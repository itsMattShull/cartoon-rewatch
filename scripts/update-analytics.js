import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const TARGET_DATE = '2026-01-26'
const TARGET_VIEWS = 40
const DEFAULT_ANALYTICS = {
  version: 1,
  timezone: 'America/Chicago',
  viewers: {},
  days: {}
}

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch (error) {
    return fallback
  }
}

function resolveAnalyticsFilePath() {
  const defaultFile =
    process.env.NODE_ENV !== 'production'
      ? path.join(os.tmpdir(), 'cartoonrewatch-analytics.json')
      : '.data/analytics.json'
  const configured = process.env.ANALYTICS_FILE || defaultFile
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
}

async function updateAnalytics() {
  const filePath = resolveAnalyticsFilePath()
  let data = { ...DEFAULT_ANALYTICS }

  try {
    const raw = await fs.readFile(filePath, 'utf8')
    data = safeParseJson(raw, DEFAULT_ANALYTICS)
  } catch (error) {
    data = { ...DEFAULT_ANALYTICS }
  }

  if (!data.days || typeof data.days !== 'object') {
    data.days = {}
  }

  if (!data.days[TARGET_DATE]) {
    data.days[TARGET_DATE] = { unique: [], views: 0, channels: {} }
  }

  data.days[TARGET_DATE].views = TARGET_VIEWS

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(data, null, 2))

  console.log(`Set total visits for ${TARGET_DATE} to ${TARGET_VIEWS} in ${filePath}`)
}

updateAnalytics().catch((error) => {
  console.error('Failed to update analytics', error)
  process.exitCode = 1
})
