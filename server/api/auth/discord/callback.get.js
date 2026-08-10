import { defineEventHandler, getQuery, getCookie, setCookie, sendRedirect, createError } from 'h3'
import {
  MAX_OAUTH_RETRIES,
  getSessionCookieName,
  isAllowedUser,
  safeRedirectPath,
  signSession,
  verifyOAuthState
} from '../../../utils/auth'

function clearCookie(event, name) {
  setCookie(event, name, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0
  })
}

function withError(path, code) {
  const base = safeRedirectPath(path, '/')
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}authError=${encodeURIComponent(code)}`
}

export default defineEventHandler(async (event) => {
  const clientId = process.env.DISCORD_CLIENT_ID
  const clientSecret = process.env.DISCORD_CLIENT_SECRET
  const redirectUri = process.env.DISCORD_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    throw createError({ statusCode: 500, statusMessage: 'Missing Discord OAuth environment variables' })
  }

  const { code, state } = getQuery(event)
  const cookieNonce = getCookie(event, 'discord_state')
  const cookieScope = getCookie(event, 'discord_scope')
  const cookieRedirect = getCookie(event, 'discord_redirect')

  // Clear OAuth cookies — they've served their purpose
  clearCookie(event, 'discord_state')
  clearCookie(event, 'discord_scope')
  clearCookie(event, 'discord_redirect')

  const verifiedState = verifyOAuthState(typeof state === 'string' ? state : '')

  // Prefer the signed state, fall back to the cookies (which is all a login started
  // before this deploy will have).
  const intendedScope = verifiedState ? verifiedState.scope : cookieScope === 'chat' ? 'chat' : 'admin'
  const intendedRedirect = safeRedirectPath(
    verifiedState ? verifiedState.redirect : cookieRedirect,
    intendedScope === 'chat' ? '/' : '/admin'
  )

  const nonceMatches = Boolean(cookieNonce && verifiedState && verifiedState.nonce === cookieNonce)

  if (!code || !nonceMatches) {
    // The state cookie is the ONLY thing binding this callback to the browser that
    // started the flow. Without it we cannot tell a lost cookie from an attacker feeding
    // a victim a code minted against the attacker's own Discord account — so never
    // exchange the code here. Restart the flow instead, carrying the original intent so
    // a chat login stays a chat login rather than degrading into an admin login and
    // 403-ing a perfectly ordinary user.
    const attempt = verifiedState?.attempt ?? 0
    if (attempt >= MAX_OAUTH_RETRIES) {
      // Retrying again would loop forever for a browser that never returns the cookie
      // (an apex/www mismatch against DISCORD_REDIRECT_URI does exactly that).
      return sendRedirect(event, withError(intendedRedirect, 'session'))
    }
    const params = new URLSearchParams({ attempt: '1' })
    if (intendedScope === 'chat') params.set('scope', 'chat')
    if (intendedRedirect) params.set('redirect', intendedRedirect)
    return sendRedirect(event, `/api/auth/discord/login?${params.toString()}`)
  }

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: redirectUri
    }).toString()
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    console.error('[discord callback] token exchange failed:', tokenRes.status, body)
    return sendRedirect(event, withError(intendedRedirect, 'discord'))
  }

  const { access_token } = await tokenRes.json()
  if (!access_token) {
    return sendRedirect(event, withError(intendedRedirect, 'discord'))
  }

  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${access_token}` }
  })

  if (!userRes.ok) {
    return sendRedirect(event, withError(intendedRedirect, 'discord'))
  }

  const user = await userRes.json()

  const isChatScope = intendedScope === 'chat'
  if (!isChatScope && !isAllowedUser(user.id)) {
    // Must return BEFORE any session cookie is set — this is the login-time allow-list
    // gate. Redirect rather than throw so the user gets readable copy instead of a raw
    // 403 error page.
    return sendRedirect(event, withError('/', 'notAllowed'))
  }

  const discriminator = user.discriminator && user.discriminator !== '0' ? `#${user.discriminator}` : ''
  const username = user.username ? `${user.username}${discriminator}` : user.id

  setCookie(
    event,
    getSessionCookieName(),
    signSession({ id: user.id, username }, 60 * 60 * 24 * 7, isChatScope ? 'chat' : 'admin'),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 7
    }
  )

  return sendRedirect(event, intendedRedirect)
})
