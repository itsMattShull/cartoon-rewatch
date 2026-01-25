import { defineEventHandler, sendRedirect, setCookie } from 'h3'
import { getSessionCookieName } from '../../utils/auth'

export default defineEventHandler((event) => {
  setCookie(event, getSessionCookieName(), '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0
  })

  return sendRedirect(event, '/channel-maker')
})
