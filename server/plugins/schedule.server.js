import fs from 'node:fs/promises'
import path from 'node:path'
import { defineNitroPlugin } from '#imports'
import { getChannels } from '../utils/channels'
import { normalizeScheduleList, readSchedules } from '../utils/schedules'
import { broadcastToViewers } from '../utils/viewer-broadcast'

const ACTIVE_FILE = 'assets/blocks/active-blocks.json'
const CHECK_INTERVAL_MS = 60 * 1000

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

async function writeActiveBlocks(mapping) {
  const filePath = path.resolve(process.cwd(), ACTIVE_FILE)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(mapping, null, 2))
}

async function checkSchedules(state) {
  const now = Date.now()
  const lastTick = state.lastTick || now
  state.lastTick = now

  const { channels } = await getChannels({ includeDefaults: true })
  const known = new Set(channels.map((channel) => channel.slug))

  const stored = await readSchedules()
  const dueByChannel = new Map()

  for (const [slug, entries] of Object.entries(stored.channels || {})) {
    if (!known.has(slug)) continue
    const normalized = normalizeScheduleList(entries)
    for (const entry of normalized) {
      const startMs = Date.parse(entry.startTime)
      if (!Number.isFinite(startMs)) continue
      if (startMs <= lastTick || startMs > now) continue
      const existing = dueByChannel.get(slug)
      if (!existing || startMs > existing.startMs) {
        dueByChannel.set(slug, { ...entry, startMs })
      }
    }
  }

  if (!dueByChannel.size) return

  const active = await readActiveBlocks()
  let hasChanges = false
  const changed = {}

  for (const [slug, entry] of dueByChannel.entries()) {
    if (active?.[slug] !== entry.blockSlug) {
      active[slug] = entry.blockSlug
      changed[slug] = entry.blockSlug
      hasChanges = true
    }
  }

  if (!hasChanges) return

  await writeActiveBlocks(active)

  broadcastToViewers({
    type: 'schedule_update',
    channels: changed,
    at: now
  })
}

export default defineNitroPlugin(() => {
  const state = globalThis.__crt80_schedule_state || { started: false, lastTick: Date.now() }
  if (state.started) return
  state.started = true
  state.lastTick = Date.now()
  globalThis.__crt80_schedule_state = state

  const tick = () => {
    checkSchedules(state).catch((error) => {
      console.error('Schedule check failed', error)
    })
  }

  setInterval(tick, CHECK_INTERVAL_MS)
})
