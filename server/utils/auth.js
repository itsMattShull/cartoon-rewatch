import crypto from 'node:crypto'
import { createError, getCookie, getHeader, getRequestHost } from 'h3'

const SESSION_COOKIE = 'crt80_session'

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

export function verifySession(token) {
  const secret = process.env.SESSION_SECRET
  if (!secret || !token) return null
  const [payloadB64, signature] = token.split('.')
  if (!payloadB64 || !signature) return null
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url')
  if (signature.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  const payload = JSON.parse(base64UrlDecode(payloadB64))
  if (!payload?.id || !payload?.exp) return null
  if (payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
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
 * Only site-relative paths are safe redirect targets. `//evil.com` and `/\evil.com`
 * both start with '/' but browsers resolve them as absolute URLs, which turns the
 * OAuth flow into an open redirect.
 */
export function safeRedirectPath(value, fallback = '/admin') {
  if (typeof value !== 'string') return fallback
  if (!/^\/(?!\/)/.test(value)) return fallback
  if (value.includes('\\')) return fallback
  return value
}
