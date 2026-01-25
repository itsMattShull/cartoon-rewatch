import { createError, defineEventHandler, readBody } from 'h3'
import { getSessionFromEvent } from '../../utils/auth'
import {
  getChannels,
  normalizeChannelName,
  normalizeChannelNameKey,
  normalizeChannelSlug,
  writeChannelsIndex
} from '../../utils/channels'

const NAME_LIMIT = 16

export default defineEventHandler(async (event) => {
  const session = getSessionFromEvent(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readBody(event)
  const slug = normalizeChannelSlug(body?.slug)
  const nameInput = normalizeChannelName(body?.name)
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Missing channel slug' })
  }
  if (!nameInput) {
    throw createError({ statusCode: 400, statusMessage: 'Missing channel name' })
  }
  if (nameInput.length > NAME_LIMIT) {
    throw createError({ statusCode: 400, statusMessage: 'Channel name too long' })
  }

  const { index } = await getChannels({ includeDefaults: true })
  if (!index.channels?.[slug]) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found' })
  }

  const nameKey = normalizeChannelNameKey(nameInput)
  const hasNameConflict = Object.entries(index.channels || {}).some(([existingSlug, entry]) => {
    if (existingSlug === slug) return false
    if (!entry?.name) return false
    return normalizeChannelNameKey(entry.name) === nameKey
  })
  if (hasNameConflict) {
    throw createError({ statusCode: 400, statusMessage: 'Channel name already exists' })
  }

  index.channels[slug] = { ...index.channels[slug], name: nameInput }
  await writeChannelsIndex(index)

  return { ok: true, channel: { slug, name: nameInput } }
})
