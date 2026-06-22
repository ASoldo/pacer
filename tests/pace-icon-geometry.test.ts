import assert from 'node:assert/strict'
import { angleDegrees, roundaboutExitNumber, roundaboutGeometry } from '../src/utils/paceIconGeometry'

const expectedExits: Record<
  number,
  { start: [number, number]; tip: { x: number; y: number; angle: number } }
> = {
  1: { start: [49, 32], tip: { x: 55, y: 32, angle: 0 } },
  2: { start: [44, 20], tip: { x: 49, y: 15, angle: -45 } },
  3: { start: [32, 15], tip: { x: 32, y: 12, angle: -90 } },
  4: { start: [20, 20], tip: { x: 15, y: 15, angle: -135 } },
  5: { start: [15, 32], tip: { x: 12, y: 32, angle: 180 } },
  6: { start: [20, 44], tip: { x: 15, y: 49, angle: 135 } },
}

for (let exit = 1; exit <= 6; exit += 1) {
  const geometry = roundaboutGeometry(exit)
  const expected = expectedExits[exit]
  const exitSegment = `M${expected.start[0]} ${expected.start[1]} L${expected.tip.x} ${expected.tip.y}`
  const moveCount = geometry.d.match(/(^| )M/g)?.length ?? 0

  assert.match(geometry.d, /^M32 56 L32 50 M36 49 /, `Roundabout exit ${exit} should start with the entry stem and loop`)
  assert.match(geometry.d, / C50 22 42 14 32 14 /, `Roundabout exit ${exit} should include the top circular flow`)
  assert.match(geometry.d, / C14 40 20 47 28 49 /, `Roundabout exit ${exit} should leave an open entry gap`)
  assert.equal(moveCount, 3, `Roundabout exit ${exit} should use separate stem, loop, and exit subpaths`)
  assert.equal(
    geometry.d.endsWith(exitSegment),
    true,
    `Roundabout exit ${exit} should end with its outward exit segment`,
  )
  assert.doesNotMatch(geometry.d, /Z/i, `Roundabout exit ${exit} should not close into a self-crossing loop`)
  assert.doesNotMatch(geometry.d, /NaN|undefined/, `Roundabout exit ${exit} should not emit invalid path values`)
  assert.equal(roundaboutExitNumber(`RB${exit}`), exit, `RB${exit} should parse its exit number`)
  assert.equal(Number.isFinite(geometry.tip.x), true, `Roundabout exit ${exit} tip x should be finite`)
  assert.equal(Number.isFinite(geometry.tip.y), true, `Roundabout exit ${exit} tip y should be finite`)
  assert.equal(Number.isFinite(geometry.tip.angle), true, `Roundabout exit ${exit} tip angle should be finite`)
  assert.deepEqual(geometry.tip, expected.tip, `Roundabout exit ${exit} should use its tested arrow anchor`)
  assert.equal(
    angleDegrees(expected.start[0], expected.start[1], expected.tip.x, expected.tip.y),
    expected.tip.angle,
    `Roundabout exit ${exit} arrow angle should match its exit segment`,
  )
  assert.ok(geometry.tip.x >= 12 && geometry.tip.x <= 55, `Roundabout exit ${exit} tip x out of safe arrow-anchor bounds`)
  assert.ok(geometry.tip.y >= 12 && geometry.tip.y <= 49, `Roundabout exit ${exit} tip y out of safe arrow-anchor bounds`)
}

assert.equal(roundaboutExitNumber('RB0'), 1, 'Roundabout exit numbers should clamp low values')
assert.equal(roundaboutExitNumber('RB9'), 6, 'Roundabout exit numbers should clamp high values')
assert.equal(roundaboutExitNumber('JL', 3), 3, 'Non-roundabout symbols should use the fallback')

const tips = new Set(
  Array.from({ length: 6 }, (_, index) => {
    const tip = roundaboutGeometry(index + 1).tip
    return `${tip.x},${tip.y},${tip.angle}`
  }),
)

assert.equal(tips.size, 6, 'All six roundabout exits should have distinct arrow tips')

console.log('Pace icon geometry tests passed')
