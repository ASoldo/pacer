export type LatLng = {
  lat: number
  lng: number
}

export type RouteMode = 'point-to-point' | 'closed-circuit'
export type MapOrientationMode = 'north-up' | 'heading-up'

export type StagePoint = LatLng & {
  id: string
  name: string
}

export type LocationSearchResult = LatLng & {
  id: string
  label: string
  name: string
  category: string
  source: 'nominatim'
}

export type RouteStep = {
  distance: number
  duration: number
  name: string
  maneuver: {
    type: string
    modifier?: string
    exit?: number
    location: [number, number]
    bearing_before?: number
    bearing_after?: number
  }
}

export type RouteInfo = {
  geometry: LatLng[]
  distance: number
  duration: number
  steps: RouteStep[]
  source: 'osrm'
}

export type RouteWeatherRisk = 'clear' | 'wet' | 'fog' | 'wind' | 'snow' | 'ice' | 'storm'

export type RouteWeatherSeverity = 'normal' | 'caution' | 'severe'

export type RouteWeatherSample = LatLng & {
  id: string
  distance: number
  index: number
  time: string
  temperatureC: number
  humidityPercent: number
  precipitationMm: number
  rainMm: number
  showersMm: number
  snowfallCm: number
  weatherCode: number
  cloudCoverPercent: number
  windSpeedKph: number
  windDirectionDegrees: number
  windGustKph: number
  risk: RouteWeatherRisk
  severity: RouteWeatherSeverity
  label: string
  summary: string
  source: 'open-meteo'
  fetchedAt: number
}

export type RouteRoadAlertKind = 'traffic' | 'collision' | 'closure' | 'works' | 'weather' | 'obstacle'

export type RouteRoadAlertSeverity = 'info' | 'caution' | 'severe'

export type RouteRoadAlert = LatLng & {
  id: string
  distance: number
  kind: RouteRoadAlertKind
  severity: RouteRoadAlertSeverity
  title: string
  detail: string
  source: 'hak' | 'route-weather'
  updatedAt: number
}

export type PaceNoteKind = 'start' | 'finish' | 'corner' | 'junction' | 'custom'

export type PaceNoteIconShape =
  | 'straight'
  | 'corner'
  | 'square'
  | 'hairpin'
  | 'acute'
  | 'junction'
  | 'roundabout'
  | 'caution'
  | 'start'
  | 'finish'
  | 'custom'

export type PaceNote = LatLng & {
  id: string
  distance: number
  kind: PaceNoteKind
  text: string
  severity: number
  direction?: 'left' | 'right' | 'straight'
  distanceCall?: string
  displayCall?: string
  symbol?: string
  callCode?: string
  iconShape?: PaceNoteIconShape
  entryDistance?: number
  exitDistance?: number
  lengthMeters?: number
  turnDegrees?: number
  caution?: boolean
  locked?: boolean
}

export type SpeechSettings = {
  delayMs: number
  callOffsetMeters: number
  rate: number
  pitch: number
  volume: number
  voiceURI: string
}

export type SpeechVoiceOption = {
  voiceURI: string
  name: string
  lang: string
  backend: 'browser' | 'piper'
}

export type SimulationSpeedMode = 'fixed' | 'adaptive'

export type SimulationState = {
  running: boolean
  distanceMeters: number
  elapsedSeconds: number
  speedKph: number
  targetSpeedKph: number
  speedMode: SimulationSpeedMode
  loop: boolean
}

export type DriveSource = 'simulation' | 'gps'
export type DriveAttemptStatus = 'idle' | 'armed' | 'running' | 'finished' | 'aborted'
export type LocationPermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported'
export type LocationTrackingStatus =
  | 'idle'
  | 'requesting'
  | 'tracking'
  | 'stale'
  | 'error'
  | 'denied'
  | 'unsupported'

export type LiveLocationState = {
  running: boolean
  status: LocationTrackingStatus
  permission: LocationPermissionState
  point: LatLng | null
  routePoint: LatLng | null
  accuracyMeters: number
  routeErrorMeters: number
  heading: number
  speedKph: number
  distanceMeters: number
  elapsedSeconds: number
  lastUpdateAt: number
  error: string
}

export type PhoneSensorPermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported'
export type PhoneSensorStatus = 'idle' | 'requesting' | 'listening' | 'error' | 'unsupported'

export type PhoneSensorSample = {
  sampledAt: number
  accelerationX: number
  accelerationY: number
  accelerationZ: number
  accelerationMagnitude: number
  lateralG: number
  longitudinalG: number
  verticalG: number
  rotationAlpha: number
  rotationBeta: number
  rotationGamma: number
  orientationHeading?: number
  orientationAlpha?: number
  orientationBeta?: number
  orientationGamma?: number
  usesGravity: boolean
}

export type PhoneSensorState = {
  supported: boolean
  active: boolean
  permission: PhoneSensorPermissionState
  status: PhoneSensorStatus
  sample: PhoneSensorSample | null
  lastUpdateAt: number
  error: string
}

export type DriveRunSample = {
  id: string
  runId: string
  sampledAt: number
  elapsedSeconds: number
  lapIndex: number
  lapElapsedSeconds: number
  routeDistanceMeters: number
  unwrappedDistanceMeters: number
  point: LatLng
  routePoint: LatLng | null
  accuracyMeters: number
  routeErrorMeters: number
  heading: number
  speedKph: number
  lateralG?: number
  longitudinalG?: number
  verticalG?: number
  accelerationG?: number
}

export type DriveRunSummary = {
  id: string
  status: Extract<DriveAttemptStatus, 'finished' | 'aborted'>
  source: 'gps-phone'
  stageName: string
  routeMode: RouteMode
  routeKey: string
  vehicleTitle: string
  vehicleId: string
  targetLapCount: number
  completedLapCount: number
  distanceMeters: number
  elapsedSeconds: number
  startedAt: number
  finishedAt: number
  sampleCount: number
}

export type DriveAttemptState = {
  id: string
  status: DriveAttemptStatus
  source: 'gps-phone'
  armedAt: number
  startedAt: number
  finishedAt: number
  elapsedSeconds: number
  targetLapCount: number
  completedLapCount: number
  currentLapIndex: number
  routeDistanceMeters: number
  unwrappedDistanceMeters: number
  samples: DriveRunSample[]
  vehicleSnapshot: VehicleProfile | null
  startZoneArmed: boolean
  insideStartZone: boolean
  insideFinishZone: boolean
  previousRouteDistance: number
}

export type VehicleTelemetry = {
  gear: number
  throttle: number
  brake: number
  handbrake: number
  rpm: number
  speedKph?: number
  voltage?: number
  lateralG?: number
  longitudinalG?: number
  verticalG?: number
  accelerationG?: number
  heading?: number
  accuracyMeters?: number
  routeErrorMeters?: number
  source: 'derived' | 'obd' | 'phone'
}

export type ObdConnectionStatus =
  | 'idle'
  | 'unsupported'
  | 'connecting'
  | 'connected'
  | 'probing'
  | 'streaming'
  | 'error'

export type ObdTelemetrySample = {
  rpm?: number
  speedKph?: number
  throttle?: number
  accelerator?: number
  voltage?: number
  protocol?: string
  supportedPids?: string[]
  sampledAt: number
}

export type ObdDiagnosticEntry = {
  at: number
  level: 'info' | 'warn' | 'error' | 'tx' | 'rx'
  message: string
}

export type ObdTelemetryState = {
  status: ObdConnectionStatus
  error: string
  protocol: string
  supportedPids: string[]
  sample: ObdTelemetrySample | null
  lastUpdateAt: number
  mock: boolean
  diagnostics: ObdDiagnosticEntry[]
}

export type VehicleDecodeConfidence = 'manual' | 'decoded' | 'limited' | 'review' | 'confirmed'

export type VehicleModification = {
  id: string
  category: string
  label: string
  detail: string
}

export type ObdAdapterKind = 'elm327-classic' | 'ble' | 'web-serial' | 'native-bridge'
export type ObdProtocol = 'auto' | 'iso15765-can-11-500' | 'iso15765-can-29-500' | 'bmw-uds-can'

export type VehicleProfile = {
  id: string
  vin: string
  nickname: string
  make: string
  model: string
  trim: string
  modelYear: string
  generation: string
  chassis: string
  bodyStyle: string
  engine: string
  fuelType: string
  driveType: string
  transmission: string
  plant: string
  imageUrl: string
  avatarUrl: string
  source: 'owner' | 'vin' | 'obd'
  decodeProvider: string
  decodeConfidence: VehicleDecodeConfidence
  decodeWarnings: string[]
  obd: {
    adapterKind: ObdAdapterKind
    protocol: ObdProtocol
    vinPid: boolean
    ecuNamePid: boolean
    calibrationPid: boolean
  }
  modifications: VehicleModification[]
}

export type VinDecodeResult = {
  provider: string
  vin: string
  confidence: Exclude<VehicleDecodeConfidence, 'manual'>
  fields: Partial<
    Pick<
      VehicleProfile,
      | 'vin'
      | 'make'
      | 'model'
      | 'trim'
      | 'modelYear'
      | 'generation'
      | 'chassis'
      | 'bodyStyle'
      | 'engine'
      | 'fuelType'
      | 'driveType'
      | 'transmission'
      | 'plant'
      | 'imageUrl'
      | 'avatarUrl'
    >
  >
  warnings: string[]
}

export type DriverDisplaySettings = {
  showTiming: boolean
  showTelemetry: boolean
  showNoteStrip: boolean
  ghostTargetKph: number
  mapOrientationMode: MapOrientationMode
}
