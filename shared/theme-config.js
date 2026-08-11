// Per-channel colour schemes: normalisation and resolution.
//
// Pure and isomorphic, like shared/schedule-time.js and shared/palette.js — the server
// resolves the palette for the SSR'd first paint, and the admin page uses the same
// functions to preview what it is about to save.
//
// ---------------------------------------------------------------------------
// Why overrides are date ranges and NOT recurring rules
// ---------------------------------------------------------------------------
//
// The obvious move is to reuse the recurring-rule engine that already drives the block
// schedule. It is the wrong tool here, for four reasons:
//
//   1. A colour needs a WINDOW. `getEffectiveOccurrence` means "the latest occurrence at
//      or before now, which runs until something replaces it" and is bounded by
//      ANCHOR_LOOKBACK_DAYS on the justification that a rule fires at least weekly.
//      A bounded window contradicts both.
//
//   2. Adding a duration to a wall-clock start reintroduces the exact DST bug that
//      zonedWallToUtc's two-candidate solve was written to eliminate. "All day" as
//      start 00:00 + 1440 minutes is wrong twice a year in America/Chicago: on the
//      23-hour day the window overruns into the next day, and on the 25-hour day it
//      leaves a one-hour hole at 23:00 where the override silently stops applying.
//
//   3. `normalizeRecurringRule` rejects any rule without a blockSlug, so reuse means
//      splitting it — churn in a module whose contract is that the client and server
//      agree on the exact instant a rule fires.
//
//   4. Time-of-day granularity makes SSR and a client with a skewed clock disagree
//      about the palette, which is a hydration mismatch. Date granularity makes clock
//      skew irrelevant 364 days a year.
//
// A civil date range covers what this feature is actually for — "orange through
// October" — with none of that. Comparison is plain string comparison on ISO dates,
// which normalizeRecurringRule already documents as correct.

import { isCivilDate, civilDateString, getZonedParts } from './schedule-time.js'
import { normalizeHex, REFERENCE_BRAND } from './palette.js'

// Named and colocated, like MAX_ADS and MAX_RULES_PER_CHANNEL.
export const MAX_THEME_OVERRIDES = 20
export const MAX_THEME_CHANNELS = 64
export const MAX_OVERRIDE_LABEL_CHARS = 40

const ID_RE = /^[a-z0-9-]{1,40}$/
// Same shape normalizeChannelSlug produces. Validated on shape only here — see
// resolveChannelColors for why membership is checked at resolution time instead.
const SLUG_RE = /^[a-z0-9-]{1,40}$/

function cleanLabel(value) {
  if (typeof value !== 'string') return ''
  // Mirrors cleanText in server/utils/banners.js: \p{Cf} covers the bidi overrides that
  // survive a control-only filter, and slicing by code point avoids leaving a lone
  // surrogate in the stored JSON.
  const stripped = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').normalize('NFC')
  return Array.from(stripped.trim()).slice(0, MAX_OVERRIDE_LABEL_CHARS).join('').trim()
}

function toBool(value) {
  return value === true || value === 'true'
}

function normalizeSlugList(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  for (const entry of raw) {
    if (typeof entry === 'string' && SLUG_RE.test(entry)) seen.add(entry)
    if (seen.size >= MAX_THEME_CHANNELS) break
  }
  return [...seen]
}

function normalizeOverride(raw, index) {
  const color = normalizeHex(raw?.color)
  if (!color) return null

  const startDate = isCivilDate(raw?.startDate) ? raw.startDate : ''
  const endDate = isCivilDate(raw?.endDate) ? raw.endDate : ''
  if (!startDate || !endDate) return null
  // endDate is INCLUSIVE, matching the recurring-rule convention documented in the README.
  if (endDate < startDate) return null

  return {
    id: typeof raw?.id === 'string' && ID_RE.test(raw.id) ? raw.id : `ovr-${index + 1}`,
    label: cleanLabel(raw?.label),
    color,
    // Empty means every channel.
    channels: normalizeSlugList(raw?.channels),
    startDate,
    endDate,
    enabled: toBool(raw?.enabled)
  }
}

/**
 * Coerces arbitrary input into a valid theme config. Never throws.
 *
 * Every key is whitelist-constructed rather than spread from the input, so unknown keys,
 * deeply nested objects and prototype-polluting names cannot survive. `JSON.parse` does
 * create `__proto__` as an own property, so a hand-edited file and a POST body would
 * otherwise behave differently.
 */
export function normalizeTheme(raw) {
  const channels = Object.create(null)
  const rawChannels = raw?.channels
  if (rawChannels && typeof rawChannels === 'object') {
    let count = 0
    for (const [slug, value] of Object.entries(rawChannels)) {
      if (count >= MAX_THEME_CHANNELS) break
      if (!SLUG_RE.test(slug)) continue
      const hex = normalizeHex(value)
      if (!hex) continue
      channels[slug] = hex
      count += 1
    }
  }

  const overrides = Array.isArray(raw?.overrides)
    ? // Slice BEFORE mapping, so an oversized array is never fully walked.
      raw.overrides.slice(0, MAX_THEME_OVERRIDES).map(normalizeOverride).filter(Boolean)
    : []

  return {
    default: normalizeHex(raw?.default) || REFERENCE_BRAND,
    channels,
    overrides
  }
}

export function defaultTheme() {
  return { default: REFERENCE_BRAND, channels: Object.create(null), overrides: [] }
}

/**
 * The civil date in America/Chicago, as YYYY-MM-DD.
 *
 * Deliberately the site's schedule zone rather than the viewer's: an override configured
 * for October should start and end at the same moment for everyone, and the whole rest
 * of this app already reasons in that zone.
 */
export function civilDateAt(nowMs) {
  const parts = getZonedParts(nowMs)
  return civilDateString(parts.year, parts.month, parts.day)
}

function overrideRank(override) {
  // Deterministic and independent of position in the file, so SSR and the client always
  // agree. Follows the house convention set by compareOccurrences: more specific first,
  // then narrower, then lexicographic by id.
  return [
    override.channels.length ? 0 : 1, // channel-scoped beats site-wide
    override.endDate.localeCompare(override.startDate), // narrower range first
    override.id
  ]
}

function betterOverride(a, b) {
  if (!a) return b
  if (!b) return a
  const ra = overrideRank(a)
  const rb = overrideRank(b)
  for (let i = 0; i < ra.length; i += 1) {
    if (ra[i] < rb[i]) return a
    if (ra[i] > rb[i]) return b
  }
  return a
}

/**
 * The brand hex for one channel: an active override wins, then the channel's own colour,
 * then the site default.
 */
export function resolveBrandHex(theme, channelSlug, nowMs) {
  const config = theme && typeof theme === 'object' ? theme : defaultTheme()
  const today = civilDateAt(nowMs)

  let winner = null
  for (const override of config.overrides || []) {
    if (!override.enabled) continue
    if (today < override.startDate || today > override.endDate) continue
    if (override.channels.length && !override.channels.includes(channelSlug)) continue
    winner = betterOverride(winner, override)
  }
  if (winner) return winner.color

  const own = channelSlug ? config.channels?.[channelSlug] : ''
  return normalizeHex(own) || normalizeHex(config.default) || REFERENCE_BRAND
}

/**
 * Every channel's resolved colour, plus when the answer next changes.
 *
 * This is what ships to the browser instead of the override rules themselves. The client
 * can then recolour instantly on a channel flip with a map lookup — no rule evaluation,
 * no clock-skew disagreement with SSR, no admin-authored override labels and dates in a
 * public payload, and nothing to recompute every minute.
 */
export function resolveChannelColors(theme, slugs, nowMs) {
  const config = theme && typeof theme === 'object' ? theme : defaultTheme()
  const colors = Object.create(null)
  for (const slug of slugs) {
    if (typeof slug === 'string' && SLUG_RE.test(slug)) {
      colors[slug] = resolveBrandHex(config, slug, nowMs)
    }
  }
  return {
    colors,
    default: normalizeHex(config.default) || REFERENCE_BRAND,
    // Overrides change on civil-date boundaries only, so the next possible change is the
    // next local midnight. The client refetches then rather than polling.
    revalidateAt: nextLocalMidnightMs(nowMs)
  }
}

function nextLocalMidnightMs(nowMs) {
  const today = civilDateAt(nowMs)
  // Step forward in hours rather than adding 24h to a wall time: the Chicago day is 23 or
  // 25 hours twice a year, and the point of this value is to be right on exactly those
  // days. Capped so a bad clock cannot spin.
  for (let hours = 1; hours <= 26; hours += 1) {
    const candidate = nowMs + hours * 3600_000
    if (civilDateAt(candidate) !== today) return candidate
  }
  return nowMs + 26 * 3600_000
}
