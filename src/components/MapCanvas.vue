<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'
import type { LatLng, MapOrientationMode, PaceNote, RouteInfo, RouteMode, StagePoint } from '../types'
import { bearingDegrees, cumulativeDistances, distanceMeters, signedBearingDelta } from '../utils/geo'
import { paceCode, paceColor, paceDisplay } from '../utils/pace'

const props = defineProps<{
  waypoints: StagePoint[]
  route: RouteInfo | null
  paceNotes: PaceNote[]
  car: { point: LatLng; bearing: number } | null
  ghostCar: { point: LatLng; bearing: number } | null
  followCar: boolean
  orientationMode: MapOrientationMode
  routeMode: RouteMode
  driveMode: boolean
  driveRunning: boolean
  manualPlacementPoint: LatLng | null
  manualPlacementLabel: string
  showNoteMarkers: boolean
  activeDistance: number
  selectedNoteId: string
}>()

const emit = defineEmits<{
  'map-click': [point: LatLng]
  'select-note': [id: string]
  'waypoint-move': [id: string, point: LatLng]
}>()

type VisualCar = {
  point: LatLng
  bearing: number
}

type TargetVelocity = {
  latPerMs: number
  lngPerMs: number
}

type RouteZone = {
  start: number
  end: number
  color: string
  priority: number
}

type RouteRenderData = {
  key: string
  points: LatLng[]
  cumulative: number[]
  total: number
  tuples: L.LatLngTuple[]
  zones: RouteZone[]
}

type RouteDecorationRange = {
  start: number
  end: number
  key: string
}

type TileCoord = {
  x: number
  y: number
  z: number
}

const frameEl = ref<HTMLDivElement | null>(null)
const mapEl = ref<HTMLDivElement | null>(null)
let map: L.Map | null = null
let tileLayer: L.TileLayer | null = null
let waypointLayer: L.LayerGroup | null = null
let manualPlacementLayer: L.LayerGroup | null = null
let routeLayer: L.LayerGroup | null = null
let routeDecorationLayer: L.LayerGroup | null = null
let noteLayer: L.LayerGroup | null = null
let carLayer: L.Marker | null = null
let ghostLayer: L.Marker | null = null
let routeData: RouteRenderData | null = null
let lastRouteKey = ''
let lastRouteRenderKey = ''
let lastRouteDecorationKey = ''
let lastNoteRenderKey = ''
let animationFrame = 0
let lastFrameAt = 0
let driveZoomFrame = 0
let routeDecorationFrame = 0
let forceRouteDecoration = false
let lastTilePreloadAt = 0
let lastTilePreloadKey = ''
let targetCar: VisualCar | null = null
let previousTargetCar: VisualCar | null = null
let targetUpdatedAt = 0
let targetVelocity: TargetVelocity = { latPerMs: 0, lngPerMs: 0 }
let smoothCar: VisualCar | null = null
let resizeObserver: ResizeObserver | null = null
let resizeFrame = 0
let resizeToken = 0
let smoothedLateralLead = 0
let lateralLeadUpdatedAt = 0
let lastFollowCenter: L.LatLng | null = null
let lastFollowZoom = 0
let lastAppliedRotation: number | null = null
let lastAppliedOrigin: L.Point | null = null
let lastAppliedZoom = ''
let lastRotationUpdateAt = 0
const rotatedPaneNames = ['tilePane', 'overlayPane', 'markerPane', 'tooltipPane'] as const
const simulationStartZoom = 19
const mapRotationMinFrameMs = 72
const mapRotationMinDeltaDeg = 1.15
const mapRotationFastDeltaDeg = 3.25
const mapRotationMinOriginDeltaPx = 1.5
const tileUrl =
  import.meta.env.VITE_MAP_TILE_URL ??
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const tileAttribution =
  import.meta.env.VITE_MAP_ATTRIBUTION ??
  '&copy; OpenStreetMap contributors'
const tileMaxZoom = Number(import.meta.env.VITE_MAP_MAX_ZOOM ?? 19)
const tileSubdomains = (import.meta.env.VITE_MAP_SUBDOMAINS ?? '').split('')
const routeDecorationsEnabled = false
const rememberedPreloadedTileKeys: string[] = []
const preloadedTileKeys = new Set<string>()
const pendingTileImages = new Map<string, HTMLImageElement>()
const maxRememberedPreloadedTiles = 420
const maxTilePreloadsPerTick = 8
const driveRouteBehindMeters = 420
const driveRouteAheadMeters = 2_600
const driveRouteBucketMeters = 95

const routeKey = computed(() =>
  props.route ? `${props.route.geometry.length}-${Math.round(props.route.distance)}-${props.paceNotes.length}` : '',
)
const mapBleedPixels = computed(() => (props.driveMode && props.orientationMode === 'heading-up' ? 320 : 0))

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function mapLabel(value: string) {
  return `<span class="map-label__inner">${escapeHtml(value)}</span>`
}

function stageWaypointLabel(value: string) {
  return escapeHtml(value)
}

function tileUrlForCoord(coord: TileCoord) {
  const subdomain = tileSubdomains.length
    ? tileSubdomains[Math.abs(coord.x + coord.y) % tileSubdomains.length]
    : ''

  return tileUrl
    .replace('{s}', subdomain)
    .replace('{z}', String(coord.z))
    .replace('{x}', String(coord.x))
    .replace('{y}', String(coord.y))
    .replace('{r}', '')
}

function rememberPreloadedTile(key: string) {
  if (preloadedTileKeys.has(key)) return

  preloadedTileKeys.add(key)
  rememberedPreloadedTileKeys.push(key)

  while (rememberedPreloadedTileKeys.length > maxRememberedPreloadedTiles) {
    const removed = rememberedPreloadedTileKeys.shift()
    if (removed) preloadedTileKeys.delete(removed)
  }
}

function preloadTile(coord: TileCoord) {
  const key = `${coord.z}/${coord.x}/${coord.y}`
  if (preloadedTileKeys.has(key) || pendingTileImages.has(key)) return false

  rememberPreloadedTile(key)

  const image = new Image()
  pendingTileImages.set(key, image)
  image.decoding = 'async'
  image.onload = image.onerror = () => {
    pendingTileImages.delete(key)
    image.onload = null
    image.onerror = null
  }
  image.src = tileUrlForCoord(coord)

  return true
}

function tileCoordFor(point: LatLng, zoom: number) {
  if (!map) return null

  const scale = 2 ** zoom
  const tilePoint = map.project([point.lat, point.lng], zoom).divideBy(256).floor()

  return {
    x: ((tilePoint.x % scale) + scale) % scale,
    y: clamp(tilePoint.y, 0, scale - 1),
    z: zoom,
  }
}

function wrappedTileCoord(coord: TileCoord, dx: number, dy: number) {
  const scale = 2 ** coord.z

  return {
    x: ((coord.x + dx) % scale + scale) % scale,
    y: clamp(coord.y + dy, 0, scale - 1),
    z: coord.z,
  }
}

function pointAhead(point: LatLng, bearing: number, meters: number) {
  const earthRadius = 6_371_000
  const angularDistance = meters / earthRadius
  const bearingRad = (bearing * Math.PI) / 180
  const lat1 = (point.lat * Math.PI) / 180
  const lng1 = (point.lng * Math.PI) / 180
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad),
  )
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    )

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: ((((lng2 * 180) / Math.PI + 540) % 360) - 180),
  }
}

function preloadTilesAhead(car: VisualCar, now = performance.now()) {
  if (!map || !tileLayer || !props.driveMode || !props.followCar) return
  if (now - lastTilePreloadAt < 360) return

  const zoom = Math.min(tileMaxZoom, Math.max(0, Math.round(map.getZoom())))
  if (zoom < 15) return

  const aheadDistances = zoom >= 18
    ? [90, 180, 300, 460, 680]
    : [180, 380, 700]
  const tileRadius = zoom >= 18 ? 1 : 0
  const coords: TileCoord[] = []
  const coordKeys = new Set<string>()
  const data = getRouteData()

  aheadDistances.forEach((distance) => {
    const point = data
      ? pointAtDistance(data.points, data.cumulative, props.activeDistance + distance)
      : pointAhead(car.point, car.bearing, distance)
    if (!point) return

    const centerCoord = tileCoordFor(point, zoom)
    if (!centerCoord) return

    for (let dy = -tileRadius; dy <= tileRadius; dy += 1) {
      for (let dx = -tileRadius; dx <= tileRadius; dx += 1) {
        const coord = wrappedTileCoord(centerCoord, dx, dy)
        const key = `${coord.z}/${coord.x}/${coord.y}`
        if (coordKeys.has(key)) continue
        coordKeys.add(key)
        coords.push(coord)
      }
    }
  })

  if (coords.length === 0) return

  const preloadKey = coords.map((coord) => `${coord.z}/${coord.x}/${coord.y}`).join('|')
  if (preloadKey === lastTilePreloadKey) return

  lastTilePreloadAt = now
  lastTilePreloadKey = preloadKey

  let started = 0
  coords.some((coord) => {
    if (started >= maxTilePreloadsPerTick) return true
    if (preloadTile(coord)) started += 1
    return false
  })
}

function clearLayer(layer: L.LayerGroup | L.Marker | null) {
  if (layer && map) map.removeLayer(layer)
}

function followedCar() {
  return smoothCar ?? targetCar
}

function angleDelta(from: number, to: number) {
  return ((((to - from + 180) % 360) + 360) % 360) - 180
}

function smoothStep(current: number, target: number, deltaMs: number, timeConstantMs: number) {
  const alpha = 1 - Math.exp(-deltaMs / timeConstantMs)
  return current + (target - current) * alpha
}

function smoothBearing(current: number, target: number, deltaMs: number) {
  const alpha = 1 - Math.exp(-deltaMs / 190)
  return (current + angleDelta(current, target) * alpha + 360) % 360
}

function lerpPoint(current: LatLng, target: LatLng, deltaMs: number) {
  return {
    lat: smoothStep(current.lat, target.lat, deltaMs, 95),
    lng: smoothStep(current.lng, target.lng, deltaMs, 95),
  }
}

function predictedTarget(now: number) {
  if (!targetCar) return null

  const predictionMs = Math.min(Math.max(now - targetUpdatedAt, 0), 260)

  return {
    point: {
      lat: targetCar.point.lat + targetVelocity.latPerMs * predictionMs,
      lng: targetCar.point.lng + targetVelocity.lngPerMs * predictionMs,
    },
    bearing: targetCar.bearing,
  }
}

function rotationFor(car: VisualCar | null) {
  if (!car || !props.followCar || props.orientationMode !== 'heading-up') return 0
  return -car.bearing
}

function resetLateralLead() {
  smoothedLateralLead = 0
  lateralLeadUpdatedAt = 0
}

function resetFollowViewCache() {
  lastFollowCenter = null
  lastFollowZoom = 0
}

function resetRotationCache() {
  lastAppliedRotation = null
  lastAppliedOrigin = null
  lastAppliedZoom = ''
  lastRotationUpdateAt = 0
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function clampRouteMeters(value: number, total: number) {
  return Math.min(Math.max(value, 0), total)
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
  const distance = clampRouteMeters(target, total)

  if (points.length === 0) return null
  if (points.length === 1 || distance <= 0) return points[0]
  if (distance >= total) return points[points.length - 1]

  const index = Math.max(1, firstIndexGreaterThan(cumulative, distance))
  const start = points[index - 1]
  const end = points[index]
  const startDistance = cumulative[index - 1]
  const endDistance = cumulative[index]
  const ratio = endDistance === startDistance ? 0 : (distance - startDistance) / (endDistance - startDistance)

  return {
    lat: start.lat + (end.lat - start.lat) * ratio,
    lng: start.lng + (end.lng - start.lng) * ratio,
  }
}

function routeSlice(points: LatLng[], cumulative: number[], startDistance: number, endDistance: number) {
  const start = pointAtDistance(points, cumulative, startDistance)
  const end = pointAtDistance(points, cumulative, endDistance)
  if (!start || !end) return []

  const slice: LatLng[] = [start]
  let index = firstIndexGreaterThan(cumulative, startDistance)

  while (index < points.length && cumulative[index] < endDistance) {
    const point = points[index]
    const previous = slice[slice.length - 1]
    if (!previous || previous.lat !== point.lat || previous.lng !== point.lng) slice.push(point)
    index += 1
  }

  const previous = slice[slice.length - 1]
  if (!previous || previous.lat !== end.lat || previous.lng !== end.lng) slice.push(end)

  return slice.map((point) => [point.lat, point.lng] as L.LatLngTuple)
}

function routeZones(total: number) {
  const zones: RouteZone[] = []

  props.paceNotes.forEach((note) => {
    if (note.kind === 'start') return

    if (note.kind === 'finish') {
      zones.push({
        start: clampRouteMeters(note.distance - 95, total),
        end: clampRouteMeters(note.distance, total),
        color: paceColor(note),
        priority: 2,
      })
      return
    }

    if (note.kind !== 'corner' && note.kind !== 'junction') return

    const entry = note.entryDistance ?? note.distance
    const exit = note.exitDistance ?? note.distance
    const severe = note.caution || note.severity <= 2 || note.iconShape === 'acute' || note.iconShape === 'hairpin'
    const medium = note.severity <= 4 || note.iconShape === 'square'

    if (severe) {
      zones.push({
        start: clampRouteMeters(entry - 125, total),
        end: clampRouteMeters(note.distance - 42, total),
        color: '#f59e0b',
        priority: 2,
      })
      zones.push({
        start: clampRouteMeters(note.distance - 42, total),
        end: clampRouteMeters(exit + 30, total),
        color: '#ef4444',
        priority: 4,
      })
      zones.push({
        start: clampRouteMeters(exit + 30, total),
        end: clampRouteMeters(exit + 110, total),
        color: '#22c55e',
        priority: 1,
      })
      return
    }

    if (medium) {
      zones.push({
        start: clampRouteMeters(entry - 80, total),
        end: clampRouteMeters(exit + 36, total),
        color: '#f59e0b',
        priority: 2,
      })
      return
    }

    zones.push({
      start: clampRouteMeters(entry - 42, total),
      end: clampRouteMeters(exit + 24, total),
      color: '#84cc16',
      priority: 1,
    })
  })

  return zones.filter((zone) => zone.end - zone.start > 1)
}

function routeColorAt(distance: number, zones: RouteZone[]) {
  const active = zones
    .filter((zone) => distance >= zone.start && distance <= zone.end)
    .sort((a, b) => b.priority - a.priority || (a.end - a.start) - (b.end - b.start))[0]

  return active?.color ?? '#22c55e'
}

function routeCuts(
  cumulative: number[],
  zones: RouteZone[],
  total: number,
  startDistance = 0,
  endDistance = total,
) {
  const windowStart = clampRouteMeters(startDistance, total)
  const windowEnd = clampRouteMeters(endDistance, total)
  const cuts = [
    windowStart,
    windowEnd,
    ...cumulative.filter((distance) => distance > windowStart && distance < windowEnd),
    ...zones.flatMap((zone) => [zone.start, zone.end]).filter((distance) => distance > windowStart && distance < windowEnd),
  ]
    .map((distance) => clampRouteMeters(distance, total))
    .sort((a, b) => a - b)

  const unique: number[] = []
  cuts.forEach((distance) => {
    if (unique.length === 0 || Math.abs(distance - unique[unique.length - 1]) > 0.75) {
      unique.push(distance)
    }
  })

  return unique
}

function sliceIntersectsBounds(slice: L.LatLngTuple[], bounds: L.LatLngBounds | null) {
  if (!bounds) return true

  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  let minLng = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY

  slice.forEach(([lat, lng]) => {
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
  })

  return (
    maxLat >= bounds.getSouth() &&
    minLat <= bounds.getNorth() &&
    maxLng >= bounds.getWest() &&
    minLng <= bounds.getEast()
  )
}

function routeSegmentLayers(
  points: LatLng[],
  cumulative: number[],
  zones: RouteZone[],
  total: number,
  startDistance = 0,
  endDistance = total,
  bounds: L.LatLngBounds | null = null,
) {
  const cuts = routeCuts(cumulative, zones, total, startDistance, endDistance)
  const segments: { color: string; points: L.LatLngTuple[] }[] = []
  let active: { color: string; points: L.LatLngTuple[] } | null = null

  for (let index = 1; index < cuts.length; index += 1) {
    const start = cuts[index - 1]
    const end = cuts[index]
    if (end - start < 1) continue

    const color = routeColorAt((start + end) / 2, zones)
    const slice = routeSlice(points, cumulative, start, end)
    if (slice.length < 2) continue
    if (!sliceIntersectsBounds(slice, bounds)) continue

    if (active && active.color === color) {
      active.points.push(...slice.slice(1))
    } else {
      active = { color, points: slice }
      segments.push(active)
    }
  }

  return segments.map((segment) =>
    L.polyline(segment.points, {
      color: segment.color,
      weight: 5,
      opacity: 0.98,
      lineCap: 'round',
      lineJoin: 'round',
      className: 'rally-route-line',
    }),
  )
}

function chicaneKerbLayers(
  points: LatLng[],
  cumulative: number[],
  total: number,
  startDistance = 0,
  endDistance = total,
  bounds: L.LatLngBounds | null = null,
) {
  const sharpNotes = props.paceNotes.filter((note) =>
    note.kind === 'corner' &&
    (note.caution || note.severity <= 3 || note.iconShape === 'square' || note.iconShape === 'hairpin' || note.iconShape === 'acute') &&
    typeof note.entryDistance === 'number' &&
    typeof note.exitDistance === 'number' &&
    (note.exitDistance ?? note.distance) >= startDistance &&
    (note.entryDistance ?? note.distance) <= endDistance,
  )

  return sharpNotes.flatMap((note) => {
    const start = clampRouteMeters((note.entryDistance ?? note.distance) - 18, total)
    const end = clampRouteMeters((note.exitDistance ?? note.distance) + 18, total)
    const slice = routeSlice(points, cumulative, start, end)
    if (slice.length < 2) return []
    if (!sliceIntersectsBounds(slice, bounds)) return []

    return [
      L.polyline(slice, {
        color: '#f8fafc',
        weight: 12,
        opacity: 0.96,
        lineCap: 'butt',
        lineJoin: 'round',
        dashArray: '12 12',
        className: 'rally-route-kerb',
      }),
      L.polyline(slice, {
        color: '#ef4444',
        weight: 12,
        opacity: 0.96,
        lineCap: 'butt',
        lineJoin: 'round',
        dashArray: '12 12',
        dashOffset: '12',
        className: 'rally-route-kerb',
      }),
    ]
  })
}

function getRouteData() {
  if (!props.route) return null
  if (routeData?.key === routeKey.value) return routeData

  const points = props.route.geometry
  const cumulative = cumulativeDistances(points)
  const total = cumulative[cumulative.length - 1] ?? props.route.distance

  routeData = {
    key: routeKey.value,
    points,
    cumulative,
    total,
    tuples: points.map((point) => [point.lat, point.lng] as L.LatLngTuple),
    zones: routeZones(total),
  }

  return routeData
}

function driveRouteBucket() {
  return Math.floor(props.activeDistance / driveRouteBucketMeters)
}

function routeRenderKey(data: RouteRenderData) {
  if (!props.driveMode) return `${data.key}:edit`
  return `${data.key}:drive:${driveRouteBucket()}`
}

function routeRenderTuples(data: RouteRenderData) {
  if (!props.driveMode) return data.tuples

  const start = clampRouteMeters(props.activeDistance - driveRouteBehindMeters, data.total)
  const end = clampRouteMeters(props.activeDistance + driveRouteAheadMeters, data.total)
  const tuples = routeSlice(data.points, data.cumulative, start, Math.max(start + 4, end))

  return tuples.length >= 2 ? tuples : data.tuples.slice(0, 2)
}

function isRouteAnchor(note: PaceNote) {
  return note.kind === 'start' || note.kind === 'finish' || note.kind === 'corner' || note.kind === 'junction'
}

function noteStartDistance(note: PaceNote) {
  if (note.kind === 'corner' || note.kind === 'junction') return note.entryDistance ?? note.distance
  return note.distance
}

function noteEndDistance(note: PaceNote) {
  if (note.kind === 'corner' || note.kind === 'junction') return note.exitDistance ?? note.distance
  return note.distance
}

function routeAnchors() {
  return props.paceNotes
    .filter(isRouteAnchor)
    .sort((a, b) => a.distance - b.distance)
}

function decorationDistanceWindow(total: number): RouteDecorationRange {
  const active = clampRouteMeters(props.activeDistance, total)
  const anchors = routeAnchors()

  if (anchors.length === 0) {
    const start = active
    const end = clampRouteMeters(active + 800, total)
    return { start, end, key: `empty:${Math.round(start)}:${Math.round(end)}` }
  }

  const currentIndex = anchors.findIndex((note) => noteEndDistance(note) >= active - 8)
  const safeCurrentIndex = currentIndex === -1 ? anchors.length - 1 : Math.max(0, currentIndex)
  const current = anchors[safeCurrentIndex]
  const next = anchors[safeCurrentIndex + 1] ?? current
  const currentPadding = current.kind === 'start' ? 0 : 22
  const nextPadding = next.kind === 'finish' ? 0 : 22
  const start = clampRouteMeters(noteStartDistance(current) - currentPadding, total)
  const end = clampRouteMeters(Math.max(noteEndDistance(next) + nextPadding, start + 80), total)

  return {
    start,
    end,
    key: `${current.id}:${next.id}:${Math.round(start)}:${Math.round(end)}`,
  }
}

function decorationBounds() {
  if (!map) return null
  return map.getBounds().pad(props.driveMode ? 0.45 : 0.3)
}

function boundsKey() {
  if (!map || props.driveMode) return 'follow'

  const bounds = map.getBounds()
  const bucket = 250
  return [
    bounds.getSouth(),
    bounds.getWest(),
    bounds.getNorth(),
    bounds.getEast(),
  ]
    .map((value) => Math.round(value * bucket))
    .join(':')
}

function routeDecorationKey(data: RouteRenderData) {
  const zoom = map?.getZoom() ?? 0
  const zoomBucket = Math.floor(zoom * 2) / 2
  const range = decorationDistanceWindow(data.total)

  return [
    data.key,
    props.driveMode ? 'drive' : 'edit',
    props.orientationMode,
    zoomBucket,
    range.key,
    boundsKey(),
  ].join(':')
}

function renderRouteDecorations(force = false) {
  if (!map) return

  if (!routeDecorationsEnabled) {
    clearLayer(routeDecorationLayer)
    routeDecorationLayer = null
    lastRouteDecorationKey = ''
    return
  }

  const data = getRouteData()
  if (!data) {
    clearLayer(routeDecorationLayer)
    routeDecorationLayer = null
    lastRouteDecorationKey = ''
    return
  }

  const key = routeDecorationKey(data)
  if (!force && key === lastRouteDecorationKey) return
  lastRouteDecorationKey = key

  clearLayer(routeDecorationLayer)

  const { start, end } = decorationDistanceWindow(data.total)
  const bounds = decorationBounds()
  const zones = data.zones.filter((zone) => zone.end >= start && zone.start <= end)
  const kerbs = chicaneKerbLayers(data.points, data.cumulative, data.total, start, end, bounds)
  const segments = routeSegmentLayers(data.points, data.cumulative, zones, data.total, start, end, bounds)

  routeDecorationLayer = L.layerGroup([...kerbs, ...segments]).addTo(map)
}

function scheduleRouteDecorations(force = false) {
  if (!routeDecorationsEnabled) return

  forceRouteDecoration ||= force
  if (routeDecorationFrame) return

  routeDecorationFrame = window.requestAnimationFrame(() => {
    const shouldForce = forceRouteDecoration
    forceRouteDecoration = false
    routeDecorationFrame = 0
    renderRouteDecorations(shouldForce)
  })
}

function targetLateralLead(car: VisualCar, size: L.Point) {
  if (!props.driveMode || props.orientationMode !== 'heading-up') return 0

  const data = getRouteData()
  if (!data) return 0

  const before = pointAtDistance(data.points, data.cumulative, props.activeDistance + 90)
  const after = pointAtDistance(data.points, data.cumulative, props.activeDistance + 138)
  if (!before || !after || distanceMeters(before, after) < 0.5) return 0

  const turnDelta = signedBearingDelta(car.bearing, bearingDegrees(before, after))
  const turnStrength = clamp((Math.abs(turnDelta) - 4) / 58, 0, 1)
  const maxLead = Math.min(30, size.x * 0.06)

  return -Math.sign(turnDelta) * turnStrength * maxLead
}

function lateralLeadFor(car: VisualCar, size: L.Point) {
  const now = performance.now()
  const deltaMs = lateralLeadUpdatedAt ? clamp(now - lateralLeadUpdatedAt, 1, 80) : 16
  lateralLeadUpdatedAt = now

  const target = targetLateralLead(car, size)
  smoothedLateralLead = smoothStep(smoothedLateralLead, target, deltaMs, 260)

  if (Math.abs(smoothedLateralLead) < 0.2) smoothedLateralLead = 0
  return smoothedLateralLead
}

function followAnchorOffset(car: VisualCar, zoom = map?.getZoom() ?? 0) {
  if (!map || !props.driveMode) return null

  const size = frameEl.value ? L.point(frameEl.value.clientWidth, frameEl.value.clientHeight) : map.getSize()
  const targetY = size.y * (size.x < 1024 ? 0.6 : 0.58)
  const dy = targetY - size.y / 2
  const offset = L.point(lateralLeadFor(car, size), dy)
  const carPoint = map.project([car.point.lat, car.point.lng], zoom)

  return map.unproject(carPoint.subtract(offset), zoom)
}

function setFollowView(car: VisualCar, zoom = map?.getZoom() ?? 0) {
  if (!map) return

  const center = followAnchorOffset(car, zoom)
  const targetCenter = L.latLng(center ?? [car.point.lat, car.point.lng])
  const currentCenter = map.getCenter()
  const currentPoint = map.project(currentCenter, zoom)
  const targetPoint = map.project(targetCenter, zoom)
  const centerDeltaPixels = currentPoint.distanceTo(targetPoint)
  const zoomDelta = Math.abs(map.getZoom() - zoom)

  if (lastFollowCenter && zoomDelta <= 0.1 && centerDeltaPixels < 0.35) return

  if (!lastFollowCenter || zoomDelta > 0.1 || centerDeltaPixels > 0.35) {
    map.setView(targetCenter, zoom, { animate: false })
    lastFollowCenter = targetCenter
    lastFollowZoom = zoom
  } else if (lastFollowZoom !== zoom) {
    lastFollowZoom = zoom
  }
}

function applyMapRotation(car = smoothCar, now = performance.now()) {
  if (!map) return

  const rotation = rotationFor(car)
  const container = map.getContainer()
  const origin = car
    ? map.latLngToLayerPoint([car.point.lat, car.point.lng])
    : map.latLngToLayerPoint(map.getCenter())
  const zoom = map.getZoom().toFixed(2)
  const rotationDelta = lastAppliedRotation === null ? Number.POSITIVE_INFINITY : Math.abs(angleDelta(lastAppliedRotation, rotation))
  const originDelta = lastAppliedOrigin ? origin.distanceTo(lastAppliedOrigin) : Number.POSITIVE_INFINITY
  const rotationChanged = lastAppliedRotation === null || rotationDelta > 0.05
  const originChanged = rotation !== 0 && (!lastAppliedOrigin || originDelta > 0.35)
  const zoomChanged = zoom !== lastAppliedZoom
  const timeSinceRotationUpdate = now - lastRotationUpdateAt
  const shouldThrottleHeading =
    rotation !== 0 &&
    lastAppliedRotation !== null &&
    !zoomChanged &&
    timeSinceRotationUpdate < mapRotationMinFrameMs &&
    rotationDelta < mapRotationFastDeltaDeg &&
    originDelta < 8

  if (!rotationChanged && !originChanged && !zoomChanged) return
  if (shouldThrottleHeading) return
  if (
    rotation !== 0 &&
    lastAppliedRotation !== null &&
    !zoomChanged &&
    rotationDelta < mapRotationMinDeltaDeg &&
    originDelta < mapRotationMinOriginDeltaPx &&
    timeSinceRotationUpdate < mapRotationMinFrameMs * 2
  ) {
    return
  }

  container.classList.toggle('map-heading-up', rotation !== 0)
  container.style.setProperty('--map-rotation', `${rotation}deg`)
  container.style.setProperty('--map-counter-rotation', `${-rotation}deg`)
  container.dataset.zoom = zoom

  rotatedPaneNames.forEach((paneName) => {
    const pane = map?.getPane(paneName)
    if (!pane) return
    pane.style.transformOrigin = `${origin.x}px ${origin.y}px`
    pane.style.transform = rotation === 0 ? '' : `translateZ(0) rotate(${rotation}deg)`
  })

  lastAppliedRotation = rotation
  lastAppliedOrigin = origin
  lastAppliedZoom = zoom
  lastRotationUpdateAt = now
}

function recenterOnCar() {
  if (!map || !props.followCar) return

  const car = followedCar()
  if (!car) return

  setFollowView(car)
  applyMapRotation(car)
}

function zoomToSimulationStart() {
  if (!map) return

  const car = followedCar() ?? (props.car ? { point: props.car.point, bearing: props.car.bearing } : null)
  if (!car) return

  const zoom = Number.isFinite(map.getMaxZoom()) ? Math.min(simulationStartZoom, map.getMaxZoom()) : simulationStartZoom
  setFollowView(car, zoom)
  map.getContainer().dataset.zoom = map.getZoom().toFixed(2)
  applyMapRotation(car)
  preloadTilesAhead(car)
  renderNotes(true)
  scheduleRouteDecorations(true)
  scheduleMapResize(6)
}

function scheduleDriveStartZoom(timeoutMs = 3_000) {
  if (driveZoomFrame) window.cancelAnimationFrame(driveZoomFrame)
  const startedAt = performance.now()

  const tick = () => {
    zoomToSimulationStart()
    const targetZoom = map && Number.isFinite(map.getMaxZoom())
      ? Math.min(simulationStartZoom, map.getMaxZoom())
      : simulationStartZoom

    if (map && map.getZoom() < targetZoom - 0.1 && performance.now() - startedAt < timeoutMs) {
      driveZoomFrame = window.requestAnimationFrame(tick)
      return
    }

    driveZoomFrame = 0
  }

  driveZoomFrame = window.requestAnimationFrame(tick)
}

function refreshMapSize() {
  if (!map) return

  map.invalidateSize({ pan: false })
  recenterOnCar()
  renderNotes(true)
}

function scheduleMapResize(frames = 6) {
  const token = ++resizeToken
  if (resizeFrame) window.cancelAnimationFrame(resizeFrame)

  const tick = (remaining: number) => {
    if (token !== resizeToken) return
    refreshMapSize()

    if (remaining > 1) {
      resizeFrame = window.requestAnimationFrame(() => tick(remaining - 1))
      return
    }

    resizeFrame = 0
  }

  resizeFrame = window.requestAnimationFrame(() => tick(frames))
}

function handleMapResize() {
  scheduleMapResize(8)
}

function setTargetCar(car: VisualCar | null) {
  const now = performance.now()

  if (!car) {
    targetCar = null
    previousTargetCar = null
    smoothCar = null
    targetVelocity = { latPerMs: 0, lngPerMs: 0 }
    resetLateralLead()
    resetFollowViewCache()
    resetRotationCache()
    return
  }

  previousTargetCar = targetCar
  targetCar = car

  if (previousTargetCar) {
    const elapsed = Math.max(16, now - targetUpdatedAt)
    const traveled = distanceMeters(previousTargetCar.point, car.point)
    const metersPerSecond = (traveled / elapsed) * 1000

    if (metersPerSecond < 95) {
      targetVelocity = {
        latPerMs: (car.point.lat - previousTargetCar.point.lat) / elapsed,
        lngPerMs: (car.point.lng - previousTargetCar.point.lng) / elapsed,
      }
    } else {
      targetVelocity = { latPerMs: 0, lngPerMs: 0 }
    }
  }

  targetUpdatedAt = now
  smoothCar ??= { point: { ...car.point }, bearing: car.bearing }
}

function syncTargetCarFromProps() {
  if (!props.car) {
    setTargetCar(null)
    return false
  }

  setTargetCar({
    point: { ...props.car.point },
    bearing: props.car.bearing,
  })

  return true
}

function renderWaypoints() {
  if (!map) return
  clearLayer(waypointLayer)
  waypointLayer = L.layerGroup()

  props.waypoints.forEach((point, index) => {
    const isCircuit = props.routeMode === 'closed-circuit'
    const isStart = index === 0
    const isPointToPointFinish = !isCircuit && index === props.waypoints.length - 1
    const isControl = isStart || isPointToPointFinish
    const label = stageWaypointLabel(point.name)
    const markerBody = isControl
      ? `
              <div class="stage-waypoint-marker__body ${isCircuit ? 'is-circuit' : isStart ? 'is-start' : 'is-finish'}" aria-hidden="true">
                <span class="stage-waypoint-marker__pole"></span>
                <span class="stage-waypoint-marker__flag"></span>
              </div>
            `
      : '<span class="stage-waypoint-marker__split" aria-hidden="true"></span>'

    const marker = L.marker([point.lat, point.lng], {
      draggable: !props.driveMode,
      icon: L.divIcon({
        className: 'stage-waypoint-marker',
        iconSize: [112, 70],
        iconAnchor: [56, 58],
        html: `
          <div class="stage-waypoint-marker__stack" title="${label}">
            <span class="stage-waypoint-label">${label}</span>
            ${markerBody}
          </div>
        `,
      }),
    })
    marker.on('dragend', () => {
      const next = marker.getLatLng()
      emit('waypoint-move', point.id, { lat: next.lat, lng: next.lng })
    })

    waypointLayer?.addLayer(marker)
  })

  waypointLayer.addTo(map)
}

function renderManualPlacement() {
  if (!map) return
  clearLayer(manualPlacementLayer)
  manualPlacementLayer = null

  if (!props.manualPlacementPoint) return

  const label = stageWaypointLabel(props.manualPlacementLabel || 'Pending point')
  manualPlacementLayer = L.layerGroup()
  L.marker([props.manualPlacementPoint.lat, props.manualPlacementPoint.lng], {
    interactive: false,
    icon: L.divIcon({
      className: 'stage-waypoint-marker stage-waypoint-marker--pending',
      iconSize: [132, 76],
      iconAnchor: [66, 62],
      html: `
        <div class="stage-waypoint-marker__stack" title="${label}">
          <span class="stage-waypoint-label">Pick exact point</span>
          <div class="stage-waypoint-marker__body is-start" aria-hidden="true">
            <span class="stage-waypoint-marker__pole"></span>
            <span class="stage-waypoint-marker__flag"></span>
          </div>
        </div>
      `,
    }),
  }).addTo(manualPlacementLayer)

  manualPlacementLayer.addTo(map)
}

function focusManualPlacement() {
  if (!map || !props.manualPlacementPoint) return
  const targetZoom = Math.max(map.getZoom(), Math.min(18, tileMaxZoom))
  map.setView([props.manualPlacementPoint.lat, props.manualPlacementPoint.lng], targetZoom, { animate: true })
  map.getContainer().dataset.zoom = map.getZoom().toFixed(2)
}

function renderRoute() {
  if (!map) return

  if (!props.route) {
    clearLayer(routeLayer)
    clearLayer(routeDecorationLayer)
    routeLayer = null
    routeDecorationLayer = null
    routeData = null
    lastRouteRenderKey = ''
    lastRouteDecorationKey = ''
    return
  }

  const data = getRouteData()
  if (!data) return
  const renderKey = routeRenderKey(data)
  if (renderKey === lastRouteRenderKey) return
  lastRouteRenderKey = renderKey

  clearLayer(routeLayer)
  clearLayer(routeDecorationLayer)
  routeLayer = null
  routeDecorationLayer = null
  lastRouteDecorationKey = ''

  const tuples = routeRenderTuples(data)
  if (tuples.length < 2) return

  const shadow = L.polyline(tuples, {
    color: '#020617',
    weight: 10,
    opacity: 0.5,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false,
    className: 'rally-route-shadow',
  })
  const outline = L.polyline(tuples, {
    color: '#f8fafc',
    weight: 7,
    opacity: 0.92,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false,
    className: 'rally-route-outline',
  })
  const main = L.polyline(tuples, {
    color: '#f59e0b',
    weight: 4.2,
    opacity: 0.98,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false,
    className: 'rally-route-main',
  })

  routeLayer = L.layerGroup([shadow, outline, main]).addTo(map)
  if (routeDecorationsEnabled) renderRouteDecorations(true)

  if (!props.driveMode && lastRouteKey !== routeKey.value) {
    map.fitBounds(main.getBounds(), { padding: [28, 28], maxZoom: 15 })
    lastRouteKey = routeKey.value
    scheduleMapResize(3)
  }
}

function noteRenderKey() {
  const zoom = map?.getZoom() ?? 0
  const zoomBucket = Math.floor(zoom * 2) / 2
  const nextIndex = props.paceNotes.findIndex((note) => note.distance >= props.activeDistance)
  const activeIndex = nextIndex === -1 ? Math.max(0, props.paceNotes.length - 1) : Math.max(0, nextIndex)

  if (props.driveMode) {
    return `${props.paceNotes.length}:${props.selectedNoteId}:${activeIndex}:${zoomBucket}:drive`
  }

  return `${props.paceNotes.length}:${props.selectedNoteId}:${activeIndex}:${zoomBucket}:edit`
}

function renderNotes(force = false) {
  if (!map) return

  if (!props.showNoteMarkers) {
    clearLayer(noteLayer)
    noteLayer = null
    lastNoteRenderKey = ''
    return
  }

  const key = noteRenderKey()
  if (!force && key === lastNoteRenderKey) return
  lastNoteRenderKey = key

  clearLayer(noteLayer)
  noteLayer = L.layerGroup()

  const zoom = map.getZoom()
  const markerMode = zoom < 14 ? 'dot' : 'circle'
  const nextIndex = props.paceNotes.findIndex((note) => note.distance >= props.activeDistance)
  const activeIndex = nextIndex === -1 ? Math.max(0, props.paceNotes.length - 1) : Math.max(0, nextIndex)
  const notesToRender = props.driveMode
    ? props.paceNotes
        .slice(Math.max(0, activeIndex - 1), Math.min(props.paceNotes.length, activeIndex + 8))
        .filter((note) => note.distance >= props.activeDistance - 180 || note.id === props.selectedNoteId)
    : props.paceNotes.filter((note, index) => {
        if (note.id === props.selectedNoteId || note.kind === 'start' || note.kind === 'finish') return true
        if (zoom < 13) return false
        if (index < activeIndex - 1) return false
        if (index > activeIndex + (zoom >= 15 ? 10 : 6)) return false
        return note.distance >= props.activeDistance - 220 && note.distance <= props.activeDistance + (zoom >= 14 ? 3600 : 6200)
      })

  notesToRender.forEach((note) => {
    const selected = note.id === props.selectedNoteId
    const code = escapeHtml(paceCode(note))
    const color = paceColor(note)
    const iconSize: L.PointTuple =
      markerMode === 'dot'
        ? selected ? [18, 18] : [11, 11]
        : selected ? [38, 38] : [30, 30]
    const className =
      markerMode === 'dot'
        ? `pace-map-marker__dot ${selected ? 'is-selected' : ''}`
        : `pace-map-marker__circle ${selected ? 'is-selected' : ''}`
    const html =
      markerMode === 'dot'
        ? `<div class="${className}" style="--note-color:${color}"></div>`
        : `<div class="${className}" style="--note-color:${color}">${code}</div>`
    const marker = L.marker([note.lat, note.lng], {
      icon: L.divIcon({
        className: 'pace-map-marker',
        iconSize,
        iconAnchor: [iconSize[0] / 2, iconSize[1] / 2],
        html,
      }),
    })

    marker.bindTooltip(mapLabel(paceDisplay(note)), {
      direction: 'right',
      className: 'map-label',
    })
    marker.on('click', () => emit('select-note', note.id))
    noteLayer?.addLayer(marker)
  })

  noteLayer.addTo(map)
}

function ensureCarLayer(car: VisualCar) {
  if (!map) return
  if (carLayer) return

  carLayer = L.marker([car.point.lat, car.point.lng], {
    icon: L.divIcon({
      className: 'rally-car-marker',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      html: '<div class="rally-car-marker__body"><span></span></div>',
    }),
    interactive: false,
    zIndexOffset: 10_000,
  }).addTo(map)
}

function updateCarLayer(car: VisualCar) {
  if (!map) return
  ensureCarLayer(car)

  carLayer?.setLatLng([car.point.lat, car.point.lng])
  const body = carLayer?.getElement()?.querySelector<HTMLElement>('.rally-car-marker__body')
  if (body) body.style.transform = `rotate(${car.bearing}deg)`
}

function clearCarLayer() {
  clearLayer(carLayer)
  carLayer = null
}

function updateGhostLayer() {
  if (!map || !props.ghostCar || !props.route) {
    clearLayer(ghostLayer)
    ghostLayer = null
    return
  }

  if (!ghostLayer) {
    ghostLayer = L.marker([props.ghostCar.point.lat, props.ghostCar.point.lng], {
      icon: L.divIcon({
        className: 'rally-ghost-marker',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        html: '<div class="rally-ghost-marker__body"><span class="rally-ghost-marker__eyes"></span></div>',
      }),
      interactive: false,
      zIndexOffset: 9_000,
    }).addTo(map)
  }

  ghostLayer.setLatLng([props.ghostCar.point.lat, props.ghostCar.point.lng])
}

function stepVisualCar(now: number) {
  if (!map) return

  const deltaMs = lastFrameAt ? Math.min(48, Math.max(1, now - lastFrameAt)) : 16
  lastFrameAt = now

  if (!targetCar) {
    clearCarLayer()
    applyMapRotation(null)
    animationFrame = window.requestAnimationFrame(stepVisualCar)
    return
  }

  const predicted = predictedTarget(now) ?? targetCar

  smoothCar ??= { point: { ...predicted.point }, bearing: predicted.bearing }
  smoothCar = {
    point: lerpPoint(smoothCar.point, predicted.point, deltaMs),
    bearing: smoothBearing(smoothCar.bearing, predicted.bearing, deltaMs),
  }

  updateCarLayer(smoothCar)

  if (props.followCar) {
    setFollowView(smoothCar)
  }

  applyMapRotation(smoothCar, now)
  preloadTilesAhead(smoothCar, now)
  animationFrame = window.requestAnimationFrame(stepVisualCar)
}

function renderCar() {
  if (!map) return

  if (!syncTargetCarFromProps()) {
    clearCarLayer()
    applyMapRotation(null)
    return
  }

  if (smoothCar) {
    updateCarLayer(smoothCar)
    applyMapRotation(smoothCar)
  }
}

function renderAll() {
  renderRoute()
  renderWaypoints()
  renderManualPlacement()
  renderNotes()
  updateGhostLayer()
  renderCar()
}

onMounted(() => {
  if (!mapEl.value) return

  map = L.map(mapEl.value, {
    maxZoom: 19,
    zoomControl: false,
    attributionControl: false,
  }).setView([45.86, 15.94], 11)

  tileLayer = L.tileLayer(tileUrl, {
    maxZoom: tileMaxZoom,
    keepBuffer: props.driveMode ? 3 : 4,
    detectRetina: false,
    updateInterval: 280,
    updateWhenIdle: false,
    updateWhenZooming: false,
    subdomains: tileSubdomains,
    attribution: tileAttribution,
  }).addTo(map)

  map.on('click', (event) => {
    emit('map-click', {
      lat: event.latlng.lat,
      lng: event.latlng.lng,
    })
  })
  map.on('zoomend', () => renderNotes(true))
  map.on('moveend zoomend resize', () => scheduleRouteDecorations())
  map.on('zoomend resize', () => applyMapRotation())

  resizeObserver = new ResizeObserver(() => scheduleMapResize(8))
  resizeObserver.observe(mapEl.value)
  if (frameEl.value) resizeObserver.observe(frameEl.value)
  if (mapEl.value.parentElement) resizeObserver.observe(mapEl.value.parentElement)
  window.addEventListener('resize', handleMapResize)
  document.addEventListener('fullscreenchange', handleMapResize)
  document.addEventListener('visibilitychange', handleMapResize)

  renderAll()
  focusManualPlacement()
  if (props.driveMode) {
    scheduleDriveStartZoom()
  }
  scheduleMapResize(8)
  animationFrame = window.requestAnimationFrame(stepVisualCar)
})

onBeforeUnmount(() => {
  if (animationFrame) window.cancelAnimationFrame(animationFrame)
  if (driveZoomFrame) window.cancelAnimationFrame(driveZoomFrame)
  if (routeDecorationFrame) window.cancelAnimationFrame(routeDecorationFrame)
  if (resizeFrame) window.cancelAnimationFrame(resizeFrame)
  resizeObserver?.disconnect()
  window.removeEventListener('resize', handleMapResize)
  document.removeEventListener('fullscreenchange', handleMapResize)
  document.removeEventListener('visibilitychange', handleMapResize)
  pendingTileImages.forEach((image) => {
    image.onload = null
    image.onerror = null
  })
  pendingTileImages.clear()
  map?.remove()
  map = null
  tileLayer = null
})

watch(() => props.waypoints, renderWaypoints, { deep: true })
watch(() => props.manualPlacementPoint, () => {
  renderManualPlacement()
  focusManualPlacement()
}, { deep: true })
watch(() => props.route, () => {
  routeData = null
  lastRouteRenderKey = ''
  lastNoteRenderKey = ''
  lastRouteDecorationKey = ''
  renderRoute()
  scheduleMapResize(8)
})
watch(() => props.paceNotes, () => {
  routeData = null
  lastRouteRenderKey = ''
  lastNoteRenderKey = ''
  lastRouteDecorationKey = ''
  renderRoute()
  if (props.showNoteMarkers) renderNotes(true)
}, { deep: true })
watch(() => [props.selectedNoteId, props.activeDistance], () => {
  if (props.driveMode) renderRoute()
  if (props.showNoteMarkers) renderNotes()
  scheduleRouteDecorations()
})
watch(() => props.car, (car, previousCar) => {
  const hasCar = syncTargetCarFromProps()
  if (!hasCar) {
    clearCarLayer()
    applyMapRotation(null)
  }
  if (props.driveMode && car && !previousCar) scheduleDriveStartZoom()
}, { deep: true, flush: 'post' })
watch(() => props.ghostCar, updateGhostLayer, { deep: true, flush: 'post' })
watch(() => [props.orientationMode, props.followCar], () => {
  if (props.orientationMode !== 'heading-up' || !props.followCar) resetLateralLead()
  resetFollowViewCache()
  resetRotationCache()
  refreshMapSize()
  scheduleRouteDecorations(true)
  scheduleMapResize(8)
  applyMapRotation()
}, { flush: 'post' })
watch(() => props.driveMode, () => {
  resetFollowViewCache()
  resetRotationCache()
  if (!props.driveMode) resetLateralLead()

  if (props.driveMode) {
    lastRouteRenderKey = ''
    renderRoute()
    scheduleRouteDecorations(true)
    scheduleDriveStartZoom()
    return
  }

  lastRouteRenderKey = ''
  renderRoute()
  refreshMapSize()
  scheduleRouteDecorations(true)
  scheduleMapResize(10)
}, { flush: 'post' })
watch(() => props.showNoteMarkers, () => {
  renderNotes(true)
}, { flush: 'post' })
watch(() => props.driveRunning, (running, wasRunning) => {
  if (running && !wasRunning) {
    resetFollowViewCache()
    scheduleRouteDecorations(true)
    scheduleDriveStartZoom()
  }
}, { flush: 'post' })
watch(mapBleedPixels, () => {
  resetFollowViewCache()
  scheduleMapResize(10)
}, { flush: 'post' })
</script>

<template>
  <div
    ref="frameEl"
    class="relative h-full w-full overflow-hidden"
    :class="props.driveMode ? 'min-h-0' : 'min-h-[420px] sm:min-h-[560px] lg:min-h-0'"
    :data-drive-mode="String(props.driveMode)"
    :data-drive-running="String(props.driveRunning)"
    data-testid="map-canvas"
  >
    <div
      ref="mapEl"
      class="absolute"
      :style="{ inset: `-${mapBleedPixels}px` }"
      data-testid="leaflet-surface"
    />
  </div>
</template>
