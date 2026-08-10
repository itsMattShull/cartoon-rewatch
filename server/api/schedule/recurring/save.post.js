import { createError, defineEventHandler, readBody } from 'h3'
import { assertSameOrigin, requireAdmin } from '../../../utils/auth'
import { blockExists } from '../../../utils/blocks'
import { getChannels, normalizeChannelSlug } from '../../../utils/channels'
import {
  createRuleId,
  getChannelRules,
  readSchedules,
  withScheduleLock,
  writeSchedules
} from '../../../utils/schedules'
import {
  MAX_RULES_PER_CHANNEL,
  isValidId,
  normalizeRecurringRule
} from '#shared/schedule-time.js'
import { broadcastToViewers } from '../../../utils/viewer-broadcast'

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

  const incomingId = typeof body?.id === 'string' ? body.id.trim() : ''
  if (incomingId && !isValidId(incomingId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid rule id' })
  }
  const ruleId = incomingId || createRuleId()

  // Build field-by-field — never spread the body — so unknown keys cannot reach storage.
  const candidate = normalizeRecurringRule({
    id: ruleId,
    blockSlug: body?.blockSlug,
    days: body?.days,
    hour: body?.hour,
    minute: body?.minute,
    startDate: body?.startDate,
    endDate: body?.endDate,
    exceptions: body?.exceptions,
    enabled: body?.enabled
  })

  if (!candidate) {
    // normalizeRecurringRule folds every field check into one null. Re-derive the most
    // likely cause so the admin gets something actionable instead of "invalid".
    const days = Array.isArray(body?.days) ? body.days : []
    if (!days.length) {
      throw createError({ statusCode: 400, statusMessage: 'Pick at least one day of the week' })
    }
    if (body?.startDate && body?.endDate && String(body.endDate) < String(body.startDate)) {
      throw createError({ statusCode: 400, statusMessage: 'End date must not be before the start date' })
    }
    throw createError({ statusCode: 400, statusMessage: 'Invalid repeating block settings' })
  }

  if (!(await blockExists(candidate.blockSlug))) {
    throw createError({ statusCode: 400, statusMessage: 'That block no longer exists' })
  }

  const rule = await withScheduleLock(async () => {
    const stored = await readSchedules()
    if (!stored.recurring || typeof stored.recurring !== 'object') {
      stored.recurring = {}
    }

    const existing = getChannelRules(stored, channelSlug)
    const isNew = !existing.some((item) => item.id === candidate.id)
    if (isNew && existing.length >= MAX_RULES_PER_CHANNEL) {
      throw createError({
        statusCode: 400,
        statusMessage: `A channel can have at most ${MAX_RULES_PER_CHANNEL} repeating blocks`
      })
    }

    const next = existing.filter((item) => item.id !== candidate.id)
    next.push(candidate)
    stored.recurring[channelSlug] = next
    await writeSchedules(stored)
    return candidate
  })

  broadcastToViewers({
    type: 'schedule_update',
    channels: { [channelSlug]: null },
    at: Date.now()
  })

  return { ok: true, rule }
})
