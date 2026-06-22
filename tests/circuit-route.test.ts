import assert from 'node:assert/strict'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { fetchRoute } from '../src/services/routing'
import { useStageStore } from '../src/stores/stage'
import type { StagePoint } from '../src/types'

const start: StagePoint = { id: 'start', name: 'Start / Finish', lat: 45, lng: 16 }
const split: StagePoint = { id: 'split', name: 'Split 1', lat: 45.01, lng: 16.01 }
let capturedUrl = ''

globalThis.fetch = async (input) => {
  capturedUrl = String(input)
  return {
    ok: true,
    json: async () => ({
      code: 'Ok',
      routes: [
        {
          distance: 1000,
          duration: 80,
          geometry: {
            coordinates: [
              [start.lng, start.lat],
              [split.lng, split.lat],
              [start.lng, start.lat],
            ],
          },
          legs: [{ steps: [] }, { steps: [] }],
        },
      ],
    }),
  } as Response
}

const route = await fetchRoute([start, split], 'closed-circuit')
assert.equal(
  capturedUrl.includes('/route/v1/driving/16,45;16.01,45.01;16,45?'),
  true,
  `Expected circuit route to close back to start, got ${capturedUrl}`,
)
assert.deepEqual(route.geometry.at(-1), { lat: start.lat, lng: start.lng })

setActivePinia(createPinia())
const stage = useStageStore()
stage.clearStage()
stage.routeMode = 'closed-circuit'
stage.addWaypoint(start)
stage.addWaypoint(split)

assert.deepEqual(stage.waypoints.map((point) => point.name), ['Start / Finish', 'Split 1'])
assert.equal(stage.circuitLapCount, 3)

stage.setCircuitLapCount(7)
assert.equal(stage.circuitLapCount, 7)
assert.equal(stage.driveAttempt.targetLapCount, 7)

stage.setCircuitLapCount(42)
assert.equal(stage.circuitLapCount, 42)
assert.equal(stage.driveAttempt.targetLapCount, 42)

stage.routeMode = 'point-to-point'
await nextTick()
assert.deepEqual(stage.waypoints.map((point) => point.name), ['Start', 'Finish'])

console.log('Circuit route tests passed')
