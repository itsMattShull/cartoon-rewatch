import { defineEventHandler, getQuery, sendRedirect, setCookie } from 'h3'
import { getSessionCookieName } from '../../utils/auth'

// A fixed allow-list rather than safeRedirectPath: logout is a GET with no origin check,
// so any site can navigate a visitor to it. Accepting an arbitrary path here would turn
// that into a one-hop open redirect on this domain with no Discord round trip in the way.
const ALLOWED_REDIRECTS = new Set(['/', '/admin'])

export default defineEventHandler((event) => {
  setCookie(event, getSessionCookieName(), '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0
  })

  const requested = getQuery(event).redirect
  const destination =
    typeof requested === 'string' && ALLOWED_REDIRECTS.has(requested) ? requested : '/'

  // Previously redirected to /channel-maker, a route that does not exist — so signing
  // out always landed on a 404.
  return sendRedirect(event, destination)
})
