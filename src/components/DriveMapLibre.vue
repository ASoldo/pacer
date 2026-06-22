<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { LatLng, MapOrientationMode, PaceNote, RouteInfo, RouteWeatherSample } from '../types'
import { bearingDegrees, cumulativeDistances } from '../utils/geo'
import { paceCode, paceColor, paceDisplay } from '../utils/pace'

const props = defineProps<{
  route: RouteInfo | null
  paceNotes: PaceNote[]
  car: { point: LatLng; bearing: number } | null
  ghostCar: { point: LatLng; bearing: number } | null
  ghostDistance: number
  followCar: boolean
  orientationMode: MapOrientationMode
  driveRunning: boolean
  activeDistance: number
  weatherSamples: RouteWeatherSample[]
  selectedNoteId: string
  showNoteMarkers: boolean
}>()

type VisualCar = {
  point: LatLng
  bearing: number
}

type LineFeature = Feature<LineString, Record<string, string | number | boolean>>
type PointFeature = Feature<Point, Record<string, string | number | boolean>>

const frameEl = ref<HTMLDivElement | null>(null)
const mapEl = ref<HTMLDivElement | null>(null)
const mapLoaded = ref(false)
const mapZoom = ref(0)
const mapBearing = ref(0)
const routeFeatureCount = ref(0)
const noteFeatureCount = ref(0)
const kerbFeatureCount = ref(0)
const gateFeatureCount = ref(0)
const gateLineCount = ref(0)
const gatePassedCount = ref(0)
const gateGoodCount = ref(0)
const gateLateCount = ref(0)
const weatherFeatureCount = ref(0)

let driveMap: maplibregl.Map | null = null
let carMarker: maplibregl.Marker | null = null
let carMarkerBody: HTMLElement | null = null
let ghostMarker: maplibregl.Marker | null = null
let animationFrame = 0
let lastFrameAt = 0
let targetCar: VisualCar | null = null
let smoothCar: VisualCar | null = null
let resizeObserver: ResizeObserver | null = null
let lastRouteKey = ''
let lastNoteKey = ''
let lastWeatherKey = ''
let lastGateKey = ''
let lastGateRouteKey = ''
let lastGateProgressDistance = 0
let driveLayersReady = false

const driveZoom = Number(import.meta.env.VITE_DRIVE_MAPLIBRE_ZOOM ?? 18.35)
const tileUrl =
  import.meta.env.VITE_MAP_TILE_URL ??
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const tileAttribution =
  import.meta.env.VITE_MAP_ATTRIBUTION ??
  '&copy; OpenStreetMap contributors'
const tileMaxZoom = Number(import.meta.env.VITE_MAP_MAX_ZOOM ?? 19)
const tileSubdomains = (import.meta.env.VITE_MAP_SUBDOMAINS ?? '').split('').filter(Boolean)
const routeWindowBehindMeters = 520
const routeWindowAheadMeters = 3_200
const routeKerbAheadMeters = 950
const progressGateCount = 10
const gateVisualWidthMeters = 24
const gateTangentSampleMeters = 16
const earthRadiusMeters = 6_371_000

type GateStatus = 'pending' | 'good' | 'late'

const gateResults = new Map<number, Exclude<GateStatus, 'pending'>>()

const routeCumulative = computed(() => props.route ? cumulativeDistances(props.route.geometry) : [])
const routeTotal = computed(() => props.route?.distance ?? 0)
const routeKey = computed(() =>
  props.route ? `${props.route.geometry.length}:${Math.round(props.route.distance)}:${props.paceNotes.length}` : 'none',
)

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function angleDelta(from: number, to: number) {
  return ((((to - from + 180) % 360) + 360) % 360) - 180
}

function smoothStep(current: number, target: number, deltaMs: number, timeConstantMs: number) {
  const alpha = 1 - Math.exp(-deltaMs / timeConstantMs)
  return current + (target - current) * alpha
}

function smoothBearing(current: number, target: number, deltaMs: number) {
  const alpha = 1 - Math.exp(-deltaMs / 185)
  return (current + angleDelta(current, target) * alpha + 360) % 360
}

function lerpPoint(current: LatLng, target: LatLng, deltaMs: number) {
  return {
    lat: smoothStep(current.lat, target.lat, deltaMs, 92),
    lng: smoothStep(current.lng, target.lng, deltaMs, 92),
  }
}

function lngLat(point: LatLng): [number, number] {
  return [point.lng, point.lat]
}

function isFinitePoint(point: LatLng | undefined | null): point is LatLng {
  return Boolean(
    point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng),
  )
}

function isRenderableCar(car: VisualCar | undefined | null): car is VisualCar {
  return Boolean(car && isFinitePoint(car.point))
}

function finiteBearing(bearing: number | undefined | null): number {
  return typeof bearing === 'number' && Number.isFinite(bearing) ? bearing : 0
}

function emptyCollection(): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [],
  }
}

function lineFeature(coordinates: [number, number][], properties: LineFeature['properties'] = {}): LineFeature {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'LineString',
      coordinates,
    },
  }
}

function pointFeature(point: LatLng, properties: PointFeature['properties']): PointFeature {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Point',
      coordinates: lngLat(point),
    },
  }
}

function offsetPointMeters(origin: LatLng, eastMeters: number, northMeters: number): LatLng {
  const latitudeRadians = (origin.lat * Math.PI) / 180
  const latitudeScale = Math.max(Math.cos(latitudeRadians), 0.000001)

  return {
    lat: origin.lat + (northMeters / earthRadiusMeters) * (180 / Math.PI),
    lng: origin.lng + (eastMeters / (earthRadiusMeters * latitudeScale)) * (180 / Math.PI),
  }
}

function offsetByBearing(origin: LatLng, bearing: number, meters: number) {
  const radians = (bearing * Math.PI) / 180
  return offsetPointMeters(origin, Math.sin(radians) * meters, Math.cos(radians) * meters)
}

function gateDistance(index: number, total: number) {
  return total * ((index + 1) / progressGateCount)
}

function resetGateResults() {
  gateResults.clear()
  lastGateKey = ''
  lastGateProgressDistance = 0
}

function refreshGateResults(total: number) {
  if (routeKey.value !== lastGateRouteKey) {
    resetGateResults()
    lastGateRouteKey = routeKey.value
  }

  if (props.activeDistance < lastGateProgressDistance - 4) {
    for (const index of [...gateResults.keys()]) {
      if (gateDistance(index, total) > props.activeDistance) gateResults.delete(index)
    }
  }

  for (let index = 0; index < progressGateCount; index += 1) {
    const distance = gateDistance(index, total)
    if (props.activeDistance < distance || gateResults.has(index)) continue

    gateResults.set(index, props.ghostDistance > distance + 0.5 ? 'late' : 'good')
  }

  lastGateProgressDistance = props.activeDistance
}

function gateColor(status: GateStatus, current: boolean) {
  if (status === 'good') return '#22c55e'
  if (status === 'late') return '#ef4444'
  return current ? '#facc15' : '#94a3b8'
}

function weatherColor(sample: RouteWeatherSample) {
  if (sample.severity === 'severe') return '#ef4444'
  if (sample.severity === 'caution') {
    if (sample.risk === 'wet') return '#38bdf8'
    if (sample.risk === 'wind') return '#facc15'
    return '#f59e0b'
  }
  return '#22c55e'
}

function setSourceData(sourceId: string, data: FeatureCollection) {
  const source = driveMap?.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
  if (!source) return
  source.setData(data)
}

function firstIndexGreaterThan(values: number[], target: number) {
  let low = 0
  let high = values.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (values[middle] <= target) low = middle + 1
    else high = middle
  }

  return low
}

function pointAtDistance(points: LatLng[], cumulative: number[], target: number) {
  const total = cumulative[cumulative.length - 1] ?? 0
  const distance = clamp(target, 0, total)

  if (points.length === 0) return null
  if (points.length === 1 || distance <= 0) return points[0]
  if (distance >= total) return points[points.length - 1]

  const index = clamp(firstIndexGreaterThan(cumulative, distance), 1, points.length - 1)
  const start = points[index - 1]
  const end = points[index]
  const startDistance = cumulative[index - 1]
  const endDistance = cumulative[index]
  if (!isFinitePoint(start) || !isFinitePoint(end)) return points[points.length - 1] ?? null
  const ratio = endDistance === startDistance ? 0 : (distance - startDistance) / (endDistance - startDistance)

  return {
    lat: start.lat + (end.lat - start.lat) * ratio,
    lng: start.lng + (end.lng - start.lng) * ratio,
  }
}

function routeSlicePoints(points: LatLng[], cumulative: number[], startDistance: number, endDistance: number) {
  const start = pointAtDistance(points, cumulative, startDistance)
  const end = pointAtDistance(points, cumulative, endDistance)
  if (!start || !end) return []

  const slice: LatLng[] = [start]
  let index = clamp(firstIndexGreaterThan(cumulative, startDistance), 1, points.length)

  while (index < points.length && cumulative[index] < endDistance) {
    const point = points[index]
    const previous = slice[slice.length - 1]
    if (isFinitePoint(point) && (!previous || previous.lat !== point.lat || previous.lng !== point.lng)) slice.push(point)
    index += 1
  }

  const previous = slice[slice.length - 1]
  if (!previous || previous.lat !== end.lat || previous.lng !== end.lng) slice.push(end)

  return slice
}

function routeSlice(points: LatLng[], cumulative: number[], startDistance: number, endDistance: number) {
  return routeSlicePoints(points, cumulative, startDistance, endDistance)
    .filter(isFinitePoint)
    .map(lngLat)
}

function lineWindow() {
  const total = routeTotal.value
  if (!props.route) return { start: 0, end: 0 }
  if (!props.driveRunning) return { start: 0, end: total }

  return {
    start: clamp(props.activeDistance - routeWindowBehindMeters, 0, total),
    end: clamp(props.activeDistance + routeWindowAheadMeters, 0, total),
  }
}

function baseRouteFeature(points: LatLng[], cumulative: number[]) {
  const { start, end } = lineWindow()
  const coordinates = routeSlice(points, cumulative, start, end)
  return coordinates.length > 1 ? lineFeature(coordinates, { color: '#050816' }) : null
}

function kerbFeatures(points: LatLng[], cumulative: number[], total: number) {
  if (!props.driveRunning) return []

  const { start: windowStart, end: windowEnd } = lineWindow()
  const predictiveEnd = clamp(props.activeDistance + routeKerbAheadMeters, 0, total)
  const sharpNotes = props.paceNotes.filter((note) =>
    note.kind === 'corner' &&
    (note.caution || note.severity <= 3 || note.iconShape === 'square' || note.iconShape === 'hairpin' || note.iconShape === 'acute') &&
    (note.exitDistance ?? note.distance) >= Math.max(windowStart, props.activeDistance - 35) &&
    (note.entryDistance ?? note.distance) <= Math.min(windowEnd, predictiveEnd),
  )
  const features: LineFeature[] = []

  sharpNotes.forEach((note) => {
    const entry = note.entryDistance ?? note.distance - 10
    const exit = note.exitDistance ?? note.distance + 10
    const start = clamp(entry - 18, 0, total)
    const end = clamp(Math.max(exit + 18, start + 18), 0, total)
    const slice = routeSlice(points, cumulative, start, end)
    if (slice.length > 1) features.push(lineFeature(slice, { kind: 'kerb' }))
  })

  return features
}

function gateFeatures(points: LatLng[], cumulative: number[], total: number) {
  if (total <= 0 || points.length < 2) return []

  refreshGateResults(total)

  const currentGateWindow = clamp(total / (progressGateCount * 24), 10, 34)
  const features: Array<LineFeature | PointFeature> = []

  for (let index = 0; index < progressGateCount; index += 1) {
    const distance = gateDistance(index, total)
    const center = pointAtDistance(points, cumulative, distance)
    if (!center) continue

    const before = pointAtDistance(points, cumulative, distance - gateTangentSampleMeters) ?? center
    const after = pointAtDistance(points, cumulative, distance + gateTangentSampleMeters) ?? center
    const bearing = before.lat === after.lat && before.lng === after.lng ? 0 : bearingDegrees(before, after)
    const left = offsetByBearing(center, bearing - 90, gateVisualWidthMeters / 2)
    const right = offsetByBearing(center, bearing + 90, gateVisualWidthMeters / 2)
    const status: GateStatus = gateResults.get(index) ?? 'pending'
    const current = Math.abs(props.activeDistance - distance) <= currentGateWindow
    const properties = {
      kind: 'segment-gate',
      gateIndex: index,
      gateNumber: index + 1,
      distance,
      status,
      passed: status !== 'pending',
      current,
      color: gateColor(status, current),
    }

    features.push(lineFeature([lngLat(left), lngLat(right)], properties))
    features.push(pointFeature(left, { ...properties, side: 'left' }))
    features.push(pointFeature(right, { ...properties, side: 'right' }))
  }

  return features
}

function noteFeatures() {
  if (!props.showNoteMarkers) return []

  const nextIndex = props.paceNotes.findIndex((note) => note.distance >= props.activeDistance)
  const activeIndex = nextIndex === -1 ? Math.max(0, props.paceNotes.length - 1) : Math.max(0, nextIndex)
  const notes = props.paceNotes
    .slice(Math.max(0, activeIndex - 1), Math.min(props.paceNotes.length, activeIndex + 9))
    .filter((note) => note.distance >= props.activeDistance - 220 || note.id === props.selectedNoteId)

  return notes.map((note) =>
    pointFeature(note, {
      id: note.id,
      code: paceCode(note),
      label: paceDisplay(note),
      color: paceColor(note),
      active: note.id === props.selectedNoteId || note.distance >= props.activeDistance,
      kind: note.kind,
    }),
  )
}

function weatherFeatures() {
  return props.weatherSamples.map((sample) =>
    pointFeature(sample, {
      id: sample.id,
      kind: 'route-weather',
      distance: sample.distance,
      risk: sample.risk,
      severity: sample.severity,
      summary: sample.summary,
      temperatureC: Math.round(sample.temperatureC),
      windGustKph: Math.round(sample.windGustKph),
      precipitationMm: Number(sample.precipitationMm.toFixed(1)),
      color: weatherColor(sample),
      active: Math.abs(sample.distance - props.activeDistance) < Math.max(250, routeTotal.value / 28),
    }),
  )
}

function syncRouteSources(force = false) {
  if (!driveMap || !mapLoaded.value) return
  if (!props.route) {
    routeFeatureCount.value = 0
    kerbFeatureCount.value = 0
    setSourceData('drive-route-full', emptyCollection())
    setSourceData('drive-route-segments', emptyCollection())
    setSourceData('drive-route-kerbs', emptyCollection())
    syncGateSource(true)
    return
  }

  const key = `${routeKey.value}:${Math.floor(props.activeDistance / 65)}:${props.driveRunning}`
  if (!force && key === lastRouteKey) return
  lastRouteKey = key

  const points = props.route.geometry
  const cumulative = routeCumulative.value
  const total = routeTotal.value
  const fullRoute = baseRouteFeature(points, cumulative)
  const kerbs = kerbFeatures(points, cumulative, total)

  routeFeatureCount.value = fullRoute ? 1 : 0
  kerbFeatureCount.value = kerbs.length
  setSourceData('drive-route-full', {
    type: 'FeatureCollection',
    features: fullRoute ? [fullRoute] : [],
  })
  setSourceData('drive-route-segments', {
    type: 'FeatureCollection',
    features: [],
  })
  setSourceData('drive-route-kerbs', {
    type: 'FeatureCollection',
    features: kerbs,
  })
}

function syncGateSource(force = false) {
  if (!driveMap || !mapLoaded.value) return

  if (!props.route) {
    resetGateResults()
    gateFeatureCount.value = 0
    gateLineCount.value = 0
    gatePassedCount.value = 0
    gateGoodCount.value = 0
    gateLateCount.value = 0
    setSourceData('drive-route-gates', emptyCollection())
    return
  }

  const total = routeTotal.value
  refreshGateResults(total)

  const resultsSignature = Array.from({ length: progressGateCount }, (_, index) => gateResults.get(index) ?? 'pending').join('|')
  const key = [
    routeKey.value,
    Math.floor(props.activeDistance / 2),
    Math.floor(props.ghostDistance / 2),
    resultsSignature,
  ].join(':')
  if (!force && key === lastGateKey) return
  lastGateKey = key

  const features = gateFeatures(props.route.geometry, routeCumulative.value, total)
  const passed = Array.from(gateResults.values())

  gateFeatureCount.value = features.length
  gateLineCount.value = features.filter((feature) => feature.geometry.type === 'LineString').length
  gatePassedCount.value = passed.length
  gateGoodCount.value = passed.filter((status) => status === 'good').length
  gateLateCount.value = passed.filter((status) => status === 'late').length

  setSourceData('drive-route-gates', {
    type: 'FeatureCollection',
    features,
  })
}

function syncNoteSource(force = false) {
  if (!driveMap || !mapLoaded.value) return
  const key = `${props.paceNotes.length}:${props.selectedNoteId}:${Math.floor(props.activeDistance / 35)}:${props.showNoteMarkers}`
  if (!force && key === lastNoteKey) return
  lastNoteKey = key

  const features = noteFeatures()
  noteFeatureCount.value = features.length
  setSourceData('drive-notes', {
    type: 'FeatureCollection',
    features,
  })
}

function syncWeatherSource(force = false) {
  if (!driveMap || !mapLoaded.value) return
  const key = props.weatherSamples
    .map((sample) => `${sample.id}:${sample.severity}:${sample.lat.toFixed(5)}:${sample.lng.toFixed(5)}:${Math.round(sample.distance)}:${Math.round(sample.fetchedAt / 60_000)}`)
    .join('|') + `:${Math.floor(props.activeDistance / 250)}`
  if (!force && key === lastWeatherKey) return
  lastWeatherKey = key

  const features = weatherFeatures()
  weatherFeatureCount.value = features.length
  setSourceData('drive-weather', {
    type: 'FeatureCollection',
    features,
  })
}

function mapLibreTileUrl() {
  const subdomain = tileSubdomains[0] ?? ''
  return tileUrl.replace('{s}', subdomain).replace('{r}', '')
}

function driveStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [mapLibreTileUrl()],
        tileSize: 256,
        attribution: tileAttribution,
        maxzoom: tileMaxZoom,
      },
    },
    layers: [
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
      },
    ],
  }
}

function addGeoJsonSource(id: string) {
  if (driveMap?.getSource(id)) return
  driveMap?.addSource(id, {
    type: 'geojson',
    data: emptyCollection(),
  })
}

function addDriveLayers() {
  if (!driveMap) return

  ;['drive-route-kerbs-left', 'drive-route-kerbs-right'].forEach((layerId) => {
    if (driveMap?.getLayer(layerId)) driveMap.removeLayer(layerId)
  })

  addGeoJsonSource('drive-route-full')
  addGeoJsonSource('drive-route-segments')
  addGeoJsonSource('drive-route-kerbs')
  addGeoJsonSource('drive-route-gates')
  addGeoJsonSource('drive-weather')
  addGeoJsonSource('drive-notes')

  if (!driveMap.getLayer('drive-route-shadow')) {
    driveMap.addLayer({
      id: 'drive-route-shadow',
      type: 'line',
      source: 'drive-route-full',
      paint: {
        'line-color': '#020617',
        'line-width': 11,
        'line-opacity': 0.5,
        'line-blur': 1,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    })
  }

  if (!driveMap.getLayer('drive-route-outline')) {
    driveMap.addLayer({
      id: 'drive-route-outline',
      type: 'line',
      source: 'drive-route-full',
      paint: {
        'line-color': '#f8fafc',
        'line-width': 9.2,
        'line-opacity': 0.94,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    })
  }

  if (!driveMap.getLayer('drive-route-kerb-base')) {
    driveMap.addLayer({
      id: 'drive-route-kerb-base',
      type: 'line',
      source: 'drive-route-kerbs',
      paint: {
        'line-color': '#f8fafc',
        'line-width': 12.4,
        'line-opacity': 0.98,
      },
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
      },
    })
  }

  if (!driveMap.getLayer('drive-route-kerb-red')) {
    driveMap.addLayer({
      id: 'drive-route-kerb-red',
      type: 'line',
      source: 'drive-route-kerbs',
      paint: {
        'line-color': '#b91c1c',
        'line-width': 12.4,
        'line-opacity': 0.98,
        'line-dasharray': [0.62, 0.62],
      },
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
      },
    })
  }

  if (!driveMap.getLayer('drive-route-main')) {
    driveMap.addLayer({
      id: 'drive-route-main',
      type: 'line',
      source: 'drive-route-full',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 5.8,
        'line-opacity': 0.98,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    })
  }

  if (!driveMap.getLayer('drive-route-centerline')) {
    driveMap.addLayer({
      id: 'drive-route-centerline',
      type: 'line',
      source: 'drive-route-full',
      paint: {
        'line-color': '#f8fafc',
        'line-width': 1.25,
        'line-opacity': 0.9,
        'line-dasharray': [0.65, 1.45],
      },
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
      },
    })
  }

  if (!driveMap.getLayer('drive-route-gate-lines')) {
    driveMap.addLayer({
      id: 'drive-route-gate-lines',
      type: 'line',
      source: 'drive-route-gates',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['boolean', ['get', 'current'], false], 4.6, 3.2],
        'line-opacity': ['case', ['==', ['get', 'status'], 'pending'], 0.78, 0.98],
        'line-blur': 0.25,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    })
  }

  if (!driveMap.getLayer('drive-route-gate-circles')) {
    driveMap.addLayer({
      id: 'drive-route-gate-circles',
      type: 'circle',
      source: 'drive-route-gates',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['case', ['boolean', ['get', 'current'], false], 7, 5.4],
        'circle-stroke-width': ['case', ['==', ['get', 'status'], 'pending'], 1.8, 2.4],
        'circle-stroke-color': '#f8fafc',
        'circle-opacity': ['case', ['==', ['get', 'status'], 'pending'], 0.82, 0.98],
      },
    })
  }

  if (!driveMap.getLayer('drive-weather-circles')) {
    driveMap.addLayer({
      id: 'drive-weather-circles',
      type: 'circle',
      source: 'drive-weather',
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['case', ['boolean', ['get', 'active'], false], 8.5, 6.4],
        'circle-stroke-width': ['case', ['==', ['get', 'severity'], 'normal'], 2.1, 3],
        'circle-stroke-color': '#f8fafc',
        'circle-opacity': ['case', ['==', ['get', 'severity'], 'normal'], 0.78, 0.98],
      },
    })
  }

  if (!driveMap.getLayer('drive-note-circles')) {
    driveMap.addLayer({
      id: 'drive-note-circles',
      type: 'circle',
      source: 'drive-notes',
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['case', ['==', ['get', 'kind'], 'start'], 10, ['==', ['get', 'kind'], 'finish'], 10, 8],
        'circle-stroke-width': 3,
        'circle-stroke-color': '#f8fafc',
        'circle-opacity': 0.98,
      },
    })
  }

}

function carScreenOffset() {
  const height = frameEl.value?.clientHeight ?? 0
  return [0, height * 0.12] as [number, number]
}

function updateCamera(car: VisualCar) {
  if (!driveMap || !isRenderableCar(car)) return

  const bearing = props.orientationMode === 'heading-up' ? finiteBearing(car.bearing) : 0
  driveMap.easeTo({
    center: lngLat(car.point),
    zoom: Math.min(driveZoom, tileMaxZoom),
    bearing,
    pitch: 0,
    duration: 0,
    offset: carScreenOffset(),
    essential: true,
  })
  mapZoom.value = driveMap.getZoom()
  mapBearing.value = driveMap.getBearing()
}

function ensureCarMarker(car: VisualCar) {
  if (!driveMap || carMarker || !isRenderableCar(car)) return

  const element = document.createElement('div')
  element.className = 'rally-car-marker drive-maplibre-car'
  element.innerHTML = '<div class="rally-car-marker__body"><span></span></div>'
  carMarkerBody = element.querySelector('.rally-car-marker__body')
  carMarker = new maplibregl.Marker({
    element,
    anchor: 'center',
    rotationAlignment: 'viewport',
    pitchAlignment: 'viewport',
  })
    .setLngLat(lngLat(car.point))
    .addTo(driveMap)
}

function updateCarMarker(car: VisualCar) {
  if (!isRenderableCar(car)) return
  ensureCarMarker(car)
  carMarker?.setLngLat(lngLat(car.point))
  if (carMarkerBody) {
    const markerBearing = props.orientationMode === 'heading-up' ? 0 : finiteBearing(car.bearing)
    carMarkerBody.style.transform = `rotate(${markerBearing}deg)`
  }
}

function clearGhostMarker() {
  ghostMarker?.remove()
  ghostMarker = null
}

function updateGhostMarker() {
  if (
    !driveMap ||
    !isRenderableCar(props.ghostCar) ||
    !props.route ||
    props.ghostCar.point === props.car?.point
  ) {
    clearGhostMarker()
    return
  }

  const ghostLngLat = lngLat(props.ghostCar.point)

  if (!ghostMarker) {
    const element = document.createElement('div')
    element.className = 'rally-ghost-marker'
    element.innerHTML = '<div class="rally-ghost-marker__body"><span class="rally-ghost-marker__eyes"></span></div>'
    ghostMarker = new maplibregl.Marker({
      element,
      anchor: 'center',
      rotationAlignment: 'viewport',
      pitchAlignment: 'viewport',
    })
      .setLngLat(ghostLngLat)
      .addTo(driveMap)
    return
  }

  ghostMarker.setLngLat(ghostLngLat)
}

function syncTargetCar() {
  if (!isRenderableCar(props.car)) {
    targetCar = null
    smoothCar = null
    return
  }

  const nextCar: VisualCar = {
    point: { ...props.car.point },
    bearing: finiteBearing(props.car.bearing),
  }
  targetCar = nextCar
  smoothCar ??= { point: { ...nextCar.point }, bearing: nextCar.bearing }
}

function step(now: number) {
  const deltaMs = lastFrameAt ? Math.min(48, Math.max(1, now - lastFrameAt)) : 16
  lastFrameAt = now

  if (targetCar) {
    smoothCar ??= { point: { ...targetCar.point }, bearing: targetCar.bearing }
    smoothCar = {
      point: lerpPoint(smoothCar.point, targetCar.point, deltaMs),
      bearing: smoothBearing(smoothCar.bearing, targetCar.bearing, deltaMs),
    }

    updateCarMarker(smoothCar)
    if (props.followCar) updateCamera(smoothCar)
  }

  animationFrame = window.requestAnimationFrame(step)
}

function initialCenter() {
  if (isRenderableCar(props.car)) return lngLat(props.car.point)
  const first = props.route?.geometry.find(isFinitePoint)
  if (first) return lngLat(first)
  return [15.94, 45.86] as [number, number]
}

function createMap() {
  if (!mapEl.value || driveMap) return

  driveMap = new maplibregl.Map({
    container: mapEl.value,
    style: driveStyle(),
    center: initialCenter(),
    zoom: isRenderableCar(props.car) || props.route ? Math.min(driveZoom, tileMaxZoom) : 11,
    bearing: props.orientationMode === 'heading-up' && isRenderableCar(props.car) ? finiteBearing(props.car.bearing) : 0,
    attributionControl: false,
    interactive: false,
    fadeDuration: 0,
    maxZoom: tileMaxZoom,
  })
  mapZoom.value = driveMap.getZoom()
  mapBearing.value = driveMap.getBearing()

  const initializeDriveLayers = () => {
    if (!driveMap || driveLayersReady) return

    try {
      addDriveLayers()
    } catch {
      return
    }

    driveLayersReady = true
    mapLoaded.value = true
    driveMap.resize()
    syncTargetCar()
    syncRouteSources(true)
    syncGateSource(true)
    syncWeatherSource(true)
    syncNoteSource(true)
    updateGhostMarker()
    if (smoothCar) {
      updateCarMarker(smoothCar)
      updateCamera(smoothCar)
    }
  }

  driveMap.on('load', initializeDriveLayers)
  driveMap.on('styledata', initializeDriveLayers)
  driveMap.on('idle', () => {
    initializeDriveLayers()
    if (driveLayersReady) mapLoaded.value = true
  })
  window.requestAnimationFrame(initializeDriveLayers)
  window.setTimeout(initializeDriveLayers, 250)
  window.setTimeout(initializeDriveLayers, 1_000)
}

onMounted(() => {
  createMap()
  syncTargetCar()
  animationFrame = window.requestAnimationFrame(step)

  resizeObserver = new ResizeObserver(() => {
    driveMap?.resize()
    if (smoothCar) updateCamera(smoothCar)
  })
  if (frameEl.value) resizeObserver.observe(frameEl.value)
})

onBeforeUnmount(() => {
  if (animationFrame) window.cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  carMarker?.remove()
  clearGhostMarker()
  driveMap?.remove()
  carMarker = null
  driveMap = null
  driveLayersReady = false
})

watch(() => props.car, () => {
  syncTargetCar()
}, { deep: true })

watch(() => props.ghostCar, updateGhostMarker, { deep: true, flush: 'post' })

watch([routeKey, () => props.activeDistance, () => props.driveRunning], () => {
  syncRouteSources()
  syncGateSource()
}, { flush: 'post' })

watch(() => props.ghostDistance, () => {
  syncGateSource()
})

watch(() => [props.paceNotes, props.selectedNoteId, props.activeDistance, props.showNoteMarkers], () => {
  syncNoteSource()
}, { deep: true, flush: 'post' })

watch(() => [props.weatherSamples, props.activeDistance], () => {
  syncWeatherSource()
}, { deep: true, flush: 'post' })

watch(() => props.orientationMode, () => {
  if (smoothCar) updateCamera(smoothCar)
})

watch(mapLoaded, () => {
  syncRouteSources(true)
  syncGateSource(true)
  syncWeatherSource(true)
  syncNoteSource(true)
  updateGhostMarker()
})

const rendererClass = computed(() => ({
  'is-heading-up': props.orientationMode === 'heading-up',
  'is-north-up': props.orientationMode === 'north-up',
}))
</script>

<template>
  <div
    ref="frameEl"
    class="drive-maplibre relative h-full w-full overflow-hidden"
    :class="rendererClass"
    :data-drive-mode="String(true)"
    :data-drive-running="String(props.driveRunning)"
    :data-map-bearing="mapBearing.toFixed(2)"
    :data-map-loaded="String(mapLoaded)"
    :data-map-renderer="'maplibre'"
    :data-map-zoom="mapZoom.toFixed(2)"
    :data-note-count="noteFeatureCount"
    :data-route-feature-count="routeFeatureCount"
    :data-kerb-feature-count="kerbFeatureCount"
    :data-gate-feature-count="gateFeatureCount"
    :data-gate-line-count="gateLineCount"
    :data-gate-passed-count="gatePassedCount"
    :data-gate-good-count="gateGoodCount"
    :data-gate-late-count="gateLateCount"
    :data-weather-feature-count="weatherFeatureCount"
    data-testid="map-canvas"
  >
    <div
      ref="mapEl"
      class="absolute inset-0 h-full w-full"
      data-testid="maplibre-surface"
    />
  </div>
</template>
