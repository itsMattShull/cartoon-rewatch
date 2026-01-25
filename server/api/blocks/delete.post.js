import fs from 'node:fs/promises'
import path from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import { getSessionFromEvent } from '../../utils/auth'

const BLOCKS_DIR = 'assets/blocks'
const INDEX_FILE = 'assets/blocks/blocks-index.json'
const ACTIVE_FILE = 'assets/blocks/active-blocks.json'
const CHANNEL_SLUGS = ['toonami', 'adult-swim', 'saturday-morning']

function normalizeSlug(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
}

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch (error) {
    return fallback
  }
}

export default defineEventHandler(async (event) => {
  const session = getSessionFromEvent(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readBody(event)
  const slug = normalizeSlug(body?.slug)
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Missing block slug' })
  }

  const blockPath = path.resolve(process.cwd(), BLOCKS_DIR, `${slug}.json`)
  try {
    await fs.unlink(blockPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw createError({ statusCode: 500, statusMessage: 'Failed to delete block file' })
    }
  }

  const indexPath = path.resolve(process.cwd(), INDEX_FILE)
  let index = { blocks: {} }
  try {
    const rawIndex = await fs.readFile(indexPath, 'utf8')
    index = safeParseJson(rawIndex, { blocks: {} })
  } catch (error) {
    index = { blocks: {} }
  }

  if (index.blocks && typeof index.blocks === 'object') {
    delete index.blocks[slug]
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2))
  }

  const activePath = path.resolve(process.cwd(), ACTIVE_FILE)
  let active = {}
  try {
    const rawActive = await fs.readFile(activePath, 'utf8')
    active = safeParseJson(rawActive, {})
  } catch (error) {
    active = {}
  }

  let didUpdateActive = false
  for (const channel of CHANNEL_SLUGS) {
    if (active?.[channel] === slug) {
      active[channel] = ''
      didUpdateActive = true
    }
  }

  if (didUpdateActive) {
    await fs.mkdir(path.dirname(activePath), { recursive: true })
    await fs.writeFile(activePath, JSON.stringify(active, null, 2))
  }

  return { ok: true }
})
