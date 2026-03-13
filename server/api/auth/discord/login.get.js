import crypto from 'node:crypto'
import { defineEventHandler, getQuery, getCookie, sendRedirect, setCookie } from 'h3'

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
  const existingEntries = (() => {
    try {
      const raw = getCookie(event, 'discord_oauth_state')
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })()

  // Bundle scope and redirect into the state entry so they travel with the state
  // through the OAuth flow and can't be lost or overwritten by concurrent logins.
  const stateEntry = { v: state }
  if (safeScope) stateEntry.scope = safeScope
  if (safeRedirect) stateEntry.redirect = safeRedirect

  // Keep at most the 5 most recent states to handle multiple concurrent login flows
  const entries = [...existingEntries, stateEntry].slice(-5)
  setCookie(event, 'discord_oauth_state', JSON.stringify(entries), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 10
  })

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state
  })

  return sendRedirect(event, `https://discord.com/oauth2/authorize?${params.toString()}`)
})
