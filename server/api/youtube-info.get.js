import { createError, defineEventHandler, getQuery } from 'h3'
import { Innertube, UniversalCache } from 'youtubei.js'
import { getSessionFromEvent } from '../utils/auth'

let clientPromise
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || ''

function getClient() {
  if (!clientPromise) {
    clientPromise = Innertube.create({
      cache: new UniversalCache(false)
    })
  }
  return clientPromise
}

function normalizeVideoId(input) {
  if (!input) return ''
  const trimmed = String(input).trim()
  try {
    const url = new URL(trimmed)
    const host = url.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      return url.pathname.replace('/', '')
    }
    if (host.includes('youtube.com')) {
      const param = url.searchParams.get('v')
      if (param) return param
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts[0] === 'shorts' || parts[0] === 'embed') {
        return parts[1] || ''
      }
    }
  } catch (error) {
    // Not a URL, fall back to string matching.
  }
  if (trimmed.includes('youtu.be/')) {
    const id = trimmed.split('youtu.be/')[1]?.split(/[?&#]/)[0]
    if (id) return id
  }
  if (trimmed.includes('v=')) {
    const id = trimmed.split('v=')[1]?.split(/[?&#]/)[0]
    if (id) return id
  }
  if (trimmed.includes('/shorts/')) {
    const id = trimmed.split('/shorts/')[1]?.split(/[?&#]/)[0]
    if (id) return id
  }
  if (trimmed.includes('/embed/')) {
    const id = trimmed.split('/embed/')[1]?.split(/[?&#]/)[0]
    if (id) return id
  }
  return trimmed
}

function getDurationSeconds(info) {
  const candidate =
    info?.basic_info?.duration ??
    info?.video_details?.duration ??
    info?.basic_info?.length_seconds ??
    info?.video_details?.length_seconds ??
    info?.duration

  const value = Number(candidate)
  return Number.isFinite(value) ? value : 0
}

function getTitle(info) {
  return (
    info?.basic_info?.title ||
    info?.video_details?.title ||
    info?.primary_info?.title?.text ||
    info?.title ||
    ''
  )
}

function parseIsoDuration(value) {
  if (!value || typeof value !== 'string') return 0
  const match = value.match(/P(?:\\d+Y)?(?:\\d+M)?(?:\\d+W)?(?:\\d+D)?T?(\\d+H)?(\\d+M)?(\\d+S)?/i)
  if (!match) return 0
  const hours = Number(match[1]?.replace('H', '') || 0)
  const minutes = Number(match[2]?.replace('M', '') || 0)
  const seconds = Number(match[3]?.replace('S', '') || 0)
  if (![hours, minutes, seconds].every(Number.isFinite)) return 0
  return hours * 3600 + minutes * 60 + seconds
}

async function fetchFromOfficialApi(videoId) {
  if (!YOUTUBE_API_KEY) return null
  const url = new URL('https://www.googleapis.com/youtube/v3/videos')
  url.searchParams.set('part', 'snippet,contentDetails')
  url.searchParams.set('id', videoId)
  url.searchParams.set('key', YOUTUBE_API_KEY)
  const response = await fetch(url.toString())
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || `YouTube API request failed (${response.status})`)
  }
  const data = await response.json()
  const item = data?.items?.[0]
  if (!item) return null
  return {
    title: item?.snippet?.title || '',
    durationSeconds: parseIsoDuration(item?.contentDetails?.duration)
  }
}

export default defineEventHandler(async (event) => {
  const session = getSessionFromEvent(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const query = getQuery(event)
  const rawId = query.id
  const videoId = normalizeVideoId(rawId)

  if (!videoId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing video id' })
  }

  let title = ''
  let durationSeconds = 0
  let lastError = null

  try {
    const client = await getClient()
    const info = await client.getBasicInfo(videoId)
    title = getTitle(info)
    durationSeconds = getDurationSeconds(info)
  } catch (error) {
    lastError = error
  }

  if ((!title || !durationSeconds) && YOUTUBE_API_KEY) {
    try {
      const fallback = await fetchFromOfficialApi(videoId)
      if (fallback) {
        title = title || fallback.title
        durationSeconds = durationSeconds || fallback.durationSeconds
      }
    } catch (error) {
      lastError = error
    }
  }

  if (!title && lastError) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch video info'
    })
  }

  return {
    id: videoId,
    title,
    durationSeconds
  }
})
