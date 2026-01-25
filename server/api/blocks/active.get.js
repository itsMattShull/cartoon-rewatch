import fs from 'node:fs/promises'
import path from 'node:path'
import { defineEventHandler } from 'h3'
import { getChannels } from '../../utils/channels'

const ACTIVE_FILE = 'assets/blocks/active-blocks.json'

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch (error) {
    return fallback
  }
}

export default defineEventHandler(async (event) => {
  const filePath = path.resolve(process.cwd(), ACTIVE_FILE)
  let mapping = {}
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    mapping = safeParseJson(raw, {})
  } catch (error) {
    mapping = {}
  }

  const { channels } = await getChannels({ includeDefaults: true })
  const normalized = {}
  for (const channel of channels) {
    const slug = channel.slug
    normalized[slug] = typeof mapping?.[slug] === 'string' ? mapping[slug] : ''
  }

  return { active: normalized }
})
