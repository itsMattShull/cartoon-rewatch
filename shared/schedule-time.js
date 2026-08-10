// Zone/time math shared by BOTH the server (scheduler tick, admin validation) and the
// browser (front-page guide, playback anchor, admin form).
//
// It lives here rather than being copied because client and server MUST agree on the
// exact instant a rule fires. Before this file existed, `getTimeZoneOffsetMs` was
// duplicated in three places and `zonedDateHourToUtc` in two; a divergence between any
// pair shows up as "Schedule time already taken" on a time that is free, or as two
// browsers playing different episodes of the same channel.
//
// Nothing here may import from `node:` — the browser loads it too.

export const SCHEDULE_TIME_ZONE = 'America/Chicago'

export const MAX_RULES_PER_CHANNEL = 24
export const MAX_RULE_EXCEPTIONS = 60
// A rule fires at least once a week, so eight civil days always contains its most recent
// occurrence. This is what bounds the playback-anchor lookup to a handful of iterations
// instead of a multi-day scan.
export const ANCHOR_LOOKBACK_DAYS = 8

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

// Constructing an Intl.DateTimeFormat costs ~75µs; reusing one costs ~7µs. Every function
// below leans on this, and the scheduler calls it in a loop, so the instance is memoised
// per zone. In practice this Map holds exactly one entry.
const formatterCache = new Map()

function getFormatter(timeZone) {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

export function isValidId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

export function isCivilDate(value) {
  if (typeof value !== 'string' || !CIVIL_DATE.test(value)) return false
  // Round-trip guard: the regex alone accepts '2026-99-99', which Date.UTC happily
  // rolls over into a real (wrong) date.
  const [y, m, d] = value.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  )
}

export function civilDateString(year, month, day) {
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

/**
 * Wall-clock fields of an instant, as seen in `timeZone`.
 */
export function getZonedParts(input, timeZone = SCHEDULE_TIME_ZONE) {
  const ms = typeof input === 'number' ? input : input.getTime()
  const parts = getFormatter(timeZone).formatToParts(new Date(ms))
  const values = {}
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value
  }
  let hour = Number(values.hour)
  // Some ICU builds report midnight as "24" under hourCycle h24. Left unhandled this
  // rolls Date.UTC into the next day and throws the offset out by a full day.
  if (hour === 24) hour = 0
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour,
    minute: Number(values.minute),
    second: Number(values.second)
  }
}

/**
 * Offset of `timeZone` from UTC at a given instant, in ms (negative west of Greenwich).
 *
 * The input is floored to whole seconds first. `formatToParts` has no sub-second field,
 * so without the floor the returned value silently carries `-(input milliseconds)`. Call
 * sites that only ever compute `instant + offset` cancel that error out, but
 * `zonedWallToUtc` compares offsets for *equality*, and there it would misclassify an
 * ordinary time as nonexistent.
 */
export function getTimeZoneOffsetMs(input, timeZone = SCHEDULE_TIME_ZONE) {
  const raw = typeof input === 'number' ? input : input.getTime()
  const ms = Math.floor(raw / 1000) * 1000
  const p = getZonedParts(ms, timeZone)
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUTC - ms
}

/**
 * Resolve wall-clock fields in `timeZone` to a UTC instant.
 *
 * Two-candidate solve, not a single guess-and-correct pass. The naive form (build a UTC
 * guess from the digits, measure the offset *at the guess*, subtract) is wrong whenever
 * the guess and the answer sit on opposite sides of a DST transition — for
 * America/Chicago that was ten hours a year, and it made 07:00 and 08:00 on the
 * spring-forward date resolve to the same instant while 06:00 on the fall-back date was
 * unreachable entirely.
 *
 * Sampling the offset a full day either side guarantees both the pre- and
 * post-transition offsets are in hand, so each candidate can be checked for
 * self-consistency.
 *
 * Returns `kind`:
 *   'exact'       - one valid instant
 *   'ambiguous'   - the fall-back fold; the wall time happens twice. Returns the FIRST
 *                   (pre-transition) occurrence, so a block starts when the guide says.
 *   'nonexistent' - the spring-forward gap; the wall time never happens. Returns the
 *                   time shifted forward by the gap, preserving minutes, so a 02:15 and
 *                   a 02:45 rule stay distinct instead of collapsing onto one instant.
 */
export function zonedWallToUtc(year, month, day, hour, minute, timeZone = SCHEDULE_TIME_ZONE) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0)
  const offsetBefore = getTimeZoneOffsetMs(wall - 86400000, timeZone)
  const offsetAfter = getTimeZoneOffsetMs(wall + 86400000, timeZone)

  const candidateA = wall - offsetBefore
  const candidateB = wall - offsetAfter

  const valid = []
  if (getTimeZoneOffsetMs(candidateA, timeZone) === offsetBefore) valid.push(candidateA)
  if (candidateB !== candidateA && getTimeZoneOffsetMs(candidateB, timeZone) === offsetAfter) {
    valid.push(candidateB)
  }

  if (valid.length === 0) {
    return { ms: Math.max(candidateA, candidateB), kind: 'nonexistent' }
  }
  return {
    ms: Math.min(...valid),
    kind: valid.length > 1 ? 'ambiguous' : 'exact'
  }
}

/**
 * Convenience wrapper matching the old `zonedDateHourToUtc` signature, now minute-aware.
 * Returns null for malformed input rather than an Invalid Date.
 */
export function zonedDateTimeToUtc(dateText, hour, minute = 0, timeZone = SCHEDULE_TIME_ZONE) {
  if (!isCivilDate(typeof dateText === 'string' ? dateText.trim() : '')) return null
  const h = Number(hour)
  const m = Number(minute)
  if (!Number.isInteger(h) || h < 0 || h > 23) return null
  if (!Number.isInteger(m) || m < 0 || m > 59) return null
  const [year, month, day] = dateText.trim().split('-').map(Number)
  return zonedWallToUtc(year, month, day, h, m, timeZone)
}

/**
 * Civil date iteration. Days are stepped as calendar tuples in UTC, never by adding
 * 86_400_000ms to an instant: a DST day is 23 or 25 hours long, so millisecond stepping
 * emits one civil date twice and skips the next.
 */
export function addCivilDays(year, month, day, delta) {
  const stepped = new Date(Date.UTC(year, month - 1, day))
  stepped.setUTCDate(stepped.getUTCDate() + delta)
  return {
    year: stepped.getUTCFullYear(),
    month: stepped.getUTCMonth() + 1,
    day: stepped.getUTCDate()
  }
}

/**
 * Day of week (0=Sunday) for a CIVIL date.
 *
 * Must never be derived from the resolved instant: an 8pm Saturday occurrence in Chicago
 * is 01:00Z Sunday, so a "Saturdays" rule keyed off the instant would emit nothing and a
 * "Sundays" rule would fire on the wrong day.
 */
export function civilWeekday(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function normalizeDays(input) {
  if (!Array.isArray(input) || input.length > 7) return []
  const seen = new Set()
  for (const value of input) {
    const day = Number(value)
    if (Number.isInteger(day) && day >= 0 && day <= 6) seen.add(day)
  }
  return [...seen].sort((a, b) => a - b)
}

function normalizeExceptions(input) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  for (const value of input) {
    if (typeof value === 'string' && isCivilDate(value.trim())) seen.add(value.trim())
    if (seen.size >= MAX_RULE_EXCEPTIONS) break
  }
  return [...seen].sort()
}

/**
 * Coerce arbitrary input into a valid rule, or null. Never throws — a corrupt rule must
 * degrade to "this rule does not exist" rather than break the schedule for every channel.
 */
export function normalizeRecurringRule(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!isValidId(id)) return null

  const blockSlug = String(raw.blockSlug || '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!blockSlug) return null

  const days = normalizeDays(raw.days)
  if (!days.length) return null

  const hour = Number(raw.hour)
  const minute = Number(raw.minute)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null

  const startDate = typeof raw.startDate === 'string' && isCivilDate(raw.startDate.trim())
    ? raw.startDate.trim()
    : null
  const endDate = typeof raw.endDate === 'string' && isCivilDate(raw.endDate.trim())
    ? raw.endDate.trim()
    : null
  // ISO civil dates compare correctly as plain strings.
  if (startDate && endDate && endDate < startDate) return null

  return {
    id,
    blockSlug,
    days,
    hour,
    minute,
    startDate,
    endDate,
    exceptions: normalizeExceptions(raw.exceptions),
    enabled: raw.enabled !== false
  }
}

export function normalizeRecurringList(entries) {
  if (!Array.isArray(entries)) return []
  const out = []
  const seenIds = new Set()
  for (const entry of entries) {
    const rule = normalizeRecurringRule(entry)
    if (!rule || seenIds.has(rule.id)) continue
    seenIds.add(rule.id)
    out.push(rule)
    if (out.length >= MAX_RULES_PER_CHANNEL) break
  }
  return out
}

export function occurrenceId(ruleId, startMs) {
  return `r:${ruleId}:${startMs}`
}

/**
 * Expand rules into concrete occurrences in [fromMs, toMs].
 *
 * Iteration is over civil dates with a hard bound, so no input can spin it.
 */
export function expandRecurringRules(rules, fromMs, toMs, timeZone = SCHEDULE_TIME_ZONE) {
  const list = Array.isArray(rules) ? rules : []
  if (!list.length || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return []
  }

  // Start and end one civil day outside the window: the civil date of an instant differs
  // from its UTC date for several hours a day, so the exact edges would drop occurrences.
  const startParts = getZonedParts(fromMs, timeZone)
  const endParts = getZonedParts(toMs, timeZone)
  let cursor = addCivilDays(startParts.year, startParts.month, startParts.day, -1)
  const last = addCivilDays(endParts.year, endParts.month, endParts.day, 1)
  const lastKey = civilDateString(last.year, last.month, last.day)

  const days = []
  for (let guard = 0; guard < 400; guard += 1) {
    const key = civilDateString(cursor.year, cursor.month, cursor.day)
    days.push({ ...cursor, key, weekday: civilWeekday(cursor.year, cursor.month, cursor.day) })
    if (key >= lastKey) break
    cursor = addCivilDays(cursor.year, cursor.month, cursor.day, 1)
  }

  const occurrences = []
  for (const rule of list) {
    if (!rule || rule.enabled === false) continue
    const emitted = new Set()
    for (const day of days) {
      if (!rule.days.includes(day.weekday)) continue
      if (rule.startDate && day.key < rule.startDate) continue
      // endDate is INCLUSIVE — it is the last day the rule runs.
      if (rule.endDate && day.key > rule.endDate) continue
      if (rule.exceptions.includes(day.key)) continue

      const { ms, kind } = zonedWallToUtc(day.year, day.month, day.day, rule.hour, rule.minute, timeZone)
      if (ms < fromMs || ms > toMs) continue
      // The fall-back fold can resolve two civil days' worth of wall times onto one
      // instant; never emit a rule twice for the same moment.
      if (emitted.has(ms)) continue
      emitted.add(ms)

      occurrences.push({
        id: occurrenceId(rule.id, ms),
        ruleId: rule.id,
        blockSlug: rule.blockSlug,
        startTime: new Date(ms).toISOString(),
        startMs: ms,
        civilDate: day.key,
        recurring: true,
        timeKind: kind
      })
    }
  }

  occurrences.sort(compareOccurrences)
  return occurrences
}

/**
 * Total order over occurrences. Ties MUST resolve identically on client and server or
 * the two disagree about which block is playing.
 *
 * A one-off beats a rule at the same instant, which is what makes a manually placed
 * entry an override. Rule-vs-rule falls back to the rule id: arbitrary, but stable and
 * independent of position in the JSON file.
 */
export function compareOccurrences(a, b) {
  if (a.startMs !== b.startMs) return a.startMs - b.startMs
  const aRule = a.recurring ? 1 : 0
  const bRule = b.recurring ? 1 : 0
  if (aRule !== bRule) return aRule - bRule
  const aKey = a.ruleId || a.id || ''
  const bKey = b.ruleId || b.id || ''
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
}

/**
 * The single occurrence in effect at `nowMs` — the playback anchor.
 *
 * Bounded to ANCHOR_LOOKBACK_DAYS of rule expansion, which is exact for any rule (they
 * repeat at least weekly). One-offs are scanned in full since the caller already holds
 * them sorted.
 */
export function getEffectiveOccurrence(oneOffs, rules, nowMs, timeZone = SCHEDULE_TIME_ZONE) {
  const candidates = []

  for (const entry of oneOffs || []) {
    const startMs = Number.isFinite(entry?.startMs) ? entry.startMs : Date.parse(entry?.startTime)
    if (!Number.isFinite(startMs) || startMs > nowMs) continue
    candidates.push({ ...entry, startMs, recurring: false })
  }

  const lookbackMs = nowMs - ANCHOR_LOOKBACK_DAYS * 86400000
  for (const occurrence of expandRecurringRules(rules, lookbackMs, nowMs, timeZone)) {
    candidates.push(occurrence)
  }

  if (!candidates.length) return null
  candidates.sort(compareOccurrences)
  return candidates[candidates.length - 1]
}

/**
 * Stable identity for "which occurrence is currently applied". The scheduler compares
 * this rather than the block slug, so re-running is a no-op and a manual override is not
 * stomped every tick.
 */
export function occurrenceKey(occurrence) {
  if (!occurrence) return null
  const source = occurrence.recurring ? 'r' : 'o'
  const stable = occurrence.ruleId || occurrence.id || ''
  return `${source}:${stable}:${occurrence.startMs}`
}

export function describeRule(rule) {
  if (!rule) return ''
  const dayText =
    rule.days.length === 7
      ? 'Every day'
      : rule.days.length === 5 && [1, 2, 3, 4, 5].every((d) => rule.days.includes(d))
        ? 'Weekdays'
        : rule.days.length === 2 && rule.days.includes(0) && rule.days.includes(6)
          ? 'Weekends'
          : rule.days.map((d) => WEEKDAY_SHORT[d]).join(' ')
  const hour12 = rule.hour % 12 === 0 ? 12 : rule.hour % 12
  const period = rule.hour < 12 ? 'AM' : 'PM'
  const minute = String(rule.minute).padStart(2, '0')
  return `${dayText} · ${hour12}:${minute} ${period} CST`
}
