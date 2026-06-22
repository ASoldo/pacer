import type { VehicleProfile } from '../types'

export type VehicleVisuals = Pick<VehicleProfile, 'imageUrl' | 'avatarUrl'>

export const miniF55CooperSdVisuals: VehicleVisuals = {
  imageUrl: '/vehicles/mini-f55-cooper-sd.png',
  avatarUrl: '/vehicles/mini-f55-cooper-sd-avatar.png',
}

const legacyVehicleVisualUrls: Record<string, string> = {
  '/vehicles/mini-f55-cooper-sd.svg': miniF55CooperSdVisuals.imageUrl,
  '/vehicles/mini-f55-cooper-sd-avatar.svg': miniF55CooperSdVisuals.avatarUrl,
}

function lower(value = '') {
  return value.trim().toLowerCase()
}

export function canonicalVehicleVisualUrl(value = '') {
  return legacyVehicleVisualUrls[value] ?? value
}

export function vehicleVisualsForProfile(profile: Partial<VehicleProfile>): VehicleVisuals | null {
  const make = lower(profile.make)
  const model = lower(profile.model)
  const chassis = lower(profile.chassis)
  const bodyStyle = lower(profile.bodyStyle)

  if (
    make.includes('mini') &&
    model.includes('cooper sd') &&
    (chassis === 'f55' || bodyStyle.includes('5-door hatch'))
  ) {
    return miniF55CooperSdVisuals
  }

  return null
}

export function vehicleVisualUrl(profile: Partial<VehicleProfile>, key: keyof VehicleVisuals) {
  return canonicalVehicleVisualUrl(profile[key]) || vehicleVisualsForProfile(profile)?.[key] || ''
}
