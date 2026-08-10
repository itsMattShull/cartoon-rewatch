import { defineEventHandler } from 'h3'
import { getSessionFromEvent, isAllowedUser } from '../../utils/auth'

export default defineEventHandler((event) => {
  const session = getSessionFromEvent(event)
  if (!session) {
    return { authenticated: false, allowed: false, scope: null }
  }
  const scope = session.scope === 'chat' ? 'chat' : 'admin'
  return {
    authenticated: true,
    // Mirrors requireAdmin(): a chat cookie can never authorise an admin write, so it
    // must not unlock the admin UI either. Reporting `allowed: true` for one showed the
    // full admin interface and then 403'd every save with no explanation.
    allowed: scope !== 'chat' && isAllowedUser(session.id),
    scope,
    user: { id: session.id, username: session.username }
  }
})
