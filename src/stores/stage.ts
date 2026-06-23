import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type {
  DriverDisplaySettings,
  DriveAttemptState,
  DriveSource,
  DriveRunSample,
  DriveRunSummary,
  LatLng,
  LiveLocationState,
  LocationSearchResult,
  ObdAdapterKind,
  ObdDiagnosticEntry,
  ObdProtocol,
  ObdTelemetrySample,
  ObdTelemetryState,
  PaceNote,
  PhoneSensorSample,
  PhoneSensorState,
  RouteInfo,
  RouteMode,
  RouteRoadAlert,
  RouteWeatherSample,
  SimulationState,
  SimulationSpeedMode,
  SpeechSettings,
  StagePoint,
  VehicleModification,
  VehicleProfile,
  VehicleTelemetry,
  VinDecodeResult,
} from '../types'
import { fetchRoute } from '../services/routing'
import { preferredThrottle } from '../services/obd'
import { generatePaceNotes } from '../services/paceNotes'
import { searchLocations } from '../services/geocoding'
import { fetchRouteRoadAlerts, roadAlertsFromWeather } from '../services/roadAlerts'
import { fetchRouteWeather } from '../services/weather'
import { canonicalVehicleVisualUrl, miniF55CooperSdVisuals, vehicleVisualsForProfile } from '../services/vehicleVisuals'
import {
  bearingDegrees,
  cumulativeDistances,
  distanceMeters,
  interpolateAlongCumulativeRoute,
  nearestRouteProgress,
} from '../utils/geo'

const id = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 12)

const demoStage: StagePoint[] = [
  { id: id(), name: 'Start', lat: 45.84264, lng: 15.88717 },
  { id: id(), name: 'Split 1', lat: 45.87531, lng: 15.91765 },
  { id: id(), name: 'Split 2', lat: 45.90278, lng: 15.95008 },
  { id: id(), name: 'Finish', lat: 45.91918, lng: 15.98192 },
]

const vehicleStorageKey = 'rally-pacenotes.vehicle.v1'
const driveRunsStorageKey = 'rally-pacenotes.drive-runs.v1'
const maxAttemptSamples = 1_800
const maxCircuitLapCount = 99

function pointName(index: number, total: number, mode: RouteMode) {
  if (mode === 'closed-circuit') {
    if (index === 0) return 'Start / Finish'
    return `Split ${index}`
  }

  if (index === 0) return 'Start'
  if (index === total - 1) return 'Finish'
  return `Split ${index}`
}

function pointNameSuffix(name: string) {
  const match = name.trim().match(/^(Start \/ Finish|Start|Finish|Split \d+)(?::\s*)?(.*)$/)
  if (!match) return name.trim()
  return match[2]?.trim() ?? ''
}

function renamePoints(points: StagePoint[], mode: RouteMode) {
  return points.map((point, index) => ({
    ...point,
    name: pointNameSuffix(point.name)
      ? `${pointName(index, points.length, mode)}: ${pointNameSuffix(point.name)}`
      : pointName(index, points.length, mode),
  }))
}

function firstNoteIndexAtDistance(notes: PaceNote[], distance: number) {
  let low = 0
  let high = notes.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (notes[middle].distance < distance) low = middle + 1
    else high = middle
  }

  return low
}

function defaultVehicle(): VehicleProfile {
  return {
    id: id(),
    vin: 'WMWXT710702C58288',
    nickname: 'Rootster',
    make: 'MINI',
    model: 'Cooper SD',
    trim: 'Austin Seven Special Edition',
    modelYear: '2017',
    generation: 'Gen 3',
    chassis: 'F55',
    bodyStyle: '5-door hatch',
    engine: 'B47C20O0 2.0 diesel, 125 kW / 170 hp',
    fuelType: 'Diesel',
    driveType: 'Front-wheel drive',
    transmission: '',
    plant: 'Oxford, United Kingdom',
    imageUrl: miniF55CooperSdVisuals.imageUrl,
    avatarUrl: miniF55CooperSdVisuals.avatarUrl,
    source: 'owner',
    decodeProvider: '',
    decodeConfidence: 'confirmed',
    decodeWarnings: [],
    obd: {
      adapterKind: 'elm327-classic',
      protocol: 'auto',
      vinPid: true,
      ecuNamePid: true,
      calibrationPid: true,
    },
    modifications: [],
  }
}

function loadVehicle() {
  if (typeof localStorage === 'undefined') return defaultVehicle()

  try {
    const stored = localStorage.getItem(vehicleStorageKey)
    if (!stored) return defaultVehicle()
    const vehicle = { ...defaultVehicle(), ...JSON.parse(stored) } as VehicleProfile
    return {
      ...vehicle,
      imageUrl: canonicalVehicleVisualUrl(vehicle.imageUrl),
      avatarUrl: canonicalVehicleVisualUrl(vehicle.avatarUrl),
    }
  } catch {
    return defaultVehicle()
  }
}

function defaultLocation(): LiveLocationState {
  return {
    running: false,
    status: 'idle',
    permission: 'unknown',
    point: null,
    routePoint: null,
    accuracyMeters: 0,
    routeErrorMeters: 0,
    heading: 0,
    speedKph: 0,
    distanceMeters: 0,
    elapsedSeconds: 0,
    lastUpdateAt: 0,
    error: '',
  }
}

function defaultObdTelemetry(): ObdTelemetryState {
  return {
    status: 'idle',
    error: '',
    protocol: '',
    supportedPids: [],
    sample: null,
    lastUpdateAt: 0,
    mock: false,
    diagnostics: [],
  }
}

function defaultPhoneSensors(): PhoneSensorState {
  return {
    supported: false,
    active: false,
    permission: 'unknown',
    status: 'idle',
    sample: null,
    lastUpdateAt: 0,
    error: '',
  }
}

function defaultDriveAttempt(targetLapCount = 1): DriveAttemptState {
  return {
    id: '',
    status: 'idle',
    source: 'gps-phone',
    armedAt: 0,
    startedAt: 0,
    finishedAt: 0,
    elapsedSeconds: 0,
    targetLapCount,
    completedLapCount: 0,
    currentLapIndex: 0,
    routeDistanceMeters: 0,
    unwrappedDistanceMeters: 0,
    samples: [],
    vehicleSnapshot: null,
    startZoneArmed: false,
    insideStartZone: false,
    insideFinishZone: false,
    previousRouteDistance: 0,
  }
}

function loadDriveRuns(): DriveRunSummary[] {
  if (typeof localStorage === 'undefined') return []

  try {
    const stored = localStorage.getItem(driveRunsStorageKey)
    if (!stored) return []
    return (JSON.parse(stored) as DriveRunSummary[]).filter((run) => run.id && run.startedAt)
  } catch {
    return []
  }
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function markerRadius(accuracyMeters: number) {
  return clamp(Math.max(12, accuracyMeters * 1.5), 12, 35)
}

function simulationCornerCap(note: PaceNote) {
  if (note.kind === 'finish') return 24
  if (note.kind === 'start') return 58

  if (note.kind === 'junction') {
    if (note.iconShape === 'roundabout') return 28
    if (note.iconShape === 'junction') return note.direction === 'straight' ? 64 : 42
    return 48
  }

  const severityCaps = [0, 34, 44, 58, 76, 98, 124]
  const severity = clamp(Math.round(note.severity || 6), 1, 6)
  let cap = severityCaps[severity]

  if (note.iconShape === 'acute') cap = Math.min(cap, 28)
  if (note.iconShape === 'hairpin') cap = Math.min(cap, 34)
  if (note.iconShape === 'square') cap = Math.min(cap, 52)
  if ((note.lengthMeters ?? 0) >= 95 && severity >= 4) cap += 8
  if (note.caution) cap = Math.min(cap, 52)

  return cap
}

function simulationBrakeHorizon(note: PaceNote, cruiseKph: number) {
  if (note.kind === 'finish') return 150
  if (note.kind === 'start') return 40
  if (note.kind === 'junction') return note.iconShape === 'roundabout' ? 170 : 135

  const severity = clamp(Math.round(note.severity || 6), 1, 6)
  const speedPenalty = Math.max(0, cruiseKph - 70) * 1.08
  const shapePenalty =
    note.iconShape === 'acute' ? 78
      : note.iconShape === 'hairpin' ? 62
        : note.iconShape === 'square' ? 38
          : 0

  return clamp(82 + (6 - severity) * 34 + speedPenalty + shapePenalty, 88, 360)
}

function smoothStep(value: number) {
  const next = clamp(value, 0, 1)
  return next * next * (3 - 2 * next)
}

function adaptiveSimulationTargetSpeed(notes: PaceNote[], distanceMeters: number, cruiseKph: number, routeDistance: number) {
  const cruise = clamp(cruiseKph, 20, 190)
  let target = cruise
  const lookAhead = clamp(cruise * 3.8, 180, 540)
  const finishDistance = Math.max(0, routeDistance - distanceMeters)

  if (distanceMeters < 42) {
    target = Math.min(target, 38 + distanceMeters * 1.15)
  }

  if (finishDistance < 110) {
    const finishEase = smoothStep(1 - finishDistance / 110)
    target = Math.min(target, cruise - (cruise - 24) * finishEase)
  }

  for (const note of notes) {
    if (note.kind === 'start') continue

    const entryDistance = note.entryDistance ?? note.distance
    const exitDistance = note.exitDistance ?? note.distance
    if (exitDistance < distanceMeters - 24) continue
    if (entryDistance > distanceMeters + lookAhead) break

    const cap = simulationCornerCap(note)
    const horizon = simulationBrakeHorizon(note, cruise)
    const distanceToEntry = entryDistance - distanceMeters
    const distancePastExit = distanceMeters - exitDistance
    let noteTarget = cruise

    if (distanceToEntry >= 0) {
      const brakeProgress = smoothStep(1 - distanceToEntry / horizon)
      noteTarget = cruise - (cruise - cap) * brakeProgress
    } else if (distancePastExit <= 24) {
      noteTarget = cap
    } else {
      const recoveryProgress = smoothStep(distancePastExit / 96)
      noteTarget = cap + (cruise - cap) * recoveryProgress
    }

    target = Math.min(target, noteTarget)
  }

  return Math.round(clamp(target, 8, 190))
}

function moveTowardSpeed(currentKph: number, targetKph: number, deltaSeconds: number) {
  const increasing = targetKph > currentKph
  const rateKphPerSecond = increasing ? 19 : 54
  const maxDelta = rateKphPerSecond * deltaSeconds
  if (Math.abs(targetKph - currentKph) <= maxDelta) return targetKph
  return currentKph + Math.sign(targetKph - currentKph) * maxDelta
}

export const useStageStore = defineStore('stage', () => {
  const stageName = ref('Medvednica Recce')
  const routeMode = ref<RouteMode>('point-to-point')
  const waypoints = ref<StagePoint[]>([])
  const route = ref<RouteInfo | null>(null)
  const paceNotes = ref<PaceNote[]>([])
  const selectedNoteId = ref('')
  const circuitLapCount = ref(3)
  const loadingRoute = ref(false)
  const routeError = ref('')
  const vehicle = ref<VehicleProfile>(loadVehicle())
  const display = ref<DriverDisplaySettings>({
    showTiming: true,
    showTelemetry: true,
    showNoteStrip: true,
    ghostTargetKph: 82,
    mapOrientationMode: 'heading-up',
  })

  const speech = ref<SpeechSettings>({
    delayMs: 0,
    callOffsetMeters: -150,
    rate: 1.05,
    pitch: 0.92,
    volume: 1,
    voiceURI: '',
  })

  const simulation = ref<SimulationState>({
    running: false,
    distanceMeters: 0,
    elapsedSeconds: 0,
    speedKph: 76,
    targetSpeedKph: 128,
    speedMode: 'fixed',
    loop: true,
  })
  const driveSource = ref<DriveSource>('simulation')
  const location = ref<LiveLocationState>(defaultLocation())
  const driveAttempt = ref<DriveAttemptState>(defaultDriveAttempt(circuitLapCount.value))
  const driveRuns = ref<DriveRunSummary[]>(loadDriveRuns())
  const selectedGhostRunId = ref('')
  const obdTelemetry = ref<ObdTelemetryState>(defaultObdTelemetry())
  const phoneSensors = ref<PhoneSensorState>(defaultPhoneSensors())
  const routeWeatherSamples = ref<RouteWeatherSample[]>([])
  const routeWeatherLoading = ref(false)
  const routeWeatherError = ref('')
  const routeWeatherUpdatedAt = ref(0)
  const routeRoadAlerts = ref<RouteRoadAlert[]>([])
  const routeRoadAlertsLoading = ref(false)
  const routeRoadAlertsError = ref('')
  const routeRoadAlertsUpdatedAt = ref(0)
  const locationSearchResults = ref<LocationSearchResult[]>([])
  const locationSearchLoading = ref(false)
  const locationSearchError = ref('')
  const pendingManualWaypointName = ref('')
  const pendingManualWaypointPoint = ref<LatLng | null>(null)
  let routeWeatherRequestId = 0
  let routeRoadAlertsRequestId = 0
  let locationSearchRequestId = 0

  const hasRoute = computed(() => Boolean(route.value && route.value.geometry.length > 1))
  const totalDistance = computed(() => route.value?.distance ?? 0)
  const routeCumulativeDistances = computed(() =>
    route.value ? cumulativeDistances(route.value.geometry) : [],
  )
  const activeDistanceMeters = computed(() =>
    driveSource.value === 'gps' ? location.value.distanceMeters : simulation.value.distanceMeters,
  )
  const activeSpeedKph = computed(() =>
    driveSource.value === 'gps' ? location.value.speedKph : simulation.value.speedKph,
  )
  const activeElapsedSeconds = computed(() =>
    driveSource.value === 'gps' ? driveAttempt.value.elapsedSeconds : simulation.value.elapsedSeconds,
  )
  const activeDriveRunning = computed(() =>
    driveSource.value === 'gps' ? driveAttempt.value.status === 'running' : simulation.value.running,
  )
  const simulationTargetSpeedKph = computed(() =>
    simulation.value.speedMode === 'adaptive' && route.value
      ? adaptiveSimulationTargetSpeed(
        paceNotes.value,
        simulation.value.distanceMeters,
        simulation.value.targetSpeedKph,
        route.value.distance,
      )
      : simulation.value.speedKph,
  )
  const currentCar = computed(() =>
    route.value
      ? interpolateAlongCumulativeRoute(route.value.geometry, routeCumulativeDistances.value, activeDistanceMeters.value)
      : null,
  )
  const activeCar = computed(() =>
    driveSource.value === 'gps' && location.value.point
      ? {
          point: location.value.point,
          bearing: location.value.heading || currentCar.value?.bearing || 0,
        }
      : currentCar.value,
  )
  const activeNoteIndex = computed(() => firstNoteIndexAtDistance(paceNotes.value, activeDistanceMeters.value))
  const nextNote = computed(() => paceNotes.value[activeNoteIndex.value] ?? null)
  const followingNote = computed(() => {
    const current = nextNote.value
    return current ? paceNotes.value[activeNoteIndex.value + 1] ?? null : null
  })
  const previousNote = computed(() => {
    const current = nextNote.value
    if (!current) return paceNotes.value[paceNotes.value.length - 1] ?? null
    const index = activeNoteIndex.value
    return index > 0 ? paceNotes.value[index - 1] : null
  })
  const noteWindow = computed(() => {
    const current = nextNote.value
    if (!current) return paceNotes.value.slice(0, 6)
    const index = Math.max(0, activeNoteIndex.value)
    return paceNotes.value.slice(Math.max(0, index - 1), index + 8)
  })
  const activeWeather = computed(() => {
    const samples = routeWeatherSamples.value
    if (samples.length === 0) return null

    return samples.reduce((best, sample) =>
      Math.abs(sample.distance - activeDistanceMeters.value) < Math.abs(best.distance - activeDistanceMeters.value)
        ? sample
        : best,
    samples[0])
  })
  const upcomingWeatherAlert = computed(() =>
    routeWeatherSamples.value.find((sample) =>
      sample.distance >= activeDistanceMeters.value &&
      sample.severity !== 'normal',
    ) ?? null,
  )
  const activeRoadAlert = computed(() => {
    const alerts = routeRoadAlerts.value
    if (alerts.length === 0) return null

    return alerts.reduce((best, alert) =>
      Math.abs(alert.distance - activeDistanceMeters.value) < Math.abs(best.distance - activeDistanceMeters.value)
        ? alert
        : best,
    alerts[0])
  })
  const upcomingRoadAlert = computed(() =>
    routeRoadAlerts.value.find((alert) =>
      alert.distance >= activeDistanceMeters.value &&
      alert.distance - activeDistanceMeters.value <= 2_500,
    ) ?? null,
  )
  const ghostTargetSeconds = computed(() =>
    route.value ? route.value.distance / (Math.max(1, display.value.ghostTargetKph) / 3.6) : 0,
  )
  const ghostDistanceMeters = computed(() => {
    if (!route.value || ghostTargetSeconds.value <= 0) return 0
    const ratio = clamp(activeElapsedSeconds.value / ghostTargetSeconds.value, 0, 1)
    return route.value.distance * ratio
  })
  const ghostCar = computed(() =>
    route.value
      ? interpolateAlongCumulativeRoute(route.value.geometry, routeCumulativeDistances.value, ghostDistanceMeters.value)
      : null,
  )
  const ghostDeltaSeconds = computed(() => {
    if (!route.value || route.value.distance === 0) return 0
    const targetAtDistance = ghostTargetSeconds.value * (activeDistanceMeters.value / route.value.distance)
    return activeElapsedSeconds.value - targetAtDistance
  })
  const estimatedRemainingSeconds = computed(() => {
    if (!route.value || activeSpeedKph.value <= 0) return 0
    return (route.value.distance - activeDistanceMeters.value) / (activeSpeedKph.value / 3.6)
  })
  const telemetry = computed<VehicleTelemetry>(() => {
    const next = nextNote.value
    const distanceToNext = next ? Math.max(0, next.distance - activeDistanceMeters.value) : 999
    const brakingForSharp = Boolean(next && next.severity <= 3 && distanceToNext < 160)
    const brakingForJunction = Boolean(next && next.kind === 'junction' && distanceToNext < 90)
    const brake = brakingForSharp ? 64 : brakingForJunction ? 42 : 0
    const throttle = activeDriveRunning.value ? Math.max(18, 88 - brake) : 0
    const gear = Math.min(6, Math.max(1, Math.round(activeSpeedKph.value / 28)))
    const rpm = activeDriveRunning.value ? Math.round(2200 + throttle * 42 + gear * 130) : 900
    const obdSample = obdTelemetry.value.sample
    const obdFresh = Boolean(obdSample && Date.now() - obdTelemetry.value.lastUpdateAt < 2_500)
    const obdThrottle = preferredThrottle(obdSample)

    if (obdFresh && obdSample) {
      const obdSpeedKph = finiteNumber(obdSample.speedKph) ? Math.max(0, Number(obdSample.speedKph)) : undefined
      const displaySpeed = obdSpeedKph ?? activeSpeedKph.value

      return {
        gear: Math.min(6, Math.max(1, Math.round(displaySpeed / 28))),
        throttle: finiteNumber(obdThrottle) ? Math.min(100, Math.max(0, Number(obdThrottle))) : throttle,
        brake,
        handbrake: next?.severity === 1 && distanceToNext < 55 ? 22 : 0,
        rpm: finiteNumber(obdSample.rpm) ? Math.max(0, Math.round(Number(obdSample.rpm))) : rpm,
        speedKph: obdSpeedKph,
        voltage: finiteNumber(obdSample.voltage) ? Number(obdSample.voltage) : undefined,
        source: 'obd',
      }
    }

    if (driveSource.value === 'gps') {
      const sensorSample = phoneSensors.value.sample
      const sensorFresh = Boolean(sensorSample && Date.now() - phoneSensors.value.lastUpdateAt < 2_500)
      const lateralG = sensorFresh && sensorSample ? sensorSample.lateralG : 0
      const longitudinalG = sensorFresh && sensorSample ? sensorSample.longitudinalG : 0
      const verticalG = sensorFresh && sensorSample ? sensorSample.verticalG : 0
      const accelerationG = sensorFresh && sensorSample ? sensorSample.accelerationMagnitude : 0
      const forwardG = Math.max(0, longitudinalG)
      const brakingG = Math.max(0, -longitudinalG)

      return {
        gear: Math.min(6, Math.max(1, Math.round(activeSpeedKph.value / 28))),
        throttle: Math.min(100, Math.round(forwardG * 180)),
        brake: Math.min(100, Math.round(brakingG * 220)),
        handbrake: Math.abs(lateralG) > 0.65 && activeSpeedKph.value < 45 ? 16 : 0,
        rpm: 0,
        speedKph: activeSpeedKph.value,
        lateralG,
        longitudinalG,
        verticalG,
        accelerationG,
        heading: location.value.heading,
        accuracyMeters: location.value.accuracyMeters,
        routeErrorMeters: location.value.routeErrorMeters,
        source: 'phone',
      }
    }

    return {
      gear,
      throttle,
      brake,
      handbrake: next?.severity === 1 && distanceToNext < 55 ? 22 : 0,
      rpm,
      source: 'derived',
    }
  })

  const vehicleTitle = computed(() =>
    [
      vehicle.value.modelYear,
      vehicle.value.make,
      vehicle.value.model,
      vehicle.value.trim,
    ]
      .filter(Boolean)
      .join(' ')
      || vehicle.value.nickname
      || 'Vehicle pending',
  )
  const currentDriveRun = computed(() =>
    driveRuns.value.find((run) => run.id === selectedGhostRunId.value) ?? null,
  )

  function routeKeyForCurrentRoute() {
    if (!route.value) return ''
    return [
      stageName.value,
      routeMode.value,
      Math.round(route.value.distance),
      waypoints.value.map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join('|'),
    ].join(':')
  }

  function resetDriveAttempt(status: DriveAttemptState['status'] = 'idle') {
    const previous = driveAttempt.value
    driveAttempt.value = {
      ...defaultDriveAttempt(circuitLapCount.value),
      status,
      targetLapCount: circuitLapCount.value,
      routeDistanceMeters: route.value?.distance ?? 0,
      previousRouteDistance: previous.previousRouteDistance,
    }
  }

  function persistDriveRun(summary: DriveRunSummary) {
    driveRuns.value = [
      summary,
      ...driveRuns.value.filter((run) => run.id !== summary.id),
    ].slice(0, 24)
  }

  function finishDriveAttempt(status: Extract<DriveRunSummary['status'], 'finished' | 'aborted'>) {
    const attempt = driveAttempt.value
    if (!attempt.id || attempt.status === 'idle') {
      resetDriveAttempt(status)
      return
    }

    const now = Date.now()
    const summary: DriveRunSummary = {
      id: attempt.id,
      status,
      source: attempt.source,
      stageName: stageName.value,
      routeMode: routeMode.value,
      routeKey: routeKeyForCurrentRoute(),
      vehicleTitle: vehicleTitle.value,
      vehicleId: attempt.vehicleSnapshot?.id ?? vehicle.value.id,
      targetLapCount: attempt.targetLapCount,
      completedLapCount: attempt.completedLapCount,
      distanceMeters: attempt.unwrappedDistanceMeters,
      elapsedSeconds: attempt.elapsedSeconds,
      startedAt: attempt.startedAt || attempt.armedAt || now,
      finishedAt: now,
      sampleCount: attempt.samples.length,
    }

    if (attempt.startedAt || attempt.samples.length > 0) persistDriveRun(summary)

    driveAttempt.value = {
      ...attempt,
      status,
      finishedAt: now,
    }
  }

  function beginDriveAttempt(routeDistance: number, timestamp: number) {
    const attempt = driveAttempt.value
    if (attempt.status !== 'armed') return

    driveAttempt.value = {
      ...attempt,
      status: 'running',
      startedAt: timestamp || Date.now(),
      elapsedSeconds: 0,
      routeDistanceMeters: routeDistance,
      previousRouteDistance: 0,
      unwrappedDistanceMeters: 0,
      completedLapCount: 0,
      currentLapIndex: 1,
    }
  }

  function appendDriveRunSample(position: {
    point: LatLng
    routePoint: LatLng | null
    accuracyMeters: number
    routeErrorMeters: number
    heading: number
    speedKph: number
    timestamp: number
    snappedDistance: number
    unwrappedDistance: number
  }) {
    const attempt = driveAttempt.value
    if (attempt.status !== 'running' || !attempt.id) return

    const sensorSample = phoneSensors.value.sample
    const sensorFresh = Boolean(sensorSample && position.timestamp - phoneSensors.value.lastUpdateAt < 2_500)
    const sample: DriveRunSample = {
      id: id(),
      runId: attempt.id,
      sampledAt: position.timestamp,
      elapsedSeconds: attempt.elapsedSeconds,
      lapIndex: attempt.currentLapIndex,
      lapElapsedSeconds: attempt.elapsedSeconds,
      routeDistanceMeters: position.snappedDistance,
      unwrappedDistanceMeters: position.unwrappedDistance,
      point: position.point,
      routePoint: position.routePoint,
      accuracyMeters: position.accuracyMeters,
      routeErrorMeters: position.routeErrorMeters,
      heading: position.heading,
      speedKph: position.speedKph,
      lateralG: sensorFresh && sensorSample ? sensorSample.lateralG : undefined,
      longitudinalG: sensorFresh && sensorSample ? sensorSample.longitudinalG : undefined,
      verticalG: sensorFresh && sensorSample ? sensorSample.verticalG : undefined,
      accelerationG: sensorFresh && sensorSample ? sensorSample.accelerationMagnitude : undefined,
    }

    sample.lapElapsedSeconds = sample.elapsedSeconds
    driveAttempt.value = {
      ...attempt,
      samples: [...attempt.samples, sample].slice(-maxAttemptSamples),
    }
  }

  function clampRouteDistance(nextDistance: number, previousDistance: number, accuracyMeters: number) {
    const jitterTolerance = Math.max(8, accuracyMeters * 0.65)

    if (routeMode.value === 'closed-circuit') return Math.min(Math.max(nextDistance, 0), totalDistance.value)
    if (nextDistance < previousDistance - jitterTolerance) return previousDistance
    return Math.min(Math.max(nextDistance, 0), totalDistance.value)
  }

  function addWaypoint(point: LatLng, name = '') {
    const next = [
      ...waypoints.value,
      {
        id: id(),
        name,
        lat: point.lat,
        lng: point.lng,
      },
    ]
    waypoints.value = renamePoints(next, routeMode.value).map((entry, index) => {
      if (index < waypoints.value.length) return { ...entry, name: waypoints.value[index]?.name || entry.name }
      return {
        ...entry,
        name: name.trim() ? `${entry.name}: ${name.trim()}` : entry.name,
      }
    })
    clearRoute()
  }

  function addSearchResultWaypoint(result: LocationSearchResult) {
    const requestedName = result.query || result.name
    if (result.precision !== 'address' && /\d/.test(requestedName)) {
      pendingManualWaypointName.value = requestedName
      pendingManualWaypointPoint.value = { lat: result.lat, lng: result.lng }
      return 'manual' as const
    }

    addWaypoint({ lat: result.lat, lng: result.lng }, result.name)
    return 'added' as const
  }

  function placePendingManualWaypoint(point: LatLng) {
    const name = pendingManualWaypointName.value.trim()
    if (!name) return false

    pendingManualWaypointName.value = ''
    pendingManualWaypointPoint.value = null
    addWaypoint(point, name)
    return true
  }

  function cancelPendingManualWaypoint() {
    pendingManualWaypointName.value = ''
    pendingManualWaypointPoint.value = null
  }

  function updateWaypointPosition(pointId: string, point: LatLng) {
    let changed = false
    waypoints.value = waypoints.value.map((entry) => {
      if (entry.id !== pointId) return entry
      changed = true
      return { ...entry, lat: point.lat, lng: point.lng }
    })
    if (changed) clearRoute()
  }

  function moveWaypoint(pointId: string, direction: -1 | 1) {
    const currentIndex = waypoints.value.findIndex((point) => point.id === pointId)
    const nextIndex = currentIndex + direction
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= waypoints.value.length) return

    const next = [...waypoints.value]
    const [point] = next.splice(currentIndex, 1)
    next.splice(nextIndex, 0, point)
    waypoints.value = renamePoints(next, routeMode.value)
    clearRoute()
  }

  function moveWaypointBefore(pointId: string, targetPointId: string) {
    if (pointId === targetPointId) return
    const currentIndex = waypoints.value.findIndex((point) => point.id === pointId)
    const targetIndex = waypoints.value.findIndex((point) => point.id === targetPointId)
    if (currentIndex < 0 || targetIndex < 0) return

    const next = [...waypoints.value]
    const [point] = next.splice(currentIndex, 1)
    const adjustedTargetIndex = currentIndex < targetIndex ? targetIndex - 1 : targetIndex
    next.splice(adjustedTargetIndex, 0, point)
    waypoints.value = renamePoints(next, routeMode.value)
    clearRoute()
  }

  function moveWaypointToIndex(pointId: string, targetIndex: number) {
    const currentIndex = waypoints.value.findIndex((point) => point.id === pointId)
    if (currentIndex < 0) return

    const nextIndex = clamp(Math.round(targetIndex), 0, waypoints.value.length - 1)
    if (currentIndex === nextIndex) return

    const next = [...waypoints.value]
    const [point] = next.splice(currentIndex, 1)
    next.splice(nextIndex, 0, point)
    waypoints.value = renamePoints(next, routeMode.value)
    clearRoute()
  }

  function renameWaypoint(pointId: string, name: string) {
    const nextName = name.trim()
    waypoints.value = waypoints.value.map((entry) =>
      entry.id === pointId ? { ...entry, name: nextName || entry.name } : entry,
    )
  }

  function removeWaypoint(pointId: string) {
    waypoints.value = renamePoints(waypoints.value.filter((point) => point.id !== pointId), routeMode.value)
    if (waypoints.value.length < 2) clearRoute()
  }

  function reverseWaypoints() {
    waypoints.value = renamePoints([...waypoints.value].reverse(), routeMode.value)
    clearRoute()
  }

  function clearRoute() {
    route.value = null
    paceNotes.value = []
    selectedNoteId.value = ''
    routeWeatherRequestId += 1
    routeWeatherSamples.value = []
    routeWeatherLoading.value = false
    routeWeatherError.value = ''
    routeWeatherUpdatedAt.value = 0
    routeRoadAlertsRequestId += 1
    routeRoadAlerts.value = []
    routeRoadAlertsLoading.value = false
    routeRoadAlertsError.value = ''
    routeRoadAlertsUpdatedAt.value = 0
    resetSimulation()
    resetDriveAttempt()
  }

  function clearStage() {
    waypoints.value = []
    clearRoute()
    routeError.value = ''
  }

  function loadDemo() {
    stageName.value = 'Medvednica Recce'
    routeMode.value = 'point-to-point'
    waypoints.value = demoStage.map((point) => ({ ...point, id: id() }))
    clearRoute()
  }

  async function buildRoute() {
    routeError.value = ''
    loadingRoute.value = true

    try {
      const nextRoute = await fetchRoute(waypoints.value, routeMode.value)
      route.value = nextRoute
      paceNotes.value = generatePaceNotes(nextRoute)
      selectedNoteId.value = paceNotes.value[1]?.id ?? paceNotes.value[0]?.id ?? ''
      resetSimulation()
      void refreshRouteWeather(nextRoute)
      void refreshRouteRoadAlerts(nextRoute, [])
    } catch (error) {
      routeError.value = error instanceof Error ? error.message : 'Routing failed.'
    } finally {
      loadingRoute.value = false
    }
  }

  async function refreshRouteWeather(targetRoute = route.value) {
    if (!targetRoute) {
      routeWeatherSamples.value = []
      routeWeatherError.value = ''
      routeWeatherUpdatedAt.value = 0
      return
    }

    routeWeatherLoading.value = true
    routeWeatherError.value = ''
    const requestId = ++routeWeatherRequestId

    try {
      const samples = await fetchRouteWeather(targetRoute)
      if (requestId !== routeWeatherRequestId) return
      routeWeatherSamples.value = samples
      routeWeatherUpdatedAt.value = Date.now()
      void refreshRouteRoadAlerts(targetRoute, samples)
    } catch {
      if (requestId !== routeWeatherRequestId) return
      routeWeatherError.value = ''
      void refreshRouteRoadAlerts(targetRoute, routeWeatherSamples.value)
    } finally {
      if (requestId === routeWeatherRequestId) routeWeatherLoading.value = false
    }
  }

  async function refreshRouteRoadAlerts(targetRoute = route.value, weatherSamples = routeWeatherSamples.value) {
    if (!targetRoute) {
      routeRoadAlerts.value = []
      routeRoadAlertsError.value = ''
      routeRoadAlertsUpdatedAt.value = 0
      return
    }

    routeRoadAlertsLoading.value = true
    routeRoadAlertsError.value = ''
    const requestId = ++routeRoadAlertsRequestId

    try {
      const alerts = await fetchRouteRoadAlerts(targetRoute, weatherSamples)
      if (requestId !== routeRoadAlertsRequestId) return
      routeRoadAlerts.value = alerts
      routeRoadAlertsUpdatedAt.value = Date.now()
    } catch {
      if (requestId !== routeRoadAlertsRequestId) return
      routeRoadAlerts.value = roadAlertsFromWeather(weatherSamples)
      routeRoadAlertsUpdatedAt.value = Date.now()
      routeRoadAlertsError.value = ''
    } finally {
      if (requestId === routeRoadAlertsRequestId) routeRoadAlertsLoading.value = false
    }
  }

  async function searchRouteLocations(query: string) {
    const trimmed = query.trim()
    locationSearchError.value = ''

    if (trimmed.length < 3) {
      locationSearchRequestId += 1
      locationSearchResults.value = []
      locationSearchLoading.value = false
      return
    }

    locationSearchLoading.value = true
    const requestId = ++locationSearchRequestId

    try {
      const results = await searchLocations(trimmed)
      if (requestId !== locationSearchRequestId) return
      locationSearchResults.value = results
    } catch (error) {
      if (requestId !== locationSearchRequestId) return
      locationSearchResults.value = []
      locationSearchError.value = error instanceof Error ? error.message : 'Location search failed.'
    } finally {
      if (requestId === locationSearchRequestId) locationSearchLoading.value = false
    }
  }

  function regenerateNotes() {
    if (!route.value) return
    paceNotes.value = generatePaceNotes(route.value)
  }

  function updatePaceNote(noteId: string, text: string) {
    const cleanText = text.trim()
    paceNotes.value = paceNotes.value.map((note) =>
      note.id === noteId
        ? {
            ...note,
            text: note.distanceCall ? `${note.distanceCall}, ${cleanText}` : cleanText,
            displayCall: cleanText,
            locked: false,
          }
        : note,
    )
  }

  function addCustomNote(text: string) {
    if (!route.value || text.trim().length === 0) return

    const car = activeCar.value
    const point = car?.point ?? route.value.geometry[0]
    const note: PaceNote = {
      id: id(),
      kind: 'custom',
      text: text.trim(),
      displayCall: text.trim(),
      severity: 3,
      direction: 'straight',
      symbol: '!',
      callCode: '!',
      iconShape: 'custom',
      distance: activeDistanceMeters.value,
      lat: point.lat,
      lng: point.lng,
      locked: false,
    }

    paceNotes.value = [...paceNotes.value, note].sort((a, b) => a.distance - b.distance)
    selectedNoteId.value = note.id
  }

  function deletePaceNote(noteId: string) {
    paceNotes.value = paceNotes.value.filter((note) => note.locked || note.id !== noteId)
  }

  function setSelectedNote(noteId: string) {
    selectedNoteId.value = noteId
  }

  function setCircuitLapCount(value: number) {
    circuitLapCount.value = Math.round(clamp(Number(value) || 1, 1, maxCircuitLapCount))
    if (driveAttempt.value.status === 'idle') {
      driveAttempt.value.targetLapCount = circuitLapCount.value
    }
  }

  function selectGhostRun(runId: string) {
    selectedGhostRunId.value = driveRuns.value.some((run) => run.id === runId) ? runId : ''
  }

  function deleteDriveRun(runId: string) {
    driveRuns.value = driveRuns.value.filter((run) => run.id !== runId)
    if (selectedGhostRunId.value === runId) selectedGhostRunId.value = ''
  }

  function applyVinDecode(result: VinDecodeResult) {
    const fields = result.fields
    const decodedProfile = {
      ...vehicle.value,
      ...Object.fromEntries(
        Object.entries(fields).filter(([, value]) => typeof value === 'string' && value.trim().length > 0),
      ),
      vin: result.vin || fields.vin || vehicle.value.vin,
      source: 'vin' as const,
      decodeProvider: result.provider,
      decodeConfidence: result.confidence,
      decodeWarnings: result.warnings,
    }
    const fallbackVisuals = vehicleVisualsForProfile(decodedProfile)

    vehicle.value = {
      ...decodedProfile,
      imageUrl: canonicalVehicleVisualUrl(decodedProfile.imageUrl) || fallbackVisuals?.imageUrl || '',
      avatarUrl: canonicalVehicleVisualUrl(decodedProfile.avatarUrl) || fallbackVisuals?.avatarUrl || '',
    }
  }

  function setObdAdapterKind(adapterKind: ObdAdapterKind) {
    vehicle.value.obd.adapterKind = adapterKind
  }

  function setObdProtocol(protocol: ObdProtocol) {
    vehicle.value.obd.protocol = protocol
  }

  function confirmVehicleProfile() {
    const fallbackVisuals = vehicleVisualsForProfile(vehicle.value)
    vehicle.value = {
      ...vehicle.value,
      imageUrl: canonicalVehicleVisualUrl(vehicle.value.imageUrl) || fallbackVisuals?.imageUrl || '',
      avatarUrl: canonicalVehicleVisualUrl(vehicle.value.avatarUrl) || fallbackVisuals?.avatarUrl || '',
      source: 'owner',
      decodeConfidence: 'confirmed',
      decodeWarnings: [],
    }
  }

  function addVehicleModification(category: string, label: string, detail: string) {
    const cleanLabel = label.trim()
    if (!cleanLabel) return

    const modification: VehicleModification = {
      id: id(),
      category: category.trim() || 'setup',
      label: cleanLabel,
      detail: detail.trim(),
    }

    vehicle.value.modifications = [...vehicle.value.modifications, modification]
  }

  function removeVehicleModification(modificationId: string) {
    vehicle.value.modifications = vehicle.value.modifications.filter((modification) => modification.id !== modificationId)
  }

  function setObdStatus(status: ObdTelemetryState['status'], error = '') {
    obdTelemetry.value.status = status
    obdTelemetry.value.error = error
  }

  function appendObdDiagnostic(level: ObdDiagnosticEntry['level'], message: string) {
    obdTelemetry.value.diagnostics = [
      ...obdTelemetry.value.diagnostics,
      {
        at: Date.now(),
        level,
        message,
      },
    ].slice(-80)
  }

  function applyObdTelemetry(sample: ObdTelemetrySample, mock = false) {
    const supportedPids = sample.supportedPids?.length ? sample.supportedPids : obdTelemetry.value.supportedPids
    const protocol = sample.protocol || obdTelemetry.value.protocol

    obdTelemetry.value = {
      status: mock ? 'streaming' : obdTelemetry.value.status === 'probing' ? 'connected' : 'streaming',
      error: '',
      protocol,
      supportedPids,
      sample,
      lastUpdateAt: sample.sampledAt,
      mock,
      diagnostics: obdTelemetry.value.diagnostics,
    }
  }

  function clearObdTelemetry(keepDiagnostics = false) {
    const diagnostics = keepDiagnostics ? obdTelemetry.value.diagnostics : []
    obdTelemetry.value = {
      ...defaultObdTelemetry(),
      diagnostics,
    }
  }

  function setPhoneSensorSupport(supported: boolean) {
    phoneSensors.value.supported = supported
    if (!supported) {
      phoneSensors.value.status = 'unsupported'
      phoneSensors.value.permission = 'unsupported'
      phoneSensors.value.active = false
      phoneSensors.value.error = 'Phone motion sensors are not available in this browser.'
    }
  }

  function setPhoneSensorStatus(
    status: PhoneSensorState['status'],
    error = '',
    permission: PhoneSensorState['permission'] = phoneSensors.value.permission,
  ) {
    phoneSensors.value = {
      ...phoneSensors.value,
      active: status === 'listening',
      status,
      permission,
      error,
    }
  }

  function applyPhoneSensorSample(sample: PhoneSensorSample) {
    phoneSensors.value = {
      ...phoneSensors.value,
      supported: true,
      active: true,
      permission: 'granted',
      status: 'listening',
      sample,
      lastUpdateAt: sample.sampledAt,
      error: '',
    }
  }

  function clearPhoneSensors() {
    phoneSensors.value = {
      ...phoneSensors.value,
      active: false,
      status: phoneSensors.value.supported ? 'idle' : phoneSensors.value.status,
    }
  }

  function setSimulationRunning(running: boolean) {
    if (!hasRoute.value) return
    driveSource.value = 'simulation'
    if (running) location.value.running = false
    simulation.value.running = running
  }

  function setSimulationDistance(distance: number) {
    if (!location.value.running) driveSource.value = 'simulation'
    simulation.value.distanceMeters = Math.min(Math.max(distance, 0), totalDistance.value)
  }

  function setSimulationSpeed(value: number) {
    const speed = Math.round(clamp(Number(value) || 0, 5, 190))
    if (simulation.value.speedMode === 'adaptive') {
      simulation.value.targetSpeedKph = speed
      return
    }

    simulation.value.speedKph = speed
  }

  function setSimulationSpeedMode(mode: SimulationSpeedMode) {
    simulation.value.speedMode = mode
    if (mode === 'adaptive') {
      simulation.value.targetSpeedKph = Math.max(simulation.value.targetSpeedKph, simulation.value.speedKph, 90)
      return
    }

    simulation.value.speedKph = Math.round(simulation.value.speedKph)
  }

  function resetSimulation() {
    if (!location.value.running) driveSource.value = 'simulation'
    simulation.value.running = false
    simulation.value.distanceMeters = 0
    simulation.value.elapsedSeconds = 0
    if (simulation.value.speedMode === 'adaptive') {
      simulation.value.speedKph = Math.min(simulation.value.speedKph, 60)
    }
  }

  function setLocationPermission(permission: LiveLocationState['permission']) {
    location.value.permission = permission
    if (permission === 'denied') {
      location.value.status = 'denied'
      location.value.error = 'Location permission is denied.'
    }
    if (permission === 'unsupported') {
      location.value.status = 'unsupported'
      location.value.error = 'Location services are not available in this browser.'
    }
  }

  function startGpsDrive() {
    if (!hasRoute.value) return
    const permission = location.value.permission
    driveSource.value = 'gps'
    simulation.value.running = false
    driveAttempt.value = {
      ...defaultDriveAttempt(routeMode.value === 'closed-circuit' ? circuitLapCount.value : 1),
      id: id(),
      status: 'armed',
      armedAt: Date.now(),
      targetLapCount: routeMode.value === 'closed-circuit' ? circuitLapCount.value : 1,
      routeDistanceMeters: totalDistance.value,
      vehicleSnapshot: {
        ...vehicle.value,
        modifications: [...vehicle.value.modifications],
        obd: { ...vehicle.value.obd },
        decodeWarnings: [...vehicle.value.decodeWarnings],
      },
    }
    location.value = {
      ...defaultLocation(),
      permission,
      running: true,
      status: 'requesting',
    }
  }

  function stopGpsDrive() {
    if (driveAttempt.value.status === 'armed' || driveAttempt.value.status === 'running') {
      finishDriveAttempt('aborted')
    }
    location.value = {
      ...location.value,
      running: false,
      status: location.value.point ? 'idle' : location.value.status === 'requesting' ? 'idle' : location.value.status,
    }
  }

  function setGpsError(error: string, status: LiveLocationState['status'] = 'error') {
    if (status === 'denied' || status === 'unsupported') finishDriveAttempt('aborted')
    location.value = {
      ...location.value,
      running: status === 'error' ? location.value.running : false,
      status,
      error,
    }
  }

  function applyGpsPosition(position: {
    point: LatLng
    accuracyMeters: number
    heading: number | null
    speedMetersPerSecond: number | null
    timestamp: number
  }) {
    const routeProgress = route.value ? nearestRouteProgress(route.value.geometry, position.point) : null
    const previousPoint = location.value.point
    const elapsedSeconds = location.value.lastUpdateAt
      ? Math.max(0.2, (position.timestamp - location.value.lastUpdateAt) / 1000)
      : 0
    const derivedSpeed = previousPoint && elapsedSeconds > 0
      ? (distanceMeters(previousPoint, position.point) / elapsedSeconds) * 3.6
      : location.value.speedKph
    const speedKph = finiteNumber(position.speedMetersPerSecond)
      ? Math.max(0, Number(position.speedMetersPerSecond) * 3.6)
      : Math.max(0, derivedSpeed)
    const movedMeters = previousPoint ? distanceMeters(previousPoint, position.point) : 0
    const heading = finiteNumber(position.heading)
      ? Number(position.heading)
      : movedMeters > 1.5 && previousPoint
        ? bearingDegrees(previousPoint, position.point)
        : routeProgress?.bearing ?? location.value.heading
    const snappedDistance = routeProgress && route.value
      ? clampRouteDistance(routeProgress.distance, location.value.distanceMeters, position.accuracyMeters)
      : location.value.distanceMeters
    const routeDistance = Math.max(1, totalDistance.value)
    const radius = markerRadius(position.accuracyMeters)
    const startDistance = routeMode.value === 'closed-circuit'
      ? Math.min(snappedDistance, Math.max(0, routeDistance - snappedDistance))
      : snappedDistance
    const finishDistance = Math.max(0, routeDistance - snappedDistance)
    const insideStartZone = startDistance <= radius
    const insideFinishZone = finishDistance <= radius
    const attempt = driveAttempt.value
    let unwrappedDistance = routeMode.value === 'closed-circuit'
      ? attempt.completedLapCount * routeDistance + snappedDistance
      : snappedDistance

    if (attempt.status === 'armed') {
      if (!attempt.startZoneArmed && !insideStartZone) {
        driveAttempt.value = {
          ...attempt,
          startZoneArmed: true,
          insideStartZone,
          insideFinishZone,
          previousRouteDistance: snappedDistance,
        }
      } else if (attempt.startZoneArmed && insideStartZone) {
        beginDriveAttempt(routeDistance, position.timestamp)
      } else if (!attempt.startZoneArmed && attempt.insideStartZone && !insideStartZone && snappedDistance > radius) {
        beginDriveAttempt(routeDistance, position.timestamp)
      } else {
        driveAttempt.value = {
          ...attempt,
          insideStartZone,
          insideFinishZone,
          previousRouteDistance: snappedDistance,
        }
      }
    }

    if (driveAttempt.value.status === 'running') {
      const runningAttempt = driveAttempt.value
      let completedLapCount = runningAttempt.completedLapCount
      let currentLapIndex = runningAttempt.currentLapIndex
      let shouldFinish = false

      if (
        routeMode.value === 'closed-circuit' &&
        runningAttempt.previousRouteDistance > routeDistance * 0.68 &&
        snappedDistance < routeDistance * 0.32 &&
        !runningAttempt.insideFinishZone
      ) {
        completedLapCount += 1
        currentLapIndex = completedLapCount + 1
        shouldFinish = completedLapCount >= runningAttempt.targetLapCount
      } else if (
        routeMode.value === 'point-to-point' &&
        insideFinishZone &&
        !runningAttempt.insideFinishZone &&
        snappedDistance > routeDistance * 0.8
      ) {
        completedLapCount = 1
        shouldFinish = true
      }

      unwrappedDistance = routeMode.value === 'closed-circuit'
        ? completedLapCount * routeDistance + snappedDistance
        : snappedDistance

      driveAttempt.value = {
        ...runningAttempt,
        completedLapCount,
        currentLapIndex,
        insideStartZone,
        insideFinishZone,
        previousRouteDistance: snappedDistance,
        unwrappedDistanceMeters: unwrappedDistance,
      }

      appendDriveRunSample({
        point: position.point,
        routePoint: routeProgress?.point ?? null,
        accuracyMeters: position.accuracyMeters,
        routeErrorMeters: routeProgress?.error ?? 0,
        heading,
        speedKph,
        timestamp: position.timestamp,
        snappedDistance,
        unwrappedDistance,
      })

      if (shouldFinish) finishDriveAttempt('finished')
    }

    location.value = {
      ...location.value,
      running: true,
      status: 'tracking',
      permission: 'granted',
      point: position.point,
      routePoint: routeProgress?.point ?? null,
      accuracyMeters: position.accuracyMeters,
      routeErrorMeters: routeProgress?.error ?? 0,
      heading,
      speedKph,
      distanceMeters: snappedDistance,
      lastUpdateAt: position.timestamp,
      error: '',
    }
  }

  function advanceGpsDrive(deltaSeconds: number) {
    if (!location.value.running) return
    location.value.elapsedSeconds += deltaSeconds

    if (driveAttempt.value.status === 'running') {
      driveAttempt.value.elapsedSeconds += deltaSeconds
    }

    if (
      location.value.status === 'tracking' &&
      location.value.lastUpdateAt > 0 &&
      Date.now() - location.value.lastUpdateAt > 5_000
    ) {
      location.value.status = 'stale'
    }
  }

  function advanceSimulation(deltaSeconds: number) {
    if (!simulation.value.running || !route.value) return

    const previousSpeedKph = simulation.value.speedKph
    const targetSpeedKph = simulationTargetSpeedKph.value
    const nextSpeedKph = simulation.value.speedMode === 'adaptive'
      ? moveTowardSpeed(previousSpeedKph, targetSpeedKph, deltaSeconds)
      : previousSpeedKph
    simulation.value.speedKph = Math.round(nextSpeedKph * 10) / 10

    const metersPerSecond = ((previousSpeedKph + simulation.value.speedKph) / 2) / 3.6
    const nextDistance = simulation.value.distanceMeters + metersPerSecond * deltaSeconds

    if (nextDistance >= route.value.distance) {
      if (routeMode.value === 'closed-circuit' && simulation.value.loop) {
        simulation.value.distanceMeters = nextDistance % route.value.distance
        simulation.value.elapsedSeconds += deltaSeconds
      } else {
        simulation.value.distanceMeters = route.value.distance
        simulation.value.elapsedSeconds += deltaSeconds
        simulation.value.running = false
      }
      return
    }

    simulation.value.distanceMeters = nextDistance
    simulation.value.elapsedSeconds += deltaSeconds
  }

  loadDemo()

  watch(
    routeMode,
    () => {
      waypoints.value = renamePoints(waypoints.value, routeMode.value)
      clearRoute()
    },
    { flush: 'sync' },
  )

  watch(
    vehicle,
    (value) => {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(vehicleStorageKey, JSON.stringify(value))
    },
    { deep: true },
  )

  watch(
    driveRuns,
    (value) => {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(driveRunsStorageKey, JSON.stringify(value))
    },
    { deep: true },
  )

  return {
    stageName,
    routeMode,
    waypoints,
    route,
    paceNotes,
    selectedNoteId,
    circuitLapCount,
    loadingRoute,
    routeError,
    vehicle,
    speech,
    display,
    simulation,
    simulationTargetSpeedKph,
    driveSource,
    location,
    driveAttempt,
    driveRuns,
    selectedGhostRunId,
    obdTelemetry,
    phoneSensors,
    routeWeatherSamples,
    routeWeatherLoading,
    routeWeatherError,
    routeWeatherUpdatedAt,
    routeRoadAlerts,
    routeRoadAlertsLoading,
    routeRoadAlertsError,
    routeRoadAlertsUpdatedAt,
    locationSearchResults,
    locationSearchLoading,
    locationSearchError,
    pendingManualWaypointName,
    pendingManualWaypointPoint,
    hasRoute,
    totalDistance,
    activeDistanceMeters,
    activeSpeedKph,
    activeElapsedSeconds,
    activeDriveRunning,
    currentCar,
    activeCar,
    nextNote,
    followingNote,
    previousNote,
    noteWindow,
    activeWeather,
    upcomingWeatherAlert,
    activeRoadAlert,
    upcomingRoadAlert,
    ghostTargetSeconds,
    ghostDistanceMeters,
    ghostCar,
    ghostDeltaSeconds,
    estimatedRemainingSeconds,
    telemetry,
    vehicleTitle,
    currentDriveRun,
    addWaypoint,
    addSearchResultWaypoint,
    placePendingManualWaypoint,
    cancelPendingManualWaypoint,
    updateWaypointPosition,
    moveWaypoint,
    moveWaypointBefore,
    moveWaypointToIndex,
    renameWaypoint,
    removeWaypoint,
    reverseWaypoints,
    clearStage,
    loadDemo,
    buildRoute,
    regenerateNotes,
    refreshRouteWeather,
    refreshRouteRoadAlerts,
    searchRouteLocations,
    updatePaceNote,
    addCustomNote,
    deletePaceNote,
    setSelectedNote,
    setCircuitLapCount,
    selectGhostRun,
    deleteDriveRun,
    applyVinDecode,
    setObdAdapterKind,
    setObdProtocol,
    confirmVehicleProfile,
    addVehicleModification,
    removeVehicleModification,
    setObdStatus,
    appendObdDiagnostic,
    applyObdTelemetry,
    clearObdTelemetry,
    setPhoneSensorSupport,
    setPhoneSensorStatus,
    applyPhoneSensorSample,
    clearPhoneSensors,
    setSimulationRunning,
    setSimulationDistance,
    setSimulationSpeed,
    setSimulationSpeedMode,
    resetSimulation,
    setLocationPermission,
    startGpsDrive,
    stopGpsDrive,
    setGpsError,
    applyGpsPosition,
    advanceGpsDrive,
    advanceSimulation,
  }
})
