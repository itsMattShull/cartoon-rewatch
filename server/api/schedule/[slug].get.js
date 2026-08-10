import { createError, defineEventHandler } from 'h3'
import { requireAdmin } from '../../utils/auth'
import { getChannels, normalizeChannelSlug } from '../../utils/channels'
import {
  expandRecurringRules,
  getChannelRules,
  normalizeScheduleList,
  readSchedules,
  SCHEDULE_TIME_ZONE
} from '../../utils/schedules'

const PREVIEW_DAYS = 14

export default defineEventHandler(async (event) => {
  // Was `getSessionFromEvent` + a null check, which any Discord account on earth
  // satisfies via the site's own chat login — leaking every channel's unpublished
  // schedule. This is admin data; gate it like every other admin endpoint.
  requireAdmin(event)

  const slug = normalizeChannelSlug(event.context.params?.slug)
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Missing channel slug' })
  }

  const { channels } = await getChannels({ includeDefaults: true })
  const isKnown = channels.some((channel) => channel.slug === slug)
  if (!isKnown) {
    throw createError({ statusCode: 404, statusMessage: 'Channel not found' })
  }

  const stored = await readSchedules()
  const entries = normalizeScheduleList(stored.channels?.[slug] || [])
  const rules = getChannelRules(stored, slug)

  const now = Date.now()
  const occurrences = expandRecurringRules(rules, now, now + PREVIEW_DAYS * 86400000)

  return {
    channel: slug,
    timeZone: SCHEDULE_TIME_ZONE,
    entries,
    rules,
    occurrences,
    previewDays: PREVIEW_DAYS
  }
})
