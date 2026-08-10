import crypto from 'node:crypto'
import { createError, getCookie, getHeader, getRequestHost } from 'h3'

const SESSION_COOKIE = 'crt80_session'
const BASE64URL = /^[A-Za-z0-9_-]+$/

export const OAUTH_STATE_TTL_SECONDS = 600
export const MAX_OAUTH_RETRIES = 1

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url')
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

export function getAllowedIds() {
  const raw = process.env.DISCORD_ALLOWED_IDS || ''
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

export function isAllowedUser(userId) {
  if (!userId) return false
  const allowed = getAllowedIds()
  return allowed.includes(String(userId))
}

export function signSession(user, ttlSeconds = 60 * 60 * 24 * 7, scope = 'admin') {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not set')
  const userId = typeof user === 'object' && user !== null ? user.id : user
  const username = typeof user === 'object' && user !== null ? user.username : null
  const payload = {
    id: String(userId),
    // Chat logins and admin logins issue the same cookie format, so the scope is recorded
    // in the signed payload. requireAdmin() demands scope === 'admin', which means a chat
    // cookie is structurally incapable of authorising an admin write even if the
    // allow-list is ever misconfigured.
    scope: scope === 'chat' ? 'chat' : 'admin',
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  }
  if (username) {
    payload.username = String(username)
  }
  const payloadB64 = base64UrlEncode(JSON.stringify(payload))
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url')
  return `${payloadB64}.${signature}`
}

/**
 * Returns the session payload, or null. Never throws.
 *
 * Two ways it used to throw on a malformed cookie, both reachable by anyone who can set
 * a cookie on the site (including from a sibling subdomain, since cookies are same-site
 * rather than same-origin):
 *
 *   - `signature.length !== expected.length` compares UTF-16 code units while
 *     timingSafeEqual compares bytes, so a 43-character signature containing one
 *     multi-byte character is 44 bytes and threw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH.
 *   - JSON.parse on a payload that is not valid JSON.
 *
 * Either one surfaced as a 500 on /api/auth/me — which the front page awaits during SSR —
 * and as an unguarded throw inside the WebSocket open handler, killing chat and viewer
 * counts for that connection.
 */
export function verifySession(token) {
  try {
    const secret = process.env.SESSION_SECRET
    if (!secret || typeof token !== 'string' || !token || token.length > 4096) return null
    const [payloadB64, signature] = token.split('.')
    if (!payloadB64 || !signature) return null
    // base64url charset only — this alone rules out the multi-byte length mismatch.
    if (!BASE64URL.test(payloadB64) || !BASE64URL.test(signature)) return null
    const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url')
    const actualBuf = Buffer.from(signature, 'utf8')
    const expectedBuf = Buffer.from(expected, 'utf8')
    if (actualBuf.length !== expectedBuf.length) return null
    if (!crypto.timingSafeEqual(actualBuf, expectedBuf)) return null
    const payload = JSON.parse(base64UrlDecode(payloadB64))
    // An OAuth state token is the same shape signed with a different key, so it can never
    // verify here — but reject the type explicitly too, so the two can never be confused
    // if the keys are ever unified by mistake.
    if (!payload?.id || payload.typ === 'state') return null
    if (!Number.isFinite(payload.exp)) return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

/**
 * Key for OAuth state tokens, derived from SESSION_SECRET but NOT equal to it.
 *
 * Session cookies and state tokens are both `base64url(json).hmac`. Signing them with
 * the same key would put two different token types in one namespace, and a state token
 * is handed to an anonymous caller in plaintext on every /login hit — so the only thing
 * standing between "copy the state out of a redirect" and "paste it in as a session
 * cookie" would be which fields each verifier happens to require. A separate key makes
 * cross-use impossible by construction rather than by coincidence.
 */
function getStateKey() {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not set')
  return Buffer.from(crypto.hkdfSync('sha256', secret, '', 'crt80-oauth-state-v1', 32))
}

export function signOAuthState({ nonce, scope, redirect, attempt = 0 }) {
  const payload = {
    typ: 'state',
    nonce: String(nonce),
    scope: scope === 'chat' ? 'chat' : 'admin',
    redirect: typeof redirect === 'string' ? redirect : '',
    attempt: Number.isInteger(attempt) ? attempt : 0,
    exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS
  }
  const payloadB64 = base64UrlEncode(JSON.stringify(payload))
  const signature = crypto
    .createHmac('sha256', getStateKey())
    .update(`oauthstate.v1|${payloadB64}`)
    .digest('base64url')
  return `${payloadB64}.${signature}`
}

/**
 * Verifies that WE minted this state and it has not expired.
 *
 * This proves origin, never identity: the signature says nothing about which browser the
 * state was issued to. That binding comes only from the discord_state cookie, which is
 * why a verified state is never sufficient to complete a login on its own.
 */
export function verifyOAuthState(token) {
  try {
    if (typeof token !== 'string' || !token || token.length > 2048) return null
    const [payloadB64, signature] = token.split('.')
    if (!payloadB64 || !signature) return null
    if (!BASE64URL.test(payloadB64) || !BASE64URL.test(signature)) return null
    const expected = crypto
      .createHmac('sha256', getStateKey())
      .update(`oauthstate.v1|${payloadB64}`)
      .digest('base64url')
    const actualBuf = Buffer.from(signature, 'utf8')
    const expectedBuf = Buffer.from(expected, 'utf8')
    if (actualBuf.length !== expectedBuf.length) return null
    if (!crypto.timingSafeEqual(actualBuf, expectedBuf)) return null
    const payload = JSON.parse(base64UrlDecode(payloadB64))
    if (payload?.typ !== 'state' || !payload.nonce) return null
    if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function getSessionFromEvent(event) {
  const token = getCookie(event, SESSION_COOKIE)
  return verifySession(token)
}

export function getSessionCookieName() {
  return SESSION_COOKIE
}

/**
 * The gate every admin write endpoint must use.
 *
 * getSessionFromEvent() only proves the cookie is validly signed — and chat logins
 * (`?scope=chat`) hand that same cookie to any Discord account on earth. Checking the
 * allow-list here is what actually restricts admin writes to approved users.
 */
export function requireAdmin(event) {
  const session = getSessionFromEvent(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  // Sessions signed before the scope claim existed have no `scope`; treat only an
  // explicit 'chat' as disqualifying so existing admin logins keep working.
  if (session.scope === 'chat' || !isAllowedUser(session.id)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  return session
}

/**
 * Proportionate CSRF defence for state-changing endpoints.
 *
 * The session cookie is SameSite=Lax, which already blocks cross-site POSTs, but that
 * leaves same-site-different-origin attackers and offers the endpoints no defence of
 * their own. Browsers send `Origin` on every cross-origin POST and on same-origin
 * fetch/$fetch, so comparing it to the request host blocks forged form posts while
 * leaving the admin UI untouched. Requiring the header to be present fails closed.
 */
export function assertSameOrigin(event) {
  const origin = getHeader(event, 'origin')
  if (!origin) {
    throw createError({ statusCode: 403, statusMessage: 'Missing Origin header' })
  }
  let originHost
  try {
    originHost = new URL(origin).host
  } catch {
    throw createError({ statusCode: 403, statusMessage: 'Invalid Origin header' })
  }
  if (originHost !== getRequestHost(event, { xForwardedHost: true })) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request rejected' })
  }
}

/**
 * Only site-relative paths are safe redirect targets.
 *
 * A prefix test is not enough. Browsers follow WHATWG URL parsing, which STRIPS raw tab,
 * LF and CR from a URL before parsing it — so `/\t//evil.com` passes a naive
 * "starts with / but not //" check and then resolves to `https://evil.com/`. Node emits
 * the tab verbatim in a Location header, so that was a working open redirect on a
 * legitimate-looking link.
 *
 * Parse it and let the URL parser be the authority instead of guessing at the syntax.
 */
export function safeRedirectPath(value, fallback = '/admin') {
  if (typeof value !== 'string' || value.length > 512) return fallback
  // Kills tab/LF/CR and every other control character, plus backslash.
  if (/[\u0000-\u001F\u007F\\]/.test(value)) return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  let parsed
  try {
    parsed = new URL(value, 'https://placeholder.invalid')
  } catch {
    return fallback
  }
  // If it resolved anywhere other than the placeholder origin, it was not site-relative.
  if (parsed.origin !== 'https://placeholder.invalid') return fallback
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}
