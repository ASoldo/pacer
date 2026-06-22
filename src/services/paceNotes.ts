import type { LatLng, PaceNote, RouteInfo } from '../types'
import {
  bearingDegrees,
  cumulativeDistances,
  nearestRouteDistance,
  roundedCallDistance,
  signedBearingDelta,
} from '../utils/geo'

type RouteSampler = {
  pointAt: (distance: number) => LatLng
}

type TurnSample = {
  distance: number
  point: LatLng
  delta: number
  absDelta: number
}

type CornerCluster = {
  samples: TurnSample[]
  direction: 'left' | 'right'
  startDistance: number
  endDistance: number
  apex: TurnSample
  entryStrength: number
  exitStrength: number
}

function noteId(prefix: string, distance: number) {
  return `${prefix}-${Math.round(distance)}-${Math.random().toString(36).slice(2, 8)}`
}

function createSampler(points: LatLng[], cumulative: number[]): RouteSampler {
  function pointAt(distance: number) {
    const target = Math.min(Math.max(distance, 0), cumulative[cumulative.length - 1])
    let low = 0
    let high = cumulative.length - 1

    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (cumulative[middle] < target) low = middle + 1
      else high = middle
    }

    const index = Math.max(1, low)
    const start = points[index - 1]
    const end = points[index]
    const startDistance = cumulative[index - 1]
    const endDistance = cumulative[index]
    const ratio = endDistance === startDistance ? 0 : (target - startDistance) / (endDistance - startDistance)

    return {
      lat: start.lat + (end.lat - start.lat) * ratio,
      lng: start.lng + (end.lng - start.lng) * ratio,
    }
  }

  return { pointAt }
}

function averageStrength(samples: TurnSample[]) {
  if (samples.length === 0) return 0
  return samples.reduce((total, sample) => total + sample.absDelta, 0) / samples.length
}

function cornerGrade(absDelta: number) {
  if (absDelta >= 118) return 1
  if (absDelta >= 92) return 2
  if (absDelta >= 70) return 3
  if (absDelta >= 48) return 4
  if (absDelta >= 26) return 5
  return 6
}

function cornerText(
  delta: number,
  lengthMeters: number,
  entryStrength: number,
  exitStrength: number,
): {
  grade: number
  direction: 'left' | 'right'
  text: string
  symbol: string
  callCode: string
  iconShape: PaceNote['iconShape']
  caution: boolean
} {
  const absDelta = Math.abs(delta)
  const grade = cornerGrade(absDelta)
  const direction: 'left' | 'right' = delta > 0 ? 'right' : 'left'
  const side = direction === 'left' ? 'L' : 'R'
  const isAcute = absDelta >= 150
  const isHairpin = !isAcute && absDelta >= 126
  const isSquare = !isAcute && !isHairpin && absDelta >= 84 && absDelta <= 112
  const iconShape: PaceNote['iconShape'] = isAcute ? 'acute' : isHairpin ? 'hairpin' : isSquare ? 'square' : 'corner'
  const callCode = isAcute ? `Ac${side}` : isHairpin ? `Hp${side}` : isSquare ? `Sq${side}` : `${side}${grade}`
  const caution = iconShape === 'acute' || iconShape === 'hairpin' || grade <= 2
  const shapeText = isAcute ? 'acute' : isHairpin ? 'hairpin' : isSquare ? 'square' : `${grade}`
  const long = lengthMeters >= 95 ? ' long' : ''
  const tightens = exitStrength - entryStrength >= 8 && grade > 1 ? ' tightens' : ''
  const opens = entryStrength - exitStrength >= 10 && grade < 6 ? ' opens' : ''

  return {
    grade,
    direction,
    text: `${direction} ${shapeText}${long}${tightens || opens}${caution ? ', caution' : ''}`,
    symbol: callCode,
    callCode,
    iconShape,
    caution,
  }
}

function maneuverText(type: string, modifier = '', exit?: number) {
  const side = modifier.includes('left') ? 'left' : modifier.includes('right') ? 'right' : ''

  if (type === 'roundabout' || type === 'rotary') {
    return `roundabout exit ${exit ?? 1}`
  }

  if (type === 'fork') return `fork ${side || modifier}`.trim()
  if (type === 'merge') return `merge ${side || modifier}`.trim()
  if (type === 'turn' || type === 'end of road') return `${side || modifier || 'straight'} junction`.trim()

  return ''
}

function junctionSymbol(type: string, modifier = '', exit?: number) {
  if (type === 'roundabout' || type === 'rotary') return `RB${exit ?? 1}`
  if (modifier.includes('left')) return 'JL'
  if (modifier.includes('right')) return 'JR'
  return 'J'
}

function junctionSeverity(modifier = '') {
  if (modifier.includes('sharp')) return 2
  if (modifier.includes('slight')) return 5
  if (modifier.includes('left') || modifier.includes('right')) return 4
  return 5
}

function sampleTurns(points: LatLng[], cumulative: number[]) {
  const sampler = createSampler(points, cumulative)
  const totalDistance = cumulative[cumulative.length - 1]
  const sampleStepMeters = 12
  const windowMeters = 26
  const samples: TurnSample[] = []

  for (let distance = windowMeters; distance <= totalDistance - windowMeters; distance += sampleStepMeters) {
    const before = sampler.pointAt(distance - windowMeters)
    const current = sampler.pointAt(distance)
    const after = sampler.pointAt(distance + windowMeters)
    const incoming = bearingDegrees(before, current)
    const outgoing = bearingDegrees(current, after)
    const delta = signedBearingDelta(incoming, outgoing)
    const absDelta = Math.abs(delta)

    if (absDelta < 8.5) continue

    samples.push({
      distance,
      point: current,
      delta,
      absDelta,
    })
  }

  return samples
}

function finalizeCluster(samples: TurnSample[]): CornerCluster | null {
  if (samples.length === 0) return null

  const apex = samples.reduce((strongest, sample) => (sample.absDelta > strongest.absDelta ? sample : strongest), samples[0])
  const lengthMeters = samples[samples.length - 1].distance - samples[0].distance
  const average = averageStrength(samples)

  if (apex.absDelta < 12 && (lengthMeters < 28 || average < 9.5)) return null

  const split = Math.max(1, Math.floor(samples.length / 3))
  const entry = samples.slice(0, split)
  const exit = samples.slice(-split)

  return {
    samples,
    direction: apex.delta > 0 ? 'right' : 'left',
    startDistance: Math.max(0, samples[0].distance - 14),
    endDistance: samples[samples.length - 1].distance + 14,
    apex,
    entryStrength: averageStrength(entry),
    exitStrength: averageStrength(exit),
  }
}

function clusterCorners(samples: TurnSample[]) {
  const clusters: CornerCluster[] = []
  let current: TurnSample[] = []

  for (const sample of samples) {
    const previous = current[current.length - 1]
    const sameDirection = !previous || Math.sign(previous.delta) === Math.sign(sample.delta)
    const closeEnough = !previous || sample.distance - previous.distance <= 30

    if (!previous || (sameDirection && closeEnough)) {
      current.push(sample)
      continue
    }

    const cluster = finalizeCluster(current)
    if (cluster) clusters.push(cluster)
    current = [sample]
  }

  const last = finalizeCluster(current)
  if (last) clusters.push(last)

  return clusters
}

function cornerNotes(points: LatLng[], cumulative: number[]) {
  return clusterCorners(sampleTurns(points, cumulative)).map((cluster) => {
    const lengthMeters = cluster.endDistance - cluster.startDistance
    const call = cornerText(
      cluster.apex.delta,
      lengthMeters,
      cluster.entryStrength,
      cluster.exitStrength,
    )

    return {
      id: noteId('corner', cluster.apex.distance),
      kind: 'corner',
      text: call.text,
      displayCall: call.text,
      severity: call.grade,
      direction: call.direction,
      symbol: call.symbol,
      callCode: call.callCode,
      iconShape: call.iconShape,
      caution: call.caution,
      distance: cluster.apex.distance,
      entryDistance: cluster.startDistance,
      exitDistance: cluster.endDistance,
      lengthMeters,
      turnDegrees: Math.round(cluster.apex.absDelta),
      lat: cluster.apex.point.lat,
      lng: cluster.apex.point.lng,
    } satisfies PaceNote
  })
}

function junctionNotes(route: RouteInfo, points: LatLng[]) {
  const notes: PaceNote[] = []
  let lastJunctionDistance = -Infinity

  route.steps.forEach((step) => {
    const type = step.maneuver.type
    if (type === 'depart' || type === 'arrive') return

    const text = maneuverText(type, step.maneuver.modifier, step.maneuver.exit)
    if (!text) return

    const location: LatLng = {
      lng: step.maneuver.location[0],
      lat: step.maneuver.location[1],
    }
    const distance = nearestRouteDistance(points, location)
    if (distance - lastJunctionDistance < 35) return
    lastJunctionDistance = distance

    const symbol = junctionSymbol(type, step.maneuver.modifier, step.maneuver.exit)

    notes.push({
      id: noteId('junction', distance),
      kind: 'junction',
      text,
      displayCall: text,
      severity: junctionSeverity(step.maneuver.modifier),
      symbol,
      callCode: symbol,
      iconShape: type === 'roundabout' || type === 'rotary' ? 'roundabout' : 'junction',
      direction:
        step.maneuver.modifier === 'left' || step.maneuver.modifier === 'slight left'
          ? 'left'
          : step.maneuver.modifier === 'right' || step.maneuver.modifier === 'slight right'
            ? 'right'
            : 'straight',
      distance,
      lat: location.lat,
      lng: location.lng,
    })
  })

  return notes
}

function dedupeNotes(notes: PaceNote[]) {
  const sorted = [...notes].sort((a, b) => a.distance - b.distance)
  const kept: PaceNote[] = []

  for (const note of sorted) {
    const previous = kept[kept.length - 1]

    if (!previous || note.distance - previous.distance > 24) {
      kept.push(note)
      continue
    }

    if (previous.kind === 'start' || note.kind === 'finish') {
      kept.push(note)
      continue
    }

    if (note.kind === 'junction' && previous.kind === 'corner') {
      kept[kept.length - 1] = {
        ...note,
        severity: Math.min(note.severity, previous.severity),
        caution: note.caution || previous.caution,
      }
      continue
    }

    if (note.kind === 'corner' && previous.kind === 'junction') {
      kept[kept.length - 1] = {
        ...previous,
        severity: Math.min(note.severity, previous.severity),
        caution: note.caution || previous.caution,
      }
      continue
    }

    if (note.severity < previous.severity) kept[kept.length - 1] = note
  }

  return kept
}

function prependDistances(notes: PaceNote[]) {
  return notes.map((note, index) => {
    const displayCall = note.displayCall ?? note.text
    if (index === 0 || note.kind === 'finish') return { ...note, displayCall }

    const previous = notes[index - 1]
    const rawGap = note.distance - previous.distance
    const gap = roundedCallDistance(rawGap)

    if (rawGap < 45) {
      return { ...note, distanceCall: 'into', displayCall, text: `into ${displayCall}` }
    }

    if (rawGap < 120) {
      return { ...note, distanceCall: `${gap} into`, displayCall, text: `${gap}, into ${displayCall}` }
    }

    if (!gap) return { ...note, displayCall }
    return { ...note, distanceCall: gap, displayCall, text: `${gap}, ${displayCall}` }
  })
}

export function generatePaceNotes(route: RouteInfo): PaceNote[] {
  const points = route.geometry
  if (points.length < 3) return []

  const cumulative = cumulativeDistances(points)
  const notes: PaceNote[] = [
    {
      id: 'start',
      kind: 'start',
      text: 'start',
      displayCall: 'start',
      severity: 6,
      direction: 'straight',
      symbol: 'GO',
      callCode: 'GO',
      iconShape: 'start',
      distance: 0,
      lat: points[0].lat,
      lng: points[0].lng,
      locked: true,
    },
    ...cornerNotes(points, cumulative),
    ...junctionNotes(route, points),
  ]

  const finish = points[points.length - 1]
  notes.push({
    id: 'finish',
    kind: 'finish',
    text: 'finish',
    displayCall: 'finish',
    severity: 6,
    direction: 'straight',
    symbol: 'FIN',
    callCode: 'FIN',
    iconShape: 'finish',
    distance: route.distance,
    lat: finish.lat,
    lng: finish.lng,
    locked: true,
  })

  return prependDistances(dedupeNotes(notes))
}
