import fs from 'node:fs/promises'
import path from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import { getSessionFromEvent } from '../../utils/auth'

const BLOCKS_DIR = 'assets/blocks'
const INDEX_FILE = 'assets/blocks/blocks-index.json'
const USERS_FILE = 'assets/discord-users.json'

function normalizeSlug(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
}

function sanitizePayload(payload, fallbackName) {
  const name =
    typeof payload?.channel === 'string'
      ? payload.channel
      : typeof payload?.block === 'string'
        ? payload.block
        : typeof payload?.name === 'string'
          ? payload.name
          : fallbackName
  const videos = Array.isArray(payload?.videos) ? payload.videos : []
  return {
    channel: name || fallbackName,
    note: 'Replace each id with a YouTube video ID and durationSeconds with the full length in seconds.',
    videos: videos.map((video) => ({
      id: typeof video.id === 'string' ? video.id : '',
      title: typeof video.title === 'string' ? video.title : '',
      durationSeconds: Number(video.durationSeconds) || 0
    }))
  }
}

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch (error) {
    return fallback
  }
}

function normalizeName(input) {
  return String(input || '').trim().toLowerCase()
}

function isNumericId(value) {
  return typeof value === 'string' && /^\\d+$/.test(value)
}

export default defineEventHandler(async (event) => {
  const session = getSessionFromEvent(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readBody(event)
  const nameInput = typeof body?.name === 'string' ? body.name : null
  const slugInput = typeof body?.slug === 'string' ? body.slug : null
  const payloadInput = body?.payload || {}

  const name = nameInput || payloadInput?.channel || payloadInput?.block || payloadInput?.name
  const slug = normalizeSlug(slugInput || name)
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Missing block name' })
  }

  const payload = sanitizePayload({ ...payloadInput, channel: name || payloadInput?.channel }, name || slug)

  const blocksDir = path.resolve(process.cwd(), BLOCKS_DIR)
  const indexPath = path.resolve(process.cwd(), INDEX_FILE)
  await fs.mkdir(blocksDir, { recursive: true })

  const filePath = path.join(blocksDir, `${slug}.json`)
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2))

  let index = { blocks: {} }
  try {
    const rawIndex = await fs.readFile(indexPath, 'utf8')
    index = safeParseJson(rawIndex, { blocks: {} })
  } catch (error) {
    index = { blocks: {} }
  }

  if (!index.blocks || typeof index.blocks !== 'object') {
    index.blocks = {}
  }

  const normalizedName = normalizeName(payload.channel)
  if (normalizedName) {
    const conflict = Object.entries(index.blocks).find(([existingSlug, existing]) => {
      if (existingSlug === slug) return false
      return normalizeName(existing?.name) === normalizedName
    })
    if (conflict) {
      throw createError({ statusCode: 400, statusMessage: 'Block name already exists' })
    }
  }

  const now = new Date().toISOString()
  const username = session.username || session.id
  const existing = index.blocks[slug]
  const existingCreatedById =
    existing?.createdById || (isNumericId(existing?.createdBy) ? existing.createdBy : null)
  const createdById = existingCreatedById || session.id
  let createdBy = existing?.createdBy || username
  if (isNumericId(createdBy) && createdById === session.id && session.username) {
    createdBy = session.username
  }

  const usersPath = path.resolve(process.cwd(), USERS_FILE)
  if (session.id && session.username) {
    let users = {}
    try {
      const rawUsers = await fs.readFile(usersPath, 'utf8')
      users = safeParseJson(rawUsers, {})
    } catch (error) {
      users = {}
    }
    users[String(session.id)] = String(session.username)
    await fs.mkdir(path.dirname(usersPath), { recursive: true })
    await fs.writeFile(usersPath, JSON.stringify(users, null, 2))
  }

  index.blocks[slug] = {
    name: payload.channel,
    createdAt: existing?.createdAt || now,
    createdBy,
    createdById,
    updatedAt: now,
    updatedBy: username,
    updatedById: session.id
  }

  await fs.writeFile(indexPath, JSON.stringify(index, null, 2))

  return { ok: true, slug }
})
