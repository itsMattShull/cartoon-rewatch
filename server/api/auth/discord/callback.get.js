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
  const cookieStateRaw = getCookie(event, 'discord_oauth_state')

  // Parse state entries — new format is [{v, scope?, redirect?}, ...],
  // old format (plain strings) is handled for backwards compatibility with
  // any in-flight sessions that were started before this deploy.
  const cookieStateEntries = (() => {
    try {
      const parsed = cookieStateRaw ? JSON.parse(cookieStateRaw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })()

  function getEntryValue(entry) {
    return typeof entry === 'object' && entry !== null ? entry.v : String(entry)
  }

  const matchingEntry = state
    ? cookieStateEntries.find((e) => getEntryValue(e) === String(state))
    : null

  if (!code || !state || !matchingEntry) {
    // State mismatch: the cookie expired, was overwritten by a newer login attempt,
    // or the user navigated back and reused an old Discord redirect. Send them back
    // to login so they can start a fresh OAuth flow instead of showing a dead-end error.
    //
    // Look for scope/redirect hints in the remaining state entries so that a chat
    // user who hits a state mismatch still gets sent through the chat login path.
    const hintEntry = cookieStateEntries.find(
      (e) => typeof e === 'object' && e !== null && e.scope === 'chat'
    )
    const recoveryParams = new URLSearchParams({ error: 'state_mismatch' })
    if (hintEntry) {
      recoveryParams.set('scope', 'chat')
      if (hintEntry.redirect && hintEntry.redirect.startsWith('/')) {
        recoveryParams.set('redirect', hintEntry.redirect)
      }
    } else {
      // Backwards compatibility: fall back to separate cookies for old-format flows
      const recoveryScopeCookie = getCookie(event, 'discord_oauth_scope')
      const recoveryRedirectCookie = getCookie(event, 'discord_oauth_redirect')
      if (recoveryScopeCookie === 'chat') recoveryParams.set('scope', 'chat')
      if (recoveryRedirectCookie && recoveryRedirectCookie.startsWith('/')) {
        recoveryParams.set('redirect', recoveryRedirectCookie)
      }
    }
    return sendRedirect(event, `/api/auth/discord/login?${recoveryParams.toString()}`)
  }

  // Remove the consumed state so it can't be replayed
  const remainingEntries = cookieStateEntries.filter((e) => getEntryValue(e) !== String(state))

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

  // Read scope from the matched state entry (new format). Fall back to the
  // separate scope cookie for old-format flows started before this deploy.
  const entryScope =
    typeof matchingEntry === 'object' && matchingEntry !== null ? matchingEntry.scope : null
  const isChatScope =
    entryScope === 'chat' || getCookie(event, 'discord_oauth_scope') === 'chat'

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

  // Read redirect from matched state entry, fall back to legacy redirect cookie
  const entryRedirect =
    typeof matchingEntry === 'object' && matchingEntry !== null ? matchingEntry.redirect : null
  const legacyRedirectCookie = getCookie(event, 'discord_oauth_redirect')
  const safeRedirect =
    entryRedirect && entryRedirect.startsWith('/')
      ? entryRedirect
      : legacyRedirectCookie && legacyRedirectCookie.startsWith('/')
        ? legacyRedirectCookie
        : '/admin'

  if (remainingEntries.length > 0) {
    setCookie(event, 'discord_oauth_state', JSON.stringify(remainingEntries), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 10
    })
  } else {
    setCookie(event, 'discord_oauth_state', '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0
    })
  }

  // Clear legacy separate cookies (no-op if they don't exist)
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
