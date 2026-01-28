import fs from 'node:fs/promises'
import path from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import { getSessionFromEvent } from '../../utils/auth'
import { getChannels } from '../../utils/channels'
import { broadcastToViewers } from '../../utils/viewer-broadcast'

const ACTIVE_FILE = 'assets/blocks/active-blocks.json'

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
  const channelSlug = normalizeSlug(body?.channelSlug)
  const { channels } = await getChannels({ includeDefaults: true })
  const isKnownChannel = channels.some((channel) => channel.slug === channelSlug)
  if (!isKnownChannel) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown channel' })
  }

  const blockSlug = normalizeSlug(body?.blockSlug)

  const filePath = path.resolve(process.cwd(), ACTIVE_FILE)
  let mapping = {}
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    mapping = safeParseJson(raw, {})
  } catch (error) {
    mapping = {}
  }

  mapping[channelSlug] = blockSlug || ''

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(mapping, null, 2))

  broadcastToViewers({
    type: 'active_update',
    channels: { [channelSlug]: blockSlug || '' },
    at: Date.now()
  })

  return { ok: true, active: mapping }
})
