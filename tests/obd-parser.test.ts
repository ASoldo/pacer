import assert from 'node:assert/strict'
import {
  createMockObdSample,
  extractObdPayload,
  parseObdSnapshot,
  parsePidValue,
  parseSupportedPids,
  preferredThrottle,
} from '../src/services/obd'

assert.deepEqual(extractObdPayload('010C', '010C\r41 0C 1A F8\r>'), [0x1a, 0xf8])
assert.deepEqual(parsePidValue('010C', '41 0C 1A F8'), { rpm: 1726 })
assert.deepEqual(parsePidValue('010D', '41 0D 58'), { speedKph: 88 })
assert.deepEqual(parsePidValue('0111', '41 11 80'), { throttle: 50.2 })
assert.deepEqual(parsePidValue('0149', '41 49 70'), { accelerator: 43.9 })
assert.deepEqual(parsePidValue('0142', '41 42 37 10'), { voltage: 14.1 })

const supported = parseSupportedPids('0100', '41 00 BE 1F A8 13')
assert.equal(supported.includes('0C'), true)
assert.equal(supported.includes('0D'), true)
assert.equal(supported.includes('11'), true)
assert.equal(supported.includes('20'), true)

const snapshot = parseObdSnapshot(
  {
    rpm: '41 0C 2E E0',
    speed: '41 0D 4C',
    throttle: '41 11 66',
    acceleratorD: '41 49 99',
    voltage: '41 42 36 7C',
  },
  1_000,
)

assert.equal(snapshot.rpm, 3000)
assert.equal(snapshot.speedKph, 76)
assert.equal(snapshot.throttle, 40)
assert.equal(snapshot.accelerator, 60)
assert.equal(snapshot.voltage, 13.95)
assert.equal(preferredThrottle(snapshot), 60)

const mock = createMockObdSample(3_500)
assert.equal(typeof mock.rpm, 'number')
assert.equal(typeof mock.speedKph, 'number')
assert.equal(typeof preferredThrottle(mock), 'number')
assert.ok(mock.supportedPids?.includes('0C'))

console.log('OBD parser tests passed')
