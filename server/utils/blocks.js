import fs from 'node:fs/promises'
import path from 'node:path'

const BLOCKS_DIR = 'assets/blocks'
const RESERVED = new Set(['blocks-index', 'active-blocks'])

/**
 * Does a block payload actually exist on disk?
 *
 * Scheduling a block slug that does not exist is a self-inflicted outage: when the entry
 * fires, active-blocks.json points at a missing payload, every viewer's
 * `/api/blocks/<slug>` 404s and playback breaks for that channel. As a one-off that is a
 * single incident; as a recurring rule it repeats on schedule forever. So slugs are
 * validated at write time, and skipped again at expansion time.
 */
export async function blockExists(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{1,64}$/.test(slug)) return false
  if (RESERVED.has(slug)) return false
  const filePath = path.resolve(process.cwd(), BLOCKS_DIR, `${slug}.json`)
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile()
  } catch {
    return false
  }
}
