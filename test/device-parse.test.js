import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAdbDevices } from '../lib/providers/device.js'

/**
 * `adb devices -l` parsing, pinned against the lines real adb prints.
 *
 * The listing is the plugin's only view of which devices exist and in what
 * state, so a state misread here reaches every device tool. Two lines are worth
 * pinning in particular: the two-word `no permissions` state, which is the one
 * place a failing adb names the fix, and a state a future adb adds, which must
 * stay visible rather than collapse to `unknown`.
 */

/**
 * Assemble a listing the way `adb devices -l` prints one.
 *
 * @param {...string} lines - the device lines, without the header.
 * @returns {string} the command's stdout.
 */
function listing(...lines) {
  return ['List of devices attached', ...lines, ''].join('\n')
}

test('a two-word state keeps both words and the whole raw line', () => {
  // Observed from a USB device without udev rules. The trailing URL is what
  // makes reading the rest of the line as label attributes wrong, and the
  // parenthesised sentence is the only thing that says what to repair.
  const line =
    'R58M12ABCDE            no permissions (user in plugdev group; are your udev rules wrong?); ' +
    'see [http://developer.android.com/tools/device.html]'
  const [device] = parseAdbDevices(listing(line))
  assert.equal(device.serial, 'R58M12ABCDE')
  assert.equal(device.state, 'no permissions')
  // The explanation has no structured field, so it has to survive in `raw`;
  // truncating the state to its first word used to lose both.
  assert.equal(device.raw, line)
  assert.match(device.raw, /udev rules wrong/)
  // Prose is not attribute data: the URL must not turn into an attribute.
  assert.equal(device.transportId, undefined)
  assert.equal(device.model, undefined)
})

test('every adb connection state survives parsing', () => {
  const states = [
    'device',
    'offline',
    'unauthorized',
    'bootloader',
    'recovery',
    'sideload',
    'rescue',
    'authorizing',
    'connecting',
    'host',
  ]
  const devices = parseAdbDevices(
    listing(...states.map((state, index) => `emulator-556${index}          ${state} transport_id:${index + 1}`)),
  )
  assert.deepEqual(
    devices.map((item) => item.state),
    states,
  )
  assert.equal(devices[1].transportId, '2')
})

test('a state outside the vocabulary is reported as its own word', () => {
  // A newer adb may add a state. Dropping it would label the device `unknown`,
  // which reads as a parser failure rather than as a real answer from the tool.
  const [device] = parseAdbDevices(listing('emulator-5554          halting transport_id:7'))
  assert.equal(device.state, 'halting')
  assert.equal(device.transportId, '7')
})

test('a state that merely starts with a known one is not truncated', () => {
  const [device] = parseAdbDevices(listing('emulator-5554          device-busy'))
  assert.equal(device.state, 'device-busy')
})

test('label attributes still parse after a one-word state', () => {
  // The regression guard for the state rewrite: splitting the state off must
  // leave the `-l` attributes starting exactly where they started before.
  const [device] = parseAdbDevices(
    listing(
      'R58M12ABCDE            unauthorized usb:336592896X product:oriole model:Pixel_6 device:oriole transport_id:2',
    ),
  )
  assert.equal(device.state, 'unauthorized')
  assert.equal(device.product, 'oriole')
  assert.equal(device.model, 'Pixel_6')
  assert.equal(device.device, 'oriole')
  assert.equal(device.transportId, '2')
  assert.equal(device.kind, 'device')
})

test('a serial with no state at all is still one record', () => {
  const [device] = parseAdbDevices(listing('emulator-5554'))
  assert.equal(device.serial, 'emulator-5554')
  assert.equal(device.state, 'unknown')
  assert.equal(device.kind, 'emulator')
})
