import { createError, defineEventHandler, readBody } from 'h3'
import { getSessionFromEvent } from '../../utils/auth'
import { getChannels, normalizeChannelSlug } from '../../utils/channels'
import {
  normalizeScheduleList,
  readSchedules,
  writeSchedules
} from '../../utils/schedules'
import { broadcastToViewers } from '../../utils/viewer-broadcast'

export default defineEventHandler(async (event) => {
  const session = getSessionFromEvent(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readBody(event)
  const channelSlug = normalizeChannelSlug(body?.channelSlug)
  if (!channelSlug) {
    throw createError({ statusCode: 400, statusMessage: 'Missing channel slug' })
  }

  const { channels } = await getChannels({ includeDefaults: true })
  const isKnown = channels.some((channel) => channel.slug === channelSlug)
  if (!isKnown) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown channel' })
  }

  const entryId = typeof body?.id === 'string' ? body.id.trim() : ''
  if (!entryId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing schedule id' })
  }

  const stored = await readSchedules()
  const existingEntries = normalizeScheduleList(stored.channels?.[channelSlug] || [])
  const nextEntries = existingEntries.filter((entry) => entry.id !== entryId)
  if (nextEntries.length === existingEntries.length) {
    throw createError({ statusCode: 404, statusMessage: 'Schedule entry not found' })
  }

  stored.channels[channelSlug] = nextEntries
  await writeSchedules(stored)

  broadcastToViewers({
    type: 'schedule_update',
    channels: { [channelSlug]: null },
    at: Date.now()
  })

  return { ok: true }
})
