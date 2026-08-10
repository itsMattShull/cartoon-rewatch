import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { createError, defineEventHandler, getHeader, readMultipartFormData } from 'h3'
import { assertSameOrigin, requireAdmin } from '../../utils/auth'
import { MAX_UPLOAD_BYTES, UPLOAD_DIR } from '../../utils/banners'
import { probeImage } from '../../utils/image-probe'

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  requireAdmin(event)

  // readMultipartFormData buffers the whole body into memory before we can inspect it,
  // and this is a single-process server shared with the viewer WebSocket fan-out — so
  // reject oversized uploads on the declared length first. Requiring Content-Length also
  // rejects chunked bodies, which is how you would otherwise lie past this check.
  // A reverse proxy limit (e.g. nginx client_max_body_size) is the only bound that
  // applies before Node allocates at all, and should be set alongside this.
  const declaredLength = Number(getHeader(event, 'content-length'))
  if (!Number.isFinite(declaredLength) || declaredLength <= 0) {
    throw createError({ statusCode: 411, statusMessage: 'Content-Length required' })
  }
  if (declaredLength > MAX_UPLOAD_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: `Image must be under ${Math.floor(MAX_UPLOAD_BYTES / 1024)} KB`
    })
  }

  const parts = await readMultipartFormData(event)
  const file = parts?.find((part) => part.name === 'file' && part.data?.length)
  if (!file) {
    throw createError({ statusCode: 400, statusMessage: 'No file uploaded' })
  }
  if (file.data.length > MAX_UPLOAD_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: `Image must be under ${Math.floor(MAX_UPLOAD_BYTES / 1024)} KB`
    })
  }

  // Type comes from the bytes, never from part.type or part.filename.
  const probed = probeImage(file.data)
  if (!probed) {
    throw createError({
      statusCode: 415,
      statusMessage: 'Unsupported image. Use PNG, JPEG, GIF or WebP.'
    })
  }
  if (probed.width > 4000 || probed.height > 4000) {
    throw createError({ statusCode: 400, statusMessage: 'Image dimensions must be 4000px or less' })
  }

  // Content-addressed name: the client filename is discarded entirely, so there is no
  // attacker-controlled path component. Re-uploading identical bytes is idempotent, and
  // changing an image mints a new URL — which is what makes immutable caching safe.
  const digest = crypto.createHash('sha256').update(file.data).digest('hex').slice(0, 32)
  const filename = `${digest}.${probed.ext}`

  const dir = path.resolve(process.cwd(), UPLOAD_DIR)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, filename), file.data)

  return {
    ok: true,
    imageUrl: `/api/banner-image/${filename}`,
    width: probed.width,
    height: probed.height,
    bytes: file.data.length
  }
})
