import { defineEventHandler, getQuery, getCookie, setCookie, sendRedirect, createError } from 'h3'
import { getSessionCookieName, isAllowedUser, signSession } from '../../../utils/auth'

function clearCookie(event, name) {
  setCookie(event, name, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0
  })
}

export default defineEventHandler(async (event) => {
  const clientId = process.env.DISCORD_CLIENT_ID
  const clientSecret = process.env.DISCORD_CLIENT_SECRET
  const redirectUri = process.env.DISCORD_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    throw createError({ statusCode: 500, statusMessage: 'Missing Discord OAuth environment variables' })
  }

  const { code, state } = getQuery(event)
  const cookieState = getCookie(event, 'discord_state')
  const isChatScope = getCookie(event, 'discord_scope') === 'chat'
  const savedRedirect = getCookie(event, 'discord_redirect')

  // Clear OAuth cookies — they've served their purpose
  clearCookie(event, 'discord_state')
  clearCookie(event, 'discord_scope')
  clearCookie(event, 'discord_redirect')

  if (!code || !state || !cookieState || String(state) !== cookieState) {
    // State mismatch or missing params — send back to login for a fresh attempt
    return sendRedirect(event, '/api/auth/discord/login')
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
    throw createError({ statusCode: 400, statusMessage: 'Discord token exchange failed' })
  }

  const { access_token } = await tokenRes.json()
  if (!access_token) {
    throw createError({ statusCode: 400, statusMessage: 'No access token returned by Discord' })
  }

  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${access_token}` }
  })

  if (!userRes.ok) {
    throw createError({ statusCode: 400, statusMessage: 'Failed to fetch Discord user info' })
  }

  const user = await userRes.json()

  if (!isChatScope && !isAllowedUser(user.id)) {
    throw createError({ statusCode: 403, statusMessage: 'Not authorized' })
  }

  const discriminator = user.discriminator && user.discriminator !== '0' ? `#${user.discriminator}` : ''
  const username = user.username ? `${user.username}${discriminator}` : user.id

  setCookie(event, getSessionCookieName(), signSession({ id: user.id, username }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7
  })

  const destination = savedRedirect && savedRedirect.startsWith('/') ? savedRedirect : '/admin'
  return sendRedirect(event, destination)
})
