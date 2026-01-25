import { createError, defineEventHandler, getQuery } from 'h3'
import { Innertube, UniversalCache } from 'youtubei.js'
import { getSessionFromEvent } from '../utils/auth'

let clientPromise

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

  try {
    const client = await getClient()
    const info = await client.getBasicInfo(videoId)
    return {
      id: videoId,
      title: getTitle(info),
      durationSeconds: getDurationSeconds(info)
    }
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch video info'
    })
  }
})
