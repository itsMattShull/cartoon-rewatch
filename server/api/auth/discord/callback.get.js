import { defineEventHandler, getQuery, getCookie, setCookie, sendRedirect, createError } from 'h3'
import { getSessionCookieName, isAllowedUser, signSession } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const clientId = process.env.DISCORD_CLIENT_ID
  const clientSecret = process.env.DISCORD_CLIENT_SECRET
  const redirectUri = process.env.DISCORD_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    throw createError({ statusCode: 500, statusMessage: 'Missing Discord OAuth environment variables' })
  }

  const query = getQuery(event)
  const code = query.code
  const state = query.state
  const cookieState = getCookie(event, 'discord_oauth_state')
  if (!code || !state || !cookieState || state !== cookieState) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid OAuth state' })
  }

  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code: String(code),
    redirect_uri: redirectUri
  })

  const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString()
  })

  if (!tokenResponse.ok) {
    throw createError({ statusCode: 400, statusMessage: 'Discord token exchange failed' })
  }

  const tokenData = await tokenResponse.json()
  const accessToken = tokenData.access_token
  if (!accessToken) {
    throw createError({ statusCode: 400, statusMessage: 'Missing Discord access token' })
  }

  const userResponse = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  if (!userResponse.ok) {
    throw createError({ statusCode: 400, statusMessage: 'Failed to fetch Discord user' })
  }

  const user = await userResponse.json()
  const scopeCookie = getCookie(event, 'discord_oauth_scope')
  const isChatScope = scopeCookie === 'chat'
  if (!isChatScope && !isAllowedUser(user.id)) {
    throw createError({ statusCode: 403, statusMessage: 'Not authorized' })
  }

  const discriminator = user.discriminator && user.discriminator !== '0' ? `#${user.discriminator}` : ''
  const username = user.username ? `${user.username}${discriminator}` : user.id
  const sessionToken = signSession({ id: user.id, username })
  setCookie(event, getSessionCookieName(), sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7
  })

  const redirectCookie = getCookie(event, 'discord_oauth_redirect')
  const safeRedirect = redirectCookie && redirectCookie.startsWith('/') ? redirectCookie : '/admin'

  setCookie(event, 'discord_oauth_state', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0
  })

  setCookie(event, 'discord_oauth_redirect', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0
  })

  setCookie(event, 'discord_oauth_scope', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0
  })

  return sendRedirect(event, safeRedirect)
})
