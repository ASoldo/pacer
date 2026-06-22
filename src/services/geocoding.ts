import type { LocationSearchResult } from '../types'

type NominatimSearchItem = {
  place_id?: number | string
  display_name?: string
  name?: string
  lat?: string
  lon?: string
  class?: string
  type?: string
}

export async function searchLocations(query: string): Promise<LocationSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 3) return []

  const url = new URL('/api/geocode/search', window.location.origin)
  url.searchParams.set('q', trimmed)
  url.searchParams.set('limit', '6')

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Search failed (${response.status})`)

  const payload = (await response.json()) as { results?: NominatimSearchItem[] }
  const results = Array.isArray(payload.results) ? payload.results : []

  return results.flatMap((item, index) => {
    const lat = Number(item.lat)
    const lng = Number(item.lon)
    const label = String(item.display_name ?? '').trim()

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !label) return []

    return [{
      id: String(item.place_id ?? `${lat.toFixed(5)},${lng.toFixed(5)}-${index}`),
      lat,
      lng,
      label,
      name: String(item.name ?? '').trim() || label.split(',')[0]?.trim() || 'Location',
      category: [item.class, item.type].filter(Boolean).join(' / ') || 'place',
      source: 'nominatim' as const,
    }]
  })
}
