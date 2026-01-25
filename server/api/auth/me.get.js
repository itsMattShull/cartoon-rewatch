import { defineEventHandler } from 'h3'
import { getSessionFromEvent } from '../../utils/auth'

export default defineEventHandler((event) => {
  const session = getSessionFromEvent(event)
  if (!session) {
    return { authenticated: false }
  }
  return {
    authenticated: true,
    user: { id: session.id }
  }
})
