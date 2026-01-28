import { defineEventHandler } from 'h3'
import { getChannels } from '../utils/channels'
import { normalizeScheduleList, readSchedules, SCHEDULE_TIME_ZONE } from '../utils/schedules'

export default defineEventHandler(async () => {
  const { channels } = await getChannels({ includeDefaults: true })
  const known = new Set(channels.map((channel) => channel.slug))
  const stored = await readSchedules()
  const output = {}

  for (const [slug, entries] of Object.entries(stored.channels || {})) {
    if (!known.has(slug)) continue
    const normalized = normalizeScheduleList(entries)
    if (normalized.length) {
      output[slug] = normalized
    }
  }

  return { channels: output, timeZone: SCHEDULE_TIME_ZONE }
})
