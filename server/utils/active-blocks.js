import fs from 'node:fs/promises'
import path from 'node:path'

const ACTIVE_FILE = 'assets/blocks/active-blocks.json'

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

/** The raw slug -> blockSlug mapping. Never throws; a missing file is "nothing active". */
export async function readActiveBlocks() {
  const filePath = path.resolve(process.cwd(), ACTIVE_FILE)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const mapping = safeParseJson(raw, {})
    return mapping && typeof mapping === 'object' ? mapping : {}
  } catch {
    return {}
  }
}

/**
 * The channels the front page will actually show, in the order it shows them.
 *
 * index.vue filters the channel list to those with an active block and then re-indexes,
 * so this must apply the same rule: it is what lets the server pick the same default
 * channel the client will land on, and therefore paint the right palette on the first
 * render instead of having the client repaint after hydration.
 */
export function filterToActive(channels, active) {
  return channels.filter((channel) => typeof active?.[channel.slug] === 'string' && active[channel.slug])
}
