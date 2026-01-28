import { createError, defineEventHandler } from 'h3'
import { getSessionFromEvent } from '../../utils/auth'
import { getChannels, normalizeChannelSlug } from '../../utils/channels'
import {
  normalizeScheduleList,
  readSchedules,
  SCHEDULE_TIME_ZONE
} from '../../utils/schedules'

export default defineEventHandler(async (event) => {
  const session = getSessionFromEvent(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

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

  return {
    channel: slug,
    timeZone: SCHEDULE_TIME_ZONE,
    entries
  }
})
