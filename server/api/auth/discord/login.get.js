import crypto from 'node:crypto'
import { defineEventHandler, getQuery, sendRedirect, setCookie } from 'h3'

export default defineEventHandler((event) => {
  const clientId = process.env.DISCORD_CLIENT_ID
  const redirectUri = process.env.DISCORD_REDIRECT_URI
  if (!clientId || !redirectUri) {
    throw new Error('Missing Discord OAuth environment variables')
  }

  const query = getQuery(event)
  const requestedRedirect = typeof query.redirect === 'string' ? query.redirect : ''
  const safeRedirect = requestedRedirect.startsWith('/') ? requestedRedirect : ''
  const requestedScope = typeof query.scope === 'string' ? query.scope : ''
  const safeScope = requestedScope === 'chat' ? requestedScope : ''

  const state = crypto.randomBytes(16).toString('hex')
  setCookie(event, 'discord_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 10
  })

  if (safeRedirect) {
    setCookie(event, 'discord_oauth_redirect', safeRedirect, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 10
    })
  }

  if (safeScope) {
    setCookie(event, 'discord_oauth_scope', safeScope, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 10
    })
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state
  })

  return sendRedirect(event, `https://discord.com/oauth2/authorize?${params.toString()}`)
})
