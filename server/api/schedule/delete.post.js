import { createError, defineEventHandler, readBody } from 'h3'
import { assertSameOrigin, requireAdmin } from '../../utils/auth'
import { getChannels, normalizeChannelSlug } from '../../utils/channels'
import {
  normalizeScheduleList,
  readSchedules,
  withScheduleLock,
  writeSchedules
} from '../../utils/schedules'
import { isValidId } from '#shared/schedule-time.js'
import { broadcastToViewers } from '../../utils/viewer-broadcast'

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  requireAdmin(event)

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
  if (!isValidId(entryId)) {
    // A rule occurrence id lands here. Those are not rows in this store — the caller
    // wants to skip an occurrence, which is /api/schedule/recurring/delete.
    throw createError({
      statusCode: 400,
      statusMessage: 'That entry comes from a repeating block. Edit the repeat instead.'
    })
  }

  await withScheduleLock(async () => {
    const stored = await readSchedules()
    const existingEntries = normalizeScheduleList(stored.channels?.[channelSlug] || [])
    const nextEntries = existingEntries.filter((entry) => entry.id !== entryId)
    if (nextEntries.length === existingEntries.length) {
      throw createError({ statusCode: 404, statusMessage: 'Schedule entry not found' })
    }

    if (!stored.channels || typeof stored.channels !== 'object') {
      stored.channels = {}
    }
    stored.channels[channelSlug] = nextEntries.map(({ id, blockSlug, startTime }) => ({
      id,
      blockSlug,
      startTime
    }))
    await writeSchedules(stored)
  })

  broadcastToViewers({
    type: 'schedule_update',
    channels: { [channelSlug]: null },
    at: Date.now()
  })

  return { ok: true }
})
