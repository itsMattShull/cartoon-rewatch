import { defineEventHandler } from 'h3'
import { getSessionFromEvent, isAllowedUser } from '../../utils/auth'

export default defineEventHandler((event) => {
  const session = getSessionFromEvent(event)
  if (!session) {
    return { authenticated: false, allowed: false }
  }
  const allowed = isAllowedUser(session.id)
  return {
    authenticated: true,
    allowed,
    user: { id: session.id, username: session.username }
  }
})
