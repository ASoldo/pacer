import { computed, ref } from 'vue'
import { useStageStore } from '../stores/stage'
import type { PhoneSensorSample } from '../types'

const GRAVITY_METERS_PER_SECOND = 9.80665

const active = ref(false)
const supported = ref(false)
let started = false
let lastSample: PhoneSensorSample | null = null

type MotionEventConstructorWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

function finite(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
}

function roundG(value: number) {
  return Math.round(value * 1000) / 1000
}

function sampleTimestamp() {
  return Date.now()
}

function sensorSupported() {
  return typeof window !== 'undefined' && ('DeviceMotionEvent' in window || 'DeviceOrientationEvent' in window)
}

async function requestMotionPermission() {
  const motionConstructor = window.DeviceMotionEvent as MotionEventConstructorWithPermission | undefined
  if (!motionConstructor?.requestPermission) return 'granted'

  return motionConstructor.requestPermission()
}

function handleMotion(event: DeviceMotionEvent) {
  const stage = useStageStore()
  const rawAcceleration = event.acceleration
  const rawHasData = finite(rawAcceleration?.x) || finite(rawAcceleration?.y) || finite(rawAcceleration?.z)
  const acceleration = rawHasData ? rawAcceleration : event.accelerationIncludingGravity
  const usesGravity = !rawHasData && Boolean(event.accelerationIncludingGravity)
  const x = finite(acceleration?.x) ? Number(acceleration?.x) : 0
  const y = finite(acceleration?.y) ? Number(acceleration?.y) : 0
  const z = finite(acceleration?.z) ? Number(acceleration?.z) : 0
  const rotation = event.rotationRate

  lastSample = {
    ...(lastSample ?? {
      orientationHeading: undefined,
      orientationAlpha: undefined,
      orientationBeta: undefined,
      orientationGamma: undefined,
    }),
    sampledAt: sampleTimestamp(),
    accelerationX: x,
    accelerationY: y,
    accelerationZ: z,
    accelerationMagnitude: roundG(Math.sqrt(x * x + y * y + z * z) / GRAVITY_METERS_PER_SECOND),
    lateralG: roundG(x / GRAVITY_METERS_PER_SECOND),
    longitudinalG: roundG(-y / GRAVITY_METERS_PER_SECOND),
    verticalG: roundG(z / GRAVITY_METERS_PER_SECOND),
    rotationAlpha: finite(rotation?.alpha) ? Number(rotation?.alpha) : 0,
    rotationBeta: finite(rotation?.beta) ? Number(rotation?.beta) : 0,
    rotationGamma: finite(rotation?.gamma) ? Number(rotation?.gamma) : 0,
    usesGravity,
  }

  stage.applyPhoneSensorSample(lastSample)
}

function handleOrientation(event: DeviceOrientationEvent) {
  const stage = useStageStore()
  const webkitHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
  const orientationHeading = finite(webkitHeading)
    ? Number(webkitHeading)
    : finite(event.alpha)
      ? Number(event.alpha)
      : undefined

  lastSample = {
    ...(lastSample ?? {
      sampledAt: sampleTimestamp(),
      accelerationX: 0,
      accelerationY: 0,
      accelerationZ: 0,
      accelerationMagnitude: 0,
      lateralG: 0,
      longitudinalG: 0,
      verticalG: 0,
      rotationAlpha: 0,
      rotationBeta: 0,
      rotationGamma: 0,
      usesGravity: false,
    }),
    sampledAt: sampleTimestamp(),
    orientationHeading,
    orientationAlpha: finite(event.alpha) ? Number(event.alpha) : undefined,
    orientationBeta: finite(event.beta) ? Number(event.beta) : undefined,
    orientationGamma: finite(event.gamma) ? Number(event.gamma) : undefined,
  }

  stage.applyPhoneSensorSample(lastSample)
}

export function usePhoneSensors() {
  const stage = useStageStore()
  supported.value = sensorSupported()
  stage.setPhoneSensorSupport(supported.value)

  async function start() {
    supported.value = sensorSupported()
    stage.setPhoneSensorSupport(supported.value)

    if (!supported.value) return false

    stage.setPhoneSensorStatus('requesting', '', 'prompt')

    try {
      const permission = await requestMotionPermission()
      if (permission !== 'granted') {
        stage.setPhoneSensorStatus('error', 'Motion sensor permission is denied.', 'denied')
        return false
      }
    } catch (error) {
      stage.setPhoneSensorStatus(
        'error',
        error instanceof Error ? error.message : 'Motion sensor permission failed.',
        'unknown',
      )
      return false
    }

    if (!started) {
      window.addEventListener('devicemotion', handleMotion)
      window.addEventListener('deviceorientation', handleOrientation)
      window.addEventListener('deviceorientationabsolute', handleOrientation)
      started = true
    }

    active.value = true
    stage.setPhoneSensorStatus('listening', '', 'granted')
    return true
  }

  function detachListeners() {
    if (started && typeof window !== 'undefined') {
      window.removeEventListener('devicemotion', handleMotion)
      window.removeEventListener('deviceorientation', handleOrientation)
      window.removeEventListener('deviceorientationabsolute', handleOrientation)
      started = false
    }
  }

  function pause() {
    detachListeners()
    active.value = false
    stage.setPhoneSensorStatus('idle')
  }

  function stop() {
    detachListeners()
    active.value = false
    stage.clearPhoneSensors()
  }

  return {
    active: computed(() => active.value),
    supported: computed(() => supported.value),
    start,
    pause,
    stop,
  }
}
