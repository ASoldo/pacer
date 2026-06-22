import type { LatLng, RouteInfo, RouteWeatherRisk, RouteWeatherSample, RouteWeatherSeverity } from '../types'
import { cumulativeDistances, pointAlongCumulativeRoute } from '../utils/geo'

const routeWeatherSampleCount = 10
const routeWeatherTimeoutMs = 12_000
const routeWeatherMaxAttempts = 3

type OpenMeteoCurrent = {
  time?: string
  temperature_2m?: number
  relative_humidity_2m?: number
  precipitation?: number
  rain?: number
  showers?: number
  snowfall?: number
  weather_code?: number
  cloud_cover?: number
  wind_speed_10m?: number
  wind_direction_10m?: number
  wind_gusts_10m?: number
}

type OpenMeteoResponse = {
  current?: OpenMeteoCurrent
}

function finite(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function weatherCodeLabel(code: number) {
  if (code === 0) return 'Clear'
  if (code <= 3) return 'Clouds'
  if (code === 45 || code === 48) return 'Fog'
  if (code >= 51 && code <= 57) return 'Drizzle'
  if (code >= 61 && code <= 67) return 'Rain'
  if (code >= 71 && code <= 77) return 'Snow'
  if (code >= 80 && code <= 82) return 'Showers'
  if (code >= 95) return 'Storm'
  return 'Weather'
}

function classifyRisk(current: OpenMeteoCurrent): { risk: RouteWeatherRisk; severity: RouteWeatherSeverity } {
  const code = finite(current.weather_code)
  const precipitation = finite(current.precipitation)
  const rain = finite(current.rain) + finite(current.showers)
  const snowfall = finite(current.snowfall)
  const temperature = finite(current.temperature_2m, 12)
  const windSpeed = finite(current.wind_speed_10m)
  const windGust = finite(current.wind_gusts_10m)

  if (code >= 95 || windGust >= 72 || windSpeed >= 55) {
    return { risk: 'storm', severity: 'severe' }
  }

  if ((code === 56 || code === 57 || code === 66 || code === 67 || temperature <= 1.5) && precipitation > 0) {
    return { risk: 'ice', severity: 'severe' }
  }

  if ((code >= 71 && code <= 77) || snowfall > 0) {
    return { risk: 'snow', severity: precipitation >= 2 ? 'severe' : 'caution' }
  }

  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82) || rain > 0 || precipitation >= 0.2) {
    return { risk: 'wet', severity: precipitation >= 3 || code === 65 || code === 82 ? 'severe' : 'caution' }
  }

  if (code === 45 || code === 48) {
    return { risk: 'fog', severity: code === 48 ? 'severe' : 'caution' }
  }

  if (windGust >= 40 || windSpeed >= 32) {
    return { risk: 'wind', severity: windGust >= 62 || windSpeed >= 48 ? 'severe' : 'caution' }
  }

  return { risk: 'clear', severity: 'normal' }
}

function weatherSummary(current: OpenMeteoCurrent, risk: RouteWeatherRisk) {
  const label = weatherCodeLabel(finite(current.weather_code))
  const temperature = Math.round(finite(current.temperature_2m))
  const windGust = Math.round(finite(current.wind_gusts_10m))
  const precipitation = finite(current.precipitation)

  if (risk === 'clear') return `${label}, ${temperature}C`
  if (risk === 'wind' || risk === 'storm') return `${label}, gust ${windGust} km/h`
  if (risk === 'snow') return `${label}, ${finite(current.snowfall).toFixed(1)} cm`
  if (risk === 'ice') return `Ice risk, ${temperature}C`
  if (risk === 'fog') return `Fog, ${temperature}C`
  return `${label}, ${precipitation.toFixed(1)} mm`
}

function sampleRoute(route: RouteInfo) {
  const cumulative = cumulativeDistances(route.geometry)
  const total = route.distance || cumulative[cumulative.length - 1] || 0

  return Array.from({ length: routeWeatherSampleCount }, (_, index) => {
    const distance = total * (index / Math.max(1, routeWeatherSampleCount - 1))
    const point = pointAlongCumulativeRoute(route.geometry, cumulative, distance) ?? route.geometry[0]
    return {
      id: `wx-${index}`,
      index,
      distance,
      point,
    }
  }).filter((sample): sample is { id: string; index: number; distance: number; point: LatLng } => Boolean(sample.point))
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function fetchWeatherPayload(url: URL) {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= routeWeatherMaxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), routeWeatherTimeoutMs)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          accept: 'application/json',
        },
      })

      if (!response.ok) throw new Error(`Weather fetch failed (${response.status})`)
      return (await response.json()) as OpenMeteoResponse | OpenMeteoResponse[]
    } catch (error) {
      lastError = error
      if (attempt === routeWeatherMaxAttempts) break
      await wait(300 * attempt)
    } finally {
      window.clearTimeout(timeout)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Weather fetch failed.')
}

export async function fetchRouteWeather(route: RouteInfo): Promise<RouteWeatherSample[]> {
  const samples = sampleRoute(route)
  if (samples.length === 0) return []

  const url = new URL('/api/weather/route', window.location.origin)
  url.searchParams.set('latitude', samples.map((sample) => sample.point.lat.toFixed(5)).join(','))
  url.searchParams.set('longitude', samples.map((sample) => sample.point.lng.toFixed(5)).join(','))

  const payload = await fetchWeatherPayload(url)
  const results = Array.isArray(payload) ? payload : [payload]
  const fetchedAt = Date.now()

  return samples.map((sample, index) => {
    const current = results[index]?.current ?? {}
    const { risk, severity } = classifyRisk(current)

    return {
      id: sample.id,
      index: sample.index,
      distance: sample.distance,
      lat: sample.point.lat,
      lng: sample.point.lng,
      time: current.time ?? '',
      temperatureC: finite(current.temperature_2m),
      humidityPercent: finite(current.relative_humidity_2m),
      precipitationMm: finite(current.precipitation),
      rainMm: finite(current.rain),
      showersMm: finite(current.showers),
      snowfallCm: finite(current.snowfall),
      weatherCode: finite(current.weather_code),
      cloudCoverPercent: finite(current.cloud_cover),
      windSpeedKph: finite(current.wind_speed_10m),
      windDirectionDegrees: finite(current.wind_direction_10m),
      windGustKph: finite(current.wind_gusts_10m),
      risk,
      severity,
      label: weatherCodeLabel(finite(current.weather_code)),
      summary: weatherSummary(current, risk),
      source: 'open-meteo',
      fetchedAt,
    }
  })
}
