import crypto from 'node:crypto'
import { defineEventHandler, getQuery, sendRedirect, setCookie } from 'h3'
import { OAUTH_STATE_TTL_SECONDS, safeRedirectPath, signOAuthState } from '../../../utils/auth'

function oauthCookie(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge
  }
}

export default defineEventHandler((event) => {
  const clientId = process.env.DISCORD_CLIENT_ID
  const redirectUri = process.env.DISCORD_REDIRECT_URI
  if (!clientId || !redirectUri) {
    throw new Error('Missing DISCORD_CLIENT_ID or DISCORD_REDIRECT_URI environment variables')
  }

  const query = getQuery(event)

  const requestedRedirect = typeof query.redirect === 'string' ? query.redirect : ''
  const safeRedirect = safeRedirectPath(requestedRedirect, '')

  const requestedScope = typeof query.scope === 'string' ? query.scope : ''
  const safeScope = requestedScope === 'chat' ? 'chat' : 'admin'

  // Retry counter, carried through Discord in the signed state. Bounded so a browser
  // that never returns the cookie (see the callback) fails with a readable page instead
  // of bouncing through Discord forever.
  const attempt = Number(query.attempt) === 1 ? 1 : 0

  const nonce = crypto.randomBytes(16).toString('hex')

  // The scope and redirect now travel inside the signed state as well as the cookie.
  // Previously they lived ONLY in cookies, so any cookie loss silently downgraded a chat
  // login to an admin login — and a non-allow-listed user then hit a hard 403.
  const state = signOAuthState({ nonce, scope: safeScope, redirect: safeRedirect, attempt })

  setCookie(event, 'discord_state', nonce, oauthCookie(OAUTH_STATE_TTL_SECONDS))
  // A literal 'admin' rather than '': some proxies drop empty-valued cookies, which used
  // to be indistinguishable from "not a chat login".
  setCookie(event, 'discord_scope', safeScope, oauthCookie(OAUTH_STATE_TTL_SECONDS))
  setCookie(event, 'discord_redirect', safeRedirect, oauthCookie(OAUTH_STATE_TTL_SECONDS))

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state
  })

  return sendRedirect(event, `https://discord.com/oauth2/authorize?${params.toString()}`)
})
