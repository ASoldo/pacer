import { ref } from 'vue'
import type { SpeechSettings, SpeechVoiceOption } from '../types'

type SpeechJob = {
  text: string
  settings: SpeechSettings
  channel?: 'driver' | 'advisor' | 'system'
  onStart?: () => void
  onEnd?: () => void
  onError?: (error: string) => void
}

type SpeechJobOptions = {
  channel?: SpeechJob['channel']
  onStart?: () => void
  onEnd?: () => void
  onError?: (error: string) => void
}

type SpeechDriveSegment = {
  text: string
  onStart?: () => void
  onEnd?: () => void
  onError?: (error: string) => void
}

type CachedServerSpeech = {
  buffer?: AudioBuffer
  engine?: 'piper' | 'espeak-ng'
  lastUsedAt: number
  promise?: Promise<CachedServerSpeech>
}

const maxCachedServerSpeech = 10
const speechStartProbeMs = 140
const speechStartFallbackMs = 2800
const serverSpeechTimeoutMs = 4000

function estimatedSpeechMs(text: string, settings: SpeechSettings) {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length
  const textWeight = Math.max(wordCount * 360, text.length * 45)
  return Math.min(6500, Math.max(2400, textWeight / Math.max(0.65, settings.rate) + 520))
}

export function useSpeech() {
  const voices = ref<SpeechVoiceOption[]>([])
  const browserVoices = ref<SpeechSynthesisVoice[]>([])
  const serverVoices = ref<SpeechVoiceOption[]>([])
  const speaking = ref(false)
  const queueLength = ref(0)
  const unlocked = ref(false)
  const lastError = ref('')
  const backend = ref<'browser' | 'piper' | 'espeak-ng'>('browser')
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const queue: SpeechJob[] = []
  let active = false
  let activeJob: SpeechJob | null = null
  let timer: number | null = null
  let audioContext: AudioContext | null = null
  let audioSource: AudioBufferSourceNode | null = null
  let playbackToken = 0
  const serverSpeechCache = new Map<string, CachedServerSpeech>()
  const pendingPrepareKeys = new Set<string>()

  const refreshVoices = () => {
    if (!supported) return
    browserVoices.value = window.speechSynthesis.getVoices()
    if (serverVoices.value.length === 0) {
      voices.value = browserVoices.value.map((voice) => ({
        voiceURI: voice.voiceURI,
        name: voice.name,
        lang: voice.lang,
        backend: 'browser',
      }))
    }
  }

  const refreshServerVoices = async () => {
    try {
      const response = await fetch('/api/voices', {
        headers: {
          Accept: 'application/json',
        },
      })
      if (!response.ok) return
      const payload = (await response.json()) as { voices?: SpeechVoiceOption[] }
      const piperVoices = Array.isArray(payload.voices)
        ? payload.voices.filter((voice) => voice.backend === 'piper' && voice.voiceURI)
        : []

      serverVoices.value = piperVoices
      if (piperVoices.length > 0) {
        voices.value = piperVoices
        backend.value = 'piper'
      }
    } catch {
      // Browser voices remain available when the local TTS API is unreachable.
    }
  }

  const settle = () => {
    active = false
    activeJob = null
    speaking.value = false
    runQueue()
  }

  const ensureAudioContext = () => {
    audioContext ??= new AudioContext()
    void audioContext.resume()
    return audioContext
  }

  const unlockAudio = () => {
    unlocked.value = true
    try {
      const context = ensureAudioContext()
      void context.resume()
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : 'Audio unlock failed'
    }

    if (supported) window.speechSynthesis.resume()
  }

  const stopActiveAudio = () => {
    if (!audioSource) return
    audioSource.onended = null
    try {
      audioSource.stop()
    } catch {
      // The source may already have ended between animation frames.
    }
    audioSource = null
  }

  const interruptActiveJob = (message: string) => {
    if (timer) {
      window.clearTimeout(timer)
      timer = null
    }

    const interrupted = activeJob
    playbackToken += 1
    active = false
    activeJob = null
    speaking.value = false
    stopActiveAudio()
    if (supported) window.speechSynthesis.cancel()
    interrupted?.onError?.(message)
  }

  const settingsCacheKey = (text: string, settings: SpeechSettings) =>
    JSON.stringify({
      text,
      voiceURI: settings.voiceURI,
      rate: settings.rate,
      pitch: settings.pitch,
    })

  const pruneServerSpeechCache = () => {
    if (serverSpeechCache.size <= maxCachedServerSpeech) return

    const removable = [...serverSpeechCache.entries()]
      .filter(([, entry]) => entry.buffer && !entry.promise)
      .sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt)

    while (serverSpeechCache.size > maxCachedServerSpeech && removable.length > 0) {
      const [key] = removable.shift()!
      serverSpeechCache.delete(key)
    }
  }

  const fetchServerSpeech = async (text: string, settings: SpeechSettings, key: string) => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), serverSpeechTimeoutMs)
    let response: Response

    try {
      response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          rate: settings.rate,
          pitch: settings.pitch,
          voiceURI: settings.voiceURI,
        }),
      })
    } finally {
      window.clearTimeout(timeout)
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(payload?.error ?? `TTS API returned ${response.status}`)
    }

    const engine = response.headers.get('X-TTS-Engine') === 'espeak-ng' ? 'espeak-ng' : 'piper'
    const context = ensureAudioContext()
    const wav = await response.arrayBuffer()
    const buffer = await context.decodeAudioData(wav.slice(0))
    const entry: CachedServerSpeech = {
      buffer,
      engine,
      lastUsedAt: performance.now(),
    }

    serverSpeechCache.set(key, entry)
    pruneServerSpeechCache()
    return entry
  }

  const loadServerSpeech = (text: string, settings: SpeechSettings) => {
    const key = settingsCacheKey(text, settings)
    const cached = serverSpeechCache.get(key)

    if (cached?.buffer) {
      cached.lastUsedAt = performance.now()
      return Promise.resolve(cached)
    }

    if (cached?.promise) return cached.promise

    const entry: CachedServerSpeech = {
      lastUsedAt: performance.now(),
    }
    entry.promise = fetchServerSpeech(text, settings, key)
      .catch((error: unknown) => {
        serverSpeechCache.delete(key)
        throw error
      })
      .finally(() => {
        const current = serverSpeechCache.get(key)
        if (current) current.promise = undefined
      })

    serverSpeechCache.set(key, entry)
    return entry.promise
  }

  const shouldUseServerSpeech = () => !supported || backend.value === 'piper' || backend.value === 'espeak-ng'

  const playServerSpeech = async (
    job: SpeechJob,
    token: number,
  ) => {
    active = true
    unlocked.value = true
    backend.value = 'piper'

    try {
      const context = ensureAudioContext()
      if (context.state === 'suspended') await context.resume()
      const cached = await loadServerSpeech(job.text, job.settings)
      if (token !== playbackToken) return
      backend.value = cached.engine ?? 'piper'
      const source = context.createBufferSource()
      const gain = context.createGain()

      gain.gain.value = job.settings.volume
      source.buffer = cached.buffer!
      source.connect(gain)
      gain.connect(context.destination)
      source.onended = () => {
        if (token !== playbackToken) return
        if (audioSource === source) audioSource = null
        job.onEnd?.()
        settle()
      }

      audioSource = source
      lastError.value = ''
      speaking.value = true
      job.onStart?.()
      source.start()
    } catch (error) {
      if (token !== playbackToken) return
      const message = error instanceof Error ? error.message : 'TTS API failed'
      lastError.value = message
      if (supported) {
        backend.value = 'browser'
        window.speechSynthesis.resume()
        window.speechSynthesis.speak(makeUtterance(job, token, { fallbackToServerOnError: false }))
        return
      }
      job.onError?.(message)
      settle()
    }
  }

  const makeUtterance = (
    job: SpeechJob,
    token: number,
    options: { fallbackToServerOnError?: boolean } = {},
  ) => {
    const utterance = new SpeechSynthesisUtterance(job.text)
    const voice = browserVoices.value.find((item) => item.voiceURI === job.settings.voiceURI)
    let started = false
    let ended = false
    let startProbeTimer: number | null = null
    let startFallbackTimer: number | null = null
    let endFallbackTimer: number | null = null

    const clearStartFallback = () => {
      if (startProbeTimer !== null) {
        window.clearTimeout(startProbeTimer)
        startProbeTimer = null
      }

      if (startFallbackTimer === null) return
      window.clearTimeout(startFallbackTimer)
      startFallbackTimer = null
    }

    const clearEndFallback = () => {
      if (endFallbackTimer === null) return
      window.clearTimeout(endFallbackTimer)
      endFallbackTimer = null
    }

    const finish = () => {
      if (ended || token !== playbackToken) return
      ended = true
      clearStartFallback()
      clearEndFallback()
      job.onEnd?.()
      settle()
    }

    const scheduleEndFallback = () => {
      clearEndFallback()
      endFallbackTimer = window.setTimeout(finish, estimatedSpeechMs(job.text, job.settings))
    }

    const begin = (fromEvent = false) => {
      if (ended || token !== playbackToken) return
      if (started) {
        if (fromEvent) scheduleEndFallback()
        return
      }

      started = true
      clearStartFallback()
      lastError.value = ''
      backend.value = 'browser'
      speaking.value = true
      unlocked.value = true
      job.onStart?.()
      scheduleEndFallback()
    }

    const probeStart = () => {
      if (started || ended || token !== playbackToken) return
      if (window.speechSynthesis.speaking) {
        begin(false)
        return
      }

      startProbeTimer = window.setTimeout(probeStart, speechStartProbeMs)
    }

    startProbeTimer = window.setTimeout(probeStart, speechStartProbeMs)
    startFallbackTimer = window.setTimeout(() => begin(false), speechStartFallbackMs)

    utterance.rate = job.settings.rate
    utterance.pitch = job.settings.pitch
    utterance.volume = job.settings.volume
    if (voice) utterance.voice = voice

    utterance.onstart = () => begin(true)
    utterance.onend = finish
    utterance.onerror = (event) => {
      if (token !== playbackToken) return
      clearStartFallback()
      clearEndFallback()
      const message = event.error || 'Speech failed'
      lastError.value = message
      if (options.fallbackToServerOnError !== false) {
        backend.value = 'piper'
        window.speechSynthesis.cancel()
        void playServerSpeech(job, token)
        return
      }
      job.onError?.(message)
      settle()
    }

    return utterance
  }

  const runQueue = () => {
    queueLength.value = queue.length
    if (active || queue.length === 0) return

    const job = queue.shift()
    if (!job) return

    active = true
    activeJob = job
    queueLength.value = queue.length
    const token = ++playbackToken

    timer = window.setTimeout(() => {
      timer = null
      if (token !== playbackToken) return
      if (shouldUseServerSpeech()) {
        void playServerSpeech(job, token)
        return
      }

      const utterance = makeUtterance(job, token)
      window.speechSynthesis.resume()
      window.speechSynthesis.speak(utterance)
    }, job.settings.delayMs)
  }

  const speakNow = (text: string, settings: SpeechSettings, options: SpeechJobOptions = {}) => {
    if (text.trim().length === 0) return false

    if (timer) {
      window.clearTimeout(timer)
      timer = null
    }

    queue.splice(0)
    queueLength.value = 0
    activeJob = null
    const token = ++playbackToken
    active = true
    speaking.value = false
    unlocked.value = true
    ensureAudioContext()
    stopActiveAudio()
    if (supported) window.speechSynthesis.cancel()

    timer = window.setTimeout(() => {
      timer = null
      if (token !== playbackToken) return
      const job = { text, settings, channel: options.channel, onStart: options.onStart, onEnd: options.onEnd, onError: options.onError }
      activeJob = job
      if (shouldUseServerSpeech()) {
        void playServerSpeech(job, token)
        return
      }

      window.speechSynthesis.resume()
      window.speechSynthesis.speak(makeUtterance(job, token))
    }, settings.delayMs)

    return true
  }

  const enqueue = (text: string, settings: SpeechSettings, options: SpeechJobOptions = {}) => {
    queue.push({
      text,
      settings: { ...settings },
      channel: options.channel,
      onStart: options.onStart,
      onEnd: options.onEnd,
      onError: options.onError,
    })
    runQueue()
  }

  const speakDrive = (text: string, settings: SpeechSettings, options: { onStart?: () => void } = {}) => {
    if (text.trim().length === 0) return false

    unlocked.value = true
    queue.splice(0, queue.length, { text, settings: { ...settings }, onStart: options.onStart })
    queueLength.value = queue.length
    runQueue()
    return true
  }

  const speakDriveSequence = (segments: SpeechDriveSegment[], settings: SpeechSettings) => {
    const jobs = segments
      .filter((segment) => segment.text.trim().length > 0)
      .map((segment) => ({
        text: segment.text,
        settings: { ...settings },
        channel: 'driver' as const,
        onStart: segment.onStart,
        onEnd: segment.onEnd,
        onError: segment.onError,
      }))

    if (jobs.length === 0) return false

    unlocked.value = true
    const firstAdvisorIndex = queue.findIndex((job) => job.channel === 'advisor')
    if (firstAdvisorIndex >= 0) queue.splice(firstAdvisorIndex, 0, ...jobs)
    else queue.push(...jobs)
    if (activeJob?.channel === 'advisor') {
      interruptActiveJob('Interrupted by co-driver call')
    }
    queueLength.value = queue.length
    runQueue()
    return true
  }

  const prepare = (text: string, settings: SpeechSettings) => {
    if (text.trim().length === 0 || !shouldUseServerSpeech()) return false

    const key = settingsCacheKey(text, settings)
    if (serverSpeechCache.has(key) || pendingPrepareKeys.has(key)) return true

    pendingPrepareKeys.add(key)
    const schedule = () => {
      void loadServerSpeech(text, settings)
        .catch(() => {
          // Playback will surface the error if this phrase is still needed.
        })
        .finally(() => pendingPrepareKeys.delete(key))
    }

    const requestIdleCallback = window.requestIdleCallback?.bind(window)
    if (requestIdleCallback) {
      requestIdleCallback(schedule, { timeout: 900 })
    } else {
      window.setTimeout(schedule, 120)
    }

    return true
  }

  const cancel = () => {
    queue.splice(0)
    queueLength.value = 0
    playbackToken += 1
    active = false
    activeJob = null
    speaking.value = false
    lastError.value = ''

    if (timer) {
      window.clearTimeout(timer)
      timer = null
    }

    stopActiveAudio()

    if (supported) window.speechSynthesis.cancel()
  }

  if (supported) {
    refreshVoices()
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices)
  }

  void refreshServerVoices()

  return {
    voices,
    speaking,
    queueLength,
    unlocked,
    lastError,
    backend,
    supported,
    speakNow,
    enqueue,
    speakDrive,
    speakDriveSequence,
    prepare,
    cancel,
    unlock: unlockAudio,
  }
}
