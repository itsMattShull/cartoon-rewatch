import fs from 'node:fs/promises'
import path from 'node:path'
import { defineNitroPlugin } from '#imports'
import { getChannels } from '../utils/channels'

const ACTIVE_FILE = 'assets/blocks/active-blocks.json'
const BLOCKS_DIR = 'assets/blocks'
const INDEX_FILE = 'assets/blocks/blocks-index.json'
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const DISCORD_CHANNEL_ID = '1465025785634099361'
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || ''
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || ''
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch (error) {
    return fallback
  }
}

async function readActiveBlocks() {
  const filePath = path.resolve(process.cwd(), ACTIVE_FILE)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return safeParseJson(raw, {})
  } catch (error) {
    return {}
  }
}

async function readBlocksIndex() {
  const filePath = path.resolve(process.cwd(), INDEX_FILE)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return safeParseJson(raw, { blocks: {} })
  } catch (error) {
    return { blocks: {} }
  }
}

async function readBlockPayload(slug) {
  const filePath = path.resolve(process.cwd(), BLOCKS_DIR, `${slug}.json`)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return safeParseJson(raw, null)
  } catch (error) {
    return null
  }
}

function parseIsoDuration(value) {
  if (!value || typeof value !== 'string') return 0
  const match = value.match(
    /P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/i
  )
  if (!match) return 0
  const weeks = Number(match[1] || 0)
  const days = Number(match[2] || 0)
  const hours = Number(match[3] || 0)
  const minutes = Number(match[4] || 0)
  const seconds = Number(match[5] || 0)
  if (![weeks, days, hours, minutes, seconds].every(Number.isFinite)) return 0
  return weeks * 604800 + days * 86400 + hours * 3600 + minutes * 60 + seconds
}

function isYouTubeRegionAvailable(regionRestriction, code) {
  if (!regionRestriction) return true
  const upper = code.toUpperCase()
  if (Array.isArray(regionRestriction.allowed)) {
    return regionRestriction.allowed.map(r => r.toUpperCase()).includes(upper)
  }
  if (Array.isArray(regionRestriction.blocked)) {
    return !regionRestriction.blocked.map(r => r.toUpperCase()).includes(upper)
  }
  return true
}

function parseGeoblockingList(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return { mode: 'allow', countries: [] }
  }
  const [first, ...rest] = list.map((entry) => String(entry).toLowerCase())
  if (first === 'allow' || first === 'deny') {
    return { mode: first, countries: rest }
  }
  return { mode: 'allow', countries: list.map((entry) => String(entry).toLowerCase()) }
}

function isDailymotionRegionAllowed(list, region) {
  const normalizedRegion = String(region || '').toLowerCase()
  const { mode, countries } = parseGeoblockingList(list)
  if (!countries.length) return true
  if (mode === 'allow') {
    return countries.includes(normalizedRegion)
  }
  return !countries.includes(normalizedRegion)
}

async function fetchYouTubeBatch(videoIds) {
  const result = new Map()
  const BATCH_SIZE = 50
  for (let i = 0; i < videoIds.length; i += BATCH_SIZE) {
    const batch = videoIds.slice(i, i + BATCH_SIZE)
    const url = new URL('https://www.googleapis.com/youtube/v3/videos')
    url.searchParams.set('part', 'snippet,contentDetails')
    url.searchParams.set('id', batch.join(','))
    url.searchParams.set('key', YOUTUBE_API_KEY)
    try {
      const response = await fetch(url.toString())
      if (!response.ok) continue
      const data = await response.json()
      for (const item of (data?.items || [])) {
        const id = item?.id
        if (!id) continue
        result.set(id, {
          title: item?.snippet?.title || '',
          regionRestriction: item?.contentDetails?.regionRestriction || null
        })
      }
    } catch (error) {
      console.error('[youtube-availability] YouTube API batch error', error)
    }
  }
  return result
}

async function fetchDailymotionBatch(videoIds) {
  const result = new Map()
  if (!videoIds.length) return result
  const BATCH_SIZE = 100
  for (let i = 0; i < videoIds.length; i += BATCH_SIZE) {
    const batch = videoIds.slice(i, i + BATCH_SIZE)
    const url = new URL('https://api.dailymotion.com/videos')
    url.searchParams.set('ids', batch.join(','))
    url.searchParams.set('fields', 'id,title,geoblocking')
    url.searchParams.set('limit', String(BATCH_SIZE))
    try {
      const response = await fetch(url.toString())
      if (!response.ok) continue
      const data = await response.json()
      for (const item of (data?.list || [])) {
        const id = item?.id
        if (!id) continue
        result.set(id, {
          title: item?.title || '',
          geoblocking: Array.isArray(item?.geoblocking) ? item.geoblocking : []
        })
      }
    } catch (error) {
      console.error('[youtube-availability] Dailymotion API batch error', error)
    }
  }
  return result
}

async function sendDiscordMessage(content) {
  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content })
    })
    if (!response.ok) {
      const text = await response.text().catch(() => response.status)
      console.error(`[youtube-availability] Discord message failed (${response.status}): ${text}`)
    }
  } catch (error) {
    console.error('[youtube-availability] Discord send error', error)
  }
}

async function sendStartupStatus() {
  if (!DISCORD_BOT_TOKEN) return

  const missing = []
  if (!YOUTUBE_API_KEY) missing.push('`YOUTUBE_API_KEY`')

  if (missing.length) {
    await sendDiscordMessage(`❌ **YouTube availability monitor failed to start**\n\nMissing environment variable(s): ${missing.join(', ')}\n\nAvailability checks will not run until this is resolved.`)
  } else {
    await sendDiscordMessage(`✅ **YouTube availability monitor is running**\n\nAll environment variables are set. Availability checks run every ${CHECK_INTERVAL_MS / 3600000} hours.`)
  }
}

async function sendDiscordAlert(issues) {
  const grouped = new Map()
  for (const issue of issues) {
    const key = `${issue.channelSlug}::${issue.blockSlug}`
    if (!grouped.has(key)) {
      grouped.set(key, { channelName: issue.channelName, blockName: issue.blockName, blockSlug: issue.blockSlug, videos: [] })
    }
    grouped.get(key).videos.push(issue)
  }

  let message = '⚠️ **Availability Warning**\n\nThe following videos in active blocks are not available in all regions:\n'

  for (const { channelName, blockName, blockSlug, videos } of grouped.values()) {
    message += `\n**${channelName}** — ${blockName}\n`
    for (const v of videos) {
      const label = v.source === 'dailymotion' ? 'Dailymotion' : 'YouTube'
      message += `• [${label}] "${v.videoTitle}" (\`${v.videoId}\`) — Not available in ${v.missing}\n`
    }
    const editPath = `/admin/block-maker?block=${encodeURIComponent(blockSlug)}`
    if (PUBLIC_BASE_URL) {
      message += `Edit: ${PUBLIC_BASE_URL}${editPath}\n`
    }
  }

  const chunks = []
  while (message.length > 0) {
    if (message.length <= 2000) {
      chunks.push(message)
      break
    }
    const splitAt = message.lastIndexOf('\n', 2000)
    const cutAt = splitAt > 0 ? splitAt + 1 : 2000
    chunks.push(message.slice(0, cutAt))
    message = message.slice(cutAt)
  }

  for (const chunk of chunks) {
    await sendDiscordMessage(chunk)
  }
}

async function checkAvailability(state) {
  if (!YOUTUBE_API_KEY || !DISCORD_BOT_TOKEN) {
    if (!state.warnedMissingEnv) {
      state.warnedMissingEnv = true
      if (!YOUTUBE_API_KEY) console.warn('[youtube-availability] YOUTUBE_API_KEY not set — skipping availability checks')
      if (!DISCORD_BOT_TOKEN) console.warn('[youtube-availability] DISCORD_BOT_TOKEN not set — skipping availability alerts')
    }
    return
  }

  const activeBlocks = await readActiveBlocks()
  const entries = Object.entries(activeBlocks).filter(([, blockSlug]) => !!blockSlug)
  if (!entries.length) return

  const { channels } = await getChannels({ includeDefaults: true })
  const channelNameBySlug = Object.fromEntries(channels.map(c => [c.slug, c.name]))

  const blocksIndex = await readBlocksIndex()

  const youtubeIdsByBlock = new Map()
  const dailymotionIdsByBlock = new Map()
  const blockMeta = new Map()
  const allYoutubeIds = []
  const allDailymotionIds = []

  for (const [channelSlug, blockSlug] of entries) {
    const payload = await readBlockPayload(blockSlug)
    if (!payload) continue

    const blockName = blocksIndex?.blocks?.[blockSlug]?.name || payload?.channel || blockSlug
    const channelName = channelNameBySlug[channelSlug] || channelSlug
    blockMeta.set(blockSlug, { channelSlug, channelName, blockName })

    const ytIds = []
    const dmIds = []
    for (const video of (payload?.videos || [])) {
      if (!video.id) continue
      if (video.source === 'dailymotion') {
        dmIds.push(video.id)
        if (!allDailymotionIds.includes(video.id)) allDailymotionIds.push(video.id)
      } else {
        ytIds.push(video.id)
        if (!allYoutubeIds.includes(video.id)) allYoutubeIds.push(video.id)
      }
    }
    youtubeIdsByBlock.set(blockSlug, { ytIds, videos: payload.videos || [] })
    dailymotionIdsByBlock.set(blockSlug, { dmIds, videos: payload.videos || [] })
  }

  const [youtubeData, dailymotionData] = await Promise.all([
    allYoutubeIds.length ? fetchYouTubeBatch(allYoutubeIds) : Promise.resolve(new Map()),
    allDailymotionIds.length ? fetchDailymotionBatch(allDailymotionIds) : Promise.resolve(new Map())
  ])

  const issues = []

  for (const [blockSlug, meta] of blockMeta.entries()) {
    const { channelSlug, channelName, blockName } = meta
    const { videos } = youtubeIdsByBlock.get(blockSlug) || {}
    if (!videos) continue

    for (const video of videos) {
      if (!video.id) continue
      if (video.source === 'dailymotion') {
        const data = dailymotionData.get(video.id)
        if (!data) continue
        const usOk = isDailymotionRegionAllowed(data.geoblocking, 'us')
        const gbOk = isDailymotionRegionAllowed(data.geoblocking, 'gb')
        if (!usOk || !gbOk) {
          issues.push({
            channelSlug, channelName, blockSlug, blockName,
            source: 'dailymotion',
            videoId: video.id,
            videoTitle: data.title || video.title || video.id,
            missing: !usOk && !gbOk ? 'US and UK' : !usOk ? 'US' : 'UK'
          })
        }
      } else {
        const data = youtubeData.get(video.id)
        if (!data) continue
        const usOk = isYouTubeRegionAvailable(data.regionRestriction, 'US')
        const gbOk = isYouTubeRegionAvailable(data.regionRestriction, 'GB')
        if (!usOk || !gbOk) {
          issues.push({
            channelSlug, channelName, blockSlug, blockName,
            source: 'youtube',
            videoId: video.id,
            videoTitle: data.title || video.title || video.id,
            missing: !usOk && !gbOk ? 'US and UK' : !usOk ? 'US' : 'UK'
          })
        }
      }
    }
  }

  if (!issues.length) return
  await sendDiscordAlert(issues)
}

export default defineNitroPlugin(() => {
  const state = globalThis.__crt80_ytavail_state || { started: false, warnedMissingEnv: false }
  if (state.started) return
  state.started = true
  globalThis.__crt80_ytavail_state = state

  setTimeout(() => {
    sendStartupStatus()
      .then(() => checkAvailability(state))
      .catch(err => console.error('[youtube-availability]', err))
  }, 10000)

  setInterval(() => {
    checkAvailability(state).catch(err => console.error('[youtube-availability]', err))
  }, CHECK_INTERVAL_MS)
})
