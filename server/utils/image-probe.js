// Identifies raster images by magic bytes and reads their intrinsic dimensions.
//
// Two reasons this is byte-level rather than trusting the upload's Content-Type or
// filename extension, both of which are attacker-supplied text:
//   1. Type must be established from content, so a polyglot or mislabelled file can't
//      be stored under an extension that makes the browser treat it as markup.
//   2. The intrinsic width/height get stored with the banner so the front page can
//      reserve the layout box during SSR, instead of shifting the page when the image
//      finally decodes.
//
// SVG is deliberately absent: it is an XML document that can carry <script>, and it
// would be served from the app's own origin. There is no ad banner worth that.

function readAscii(buffer, start, length) {
  return buffer.toString('latin1', start, start + length)
}

function probePng(buffer) {
  if (buffer.length < 24) return null
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < sig.length; i += 1) {
    if (buffer[i] !== sig[i]) return null
  }
  return {
    ext: 'png',
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  }
}

function probeGif(buffer) {
  if (buffer.length < 10) return null
  if (readAscii(buffer, 0, 4) !== 'GIF8') return null
  return {
    ext: 'gif',
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8)
  }
}

function probeJpeg(buffer) {
  if (buffer.length < 4) return null
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) return null

  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    // SOF0-SOF15 carry the frame dimensions; C4/C8/CC are Huffman/arithmetic tables.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      return {
        ext: 'jpg',
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      }
    }
    const segmentLength = buffer.readUInt16BE(offset + 2)
    if (segmentLength < 2) return null
    offset += 2 + segmentLength
  }
  // Valid JPEG signature but dimensions weren't found; still a JPEG.
  return { ext: 'jpg', width: 0, height: 0 }
}

function probeWebp(buffer) {
  if (buffer.length < 30) return null
  if (readAscii(buffer, 0, 4) !== 'RIFF' || readAscii(buffer, 8, 4) !== 'WEBP') return null

  const chunk = readAscii(buffer, 12, 4)
  if (chunk === 'VP8 ') {
    return {
      ext: 'webp',
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    }
  }
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21)
    return {
      ext: 'webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    }
  }
  if (chunk === 'VP8X') {
    return {
      ext: 'webp',
      width: (buffer.readUIntLE(24, 3) & 0xffffff) + 1,
      height: (buffer.readUIntLE(27, 3) & 0xffffff) + 1
    }
  }
  return { ext: 'webp', width: 0, height: 0 }
}

/**
 * Returns { ext, width, height } for a supported raster image, or null if the bytes
 * are not one of PNG / JPEG / GIF / WebP.
 */
export function probeImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null
  return probePng(buffer) || probeGif(buffer) || probeJpeg(buffer) || probeWebp(buffer) || null
}
