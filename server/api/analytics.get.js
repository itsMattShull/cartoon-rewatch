import { defineEventHandler, getQuery } from 'h3'
import { requireAdmin } from '../utils/auth'
import { getChannels } from '../utils/channels'
import { buildAnalyticsReport } from '../utils/analytics'

export default defineEventHandler(async (event) => {
  // Admin data. A chat-scope cookie is issued to any Discord account that clicks the
  // site's own chat login, so "is there a session" was not a gate at all.
  requireAdmin(event)

  const query = getQuery(event)
  const range = typeof query.range === 'string' ? query.range : '1m'
  const interval = typeof query.interval === 'string' ? query.interval : 'daily'

  const { channels } = await getChannels({ includeDefaults: true })
  return buildAnalyticsReport({ range, interval, channels })
})

