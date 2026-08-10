import fs from 'node:fs/promises'
import path from 'node:path'
import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { IMAGE_MIME, UPLOAD_DIR, UPLOAD_FILENAME } from '../../utils/banners'

// Public route serving admin-uploaded banner images out of .data/banners/.
// Runtime-written files can't be served from public/, because Nitro builds its static
// asset manifest at build time and 404s anything added afterwards.
export default defineEventHandler(async (event) => {
  const raw = getRouterParam(event, 'file') || ''
  // Decode once, explicitly, then validate — so the check stays correct even if h3's
  // decoding behaviour changes underneath us.
  let requested
  try {
    requested = decodeURIComponent(raw)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  // The allow-list regex is the security boundary, not the route shape. Only names this
  // server generated (content hash + known extension) can match, so traversal sequences
  // never reach the filesystem.
  if (!UPLOAD_FILENAME.test(requested)) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const dir = path.resolve(process.cwd(), UPLOAD_DIR)
  const filePath = path.join(dir, requested)
  if (path.dirname(filePath) !== dir) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  let data
  try {
    const stat = await fs.lstat(filePath)
    // Reject symlinks: a link inside the directory could still resolve outside it.
    if (!stat.isFile()) {
      throw createError({ statusCode: 404, statusMessage: 'Not found' })
    }
    data = await fs.readFile(filePath)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const ext = requested.split('.').pop()
  setResponseHeader(event, 'Content-Type', IMAGE_MIME[ext])
  // Never let the browser reconsider what these bytes are — with a fixed Content-Type
  // this defeats GIF/HTML polyglots.
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Content-Disposition', `inline; filename="${requested}"`)
  // Backstop for serving user bytes from our own origin: even if something scriptable
  // were served here, an opaque sandboxed origin can't read cookies or call our APIs.
  setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'; sandbox")
  // Safe because filenames are content hashes: changed image means a changed URL.
  setResponseHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  return data
})
