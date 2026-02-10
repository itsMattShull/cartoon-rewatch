import { createError, defineEventHandler, getQuery } from 'h3'
import { getSessionFromEvent } from '../utils/auth'

function stripUrlParams(value) {
  return String(value || '').split(/[?#]/)[0]
}

function cleanDailymotionId(value) {
  return stripUrlParams(value).split('_')[0]
}

function normalizeVideoId(input) {
  if (!input) return ''
  const trimmed = String(input).trim()
  try {
    const url = new URL(trimmed)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'dai.ly') {
      return cleanDailymotionId(url.pathname.split('/').filter(Boolean)[0] || '')
    }
    if (host.includes('dailymotion.com')) {
      const parts = url.pathname.split('/').filter(Boolean)
      const videoIndex = parts.indexOf('video')
      if (videoIndex >= 0) {
        return cleanDailymotionId(parts[videoIndex + 1] || '')
      }
      if (parts[0] === 'embed' && parts[1] === 'video') {
        return cleanDailymotionId(parts[2] || '')
      }
    }
  } catch (error) {
    // Not a URL, fall back to string matching.
  }
  if (trimmed.includes('dai.ly/')) {
    const id = trimmed.split('dai.ly/')[1]?.split(/[?&#]/)[0]
    if (id) return cleanDailymotionId(id)
  }
  if (trimmed.includes('dailymotion.com/video/')) {
    const id = trimmed.split('dailymotion.com/video/')[1]?.split(/[?&#]/)[0]
    if (id) return cleanDailymotionId(id)
  }
  if (trimmed.includes('dailymotion.com/embed/video/')) {
    const id = trimmed.split('dailymotion.com/embed/video/')[1]?.split(/[?&#]/)[0]
    if (id) return cleanDailymotionId(id)
  }
  return cleanDailymotionId(trimmed)
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

  const url = new URL(`https://api.dailymotion.com/video/${videoId}`)
  url.searchParams.set('fields', 'title,duration,allow_embed,geoblocking')
  const response = await fetch(url.toString())
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw createError({
      statusCode: response.status,
      statusMessage: message || `Dailymotion API request failed (${response.status})`
    })
  }
  const data = await response.json()
  if (data?.error) {
    throw createError({
      statusCode: 404,
      statusMessage: data?.error?.message || 'Video not found'
    })
  }
  const title = typeof data?.title === 'string' ? data.title : ''
  const durationSeconds = Number.isFinite(Number(data?.duration)) ? Number(data.duration) : 0
  const allowEmbed = Boolean(data?.allow_embed)
  const geoblocking = Array.isArray(data?.geoblocking) ? data.geoblocking : []

  return {
    id: videoId,
    title,
    durationSeconds,
    allowEmbed,
    geoblocking
  }
})
