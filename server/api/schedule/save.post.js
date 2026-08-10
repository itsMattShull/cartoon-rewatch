import { createError, defineEventHandler, readBody } from 'h3'
import { assertSameOrigin, requireAdmin } from '../../utils/auth'
import { blockExists } from '../../utils/blocks'
import { getChannels, normalizeChannelSlug } from '../../utils/channels'
import {
  createScheduleId,
  normalizeBlockSlug,
  normalizeScheduleList,
  readSchedules,
  withScheduleLock,
  writeSchedules,
  zonedDateTimeToUtc
} from '../../utils/schedules'
import { isValidId } from '#shared/schedule-time.js'
import { broadcastToViewers } from '../../utils/viewer-broadcast'

// The browser gates the Save button on its own clock while the server re-checks against
// its own. With minute precision a few seconds of drift between the two would reject a
// save the admin cannot express any other way, so allow a small grace window.
const FUTURE_GRACE_MS = 60 * 1000

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

  const blockSlug = normalizeBlockSlug(body?.blockSlug)
  if (!blockSlug) {
    throw createError({ statusCode: 400, statusMessage: 'Missing block slug' })
  }
  if (!(await blockExists(blockSlug))) {
    throw createError({ statusCode: 400, statusMessage: 'That block no longer exists' })
  }

  const resolved = zonedDateTimeToUtc(body?.date, body?.hour, body?.minute ?? 0)
  if (!resolved) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid schedule time' })
  }

  const startMs = resolved.ms
  const startTime = new Date(startMs).toISOString()
  if (startMs <= Date.now() - FUTURE_GRACE_MS) {
    throw createError({ statusCode: 400, statusMessage: 'Schedule time must be in the future' })
  }

  const incomingId = typeof body?.id === 'string' ? body.id.trim() : ''
  // Reject namespaced/oversized ids outright. An expanded rule occurrence carries an id
  // like `r:<ruleId>:<ms>`; letting one round-trip through here would mint a one-off that
  // shadows a live occurrence and breaks delete.
  if (incomingId && !isValidId(incomingId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid schedule id' })
  }
  const entryId = incomingId || createScheduleId()

  const entry = await withScheduleLock(async () => {
    const stored = await readSchedules()
    if (!stored.channels || typeof stored.channels !== 'object') {
      stored.channels = {}
    }

    const existingEntries = normalizeScheduleList(stored.channels[channelSlug] || [])
    const nextEntries = existingEntries.filter((item) => item.id !== entryId)
    const saved = { id: entryId, blockSlug, startTime }
    nextEntries.push({ ...saved, startMs, recurring: false })
    nextEntries.sort((a, b) => a.startMs - b.startMs)

    // Stored shape stays {id, blockSlug, startTime}; startMs/recurring are derived.
    stored.channels[channelSlug] = nextEntries.map(({ id, blockSlug: slug, startTime: time }) => ({
      id,
      blockSlug: slug,
      startTime: time
    }))
    await writeSchedules(stored)
    return saved
  })

  broadcastToViewers({
    type: 'schedule_update',
    channels: { [channelSlug]: blockSlug },
    at: Date.now()
  })

  return { ok: true, entry }
})
