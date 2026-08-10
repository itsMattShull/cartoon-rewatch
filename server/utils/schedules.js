import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  SCHEDULE_TIME_ZONE,
  compareOccurrences,
  expandRecurringRules,
  getEffectiveOccurrence,
  isValidId,
  normalizeRecurringList,
  normalizeRecurringRule,
  occurrenceKey,
  zonedDateTimeToUtc
} from '#shared/schedule-time.js'

export const SCHEDULES_FILE = 'assets/schedules/schedules.json'
export {
  SCHEDULE_TIME_ZONE,
  compareOccurrences,
  expandRecurringRules,
  getEffectiveOccurrence,
  normalizeRecurringList,
  normalizeRecurringRule,
  occurrenceKey,
  zonedDateTimeToUtc
}

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

/**
 * Coerce a stored one-off entry, or null.
 *
 * The id charset is enforced here and at the write boundary. Without it an expanded
 * rule occurrence id (`r:<ruleId>:<ms>`) could be POSTed back to /api/schedule/save and
 * become a permanent one-off sharing an id with a live occurrence — duplicate Vue keys
 * and a delete that removes the wrong row.
 */
export function normalizeScheduleEntry(entry) {
  const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
  const blockSlug = normalizeSlug(entry?.blockSlug)
  const startTime = typeof entry?.startTime === 'string' ? entry.startTime : ''
  const startMs = Date.parse(startTime)
  if (!isValidId(id) || !blockSlug || !Number.isFinite(startMs)) return null
  return {
    id,
    blockSlug,
    startTime: new Date(startMs).toISOString(),
    startMs,
    recurring: false
  }
}

export function createScheduleId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `sch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Short id for rules — it is repeated in every expanded occurrence id. */
export function createRuleId() {
  return crypto.randomBytes(6).toString('hex')
}

// Single-process server (pm2 fork, instances: 1), so a module-level memo is coherent.
// `version` is bumped on every write: mtime granularity can miss two writes inside the
// same tick, and this file is written far more often than banners.json.
let cache = null
let cacheMtime = 0
let cacheCheckedAt = 0
let version = 0

export function getSchedulesVersion() {
  return version
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export async function readSchedules() {
  const filePath = path.resolve(process.cwd(), SCHEDULES_FILE)
  const nowMs = Date.now()

  if (cache && nowMs - cacheCheckedAt < 1000) return clone(cache)

  try {
    const stat = await fs.stat(filePath)
    cacheCheckedAt = nowMs
    if (cache && stat.mtimeMs === cacheMtime) return clone(cache)

    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = safeParseJson(raw, null)
    if (parsed === null) {
      // Torn or hand-mangled file. Returning a blank schedule here would let the
      // scheduler conclude "nothing is scheduled" and blank every channel, so surface
      // the last good copy instead and let the next read retry.
      return cache ? clone(cache) : { channels: {}, recurring: {}, _exists: false }
    }
    cache = { ...parsed, _exists: true }
    cacheMtime = stat.mtimeMs
    return clone(cache)
  } catch (error) {
    cacheCheckedAt = nowMs
    cache = { channels: {}, recurring: {}, _exists: false }
    cacheMtime = 0
    return clone(cache)
  }
}

/**
 * Write-then-rename. `fs.writeFile` truncates first, so a pm2 restart mid-write would
 * otherwise leave a zero-byte schedules.json — which reads back as "no schedule at all"
 * for every channel.
 *
 * Unknown top-level keys are preserved deliberately: an older build rolled back onto a
 * file containing `recurring` must not silently drop it. Callers must therefore
 * read-modify-write the whole object rather than constructing a fresh one.
 */
export async function writeSchedules(schedule) {
  const filePath = path.resolve(process.cwd(), SCHEDULES_FILE)
  const { _exists, ...payload } = schedule || {}
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2))
  await fs.rename(tmpPath, filePath)

  cache = { ...payload, _exists: true }
  cacheCheckedAt = 0
  version += 1
  try {
    const stat = await fs.stat(filePath)
    cacheMtime = stat.mtimeMs
  } catch {
    cacheMtime = 0
  }
}

// Serialises read-modify-write cycles so two overlapping saves can't lose an update.
let writeQueue = Promise.resolve()

export function withScheduleLock(fn) {
  const next = writeQueue.then(fn, fn)
  writeQueue = next.catch(() => {})
  return next
}

export function normalizeScheduleList(entries) {
  if (!Array.isArray(entries)) return []
  const normalized = []
  for (const entry of entries) {
    const parsed = normalizeScheduleEntry(entry)
    if (parsed) normalized.push(parsed)
  }
  normalized.sort(compareOccurrences)
  return normalized
}

export function getChannelRules(stored, channelSlug) {
  const raw = stored?.recurring && typeof stored.recurring === 'object'
    ? stored.recurring[channelSlug]
    : null
  return normalizeRecurringList(raw)
}

export function normalizeBlockSlug(input) {
  return normalizeSlug(input)
}

/**
 * Legacy shim: hour-only conversion, kept so existing callers keep compiling.
 * New code should use zonedDateTimeToUtc, which carries minutes.
 */
export function zonedDateHourToUtc(dateInput, hourInput, timeZone = SCHEDULE_TIME_ZONE) {
  const result = zonedDateTimeToUtc(dateInput, hourInput, 0, timeZone)
  return result ? new Date(result.ms) : null
}
