export type IconGeometry = {
  d: string
  tip: {
    x: number
    y: number
    angle: number
  }
}

export function angleDegrees(fromX: number, fromY: number, toX: number, toY: number) {
  return Math.atan2(toY - fromY, toX - fromX) * (180 / Math.PI)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function roundaboutExitNumber(code: string, fallback = 2) {
  const match = code.match(/^RB(\d+)/)
  const parsed = match ? Number(match[1]) : fallback
  return clamp(Number.isFinite(parsed) ? parsed : fallback, 1, 6)
}

export function roundaboutGeometry(exit: number): IconGeometry {
  const safeExit = clamp(Math.round(exit), 1, 6)
  const loopPath = [
    'M32 56 L32 50',
    'M36 49',
    'C44 47 50 40 50 32',
    'C50 22 42 14 32 14',
    'C22 14 14 22 14 32',
    'C14 40 20 47 28 49',
  ].join(' ')
  const exits: Record<number, { start: [number, number]; tip: [number, number]; angle: number }> = {
    1: { start: [49, 32], tip: [55, 32], angle: 0 },
    2: { start: [44, 20], tip: [49, 15], angle: -45 },
    3: { start: [32, 15], tip: [32, 12], angle: -90 },
    4: { start: [20, 20], tip: [15, 15], angle: -135 },
    5: { start: [15, 32], tip: [12, 32], angle: 180 },
    6: { start: [20, 44], tip: [15, 49], angle: 135 },
  }
  const selected = exits[safeExit]

  return {
    d: `${loopPath} M${selected.start[0]} ${selected.start[1]} L${selected.tip[0]} ${selected.tip[1]}`,
    tip: {
      x: selected.tip[0],
      y: selected.tip[1],
      angle: selected.angle,
    },
  }
}
