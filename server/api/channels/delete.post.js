import fs from 'node:fs/promises'
import path from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import { getSessionFromEvent } from '../../utils/auth'
import { getChannels, normalizeChannelSlug, writeChannelsIndex } from '../../utils/channels'

const ACTIVE_FILE = 'assets/blocks/active-blocks.json'

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
  const slug = normalizeChannelSlug(body?.slug)
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Missing channel slug' })
  }

  const { index } = await getChannels({ includeDefaults: true })
  if (!index.channels?.[slug]) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found' })
  }

  delete index.channels[slug]
  await writeChannelsIndex(index)

  const activePath = path.resolve(process.cwd(), ACTIVE_FILE)
  let active = {}
  try {
    const rawActive = await fs.readFile(activePath, 'utf8')
    active = safeParseJson(rawActive, {})
  } catch (error) {
    active = {}
  }

  if (active && typeof active === 'object' && slug in active) {
    delete active[slug]
    await fs.mkdir(path.dirname(activePath), { recursive: true })
    await fs.writeFile(activePath, JSON.stringify(active, null, 2))
  }

  return { ok: true }
})
