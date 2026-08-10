import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { safeImageUrl, safeLinkUrl } from '#shared/url-safety.js'

// Runtime state lives in .data/, never under assets/ or public/:
//   - assets/ is a build-time import root (index.vue statically imports channel JSON)
//     and parts of it are git-tracked, so runtime writes there can abort the deploy's
//     `git pull` after pm2 has already stopped the app.
//   - public/ is copied into .output/public at build time, so runtime writes there are
//     invisible in production and destroyed on the next build.
// .data/ is gitignored and already the production home for analytics.json.
const DATA_DIR = '.data'
const BANNERS_FILE = path.join(DATA_DIR, 'banners.json')
export const UPLOAD_DIR = path.join(DATA_DIR, 'banners')

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
export const MAX_ADS = 6
export const MAX_ANNOUNCEMENT_CHARS = 140
export const MAX_STRIP_CHARS = 40
export const MAX_ALT_CHARS = 120
export const MAX_LABEL_CHARS = 60

// Uploaded files are content-addressed, so the name is a pure function of the bytes.
export const UPLOAD_FILENAME = /^[0-9a-f]{32}\.(png|jpg|gif|webp)$/

export const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
}

const DEFAULTS = {
  announcement: { enabled: false, text: '', linkUrl: '', linkLabel: '' },
  // The channel strip's middle slot, between "CH 01" and the LIVE pill.
  channelStrip: { enabled: false, text: '', linkUrl: '' },
  // Seeded with the banner that was previously hardcoded in index.vue so the
  // front page looks identical before an admin touches anything.
  ads: [
    {
      id: 'default-ad',
      label: 'Cartoon ReOrbit',
      imageUrl: '/ad1.gif',
      linkUrl: 'https://www.cartoonreorbit.com',
      alt: 'Cartoon ReOrbit',
      width: 728,
      height: 104,
      enabled: true
    }
  ]
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function defaultBanners() {
  return clone(DEFAULTS)
}

function cleanText(value, maxChars) {
  if (typeof value !== 'string') return ''
  // Strip control characters; they serve no purpose in a banner and make stored
  // data hard to reason about.
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0)
    out += code < 32 || code === 127 ? ' ' : ch
  }
  return out.trim().slice(0, maxChars)
}

function toBool(value) {
  return value === true || value === 'true'
}

function toDimension(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0 || n > 10000) return 0
  return Math.round(n)
}

function normalizeAd(raw, index) {
  const imageUrl = safeImageUrl(raw?.imageUrl)
  const linkUrl = safeLinkUrl(raw?.linkUrl)
  const id =
    typeof raw?.id === 'string' && /^[a-z0-9-]{1,40}$/.test(raw.id)
      ? raw.id
      : `ad-${index + 1}`
  return {
    id,
    label: cleanText(raw?.label, MAX_LABEL_CHARS),
    imageUrl,
    linkUrl,
    alt: cleanText(raw?.alt, MAX_ALT_CHARS),
    width: toDimension(raw?.width),
    height: toDimension(raw?.height),
    // An ad with no usable image can never render, so never store it as enabled.
    enabled: toBool(raw?.enabled) && Boolean(imageUrl)
  }
}

/**
 * Coerces arbitrary input into a valid banner config. Never throws: a corrupt or
 * partially-written file degrades to "no banners", because the front page awaits this
 * during SSR and a throw here would break the whole page render.
 */
export function normalizeBanners(raw) {
  const announcementLink = safeLinkUrl(raw?.announcement?.linkUrl)
  const stripLink = safeLinkUrl(raw?.channelStrip?.linkUrl)
  const announcementText = cleanText(raw?.announcement?.text, MAX_ANNOUNCEMENT_CHARS)
  const stripText = cleanText(raw?.channelStrip?.text, MAX_STRIP_CHARS)

  const ads = Array.isArray(raw?.ads)
    ? raw.ads.slice(0, MAX_ADS).map(normalizeAd)
    : []

  return {
    announcement: {
      enabled: toBool(raw?.announcement?.enabled) && Boolean(announcementText),
      text: announcementText,
      linkUrl: announcementLink,
      linkLabel: cleanText(raw?.announcement?.linkLabel, MAX_LABEL_CHARS)
    },
    channelStrip: {
      enabled: toBool(raw?.channelStrip?.enabled) && Boolean(stripText),
      text: stripText,
      linkUrl: stripLink
    },
    ads
  }
}

// Single-process server (pm2 fork, instances: 1), so a module-level memo is coherent.
// Lazy-filled only — never warmed at boot, since the deploy guarantees a cold start.
let cache = null
let cacheMtime = 0
let cacheCheckedAt = 0

export async function readBanners() {
  const filePath = path.resolve(process.cwd(), BANNERS_FILE)
  const nowMs = Date.now()

  if (cache && nowMs - cacheCheckedAt < 1000) return clone(cache)

  try {
    const stat = await fs.stat(filePath)
    cacheCheckedAt = nowMs
    if (cache && stat.mtimeMs === cacheMtime) return clone(cache)

    const raw = await fs.readFile(filePath, 'utf8')
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Torn or hand-mangled file: fall back rather than break the front page.
      return defaultBanners()
    }
    cache = normalizeBanners(parsed)
    cacheMtime = stat.mtimeMs
    return clone(cache)
  } catch {
    // No file yet — first run, before any admin has saved.
    cacheCheckedAt = nowMs
    cache = defaultBanners()
    cacheMtime = 0
    return clone(cache)
  }
}

// Serialises read-modify-write cycles so two overlapping saves can't lose an update.
let writeQueue = Promise.resolve()

export function withBannerLock(fn) {
  const next = writeQueue.then(fn, fn)
  // Keep the chain alive even if a caller rejects.
  writeQueue = next.catch(() => {})
  return next
}

export async function writeBanners(banners) {
  const normalized = normalizeBanners(banners)
  const filePath = path.resolve(process.cwd(), BANNERS_FILE)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  // Write-then-rename: fs.writeFile truncates first, so a crash or pm2 restart
  // mid-write would otherwise leave a zero-byte config.
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(normalized, null, 2))
  await fs.rename(tmpPath, filePath)

  // Invalidate explicitly — mtime granularity can miss a write inside the same tick.
  cache = normalized
  cacheCheckedAt = 0
  try {
    const stat = await fs.stat(filePath)
    cacheMtime = stat.mtimeMs
  } catch {
    cacheMtime = 0
  }
  return clone(normalized)
}

/**
 * Removes uploaded files no longer referenced by the saved config, so replacing a
 * banner repeatedly can't grow the data dir without bound.
 */
export async function pruneOrphanUploads(banners) {
  const dir = path.resolve(process.cwd(), UPLOAD_DIR)
  const referenced = new Set(
    (banners?.ads || [])
      .map((ad) => ad.imageUrl)
      .filter((url) => typeof url === 'string' && url.startsWith('/api/banner-image/'))
      .map((url) => url.slice('/api/banner-image/'.length))
  )
  try {
    const entries = await fs.readdir(dir)
    await Promise.all(
      entries
        .filter((name) => UPLOAD_FILENAME.test(name) && !referenced.has(name))
        .map((name) => fs.unlink(path.join(dir, name)).catch(() => {}))
    )
  } catch {
    // Directory may not exist yet.
  }
}
