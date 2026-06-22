import type { RouteInfo, RouteMode, RouteStep, StagePoint } from '../types'

const osrmBaseUrl = import.meta.env?.VITE_OSRM_BASE_URL ?? 'https://router.project-osrm.org'

type OsrmStep = {
  distance: number
  duration: number
  name?: string
  maneuver: RouteStep['maneuver']
}

type OsrmRoute = {
  distance: number
  duration: number
  geometry: {
    coordinates: [number, number][]
  }
  legs: {
    steps: OsrmStep[]
  }[]
}

type OsrmResponse = {
  code: string
  message?: string
  routes?: OsrmRoute[]
}

function routeCoordinates(points: StagePoint[], mode: RouteMode) {
  const coordinates = points.map((point) => `${point.lng},${point.lat}`)

  if (mode === 'closed-circuit' && points.length >= 2) {
    const first = points[0]
    coordinates.push(`${first.lng},${first.lat}`)
  }

  return coordinates.join(';')
}

export async function fetchRoute(points: StagePoint[], mode: RouteMode): Promise<RouteInfo> {
  if (points.length < 2) {
    throw new Error(
      mode === 'closed-circuit'
        ? 'Add a start / finish point and at least one circuit point.'
        : 'Add at least start and finish points.',
    )
  }

  const query = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: 'true',
    annotations: 'true',
    alternatives: 'false',
  })
  const url = `${osrmBaseUrl}/route/v1/driving/${routeCoordinates(points, mode)}?${query}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Route service returned ${response.status}.`)
  }

  const payload = (await response.json()) as OsrmResponse
  const route = payload.routes?.[0]

  if (payload.code !== 'Ok' || !route) {
    throw new Error(payload.message ?? 'No route found for these points.')
  }

  return {
    geometry: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
    distance: route.distance,
    duration: route.duration,
    steps: route.legs.flatMap((leg) =>
      leg.steps.map((step) => ({
        distance: step.distance,
        duration: step.duration,
        name: step.name ?? '',
        maneuver: step.maneuver,
      })),
    ),
    source: 'osrm',
  }
}
