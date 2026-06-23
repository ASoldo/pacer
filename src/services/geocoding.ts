import type { LatLng, LocationSearchResult } from '../types'

type NominatimSearchItem = {
  place_id?: number | string
  display_name?: string
  name?: string
  lat?: string
  lon?: string
  category?: string
  class?: string
  type?: string
  addresstype?: string
  precision?: LocationSearchResult['precision']
  query?: string
  source?: LocationSearchResult['source']
  address?: {
    house_number?: string
    housenumber?: string
    road?: string
  }
}

function queryHouseNumber(value: string) {
  const firstPart = value.split(',')[0]?.trim() ?? ''
  return firstPart.match(/(?:^|\s)(\d+[a-zA-Z]?)\s*$/)?.[1] ?? firstPart.match(/^(\d+[a-zA-Z]?)\s/)?.[1] ?? ''
}

function itemPrecision(item: NominatimSearchItem): LocationSearchResult['precision'] {
  if (item.precision) return item.precision
  const addresstype = String(item.addresstype ?? '').toLowerCase()
  const category = String(item.category ?? item.class ?? '').toLowerCase()
  const type = String(item.type ?? '').toLowerCase()

  if (item.address?.house_number || item.address?.housenumber || addresstype === 'house' || type === 'house') return 'address'
  if (item.address?.road || addresstype === 'road' || category === 'highway') return 'street'
  return 'place'
}

function locationResultFromItem(
  item: NominatimSearchItem,
  index: number,
  fallbackQuery: string,
): LocationSearchResult | null {
    const lat = Number(item.lat)
    const lng = Number(item.lon)
    const providerLabel = String(item.display_name ?? '').trim()
    const precision = itemPrecision(item)
    const requestedQuery = String(item.query ?? fallbackQuery).trim()
    const houseNumber = queryHouseNumber(requestedQuery)
    const approximateHouseMatch = Boolean(houseNumber) && precision !== 'address' && !providerLabel.includes(houseNumber)
    const label = approximateHouseMatch
      ? `${providerLabel} - pick exact point on map`
      : providerLabel

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !label) return null

    return {
      id: String(item.place_id ?? `${lat.toFixed(5)},${lng.toFixed(5)}-${index}`),
      lat,
      lng,
      label,
      name: approximateHouseMatch
        ? requestedQuery
        : String(item.name ?? '').trim() || providerLabel.split(',')[0]?.trim() || 'Location',
      category: [
        precision === 'address' ? 'address' : precision === 'street' ? 'street match' : 'place',
        item.category ?? item.class,
        item.type,
      ].filter(Boolean).join(' / '),
      precision,
      query: requestedQuery,
      source: item.source === 'photon' ? 'photon' : 'nominatim',
    }
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
    const result = locationResultFromItem(item, index, trimmed)
    return result ? [result] : []
  })
}

export async function reverseLocation(point: LatLng): Promise<LocationSearchResult | null> {
  const url = new URL('/api/geocode/reverse', window.location.origin)
  url.searchParams.set('lat', String(point.lat))
  url.searchParams.set('lng', String(point.lng))

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Reverse search failed (${response.status})`)

  const payload = (await response.json()) as { result?: NominatimSearchItem | null }
  if (!payload.result) return null

  return locationResultFromItem(payload.result, 0, String(payload.result.display_name ?? '').trim())
}
