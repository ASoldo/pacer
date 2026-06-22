import { computed, reactive } from 'vue'
import { createMockObdSample, obdPollCommands, parsePidValue, parseSupportedPids } from '../services/obd'
import { useStageStore } from '../stores/stage'
import type { ObdMetric } from '../services/obd'
import type { ObdTelemetrySample } from '../types'

type SerialPortLike = {
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>
  close(): Promise<void>
  readable: { getReader(): { read(): Promise<{ value?: Uint8Array; done: boolean }>; releaseLock(): void; cancel(): Promise<void> } } | null
  writable: { getWriter(): { write(chunk: Uint8Array): Promise<void>; releaseLock(): void; close?: () => Promise<void> } } | null
}

type SerialNavigator = Navigator & {
  serial?: {
    requestPort(options?: unknown): Promise<SerialPortLike>
  }
}

const serialState = reactive({
  busy: false,
})

let port: SerialPortLike | null = null
let reader: ReturnType<NonNullable<SerialPortLike['readable']>['getReader']> | null = null
let writer: ReturnType<NonNullable<SerialPortLike['writable']>['getWriter']> | null = null
let readBuffer = ''
let pollTimer: number | null = null
let mockTimer: number | null = null
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const baudCandidates = [38_400, 9_600, 115_200, 57_600]
const protocolCandidates = [
  { commands: ['ATSP6', 'ATSH7DF'], label: 'BMW CAN broadcast 11/500' },
  { commands: ['ATSP6', 'ATSH7E0'], label: 'BMW CAN engine ECU 11/500' },
  { commands: ['ATSP6'], label: 'ISO 15765-4 CAN 11/500' },
  { commands: ['ATSP0'], label: 'auto protocol' },
  { commands: ['ATSP7'], label: 'ISO 15765-4 CAN 29/500' },
  { commands: ['ATSP8', 'ATSH7DF'], label: 'ISO 15765-4 CAN 11/250' },
  { commands: ['ATSP9'], label: 'ISO 15765-4 CAN 29/250' },
]

function serialApi() {
  return (navigator as SerialNavigator).serial
}

function stopTimer(timer: number | null) {
  if (timer !== null) window.clearInterval(timer)
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function sanitizeLogValue(value: string) {
  return value.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\s+/g, ' ').trim().slice(0, 260)
}

function logObd(level: 'info' | 'warn' | 'error' | 'tx' | 'rx', message: string) {
  const stage = useStageStore()
  stage.appendObdDiagnostic(level, message)

  const body = JSON.stringify({
    scope: 'obd',
    entries: [
      {
        at: new Date().toISOString(),
        level,
        message,
      },
    ],
  })

  fetch('/api/client-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function isPromptTimeout(error: unknown) {
  if (!(error instanceof Error)) return false
  return error.message.includes('did not send prompt') || error.message.includes('did not respond')
}

function isEcuFailureResponse(response: string) {
  const normalized = response.toUpperCase()
  return ['NO DATA', 'UNABLE TO CONNECT', 'CAN ERROR', 'BUS ERROR', 'BUS INIT', 'STOPPED'].some((token) =>
    normalized.includes(token),
  )
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeoutId: number
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId!))
}

async function readUntilPrompt(timeoutMs = 3_000) {
  if (!reader) throw new Error('OBD reader is not open.')

  const promptIndex = readBuffer.indexOf('>')
  if (promptIndex !== -1) {
    const response = readBuffer.slice(0, promptIndex)
    readBuffer = readBuffer.slice(promptIndex + 1)
    return response
  }

  while (true) {
    const result = await withTimeout(
      reader.read(),
      timeoutMs,
      readBuffer
        ? `OBD adapter did not send prompt. Partial response: ${sanitizeLogValue(readBuffer)}`
        : 'OBD adapter did not respond.',
    )
    if (result.done) throw new Error('OBD adapter disconnected.')
    if (result.value) readBuffer += decoder.decode(result.value)

    const nextPromptIndex = readBuffer.indexOf('>')
    if (nextPromptIndex === -1) continue

    const response = readBuffer.slice(0, nextPromptIndex)
    readBuffer = readBuffer.slice(nextPromptIndex + 1)
    return response
  }
}

async function sendCommand(command: string, timeoutMs = 3_000, trace = false) {
  if (!writer) throw new Error('OBD writer is not open.')
  if (trace) logObd('tx', command || '<CR>')
  await writer.write(encoder.encode(`${command}\r`))
  const response = await readUntilPrompt(timeoutMs)
  if (trace) logObd('rx', response ? sanitizeLogValue(response) : '<empty>')
  return response
}

async function setupElmAdapter() {
  try {
    await sendCommand('', 1_500, true)
  } catch (error) {
    logObd('warn', errorMessage(error, 'No prompt after wake command.'))
  }

  await sendCommand('ATZ', 8_000, true)
  await sleep(250)
  await sendCommand('ATE0', 3_000, true)
  await sendCommand('ATL0', 3_000, true)
  await sendCommand('ATS0', 3_000, true)
  await sendCommand('ATH0', 3_000, true)
  await sendCommand('ATCAF1', 3_000, true)
  await sendCommand('ATAT1', 3_000, true)
  await sendCommand('ATST96', 3_000, true)
  const voltage = (await sendCommand('ATRV', 3_000, true)).trim().replace(/[\r\n>]/g, ' ')
  if (voltage) logObd('info', `Adapter voltage: ${voltage}.`)
}

async function probeEcuProtocol() {
  let lastError: unknown = null
  for (const candidate of protocolCandidates) {
    try {
      logObd('info', `Trying ${candidate.label}.`)
      for (const command of candidate.commands) {
        await sendCommand(command, 3_000, true)
      }
      const protocolCode = (await sendCommand('ATDP', 3_000, true)).trim().replace(/[\r\n>]/g, ' ')
      const protocolNumber = (await sendCommand('ATDPN', 3_000, true)).trim().replace(/[\r\n>]/g, ' ')
      const supportedPids = await probeSupportedPids()
      return {
        protocol: protocolCode
          ? `${candidate.label} (${protocolNumber || protocolCode}; ${protocolCode})`
          : candidate.label,
        supportedPids,
      }
    } catch (error) {
      lastError = error
      logObd('warn', `${candidate.label} failed: ${errorMessage(error, 'unknown protocol probe error')}`)
      if (isPromptTimeout(error)) break
    }
  }

  throw lastError instanceof Error ? lastError : new Error('ECU did not answer OBD-II protocol probe.')
}

async function probeSupportedPids() {
  const supported: string[] = []
  const supportCommands = ['0100', '0120', '0140', '0160']

  for (const command of supportCommands) {
    const response = await sendCommand(command, command === '0100' ? 12_000 : 5_000, true)
    if (isEcuFailureResponse(response)) {
      throw new Error(`ECU rejected ${command}: ${sanitizeLogValue(response)}`)
    }

    const nextSupported = parseSupportedPids(command, response)
    supported.push(...nextSupported)

    const nextBase = (Number.parseInt(command.slice(2), 16) + 0x20).toString(16).toUpperCase().padStart(2, '0')
    if (!nextSupported.includes(nextBase)) break
  }

  const uniqueSupported = [...new Set(supported)]
  if (uniqueSupported.length === 0) throw new Error('ECU did not return a supported PID list.')
  return uniqueSupported
}

async function releaseSerialPort(forgetPort: boolean) {
  try {
    await reader?.cancel()
  } catch {}
  try {
    reader?.releaseLock()
  } catch {}
  try {
    writer?.releaseLock()
  } catch {}
  try {
    await port?.close()
  } catch {}

  reader = null
  writer = null
  readBuffer = ''
  serialState.busy = false
  if (forgetPort) port = null
}

function commandSupported(supportedPids: string[], command: string) {
  if (supportedPids.length === 0) return true
  return supportedPids.includes(command.slice(2).toUpperCase())
}

async function pollOnce(protocol: string, supportedPids: string[]) {
  const metrics: [ObdMetric, string][] = [
    ['rpm', obdPollCommands.rpm],
    ['speed', obdPollCommands.speed],
    ['throttle', obdPollCommands.throttle],
    ['acceleratorD', obdPollCommands.acceleratorD],
    ['acceleratorE', obdPollCommands.acceleratorE],
    ['acceleratorF', obdPollCommands.acceleratorF],
    ['acceleratorRelative', obdPollCommands.acceleratorRelative],
    ['voltage', obdPollCommands.voltage],
  ]
  const sample: ObdTelemetrySample = {
    sampledAt: Date.now(),
    protocol,
    supportedPids,
  }

  for (const [metric, command] of metrics) {
    if (!commandSupported(supportedPids, command)) continue

    try {
      Object.assign(sample, parsePidValue(command, await sendCommand(command)))
    } catch (error) {
      if (metric === 'rpm' || metric === 'speed') throw error
    }
  }

  return sample
}

function startPolling(protocol: string, supportedPids: string[]) {
  const stage = useStageStore()
  stopTimer(pollTimer)
  pollTimer = window.setInterval(async () => {
    if (serialState.busy) return

    serialState.busy = true
    try {
      stage.applyObdTelemetry(await pollOnce(protocol, supportedPids))
    } catch (error) {
      stage.setObdStatus('error', error instanceof Error ? error.message : 'OBD polling failed.')
    } finally {
      serialState.busy = false
    }
  }, 650)
}

export function useObdSerial() {
  const stage = useStageStore()
  const supported = computed(() => typeof navigator !== 'undefined' && Boolean(serialApi()))

  async function connect() {
    if (!supported.value) {
      stage.setObdStatus('unsupported', 'Web Serial is not available in this browser.')
      return
    }

    if (!window.isSecureContext) {
      stage.setObdStatus('unsupported', 'OBD needs HTTPS or localhost.')
      return
    }

    await disconnect()
    stage.clearObdTelemetry()
    stage.setObdStatus('connecting')

    try {
      port = await serialApi()!.requestPort()
      logObd('info', 'Serial port selected.')

      let lastError: unknown = null
      for (const baudRate of baudCandidates) {
        let adapterRespondedAtBaud = false
        try {
          logObd('info', `Opening serial port at ${baudRate} baud.`)
          await port.open({ baudRate, bufferSize: 255 })
          if (!port.readable || !port.writable) throw new Error('Serial port is not readable and writable.')

          reader = port.readable.getReader()
          writer = port.writable.getWriter()
          readBuffer = ''

          stage.setObdStatus('probing')
          try {
            await setupElmAdapter()
            adapterRespondedAtBaud = true
            const { protocol, supportedPids } = await probeEcuProtocol()
            stage.applyObdTelemetry({
              protocol,
              supportedPids,
              sampledAt: Date.now(),
            })
            logObd('info', `ELM327 ready: ${protocol || 'auto protocol'}, ${supportedPids.length} supported PIDs.`)
            startPolling(protocol, supportedPids)
            return
          } catch (error) {
            if (adapterRespondedAtBaud) {
              logObd('warn', `ELM327 answered but ECU probe failed: ${errorMessage(error, 'unknown ECU probe error')}`)
              throw error
            }
            throw error
          }
        } catch (error) {
          lastError = error
          logObd('warn', `${baudRate} baud failed: ${errorMessage(error, 'unknown error')}`)
          await releaseSerialPort(false)
          if (adapterRespondedAtBaud) break
        }
      }

      throw lastError instanceof Error ? lastError : new Error('OBD adapter did not respond.')
    } catch (error) {
      await releaseSerialPort(true)
      stage.setObdStatus('error', error instanceof Error ? error.message : 'OBD connection failed.')
      logObd('error', error instanceof Error ? error.message : 'OBD connection failed.')
    }
  }

  async function disconnect() {
    stopTimer(pollTimer)
    stopTimer(mockTimer)
    pollTimer = null
    mockTimer = null

    await releaseSerialPort(true)
    stage.clearObdTelemetry()
  }

  function startMock() {
    stopTimer(pollTimer)
    stopTimer(mockTimer)
    pollTimer = null

    stage.applyObdTelemetry(createMockObdSample(), true)
    mockTimer = window.setInterval(() => {
      stage.applyObdTelemetry(createMockObdSample(), true)
    }, 650)
    logObd('info', 'Mock OBD stream started.')
  }

  return {
    supported,
    busy: computed(() => serialState.busy),
    connect,
    disconnect,
    startMock,
  }
}
