import fs from 'node:fs/promises'
import path from 'node:path'
import { createError, defineEventHandler } from 'h3'
import { getSessionFromEvent } from '../utils/auth'

const BLOCKS_DIR = 'assets/blocks'
const INDEX_FILE = 'assets/blocks/blocks-index.json'
const ACTIVE_FILE = 'assets/blocks/active-blocks.json'
const USERS_FILE = 'assets/discord-users.json'

function isBlockFile(name) {
  return name.endsWith('.json') && name !== path.basename(INDEX_FILE) && name !== path.basename(ACTIVE_FILE)
}

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch (error) {
    return fallback
  }
}

function isNumericId(value) {
  return typeof value === 'string' && /^\\d+$/.test(value)
}

function resolveUserName(name, id, users) {
  if (name && !isNumericId(name)) return name
  if (id && users?.[id]) return users[id]
  return name || null
}

export default defineEventHandler(async (event) => {
  const session = getSessionFromEvent(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const blocksDir = path.resolve(process.cwd(), BLOCKS_DIR)
  const indexPath = path.resolve(process.cwd(), INDEX_FILE)

  let index = { blocks: {} }
  try {
    const rawIndex = await fs.readFile(indexPath, 'utf8')
    index = safeParseJson(rawIndex, { blocks: {} })
  } catch (error) {
    index = { blocks: {} }
  }

  let users = {}
  try {
    const rawUsers = await fs.readFile(path.resolve(process.cwd(), USERS_FILE), 'utf8')
    users = safeParseJson(rawUsers, {})
  } catch (error) {
    users = {}
  }

  let entries = []
  try {
    entries = await fs.readdir(blocksDir, { withFileTypes: true })
  } catch (error) {
    return { blocks: [] }
  }

  const blockFiles = entries.filter((entry) => entry.isFile() && isBlockFile(entry.name))

  const blocks = await Promise.all(
    blockFiles.map(async (entry) => {
      const slug = entry.name.replace(/\.json$/i, '')
      const filePath = path.join(blocksDir, entry.name)
      let payload = {}
      try {
        const raw = await fs.readFile(filePath, 'utf8')
        payload = safeParseJson(raw, {})
      } catch (error) {
        payload = {}
      }

      let stats = null
      try {
        stats = await fs.stat(filePath)
      } catch (error) {
        stats = null
      }

      const meta = index?.blocks?.[slug] ?? {}
      const name = typeof payload?.channel === 'string' ? payload.channel : meta?.name || slug
      const createdAt = meta?.createdAt || (stats?.birthtime ? stats.birthtime.toISOString() : null)
      const updatedAt = meta?.updatedAt || (stats?.mtime ? stats.mtime.toISOString() : null)
      const createdById =
        meta?.createdById || (isNumericId(meta?.createdBy) ? meta.createdBy : null)
      const updatedById =
        meta?.updatedById || (isNumericId(meta?.updatedBy) ? meta.updatedBy : null)

      return {
        slug,
        name,
        createdAt,
        createdBy: resolveUserName(meta?.createdBy || null, createdById, users),
        updatedAt,
        updatedBy: resolveUserName(meta?.updatedBy || null, updatedById, users)
      }
    })
  )

  blocks.sort((a, b) => {
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0
    return bTime - aTime
  })

  return { blocks }
})
