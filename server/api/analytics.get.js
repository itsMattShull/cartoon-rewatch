import { createError, defineEventHandler, getQuery } from 'h3'
import { getSessionFromEvent } from '../utils/auth'
import { getChannels } from '../utils/channels'
import { buildAnalyticsReport } from '../utils/analytics'

export default defineEventHandler(async (event) => {
  const session = getSessionFromEvent(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const query = getQuery(event)
  const range = typeof query.range === 'string' ? query.range : '1m'
  const interval = typeof query.interval === 'string' ? query.interval : 'daily'

  const { channels } = await getChannels({ includeDefaults: true })
  return buildAnalyticsReport({ range, interval, channels })
})

