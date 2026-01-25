import { defineEventHandler } from 'h3'
import { getChannels } from '../utils/channels'

export default defineEventHandler(async () => {
  const { channels } = await getChannels({ includeDefaults: true })
  return { channels }
})
