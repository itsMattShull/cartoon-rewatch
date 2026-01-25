import fs from 'node:fs/promises'
import path from 'node:path'

export const CHANNELS_INDEX_FILE = 'assets/channels/channels-index.json'

export const DEFAULT_CHANNELS = [
  { slug: 'toonami', name: 'Toonami' },
  { slug: 'adult-swim', name: 'Adult Swim' },
  { slug: 'saturday-morning', name: 'Saturday Morning' }
]

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch (error) {
    return fallback
  }
}

export function normalizeChannelSlug(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
}

export function normalizeChannelName(input) {
  return String(input || '').trim()
}

export function normalizeChannelNameKey(input) {
  return normalizeChannelName(input).toLowerCase()
}

export function mergeDefaultChannels(index) {
  const next = index && typeof index === 'object' ? { ...index } : {}
  if (!next.channels || typeof next.channels !== 'object') {
    next.channels = {}
  }
  for (const channel of DEFAULT_CHANNELS) {
    if (!next.channels[channel.slug]) {
      next.channels[channel.slug] = { name: channel.name }
    }
  }
  return next
}

export async function readChannelsIndex() {
  const filePath = path.resolve(process.cwd(), CHANNELS_INDEX_FILE)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = safeParseJson(raw, { channels: {} })
    return { ...parsed, _exists: true }
  } catch (error) {
    return { channels: {}, _exists: false }
  }
}

export async function writeChannelsIndex(index) {
  const filePath = path.resolve(process.cwd(), CHANNELS_INDEX_FILE)
  const { _exists, ...payload } = index || {}
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2))
}

export function buildChannelList(index) {
  const entries = index?.channels && typeof index.channels === 'object' ? index.channels : {}
  const channels = []
  const seen = new Set()

  for (const channel of DEFAULT_CHANNELS) {
    const entry = entries[channel.slug]
    if (entry) {
      channels.push({
        slug: channel.slug,
        name: typeof entry?.name === 'string' ? entry.name : channel.name
      })
      seen.add(channel.slug)
    }
  }

  const extra = Object.entries(entries)
    .filter(([slug]) => !seen.has(slug))
    .sort((a, b) => {
      const aName = typeof a[1]?.name === 'string' ? a[1].name : a[0]
      const bName = typeof b[1]?.name === 'string' ? b[1].name : b[0]
      return aName.localeCompare(bName)
    })

  for (const [slug, entry] of extra) {
    channels.push({
      slug,
      name: typeof entry?.name === 'string' ? entry.name : slug
    })
  }

  return channels
}

export async function getChannels({ includeDefaults = true } = {}) {
  const rawIndex = await readChannelsIndex()
  const index =
    includeDefaults && !rawIndex._exists ? mergeDefaultChannels(rawIndex) : rawIndex
  return {
    index,
    channels: buildChannelList(index)
  }
}
