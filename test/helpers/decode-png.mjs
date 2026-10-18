import { inflateSync } from 'node:zlib'

/**
 * Decode an 8-bit RGBA PNG into raw pixels.
 *
 * The icon is the only image this suite reads pixel by pixel, and the check it
 * needs — "does any half-transparent pixel still carry the colour that was keyed
 * out?" — cannot be made from the header alone. Node ships `zlib`, so a decoder
 * of thirty lines beats an image dependency the package would have to carry for
 * one assertion.
 *
 * Only the subset the repository's own icons use is supported: 8-bit truecolour
 * with alpha, non-interlaced. Anything else is reported as unsupported rather
 * than mis-decoded.
 *
 * @module test/helpers/decode-png
 */

/** Samples per pixel for the colour type this decoder accepts. */
const RGBA_CHANNELS = 4

/**
 * Read an `{ r, g, b, a }` pixel out of a decoded image.
 *
 * @param {{width: number, data: Buffer}} image - a {@link decodePng} result.
 * @param {number} x - column, zero-based.
 * @param {number} y - row, zero-based.
 * @returns {{r: number, g: number, b: number, a: number}} the pixel.
 */
export function pixelAt(image, x, y) {
  const at = (y * image.width + x) * RGBA_CHANNELS
  return {
    r: image.data[at],
    g: image.data[at + 1],
    b: image.data[at + 2],
    a: image.data[at + 3],
  }
}

/** Undo one PNG scanline filter in place. */
function unfilter(filter, line, target, previous) {
  const stride = line.length
  for (let i = 0; i < stride; i += 1) {
    const left = i >= RGBA_CHANNELS ? target[i - RGBA_CHANNELS] : 0
    const up = previous[i]
    const upLeft = i >= RGBA_CHANNELS ? previous[i - RGBA_CHANNELS] : 0
    let value = line[i]
    if (filter === 1) value += left
    else if (filter === 2) value += up
    else if (filter === 3) value += (left + up) >> 1
    else if (filter === 4) {
      const estimate = left + up - upLeft
      const toLeft = Math.abs(estimate - left)
      const toUp = Math.abs(estimate - up)
      const toUpLeft = Math.abs(estimate - upLeft)
      value += toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft
    }
    target[i] = value & 0xff
  }
}

/**
 * Decode a PNG buffer into `{ width, height, data }`, `data` being RGBA bytes.
 *
 * @param {Buffer} bytes - the whole file.
 * @returns {{width: number, height: number, data: Buffer}} the decoded image.
 * @throws {Error} when the file is not the 8-bit RGBA shape this decoder reads.
 */
export function decodePng(bytes) {
  if (bytes.readUInt8(24) !== 8 || bytes.readUInt8(25) !== 6) {
    throw new Error('decodePng only reads 8-bit truecolour-with-alpha PNGs')
  }
  if (bytes.readUInt8(28) !== 0) throw new Error('decodePng does not read interlaced PNGs')
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  const parts = []
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.toString('ascii', at + 4, at + 8)
    if (type === 'IDAT') parts.push(bytes.subarray(at + 8, at + 8 + length))
    at += length + 12
    if (type === 'IEND') break
  }
  const raw = inflateSync(Buffer.concat(parts))
  const stride = width * RGBA_CHANNELS
  const data = Buffer.alloc(stride * height)
  const blank = Buffer.alloc(stride)
  for (let y = 0, at = 0; y < height; y += 1) {
    const filter = raw[at]
    at += 1
    const line = raw.subarray(at, at + stride)
    at += stride
    const target = data.subarray(y * stride, (y + 1) * stride)
    const previous = y === 0 ? blank : data.subarray((y - 1) * stride, y * stride)
    unfilter(filter, line, target, previous)
  }
  return { width, height, data }
}
