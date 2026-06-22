import type { LatLng } from '../types'

const earthRadiusMeters = 6_371_000

const toRad = (value: number) => (value * Math.PI) / 180
const toDeg = (value: number) => (value * 180) / Math.PI

export function distanceMeters(a: LatLng, b: LatLng) {
  const phi1 = toRad(a.lat)
  const phi2 = toRad(b.lat)
  const deltaPhi = toRad(b.lat - a.lat)
  const deltaLambda = toRad(b.lng - a.lng)

  const h =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function bearingDegrees(a: LatLng, b: LatLng) {
  const phi1 = toRad(a.lat)
  const phi2 = toRad(b.lat)
  const deltaLambda = toRad(b.lng - a.lng)
  const y = Math.sin(deltaLambda) * Math.cos(phi2)
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

export function signedBearingDelta(from: number, to: number) {
  return ((((to - from + 180) % 360) + 360) % 360) - 180
}

export function cumulativeDistances(points: LatLng[]) {
  const distances = [0]

  for (let index = 1; index < points.length; index += 1) {
    distances.push(distances[index - 1] + distanceMeters(points[index - 1], points[index]))
  }

  return distances
}

function projectMeters(origin: LatLng, point: LatLng) {
  const originLat = toRad(origin.lat)

  return {
    x: toRad(point.lng - origin.lng) * Math.cos(originLat) * earthRadiusMeters,
    y: toRad(point.lat - origin.lat) * earthRadiusMeters,
  }
}

function unprojectMeters(origin: LatLng, point: { x: number; y: number }) {
  const originLat = toRad(origin.lat)

  return {
    lat: origin.lat + toDeg(point.y / earthRadiusMeters),
    lng: origin.lng + toDeg(point.x / (Math.cos(originLat) * earthRadiusMeters)),
  }
}

function firstDistanceIndexGreaterThan(values: number[], target: number) {
  let low = 0
  let high = values.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (values[middle] <= target) low = middle + 1
    else high = middle
  }

  return low
}

export function pointAlongCumulativeRoute(points: LatLng[], distances: number[], targetMeters: number) {
  if (points.length === 0) return null
  if (points.length === 1) return points[0]

  const total = distances[distances.length - 1] ?? 0
  const target = Math.min(Math.max(targetMeters, 0), total)

  if (target <= 0) return points[0]
  if (target >= total) return points[points.length - 1]

  const index = Math.max(1, firstDistanceIndexGreaterThan(distances, target))
  const start = points[index - 1]
  const end = points[index]
  const startDistance = distances[index - 1]
  const endDistance = distances[index]
  const ratio = endDistance === startDistance ? 0 : (target - startDistance) / (endDistance - startDistance)

  return {
    lat: start.lat + (end.lat - start.lat) * ratio,
    lng: start.lng + (end.lng - start.lng) * ratio,
  }
}

export function interpolateAlongCumulativeRoute(points: LatLng[], distances: number[], targetMeters: number) {
  if (points.length === 0) return null
  if (points.length === 1) return { point: points[0], bearing: 0 }

  const point = pointAlongCumulativeRoute(points, distances, targetMeters) ?? points[0]
  const before = pointAlongCumulativeRoute(points, distances, Math.max(0, targetMeters - 10)) ?? point
  const after = pointAlongCumulativeRoute(points, distances, targetMeters + 28) ?? point
  const bearing = distanceMeters(before, after) > 0.5 ? bearingDegrees(before, after) : 0

  return {
    point,
    bearing,
  }
}

export function interpolateAlongRoute(points: LatLng[], targetMeters: number) {
  return interpolateAlongCumulativeRoute(points, cumulativeDistances(points), targetMeters)
}

export function nearestRouteDistance(points: LatLng[], target: LatLng) {
  return nearestRouteProgress(points, target)?.distance ?? 0
}

export function nearestRouteProgress(points: LatLng[], target: LatLng) {
  if (points.length === 0) return null
  if (points.length === 1) {
    return {
      distance: 0,
      point: points[0],
      bearing: 0,
      error: distanceMeters(points[0], target),
    }
  }

  const distances = cumulativeDistances(points)
  let best = {
    distance: distances[0],
    point: points[0],
    bearing: bearingDegrees(points[0], points[1]),
    error: distanceMeters(points[0], target),
  }
  let bestError = Number.POSITIVE_INFINITY

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const localStart = projectMeters(target, start)
    const localEnd = projectMeters(target, end)
    const segment = {
      x: localEnd.x - localStart.x,
      y: localEnd.y - localStart.y,
    }
    const lengthSquared = segment.x ** 2 + segment.y ** 2
    const ratio = lengthSquared === 0
      ? 0
      : Math.min(Math.max(-(localStart.x * segment.x + localStart.y * segment.y) / lengthSquared, 0), 1)
    const projected = {
      x: localStart.x + segment.x * ratio,
      y: localStart.y + segment.y * ratio,
    }
    const error = Math.hypot(projected.x, projected.y)

    if (error < bestError) {
      bestError = error
      best = {
        distance: distances[index - 1] + distanceMeters(start, end) * ratio,
        point: unprojectMeters(target, projected),
        bearing: bearingDegrees(start, end),
        error,
      }
    }
  }

  return best
}

export function formatMeters(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} km`
  return `${Math.round(value)} m`
}

export function roundedCallDistance(value: number) {
  if (value < 45) return ''
  if (value < 100) return `${Math.round(value / 10) * 10}`
  return `${Math.round(value / 50) * 50}`
}
