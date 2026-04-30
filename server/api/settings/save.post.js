import { createError, defineEventHandler, readBody } from 'h3'
import { getSessionFromEvent } from '../../utils/auth'
import { writeSettings } from '../../utils/settings'

export default defineEventHandler(async (event) => {
  const session = getSessionFromEvent(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readBody(event)

  const scheduleDay = Number(body?.scheduleDay)
  if (!Number.isInteger(scheduleDay) || scheduleDay < 0 || scheduleDay > 6) {
    throw createError({ statusCode: 400, statusMessage: 'scheduleDay must be an integer 0–6' })
  }

  const scheduleHour = Number(body?.scheduleHour)
  if (!Number.isInteger(scheduleHour) || scheduleHour < 0 || scheduleHour > 23) {
    throw createError({ statusCode: 400, statusMessage: 'scheduleHour must be an integer 0–23' })
  }

  await writeSettings({ scheduleDay, scheduleHour })
  return { ok: true, scheduleDay, scheduleHour }
})
