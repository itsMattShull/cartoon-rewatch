import fs from 'node:fs/promises'
import path from 'node:path'

const SETTINGS_FILE = 'assets/settings/settings.json'

const DEFAULTS = {
  scheduleDay: 5,
  scheduleHour: 19
}

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

export async function readSettings() {
  const filePath = path.resolve(process.cwd(), SETTINGS_FILE)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = safeParseJson(raw, {})
    const scheduleDay = Number.isInteger(parsed.scheduleDay) && parsed.scheduleDay >= 0 && parsed.scheduleDay <= 6
      ? parsed.scheduleDay
      : DEFAULTS.scheduleDay
    const scheduleHour = Number.isInteger(parsed.scheduleHour) && parsed.scheduleHour >= 0 && parsed.scheduleHour <= 23
      ? parsed.scheduleHour
      : DEFAULTS.scheduleHour
    return { scheduleDay, scheduleHour }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function writeSettings(settings) {
  const filePath = path.resolve(process.cwd(), SETTINGS_FILE)
  const scheduleDay = Number.isInteger(settings?.scheduleDay) && settings.scheduleDay >= 0 && settings.scheduleDay <= 6
    ? settings.scheduleDay
    : DEFAULTS.scheduleDay
  const scheduleHour = Number.isInteger(settings?.scheduleHour) && settings.scheduleHour >= 0 && settings.scheduleHour <= 23
    ? settings.scheduleHour
    : DEFAULTS.scheduleHour
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify({ scheduleDay, scheduleHour }, null, 2))
}
