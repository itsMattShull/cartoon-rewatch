import { defineEventHandler } from 'h3'
import { readSettings } from '../../utils/settings'

export default defineEventHandler(async () => {
  const settings = await readSettings()
  return settings
})
