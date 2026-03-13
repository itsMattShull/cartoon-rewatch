import crypto from 'node:crypto'
import { defineEventHandler, getQuery, sendRedirect, setCookie } from 'h3'

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
  const safeRedirect = requestedRedirect.startsWith('/') ? requestedRedirect : ''

  const requestedScope = typeof query.scope === 'string' ? query.scope : ''
  const safeScope = requestedScope === 'chat' ? 'chat' : ''

  const state = crypto.randomBytes(16).toString('hex')

  setCookie(event, 'discord_state', state, oauthCookie(600))
  setCookie(event, 'discord_scope', safeScope, oauthCookie(600))
  setCookie(event, 'discord_redirect', safeRedirect, oauthCookie(600))

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state
  })

  return sendRedirect(event, `https://discord.com/oauth2/authorize?${params.toString()}`)
})
