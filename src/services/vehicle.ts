import type { VinDecodeResult } from '../types'

export function normalizeVin(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function vinLooksComplete(value: string) {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(normalizeVin(value))
}

export async function decodeVin(value: string, modelYear = ''): Promise<VinDecodeResult> {
  const vin = normalizeVin(value)
  const params = new URLSearchParams()

  if (modelYear.trim()) params.set('modelyear', modelYear.trim())

  const response = await fetch(`/api/vin/${encodeURIComponent(vin)}?${params.toString()}`)

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error ?? `VIN decode failed with ${response.status}`)
  }

  return response.json()
}
