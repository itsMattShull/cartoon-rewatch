import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { defineNitroPlugin } from '#imports'
import { getChannels } from '../utils/channels'
import {
  getChannelRules,
  getEffectiveOccurrence,
  normalizeScheduleList,
  occurrenceKey,
  readSchedules
} from '../utils/schedules'
import { broadcastToViewers } from '../utils/viewer-broadcast'

const ACTIVE_FILE = 'assets/blocks/active-blocks.json'
// Applied-occurrence markers live in .data/ (gitignored, already home to analytics.json)
// rather than under assets/, so a runtime write can never collide with the deploy's
// `git pull`.
const STATE_FILE = '.data/schedule-state.json'
const CHECK_INTERVAL_MS = 60 * 1000

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch (error) {
    return fallback
  }
}

async function readJsonFile(relPath, fallback) {
  const filePath = path.resolve(process.cwd(), relPath)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return safeParseJson(raw, fallback)
  } catch (error) {
    return fallback
  }
}

// Write-then-rename: a plain writeFile truncates first, so a restart mid-write would
// leave a zero-byte active-blocks.json and blank every channel.
async function writeJsonFile(relPath, value) {
  const filePath = path.resolve(process.cwd(), relPath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2))
  await fs.rename(tmpPath, filePath)
}

/**
 * Reconcile the active block of every channel to whatever the schedule says should be
 * playing right now.
 *
 * This replaces a "what became due since the last tick" scan, which lost occurrences for
 * good in four separate ways: `lastTick` was reset to now at boot (so every deploy
 * silently dropped whatever was due during the restart), it was advanced before the
 * awaits that could throw, a torn read of schedules.json consumed a window, and a
 * backwards NTP step re-broadcast ground already covered.
 *
 * Comparing the applied *occurrence key* rather than the block slug is what keeps this
 * idempotent and keeps a manual block switch from being stomped every 60 seconds: a
 * manual switch stamps its own marker, and reconcile only acts when a genuinely new
 * occurrence comes into effect.
 */
async function reconcile(state) {
  const now = Date.now()

  const { channels } = await getChannels({ includeDefaults: true })
  const stored = await readSchedules()

  const active = await readJsonFile(ACTIVE_FILE, {})
  const applied = await readJsonFile(STATE_FILE, {})
  const appliedKeys = applied && typeof applied.appliedKeys === 'object' ? applied.appliedKeys : {}

  const changed = {}
  let hasChanges = false

  for (const channel of channels) {
    const slug = channel.slug
    const oneOffs = normalizeScheduleList(stored.channels?.[slug] || [])
    const rules = getChannelRules(stored, slug)
    if (!oneOffs.length && !rules.length) continue

    const occurrence = getEffectiveOccurrence(oneOffs, rules, now)
    if (!occurrence) continue

    const key = occurrenceKey(occurrence)
    const previous = appliedKeys[slug]
    if (previous === key) continue

    // A manual switch wins until a genuinely NEW occurrence begins. Without the
    // timestamp comparison, the occurrence that was already in effect when the admin
    // switched still counts as "not yet applied" and reconcile undoes their choice on
    // the very next tick.
    if (typeof previous === 'string' && previous.startsWith('manual:')) {
      const overriddenAt = Number(previous.slice('manual:'.length))
      if (Number.isFinite(overriddenAt) && occurrence.startMs <= overriddenAt) continue
    }

    appliedKeys[slug] = key
    if (active[slug] !== occurrence.blockSlug) {
      active[slug] = occurrence.blockSlug
      changed[slug] = occurrence.blockSlug
    }
    hasChanges = true
  }

  if (!hasChanges) return

  if (Object.keys(changed).length) {
    await writeJsonFile(ACTIVE_FILE, active)
  }
  await writeJsonFile(STATE_FILE, { appliedKeys, updatedAt: now })

  if (!Object.keys(changed).length) return

  broadcastToViewers({
    type: 'schedule_update',
    channels: changed,
    at: now
  })
}

export default defineNitroPlugin(() => {
  const state = globalThis.__crt80_schedule_state || { started: false }
  if (state.started) return
  state.started = true
  globalThis.__crt80_schedule_state = state

  const run = () => {
    reconcile(state).catch((error) => {
      console.error('Schedule reconcile failed', error)
    })
  }

  // Run immediately rather than waiting a full interval: this is what makes a deploy
  // spanning an occurrence self-healing instead of silently skipping it.
  run()

  // Align to the wall-clock minute. With minute-precision rules, a free-running 60s
  // interval applies changes up to a minute after browsers have already flipped to the
  // new occurrence, and during that gap the player falls back to the week anchor while
  // the guide shows the new block.
  const scheduleNext = () => {
    const delay = CHECK_INTERVAL_MS - (Date.now() % CHECK_INTERVAL_MS) + 250
    state.timer = setTimeout(() => {
      run()
      scheduleNext()
    }, delay)
    if (typeof state.timer?.unref === 'function') state.timer.unref()
  }
  scheduleNext()
})
