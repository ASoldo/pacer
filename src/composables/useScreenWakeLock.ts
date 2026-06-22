import { computed, ref } from 'vue'

type ScreenWakeLockStatus = 'idle' | 'active' | 'requesting' | 'unsupported' | 'error'

const active = ref(false)
const supported = ref(false)
const status = ref<ScreenWakeLockStatus>('idle')
const error = ref('')

let sentinel: WakeLockSentinel | null = null
let requested = false
let listening = false
let pendingRequest: Promise<boolean> | null = null

function wakeLockNavigator() {
  return navigator as Navigator & { wakeLock: WakeLock }
}

function canUseWakeLock() {
  return typeof navigator !== 'undefined' && Boolean(wakeLockNavigator().wakeLock) && window.isSecureContext
}

function errorMessage(value: unknown) {
  if (value instanceof Error && value.message) return value.message
  if (typeof value === 'string' && value) return value
  return 'Screen wake lock failed.'
}

function handleRelease() {
  sentinel?.removeEventListener('release', handleRelease)
  sentinel = null
  active.value = false
  if (requested && document.visibilityState === 'visible') {
    status.value = 'idle'
    window.setTimeout(() => {
      if (requested) void request()
    }, 250)
    return
  }
  status.value = requested ? 'idle' : 'idle'
}

async function request() {
  requested = true
  supported.value = canUseWakeLock()

  if (!supported.value) {
    active.value = false
    status.value = 'unsupported'
    error.value = window.isSecureContext ? 'Screen Wake Lock is not supported by this browser.' : 'Screen Wake Lock requires HTTPS.'
    return false
  }

  if (document.visibilityState !== 'visible') {
    status.value = 'idle'
    return false
  }

  if (sentinel && !sentinel.released) {
    active.value = true
    status.value = 'active'
    error.value = ''
    return true
  }

  if (pendingRequest) return pendingRequest

  status.value = 'requesting'
  error.value = ''
  pendingRequest = wakeLockNavigator().wakeLock!.request('screen')
    .then((nextSentinel) => {
      if (!requested) {
        void nextSentinel.release()
        return false
      }

      sentinel = nextSentinel
      sentinel.addEventListener('release', handleRelease)
      active.value = true
      status.value = 'active'
      return true
    })
    .catch((requestError: unknown) => {
      sentinel = null
      active.value = false
      status.value = 'error'
      error.value = errorMessage(requestError)
      return false
    })
    .finally(() => {
      pendingRequest = null
    })

  return pendingRequest
}

async function release() {
  requested = false
  pendingRequest = null

  const current = sentinel
  sentinel = null
  active.value = false
  status.value = 'idle'

  if (!current || current.released) return

  current.removeEventListener('release', handleRelease)
  try {
    await current.release()
  } catch (releaseError) {
    status.value = 'error'
    error.value = errorMessage(releaseError)
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible' && requested) {
    void request()
  }
}

function start() {
  supported.value = canUseWakeLock()
  if (listening) return
  listening = true
  document.addEventListener('visibilitychange', handleVisibilityChange)
}

function stop() {
  if (listening) {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    listening = false
  }
  void release()
}

export function useScreenWakeLock() {
  start()

  return {
    active: computed(() => active.value),
    supported: computed(() => supported.value),
    status: computed(() => status.value),
    error: computed(() => error.value),
    request,
    release,
    stop,
  }
}
