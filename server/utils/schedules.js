import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export const SCHEDULES_FILE = 'assets/schedules/schedules.json'
export const SCHEDULE_TIME_ZONE = 'America/Chicago'

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch (error) {
    return fallback
  }
}

function normalizeSlug(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
}

export function normalizeScheduleEntry(entry) {
  const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
  const blockSlug = normalizeSlug(entry?.blockSlug)
  const startTime = typeof entry?.startTime === 'string' ? entry.startTime : ''
  const startMs = Date.parse(startTime)
  if (!id || !blockSlug || !Number.isFinite(startMs)) return null
  return {
    id,
    blockSlug,
    startTime: new Date(startMs).toISOString()
  }
}

export function createScheduleId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `sch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date)

  const values = {}
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value
  }

  const asUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  )

  return asUTC - date.getTime()
}

export function zonedDateHourToUtc(dateInput, hourInput, timeZone = SCHEDULE_TIME_ZONE) {
  const dateText = typeof dateInput === 'string' ? dateInput.trim() : ''
  if (!dateText) return null
  const [yearText, monthText, dayText] = dateText.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null

  const hour = Number(hourInput)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null

  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, 0, 0))
  const offset = getTimeZoneOffsetMs(utcGuess, timeZone)
  return new Date(utcGuess.getTime() - offset)
}

export async function readSchedules() {
  const filePath = path.resolve(process.cwd(), SCHEDULES_FILE)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = safeParseJson(raw, { channels: {} })
    return { ...parsed, _exists: true }
  } catch (error) {
    return { channels: {}, _exists: false }
  }
}

export async function writeSchedules(schedule) {
  const filePath = path.resolve(process.cwd(), SCHEDULES_FILE)
  const { _exists, ...payload } = schedule || {}
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2))
}

export function normalizeScheduleList(entries) {
  if (!Array.isArray(entries)) return []
  const normalized = []
  for (const entry of entries) {
    const parsed = normalizeScheduleEntry(entry)
    if (parsed) normalized.push(parsed)
  }
  normalized.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
  return normalized
}

export function normalizeBlockSlug(input) {
  return normalizeSlug(input)
}
