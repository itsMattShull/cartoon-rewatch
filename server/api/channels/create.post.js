import fs from 'node:fs/promises'
import path from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import { getSessionFromEvent } from '../../utils/auth'
import {
  getChannels,
  normalizeChannelName,
  normalizeChannelNameKey,
  normalizeChannelSlug,
  writeChannelsIndex
} from '../../utils/channels'

const ACTIVE_FILE = 'assets/blocks/active-blocks.json'
const NAME_LIMIT = 16

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
  const nameInput = normalizeChannelName(body?.name)
  if (!nameInput) {
    throw createError({ statusCode: 400, statusMessage: 'Missing channel name' })
  }
  if (nameInput.length > NAME_LIMIT) {
    throw createError({ statusCode: 400, statusMessage: 'Channel name too long' })
  }

  const slug = normalizeChannelSlug(body?.slug || nameInput)
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid channel name' })
  }

  const { index } = await getChannels({ includeDefaults: true })
  if (index.channels?.[slug]) {
    throw createError({ statusCode: 400, statusMessage: 'Channel already exists' })
  }

  const nameKey = normalizeChannelNameKey(nameInput)
  const hasNameConflict = Object.values(index.channels || {}).some((entry) => {
    if (!entry?.name) return false
    return normalizeChannelNameKey(entry.name) === nameKey
  })
  if (hasNameConflict) {
    throw createError({ statusCode: 400, statusMessage: 'Channel name already exists' })
  }

  if (!index.channels || typeof index.channels !== 'object') {
    index.channels = {}
  }
  index.channels[slug] = { name: nameInput }
  await writeChannelsIndex(index)

  const activePath = path.resolve(process.cwd(), ACTIVE_FILE)
  let active = {}
  try {
    const rawActive = await fs.readFile(activePath, 'utf8')
    active = safeParseJson(rawActive, {})
  } catch (error) {
    active = {}
  }
  active[slug] = ''
  await fs.mkdir(path.dirname(activePath), { recursive: true })
  await fs.writeFile(activePath, JSON.stringify(active, null, 2))

  return { ok: true, channel: { slug, name: nameInput } }
})
