import { createError, defineEventHandler, readBody } from 'h3'
import { getSessionFromEvent } from '../../utils/auth'
import { getChannels, normalizeChannelSlug } from '../../utils/channels'
import {
  createScheduleId,
  normalizeBlockSlug,
  normalizeScheduleList,
  readSchedules,
  writeSchedules,
  zonedDateHourToUtc
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

  const blockSlug = normalizeBlockSlug(body?.blockSlug)
  if (!blockSlug) {
    throw createError({ statusCode: 400, statusMessage: 'Missing block slug' })
  }

  const startDate = zonedDateHourToUtc(body?.date, body?.hour)
  if (!startDate) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid schedule time' })
  }

  const startTime = startDate.toISOString()
  const startMs = startDate.getTime()
  if (!Number.isFinite(startMs) || startMs <= Date.now()) {
    throw createError({ statusCode: 400, statusMessage: 'Schedule time must be in the future' })
  }
  const stored = await readSchedules()

  if (!stored.channels || typeof stored.channels !== 'object') {
    stored.channels = {}
  }

  const existingEntries = normalizeScheduleList(stored.channels[channelSlug] || [])
  const incomingId = typeof body?.id === 'string' ? body.id.trim() : ''
  const entryId = incomingId || createScheduleId()

  const overlap = existingEntries.find(
    (entry) => entry.startTime === startTime && entry.id !== entryId
  )
  if (overlap) {
    throw createError({ statusCode: 400, statusMessage: 'Schedule time already taken' })
  }

  const nextEntries = existingEntries.filter((entry) => entry.id !== entryId)
  const entry = { id: entryId, blockSlug, startTime }
  nextEntries.push(entry)
  nextEntries.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))

  stored.channels[channelSlug] = nextEntries
  await writeSchedules(stored)

  broadcastToViewers({
    type: 'schedule_update',
    channels: { [channelSlug]: blockSlug },
    at: Date.now()
  })

  return { ok: true, entry }
})
