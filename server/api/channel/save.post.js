import fs from 'node:fs/promises'
import path from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import { getSessionFromEvent } from '../../utils/auth'

const CHANNEL_FILES = {
  'toonami': 'assets/channels/toonami.json',
  'adult-swim': 'assets/channels/adult-swim.json',
  'saturday-morning': 'assets/channels/saturday-morning.json'
}

function normalizeSlug(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
}

function sanitizePayload(payload, fallbackName) {
  const name = typeof payload?.channel === 'string' ? payload.channel : fallbackName
  const videos = Array.isArray(payload?.videos) ? payload.videos : []
  return {
    channel: name,
    note: 'Replace each id with a YouTube video ID and durationSeconds with the full length in seconds.',
    videos: videos.map((video) => ({
      id: typeof video.id === 'string' ? video.id : '',
      title: typeof video.title === 'string' ? video.title : '',
      durationSeconds: Number(video.durationSeconds) || 0
    }))
  }
}

export default defineEventHandler(async (event) => {
  const session = getSessionFromEvent(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readBody(event)
  const slug = normalizeSlug(body?.slug)
  const filePath = CHANNEL_FILES[slug]
  if (!filePath) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown channel slug' })
  }

  const payload = sanitizePayload(body?.payload, slug)
  const absolutePath = path.resolve(process.cwd(), filePath)
  await fs.writeFile(absolutePath, JSON.stringify(payload, null, 2))

  return { ok: true }
})
