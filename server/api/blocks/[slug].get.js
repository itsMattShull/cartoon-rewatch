import fs from 'node:fs/promises'
import path from 'node:path'
import { createError, defineEventHandler } from 'h3'

const BLOCKS_DIR = 'assets/blocks'

function normalizeSlug(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
}

export default defineEventHandler(async (event) => {
  const slug = normalizeSlug(event.context.params?.slug)
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Missing block slug' })
  }

  const filePath = path.resolve(process.cwd(), BLOCKS_DIR, `${slug}.json`)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const payload = JSON.parse(raw)
    return { slug, payload }
  } catch (error) {
    throw createError({ statusCode: 404, statusMessage: 'Block not found' })
  }
})
