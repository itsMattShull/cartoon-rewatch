import fs from 'node:fs/promises'
import path from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import { assertSameOrigin, requireAdmin } from '../../utils/auth'
import { getChannels } from '../../utils/channels'
import { broadcastToViewers } from '../../utils/viewer-broadcast'

const ACTIVE_FILE = 'assets/blocks/active-blocks.json'
const STATE_FILE = '.data/schedule-state.json'

function normalizeSlug(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
}

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch (error) {
    return fallback
  }
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const session = requireAdmin(event)

  const body = await readBody(event)
  const channelSlug = normalizeSlug(body?.channelSlug)
  const { channels } = await getChannels({ includeDefaults: true })
  const isKnownChannel = channels.some((channel) => channel.slug === channelSlug)
  if (!isKnownChannel) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown channel' })
  }

  const blockSlug = normalizeSlug(body?.blockSlug)

  const filePath = path.resolve(process.cwd(), ACTIVE_FILE)
  let mapping = {}
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    mapping = safeParseJson(raw, {})
  } catch (error) {
    mapping = {}
  }

  mapping[channelSlug] = blockSlug || ''

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(mapping, null, 2))

  // Stamp a marker the scheduler will not recognise as any scheduled occurrence, so this
  // manual choice survives until a genuinely new occurrence comes into effect. Without
  // it, reconcile would treat the channel as drifted and switch it back within a minute.
  try {
    const statePath = path.resolve(process.cwd(), STATE_FILE)
    let state = {}
    try {
      state = safeParseJson(await fs.readFile(statePath, 'utf8'), {})
    } catch (error) {
      state = {}
    }
    const appliedKeys = state && typeof state.appliedKeys === 'object' ? state.appliedKeys : {}
    appliedKeys[channelSlug] = `manual:${Date.now()}`
    await fs.mkdir(path.dirname(statePath), { recursive: true })
    await fs.writeFile(statePath, JSON.stringify({ ...state, appliedKeys }, null, 2))
  } catch (error) {
    // A missing marker only means the next scheduled occurrence reasserts itself sooner;
    // never fail the admin's switch over it.
    console.error('Failed to stamp manual block override', error)
  }

  broadcastToViewers({
    type: 'active_update',
    channels: { [channelSlug]: blockSlug || '' },
    at: Date.now()
  })

  return { ok: true, active: mapping }
})
