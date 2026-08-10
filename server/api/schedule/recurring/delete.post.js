import { createError, defineEventHandler, readBody } from 'h3'
import { assertSameOrigin, requireAdmin } from '../../../utils/auth'
import { getChannels, normalizeChannelSlug } from '../../../utils/channels'
import {
  getChannelRules,
  readSchedules,
  withScheduleLock,
  writeSchedules
} from '../../../utils/schedules'
import { MAX_RULE_EXCEPTIONS, isCivilDate, isValidId } from '#shared/schedule-time.js'
import { broadcastToViewers } from '../../../utils/viewer-broadcast'

/**
 * Removes a repeating block, or — when `skipDate` is given — cancels a single occurrence
 * by recording an exception.
 *
 * The exception path is what makes one-off overrides expressible at all: rules carry
 * minute precision, so an admin cannot reliably cancel one airing by placing a one-off
 * on top of it.
 */
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

  const ruleId = typeof body?.id === 'string' ? body.id.trim() : ''
  if (!isValidId(ruleId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid rule id' })
  }

  const skipDate = typeof body?.skipDate === 'string' ? body.skipDate.trim() : ''
  if (skipDate && !isCivilDate(skipDate)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid date to skip' })
  }

  await withScheduleLock(async () => {
    const stored = await readSchedules()
    const existing = getChannelRules(stored, channelSlug)
    const target = existing.find((rule) => rule.id === ruleId)
    if (!target) {
      throw createError({ statusCode: 404, statusMessage: 'Repeating block not found' })
    }

    if (!stored.recurring || typeof stored.recurring !== 'object') {
      stored.recurring = {}
    }

    if (skipDate) {
      if (target.exceptions.length >= MAX_RULE_EXCEPTIONS && !target.exceptions.includes(skipDate)) {
        throw createError({
          statusCode: 400,
          statusMessage: `A repeating block can skip at most ${MAX_RULE_EXCEPTIONS} dates`
        })
      }
      const exceptions = [...new Set([...target.exceptions, skipDate])].sort()
      stored.recurring[channelSlug] = existing.map((rule) =>
        rule.id === ruleId ? { ...rule, exceptions } : rule
      )
    } else {
      stored.recurring[channelSlug] = existing.filter((rule) => rule.id !== ruleId)
    }

    await writeSchedules(stored)
  })

  broadcastToViewers({
    type: 'schedule_update',
    channels: { [channelSlug]: null },
    at: Date.now()
  })

  return { ok: true }
})
