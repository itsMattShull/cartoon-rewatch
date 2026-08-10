import { defineEventHandler, setHeader } from 'h3'
import { getChannels } from '../utils/channels'
import {
  getChannelRules,
  normalizeScheduleList,
  readSchedules,
  SCHEDULE_TIME_ZONE
} from '../utils/schedules'

/**
 * Public. Ships one-off entries and the raw recurring RULES — never a server-side
 * expansion of them.
 *
 * Expanding here would mean picking a window, and any window has an edge: a browser left
 * open past it holds a stale expansion and silently disagrees with a freshly loaded one
 * about which episode is playing. Rules are deterministic by clock, exactly like the rest
 * of this app, so a client that has been open for a month computes the same anchor as a
 * new one. It also keeps this endpoint — the busiest anonymous route — free of the
 * per-request Intl work an expansion would cost.
 */
export default defineEventHandler(async (event) => {
  const { channels } = await getChannels({ includeDefaults: true })
  const known = new Set(channels.map((channel) => channel.slug))
  const stored = await readSchedules()
  const output = {}
  const recurring = {}

  for (const [slug, entries] of Object.entries(stored.channels || {})) {
    if (!known.has(slug)) continue
    const normalized = normalizeScheduleList(entries)
    if (normalized.length) {
      output[slug] = normalized
    }
  }

  for (const slug of known) {
    const rules = getChannelRules(stored, slug)
    if (rules.length) {
      recurring[slug] = rules
    }
  }

  // Short shared cache: the payload only changes on an admin write, and this route is
  // re-fetched by every connected client on each schedule_update broadcast.
  setHeader(event, 'Cache-Control', 'public, max-age=15')

  return { channels: output, recurring, timeZone: SCHEDULE_TIME_ZONE }
})
