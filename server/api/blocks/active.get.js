import fs from 'node:fs/promises'
import path from 'node:path'
import { defineEventHandler } from 'h3'

const ACTIVE_FILE = 'assets/blocks/active-blocks.json'
const CHANNEL_SLUGS = ['toonami', 'adult-swim', 'saturday-morning']

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

  const normalized = {}
  for (const slug of CHANNEL_SLUGS) {
    normalized[slug] = typeof mapping?.[slug] === 'string' ? mapping[slug] : ''
  }

  return { active: normalized }
})
