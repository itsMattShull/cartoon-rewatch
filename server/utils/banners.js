import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { safeImageUrl, safeLinkUrl } from '#shared/url-safety.js'
import { REFERENCE_BRAND } from '#shared/palette.js'
import { normalizeTheme } from '#shared/theme-config.js'

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
export const MAX_TAGLINE_CHARS = 48

// The tagline that shipped hardcoded in the header. Used when banners.json predates the
// tagline key, so an existing deployment reads identically before an admin touches it.
export const DEFAULT_TAGLINE = 'Grab cereal and enjoy.'

// Uploaded files are content-addressed, so the name is a pure function of the bytes.
export const UPLOAD_FILENAME = /^[0-9a-f]{32}\.(png|jpg|gif|webp)$/
export const UPLOAD_URL_PREFIX = '/api/banner-image/'

// An upload is not referenced by anything until a save assigns it, so a save that lands
// between an upload and its assignment would otherwise collect the fresh file. Content
// hashes make the name unrecoverable without the original bytes, so the loss is
// permanent for the admin who just picked the image.
export const UPLOAD_GRACE_MS = 15 * 60 * 1000

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
  // The header sub-line under "Cartoon ReWatch".
  //
  // `null` means "never configured" and resolves to DEFAULT_TAGLINE; an empty string
  // means an admin deliberately cleared it and the line is hidden. The distinction
  // matters because every existing banners.json predates this key, and collapsing absent
  // to empty would blank the header on deploy.
  tagline: { text: null },
  // Per-channel colour schemes. Lives here rather than in its own file so that colours,
  // banners and the embed image are one config, one lock, one atomic write and one save
  // button — a second store would mean "Save Colours" could succeed while "Save Banners"
  // failed, against a shared upload GC that only knows about one of them.
  theme: { default: REFERENCE_BRAND, channels: {}, overrides: [] },
  // The link-preview image. `null` means "never configured" and resolves to the
  // /logo.png that was hardcoded in index.vue's useHead, so an untouched deployment
  // unfurls exactly as it did before.
  embed: { imageUrl: '', width: 0, height: 0, alt: '' },
  // Seeded with the banner that was previously hardcoded in index.vue so the
  // front page looks identical before an admin touches anything.
  ads: [
    {
      id: 'default-ad',
      label: 'Cartoon ReOrbit',
      imageUrl: '/promo1.gif',
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

/**
 * Resolves the stored tagline sentinel into what should actually render.
 *
 * Done once, server-side, so SSR and the hydrated client agree from a single source —
 * and so the admin form is seeded with the value the visitor sees rather than a blank
 * box that would save as "hidden".
 */
export function withResolvedTagline(banners) {
  const stored = banners?.tagline?.text
  return {
    ...banners,
    tagline: { text: typeof stored === 'string' ? stored : DEFAULT_TAGLINE }
  }
}

function cleanText(value, maxChars) {
  if (typeof value !== 'string') return ''
  // Strip control characters AND format characters. \p{Cc} covers the C0/C1 controls the
  // original loop caught; \p{Cf} additionally covers the bidi overrides (U+202E and
  // friends) and zero-width characters, which survive a control-only filter and let a
  // single banner field reverse the rendering direction of the whole header.
  const stripped = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').normalize('NFC')
  // Cap by code point, not code unit: String#slice counts UTF-16 units, so cutting a run
  // of emoji at the limit can leave a lone surrogate in the stored JSON and the SSR'd
  // HTML.
  return Array.from(stripped.trim()).slice(0, maxChars).join('').trim()
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

// The link-preview image. Restricted to an uploaded, same-origin, content-addressed
// file rather than accepting an arbitrary https URL like the ad banners do.
//
// The reason is not SSRF — nothing fetches this server-side. It is that iMessage and
// WhatsApp build link previews ON THE SENDING OR RECEIVING DEVICE, so a third-party
// image host would receive real end-user IP addresses keyed to "somebody just shared
// this site in a private chat". A remote host can also swap the image at any time and
// change what every existing shared link looks like. Neither is true of a hash-named
// file we serve ourselves.
function normalizeEmbed(raw) {
  const imageUrl = typeof raw?.imageUrl === 'string' ? raw.imageUrl.trim() : ''
  const isUpload =
    imageUrl.startsWith(UPLOAD_URL_PREFIX) &&
    UPLOAD_FILENAME.test(imageUrl.slice(UPLOAD_URL_PREFIX.length))
  if (!isUpload) return { imageUrl: '', width: 0, height: 0, alt: '' }
  return {
    imageUrl,
    width: toDimension(raw?.width),
    height: toDimension(raw?.height),
    alt: cleanText(raw?.alt, MAX_ALT_CHARS)
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

  // Absent (or a non-string) stays null so it can resolve to the default at render time.
  // Only an actual string — including '' — counts as an admin decision.
  const taglineText =
    typeof raw?.tagline?.text === 'string'
      ? cleanText(raw.tagline.text, MAX_TAGLINE_CHARS)
      : null

  return {
    tagline: { text: taglineText },
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
    theme: normalizeTheme(raw?.theme),
    embed: normalizeEmbed(raw?.embed),
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
 * Every uploaded file the config refers to, found by walking the whole normalised object
 * for /api/banner-image/ URLs.
 *
 * Structural rather than a field-by-field list, so a new image-bearing field is covered
 * by construction. The previous version walked banners.ads only, which meant any other
 * feature storing an upload would have had its file silently deleted by the next
 * unrelated banner save — and made the GC's implementation an unwritten constraint on
 * the data model.
 */
export function collectReferencedUploads(value, found = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith(UPLOAD_URL_PREFIX)) {
      const name = value.slice(UPLOAD_URL_PREFIX.length)
      if (UPLOAD_FILENAME.test(name)) found.add(name)
    }
    return found
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectReferencedUploads(entry, found)
    return found
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectReferencedUploads(entry, found)
  }
  return found
}

/**
 * Removes uploaded files no longer referenced by the saved config, so replacing a
 * banner repeatedly can't grow the data dir without bound.
 */
export async function pruneOrphanUploads(banners) {
  const dir = path.resolve(process.cwd(), UPLOAD_DIR)
  const referenced = collectReferencedUploads(banners)
  const cutoff = Date.now() - UPLOAD_GRACE_MS
  try {
    const entries = await fs.readdir(dir)
    await Promise.all(
      entries
        .filter((name) => UPLOAD_FILENAME.test(name) && !referenced.has(name))
        .map(async (name) => {
          const filePath = path.join(dir, name)
          try {
            const stat = await fs.stat(filePath)
            if (stat.mtimeMs > cutoff) return
            await fs.unlink(filePath)
          } catch {
            // Raced with another delete, or vanished. Either way there is nothing to do.
          }
        })
    )
  } catch {
    // Directory may not exist yet.
  }
}
