import type { RouteInfo, RouteRoadAlert, RouteWeatherSample } from '../types'

function weatherAlertTitle(sample: RouteWeatherSample) {
  if (sample.risk === 'wet') return 'Wet road risk'
  if (sample.risk === 'fog') return 'Visibility risk'
  if (sample.risk === 'wind') return 'Crosswind risk'
  if (sample.risk === 'snow') return 'Snow on route'
  if (sample.risk === 'ice') return 'Ice risk'
  if (sample.risk === 'storm') return 'Storm risk'
  return 'Road condition'
}

export function roadAlertsFromWeather(samples: RouteWeatherSample[]): RouteRoadAlert[] {
  return samples
    .filter((sample) => sample.severity !== 'normal')
    .map((sample) => ({
      id: `weather-road-${sample.id}`,
      lat: sample.lat,
      lng: sample.lng,
      distance: sample.distance,
      kind: 'weather',
      severity: sample.severity === 'severe' ? 'severe' : 'caution',
      title: weatherAlertTitle(sample),
      detail: `${sample.summary}; monitor road grip and visibility.`,
      source: 'route-weather',
      updatedAt: sample.fetchedAt,
    }))
}

export async function fetchRouteRoadAlerts(route: RouteInfo, weatherSamples: RouteWeatherSample[]): Promise<RouteRoadAlert[]> {
  const weatherAlerts = roadAlertsFromWeather(weatherSamples)
  const start = route.geometry[0]
  const end = route.geometry.at(-1)

  const response = await fetch('/api/road-alerts/route', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      distance: route.distance,
      duration: route.duration,
      points: [start, end].filter(Boolean),
    }),
  })

  if (!response.ok) return weatherAlerts

  const payload = (await response.json()) as { alerts?: RouteRoadAlert[] }
  const upstreamAlerts = Array.isArray(payload.alerts) ? payload.alerts : []

  return [...upstreamAlerts, ...weatherAlerts].sort((first, second) => first.distance - second.distance)
}
