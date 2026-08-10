// Shared URL sanitisers used by BOTH the server (on write) and the front page (on render).
//
// Vue escapes `{{ }}` interpolation, but it does NOT sanitise bound attributes, so
// `<a :href="adminSuppliedValue">` happily executes `javascript:...`. Every banner link and
// image URL therefore passes through here at render time as well as at write time — the
// stored JSON is not the only route into the DOM (hand edits, restores, schema changes).
//
// Keep banner text in `{{ }}` / :alt. Never render it with v-html.

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/
const PRIVATE_HOST_172 = /^172\.(1[6-9]|2\d|3[01])\./

function parse(input) {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    // `new URL` normalises the control-character and whitespace tricks
    // (`java\tscript:`) that a hand-rolled blocklist misses.
    return new URL(trimmed)
  } catch {
    return null
  }
}

// Site-relative paths are allowed for links, but never protocol-relative (`//evil.com`)
// or backslash variants, which browsers treat as absolute.
function isSafeRelative(value) {
  return /^\/(?!\/)/.test(value) && !value.includes('\\')
}

/**
 * Returns a safe href, or '' if the value can't be trusted.
 * Allows absolute http(s) URLs and site-relative paths.
 */
export function safeLinkUrl(input) {
  if (typeof input !== 'string') return ''
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (isSafeRelative(trimmed)) return trimmed
  const url = parse(trimmed)
  if (!url) return ''
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
  return url.href
}

/**
 * Returns a safe image src, or '' if the value can't be trusted.
 * Accepts our own upload/static paths, plus https-only external URLs
 * (http would be blocked as mixed content anyway).
 */
export function safeImageUrl(input) {
  if (typeof input !== 'string') return ''
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (isSafeRelative(trimmed)) return trimmed
  const url = parse(trimmed)
  if (!url) return ''
  if (url.protocol !== 'https:') return ''
  // Nothing fetches these server-side today, so this only stops visitors' browsers being
  // used to probe a LAN. If a server-side fetch is ever added, string checks are NOT
  // enough — that needs DNS-resolution-time validation and redirect blocking.
  const host = url.hostname
  if (PRIVATE_HOST.test(host) || PRIVATE_HOST_172.test(host)) return ''
  return url.href
}
