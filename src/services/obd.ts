import type { ObdTelemetrySample } from '../types'

export const obdPollCommands = {
  rpm: '010C',
  speed: '010D',
  throttle: '0111',
  throttleRelative: '0145',
  acceleratorD: '0149',
  acceleratorE: '014A',
  acceleratorF: '014B',
  acceleratorRelative: '015A',
  voltage: '0142',
} as const

export type ObdMetric = keyof typeof obdPollCommands

const percent = (value: number) => Math.round((value * 1000) / 255) / 10

function cleanHex(value: string) {
  return value.toUpperCase().replace(/[^0-9A-F]/g, '')
}

function normalizePid(pidOrCommand: string) {
  const clean = cleanHex(pidOrCommand)
  if (clean.length >= 4 && clean.startsWith('01')) return clean.slice(2, 4)
  return clean.slice(0, 2)
}

export function normalizeElmResponse(raw: string) {
  return raw
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/>/g, '').trim().toUpperCase())
    .filter(Boolean)
    .filter((line) => !line.startsWith('SEARCHING'))
    .filter((line) => line !== 'OK')
}

export function extractObdPayload(pidOrCommand: string, raw: string) {
  const pid = normalizePid(pidOrCommand)

  for (const line of normalizeElmResponse(raw)) {
    const compact = cleanHex(line)
    const responseIndex = compact.indexOf(`41${pid}`)
    if (responseIndex === -1) continue

    const payload = compact.slice(responseIndex + 4)
    const bytes = payload.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []
    if (bytes.every((byte) => Number.isFinite(byte))) return bytes
  }

  return []
}

export function parseSupportedPids(command: string, raw: string) {
  const basePid = Number.parseInt(normalizePid(command), 16)
  const bytes = extractObdPayload(command, raw).slice(0, 4)
  if (bytes.length < 4) return []

  const bitField = bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n)
  const supported: string[] = []

  for (let offset = 1; offset <= 32; offset += 1) {
    const mask = 1n << BigInt(32 - offset)
    if ((bitField & mask) === 0n) continue
    supported.push((basePid + offset).toString(16).toUpperCase().padStart(2, '0'))
  }

  return supported
}

export function parsePidValue(pidOrCommand: string, raw: string): Partial<ObdTelemetrySample> {
  const pid = normalizePid(pidOrCommand)
  const bytes = extractObdPayload(pid, raw)
  if (bytes.length === 0) return {}

  const [a = 0, b = 0] = bytes

  if (pid === '0C' && bytes.length >= 2) return { rpm: Math.round(((a * 256 + b) / 4) * 10) / 10 }
  if (pid === '0D') return { speedKph: a }
  if (pid === '11' || pid === '45' || pid === '47' || pid === '48') return { throttle: percent(a) }
  if (pid === '49' || pid === '4A' || pid === '4B' || pid === '5A') return { accelerator: percent(a) }
  if (pid === '42' && bytes.length >= 2) return { voltage: Math.round(((a * 256 + b) / 1000) * 100) / 100 }

  return {}
}

export function parseObdSnapshot(responses: Partial<Record<ObdMetric, string>>, sampledAt = Date.now()) {
  const sample: ObdTelemetrySample = { sampledAt }

  for (const [metric, raw] of Object.entries(responses) as [ObdMetric, string][]) {
    Object.assign(sample, parsePidValue(obdPollCommands[metric], raw))
  }

  return sample
}

export function createMockObdSample(elapsedMs = Date.now()): ObdTelemetrySample {
  const phase = (elapsedMs / 1000) % 12
  const speedKph = Math.round(42 + Math.sin(phase / 2) * 24 + phase * 2)
  const accelerator = Math.min(92, Math.max(8, Math.round(36 + Math.sin(phase) * 28 + phase * 3)))

  return {
    rpm: Math.round(1200 + speedKph * 28 + accelerator * 22),
    speedKph,
    throttle: Math.min(100, Math.max(0, Math.round(accelerator * 0.72))),
    accelerator,
    voltage: 14.2,
    protocol: 'mock ELM327',
    supportedPids: ['0C', '0D', '11', '42', '49', '4A', '4B', '5A'],
    sampledAt: Date.now(),
  }
}

export function preferredThrottle(sample: ObdTelemetrySample | null) {
  if (!sample) return undefined
  return sample.accelerator ?? sample.throttle
}
