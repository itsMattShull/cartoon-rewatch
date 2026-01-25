import crypto from 'node:crypto'
import { getCookie } from 'h3'

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

export function signSession(userId, ttlSeconds = 60 * 60 * 24 * 7) {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not set')
  const payload = {
    id: String(userId),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
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
