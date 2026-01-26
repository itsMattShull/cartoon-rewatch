import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeChannelSlug } from './channels'

const DEFAULT_ANALYTICS_FILE =
  process.env.NODE_ENV !== 'production'
    ? path.join(os.tmpdir(), 'cartoonrewatch-analytics.json')
    : '.data/analytics.json'
const ANALYTICS_TIME_ZONE = 'America/Chicago'
const RANGE_MONTHS = {
  '1m': 1,
  '3m': 3,
  '6m': 6,
  '12m': 12
}
const INTERVALS = new Set(['daily', 'weekly', 'monthly'])

const DEFAULT_ANALYTICS = {
  version: 1,
  timezone: ANALYTICS_TIME_ZONE,
  viewers: {},
  days: {}
}

let writeQueue = Promise.resolve()

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ANALYTICS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch (error) {
    return fallback
  }
}

function normalizeAnalytics(raw) {
  const next = {
    version: DEFAULT_ANALYTICS.version,
    timezone: ANALYTICS_TIME_ZONE,
    viewers: {},
    days: {}
  }
  if (raw && typeof raw === 'object') {
    if (raw.timezone && typeof raw.timezone === 'string') {
      next.timezone = raw.timezone
    }
    if (raw.viewers && typeof raw.viewers === 'object') {
      next.viewers = raw.viewers
    }
    if (raw.days && typeof raw.days === 'object') {
      next.days = raw.days
    }
  }
  return next
}

function getDatePartsInTimeZone(date) {
  const parts = dateFormatter.formatToParts(date)
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const year = Number(lookup.year)
  const month = Number(lookup.month)
  const day = Number(lookup.day)
  return { year, month, day }
}

function formatDateKey(date) {
  return date.toISOString().slice(0, 10)
}

function formatMonthKey(date) {
  return date.toISOString().slice(0, 7)
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map((value) => Number(value))
  return new Date(Date.UTC(year, month - 1, day))
}

function getTodayDateUtc(date = new Date()) {
  const { year, month, day } = getDatePartsInTimeZone(date)
  return new Date(Date.UTC(year, month - 1, day))
}

function getDateKey(date = new Date()) {
  const { year, month, day } = getDatePartsInTimeZone(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function getRangeStartDate(endDate, months) {
  const start = new Date(endDate)
  start.setUTCMonth(start.getUTCMonth() - months)
  return start
}

function listDailyKeys(startDate, endDate) {
  const keys = []
  const cursor = new Date(startDate)
  while (cursor <= endDate) {
    keys.push(formatDateKey(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return keys
}

function getWeekStartDate(date) {
  const start = new Date(date)
  const dayIndex = start.getUTCDay()
  start.setUTCDate(start.getUTCDate() - dayIndex)
  return start
}

function listWeeklyKeys(startDate, endDate) {
  const keys = []
  const cursor = getWeekStartDate(startDate)
  while (cursor <= endDate) {
    keys.push(formatDateKey(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 7)
  }
  return keys
}

function listMonthlyKeys(startDate, endDate) {
  const keys = []
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1))
  while (cursor <= endDate) {
    keys.push(formatMonthKey(cursor))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return keys
}

function getBucketKeyForDay(dayKey, interval) {
  if (interval === 'weekly') {
    return formatDateKey(getWeekStartDate(parseDateKey(dayKey)))
  }
  if (interval === 'monthly') {
    return dayKey.slice(0, 7)
  }
  return dayKey
}

function getBucketStartKey(bucketKey, interval) {
  if (interval === 'monthly') {
    return `${bucketKey}-01`
  }
  return bucketKey
}

function addUnique(list, value) {
  if (!value) return
  if (!list.includes(value)) {
    list.push(value)
  }
}

function getDayEntry(data, dateKey) {
  if (!data.days[dateKey]) {
    data.days[dateKey] = { unique: [], views: 0, channels: {} }
  }
  const day = data.days[dateKey]
  if (!Array.isArray(day.unique)) day.unique = []
  if (!Number.isFinite(day.views)) day.views = 0
  if (!day.channels || typeof day.channels !== 'object') day.channels = {}
  return day
}

function getChannelEntry(day, slug) {
  if (!day.channels[slug]) {
    day.channels[slug] = { unique: [], views: 0 }
  }
  const entry = day.channels[slug]
  if (!Array.isArray(entry.unique)) entry.unique = []
  if (!Number.isFinite(entry.views)) entry.views = 0
  return entry
}

function updateViewerRecord(data, viewerId, dateKey) {
  if (!viewerId) return
  const existing = data.viewers[viewerId]
  const firstSeen = existing?.firstSeen && typeof existing.firstSeen === 'string' ? existing.firstSeen : dateKey
  data.viewers[viewerId] = {
    firstSeen: firstSeen < dateKey ? firstSeen : dateKey,
    lastSeen: dateKey
  }
}

function pruneAnalytics(data, cutoffKey) {
  for (const key of Object.keys(data.days)) {
    if (key < cutoffKey) {
      delete data.days[key]
    }
  }
  for (const [viewerId, record] of Object.entries(data.viewers)) {
    if (!record?.lastSeen || record.lastSeen < cutoffKey) {
      delete data.viewers[viewerId]
    }
  }
}

function resolveAnalyticsFilePath() {
  const configured = process.env.ANALYTICS_FILE || DEFAULT_ANALYTICS_FILE
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
}

async function readAnalytics() {
  const filePath = resolveAnalyticsFilePath()
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return safeParseJson(raw, DEFAULT_ANALYTICS)
  } catch (error) {
    return { ...DEFAULT_ANALYTICS }
  }
}

async function writeAnalytics(data) {
  const filePath = resolveAnalyticsFilePath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(data, null, 2))
}

function enqueueAnalyticsUpdate(updater) {
  writeQueue = writeQueue
    .then(async () => {
      const raw = await readAnalytics()
      const data = normalizeAnalytics(raw)
      const next = updater(data) || data
      const endDate = getTodayDateUtc()
      const cutoffDate = getRangeStartDate(endDate, RANGE_MONTHS['12m'])
      pruneAnalytics(next, formatDateKey(cutoffDate))
      await writeAnalytics(next)
      return next
    })
    .catch((error) => {
      console.error('Analytics update failed', error)
    })
  return writeQueue
}

function normalizeViewerId(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function recordVisit({ viewerId, channelSlug, date = new Date() }) {
  const normalizedViewerId = normalizeViewerId(viewerId)
  const normalizedChannel = normalizeChannelSlug(channelSlug)
  if (!normalizedViewerId) return Promise.resolve()

  return enqueueAnalyticsUpdate((data) => {
    const dateKey = getDateKey(date)
    const day = getDayEntry(data, dateKey)
    day.views += 1
    addUnique(day.unique, normalizedViewerId)
    updateViewerRecord(data, normalizedViewerId, dateKey)
    if (normalizedChannel) {
      const channelEntry = getChannelEntry(day, normalizedChannel)
      channelEntry.views += 1
      addUnique(channelEntry.unique, normalizedViewerId)
    }
    return data
  })
}

export function recordChannelView({ viewerId, channelSlug, date = new Date() }) {
  const normalizedViewerId = normalizeViewerId(viewerId)
  const normalizedChannel = normalizeChannelSlug(channelSlug)
  if (!normalizedViewerId || !normalizedChannel) return Promise.resolve()

  return enqueueAnalyticsUpdate((data) => {
    const dateKey = getDateKey(date)
    const day = getDayEntry(data, dateKey)
    const channelEntry = getChannelEntry(day, normalizedChannel)
    channelEntry.views += 1
    addUnique(channelEntry.unique, normalizedViewerId)
    updateViewerRecord(data, normalizedViewerId, dateKey)
    return data
  })
}

function countReturning(uniqueSet, startKey, viewers) {
  let returning = 0
  for (const viewerId of uniqueSet) {
    const firstSeen = viewers?.[viewerId]?.firstSeen
    if (firstSeen && firstSeen < startKey) {
      returning += 1
    }
  }
  return returning
}

export async function buildAnalyticsReport({ range = '1m', interval = 'daily', channels = [] } = {}) {
  await writeQueue
  const raw = await readAnalytics()
  const data = normalizeAnalytics(raw)
  const normalizedRange = RANGE_MONTHS[range] ? range : '1m'
  const normalizedInterval = INTERVALS.has(interval) ? interval : 'daily'

  const endDate = getTodayDateUtc()
  const startDate = getRangeStartDate(endDate, RANGE_MONTHS[normalizedRange])
  const rangeStartKey = formatDateKey(startDate)

  const dayKeys = listDailyKeys(startDate, endDate)
  const bucketKeys =
    normalizedInterval === 'weekly'
      ? listWeeklyKeys(startDate, endDate)
      : normalizedInterval === 'monthly'
        ? listMonthlyKeys(startDate, endDate)
        : dayKeys

  const buckets = new Map()
  for (const key of bucketKeys) {
    buckets.set(key, {
      unique: new Set(),
      views: 0,
      startKey: getBucketStartKey(key, normalizedInterval)
    })
  }

  const summaryUnique = new Set()
  const channelSets = new Map()
  const channelViews = new Map()
  let totalViews = 0

  for (const dayKey of dayKeys) {
    const day = data.days[dayKey]
    if (!day) continue

    const dayViews = Number(day.views) || 0
    totalViews += dayViews

    const bucketKey = getBucketKeyForDay(dayKey, normalizedInterval)
    const bucket = buckets.get(bucketKey)
    if (bucket) {
      bucket.views += dayViews
    }

    if (Array.isArray(day.unique)) {
      for (const viewerId of day.unique) {
        if (!viewerId) continue
        summaryUnique.add(viewerId)
        if (bucket) {
          bucket.unique.add(viewerId)
        }
      }
    }

    if (day.channels && typeof day.channels === 'object') {
      for (const [slug, channel] of Object.entries(day.channels)) {
        if (!channel) continue
        const uniqueList = Array.isArray(channel.unique) ? channel.unique : []
        if (!channelSets.has(slug)) {
          channelSets.set(slug, new Set())
        }
        const set = channelSets.get(slug)
        for (const viewerId of uniqueList) {
          if (viewerId) {
            set.add(viewerId)
          }
        }
        const views = Number(channel.views) || 0
        channelViews.set(slug, (channelViews.get(slug) || 0) + views)
      }
    }
  }

  const labels = []
  const uniqueSeries = []
  const viewsSeries = []
  const returningSeries = []

  for (const key of bucketKeys) {
    const bucket = buckets.get(key) || {
      unique: new Set(),
      views: 0,
      startKey: getBucketStartKey(key, normalizedInterval)
    }
    const uniqueCount = bucket.unique.size
    const returningCount = countReturning(bucket.unique, bucket.startKey, data.viewers)
    const returningPct = uniqueCount ? Math.round((returningCount / uniqueCount) * 1000) / 10 : 0

    labels.push(key)
    uniqueSeries.push(uniqueCount)
    viewsSeries.push(bucket.views)
    returningSeries.push(returningPct)
  }

  const totalUnique = summaryUnique.size
  const totalReturning = countReturning(summaryUnique, rangeStartKey, data.viewers)
  const returningPct = totalUnique ? Math.round((totalReturning / totalUnique) * 1000) / 10 : 0

  const nameBySlug = new Map(channels.map((channel) => [channel.slug, channel.name]))
  const channelSummaries = Array.from(
    new Set([...nameBySlug.keys(), ...channelSets.keys()])
  ).map((slug) => ({
    slug,
    name: nameBySlug.get(slug) || slug,
    unique: channelSets.get(slug)?.size || 0,
    views: channelViews.get(slug) || 0
  }))
  channelSummaries.sort((a, b) => a.name.localeCompare(b.name))

  return {
    timezone: ANALYTICS_TIME_ZONE,
    range: normalizedRange,
    interval: normalizedInterval,
    series: {
      labels,
      unique: uniqueSeries,
      views: viewsSeries,
      returningPct: returningSeries
    },
    summary: {
      totalUnique,
      totalViews,
      returningPct,
      newUnique: Math.max(totalUnique - totalReturning, 0)
    },
    channels: channelSummaries
  }
}
