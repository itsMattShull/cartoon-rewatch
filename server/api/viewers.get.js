import { defineWebSocketHandler } from 'h3'
import { recordChannelView, recordVisit } from '../utils/analytics'
import { getChannels, normalizeChannelSlug } from '../utils/channels'
import { getSessionCookieName, verifySession } from '../utils/auth'
import { censorChatText } from '../utils/profanity'

const globalState = globalThis.__crt80_viewers || {
  peers: new Map(),
  sockets: new Set()
}
globalThis.__crt80_viewers = globalState

const peers = globalState.peers
const sockets = globalState.sockets
const visitDedup = globalState.visitDedup || new Map()
globalState.visitDedup = visitDedup
const joinAnnouncements = globalState.joinAnnouncements || new Map()
globalState.joinAnnouncements = joinAnnouncements
const joinCleanupState = globalState.joinCleanupState || { last: 0 }
globalState.joinCleanupState = joinCleanupState

const MAX_CHAT_LENGTH = 400
// Token bucket per connection. Every message can trigger an analytics read-modify-write
// of the whole JSON store, serialised on one queue, so an unthrottled socket is a
// single-client denial of service.
const RATE_BURST = 20
const RATE_REFILL_PER_SEC = 5
const KNOWN_CHANNEL_TTL_MS = 30 * 1000

const knownChannelState = globalState.knownChannels || { slugs: new Set(), fetchedAt: 0, loading: null }
globalState.knownChannels = knownChannelState

/**
 * Channel slugs are attacker-controlled and land in analytics as object keys, so an
 * unknown slug is both a poisoned report and unbounded growth in the store. Cached
 * because this runs on the message path.
 */
function refreshKnownChannels() {
  const now = Date.now()
  if (now - knownChannelState.fetchedAt < KNOWN_CHANNEL_TTL_MS || knownChannelState.loading) return
  knownChannelState.loading = getChannels({ includeDefaults: true })
    .then(({ channels }) => {
      knownChannelState.slugs = new Set(channels.map((channel) => channel.slug))
      knownChannelState.fetchedAt = Date.now()
    })
    .catch(() => {})
    .finally(() => {
      knownChannelState.loading = null
    })
}

function isKnownChannel(slug) {
  if (!slug) return false
  refreshKnownChannels()
  // Before the first load resolves, accept nothing rather than everything.
  return knownChannelState.slugs.has(slug)
}

function takeToken(peer) {
  const state = peers.get(peer.id)
  if (!state) return true
  const now = Date.now()
  const elapsed = (now - (state.rateCheckedAt || now)) / 1000
  const tokens = Math.min(RATE_BURST, (state.rateTokens ?? RATE_BURST) + elapsed * RATE_REFILL_PER_SEC)
  if (tokens < 1) {
    state.rateTokens = tokens
    state.rateCheckedAt = now
    return false
  }
  state.rateTokens = tokens - 1
  state.rateCheckedAt = now
  return true
}
const JOIN_ANNOUNCE_COOLDOWN_MS = 60 * 60 * 1000
const VISIT_DEDUP_TTL_MS = 2 * 24 * 60 * 60 * 1000
const ANALYTICS_TIME_ZONE = 'America/Chicago'

function getCookieHeader(peer) {
  const headers = peer?.request?.headers
  if (!headers) return ''
  if (typeof headers.get === 'function') {
    return headers.get('cookie') || ''
  }
  if (typeof headers.cookie === 'string') return headers.cookie
  return ''
}

function parseCookies(header) {
  if (!header) return {}
  return header.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=')
    if (!key) return acc
    acc[key] = decodeURIComponent(rest.join('='))
    return acc
  }, {})
}

function getSessionFromPeer(peer) {
  try {
    const header = getCookieHeader(peer)
    const cookies = parseCookies(header)
    const token = cookies[getSessionCookieName()]
    return verifySession(token)
  } catch (error) {
    return null
  }
}

function getHeaderValue(peer, name) {
  const headers = peer?.request?.headers
  if (!headers) return ''
  if (typeof headers.get === 'function') return headers.get(name) || ''
  const direct = headers[name] ?? headers[name.toLowerCase()]
  return typeof direct === 'string' ? direct : ''
}

/**
 * The WebSocket handshake is the one state-changing surface that never ran an origin
 * check. SameSite=Lax blocks the pure cross-site case in current browsers, but it is
 * scoped to the site, not the origin — so any sibling subdomain could open a socket
 * carrying a visitor's cookie and post chat messages as them.
 */
function isSameOriginPeer(peer) {
  const origin = getHeaderValue(peer, 'origin')
  if (!origin) return false
  const host = getHeaderValue(peer, 'host')
  try {
    return new URL(origin).host === host
  } catch (error) {
    return false
  }
}

function normalizeViewerId(value, fallback) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return fallback || null
}

function updatePeer(
  peer,
  viewerId,
  channel,
  hasHello = false,
  username = null,
  userId = null,
  sessionId = null
) {
  peers.set(peer.id, { viewerId, channel, hasHello, username, userId, sessionId })
}

function buildCounts() {
  const totalSet = new Set()
  const channelSets = new Map()

  for (const entry of peers.values()) {
    const viewerId = entry?.viewerId
    if (!viewerId) continue
    totalSet.add(viewerId)
    if (entry?.channel) {
      if (!channelSets.has(entry.channel)) {
        channelSets.set(entry.channel, new Set())
      }
      channelSets.get(entry.channel).add(viewerId)
    }
  }

  const channels = {}
  for (const [slug, set] of channelSets.entries()) {
    channels[slug] = set.size
  }

  return {
    total: totalSet.size,
    channels
  }
}

function broadcastCounts(peer) {
  const payload = JSON.stringify({ type: 'counts', ...buildCounts() })
  if (sockets.size) {
    for (const target of sockets) {
      if (target?.send) {
        target.send(payload)
      }
    }
    return
  }
  if (peer?.send) {
    peer.send(payload)
  }
}

function broadcastChat(channel, payload) {
  if (!channel) return
  const message = JSON.stringify(payload)
  for (const socket of sockets) {
    const state = peers.get(socket.id)
    if (state?.channel !== channel) continue
    socket.send(message)
  }
}

function shouldBroadcastJoin(viewerId, channel) {
  if (!viewerId || !channel) return false
  const key = `${viewerId}:${channel}`
  const now = Date.now()
  cleanupJoinAnnouncements(now)
  const last = joinAnnouncements.get(key) || 0
  if (now - last < JOIN_ANNOUNCE_COOLDOWN_MS) {
    return false
  }
  joinAnnouncements.set(key, now)
  return true
}

function normalizeChatText(input) {
  if (typeof input !== 'string') return ''
  return input.trim().slice(0, MAX_CHAT_LENGTH)
}

function getDateKeyInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const values = {}
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value
  }
  return `${values.year}-${values.month}-${values.day}`
}

function cleanupVisitDedup(now) {
  for (const [key, timestamp] of visitDedup.entries()) {
    if (now - timestamp > VISIT_DEDUP_TTL_MS) {
      visitDedup.delete(key)
    }
  }
}

function cleanupJoinAnnouncements(now) {
  if (now - joinCleanupState.last < JOIN_ANNOUNCE_COOLDOWN_MS) return
  joinCleanupState.last = now
  for (const [key, timestamp] of joinAnnouncements.entries()) {
    if (now - timestamp > JOIN_ANNOUNCE_COOLDOWN_MS) {
      joinAnnouncements.delete(key)
    }
  }
}

function shouldCountVisit(viewerId, sessionId, dateKey) {
  if (!viewerId || !sessionId || !dateKey) return false
  const key = `visit:${viewerId}:${sessionId}:${dateKey}`
  const now = Date.now()
  cleanupVisitDedup(now)
  if (visitDedup.has(key)) return false
  visitDedup.set(key, now)
  return true
}

function shouldCountChannelView(viewerId, sessionId, dateKey, channel) {
  if (!viewerId || !sessionId || !dateKey || !channel) return false
  const key = `channel:${viewerId}:${sessionId}:${channel}:${dateKey}`
  const now = Date.now()
  cleanupVisitDedup(now)
  if (visitDedup.has(key)) return false
  visitDedup.set(key, now)
  return true
}

export default defineWebSocketHandler({
  open(peer) {
    try {
      if (!isSameOriginPeer(peer)) {
        peer.close(1008, 'Cross-origin connection rejected')
        return
      }
      sockets.add(peer)
      const session = getSessionFromPeer(peer)
      updatePeer(peer, peer.id, null, false, session?.username || null, session?.id || null, null)
      broadcastCounts(peer)
      peer.send(JSON.stringify({ type: 'ack', event: 'open' }))
    } catch (error) {
      // A throw here takes down chat and viewer counts for the connection.
      console.error('Viewer socket open failed', error)
    }
  },
  async message(peer, message) {
    let payload = null
    let rawText = ''
    try {
      rawText = message.text()
      payload = JSON.parse(rawText)
    } catch (error) {
      payload = null
    }
    if (!payload || typeof payload !== 'object') return

    const type = payload.type
    if (type !== 'hello' && type !== 'channel' && type !== 'chat') return

    if (!takeToken(peer)) return

    const viewerId = normalizeViewerId(payload.viewerId, peer.id)
    const requestedChannel = normalizeChannelSlug(payload.channel)
    const channel = isKnownChannel(requestedChannel) ? requestedChannel : ''
    const existing = peers.get(peer.id)
    const previousChannel = existing?.channel
    const hasHello = existing?.hasHello === true
    const username = existing?.username || null
    const userId = existing?.userId || null
    const sessionId =
      typeof payload.sessionId === 'string' && payload.sessionId.trim()
        ? payload.sessionId.trim()
        : existing?.sessionId || null

    updatePeer(peer, viewerId, channel || null, hasHello || type === 'hello', username, userId, sessionId)

    if (type === 'hello' && !hasHello) {
      const dateKey = getDateKeyInZone(new Date(), ANALYTICS_TIME_ZONE)
      if (shouldCountVisit(viewerId, sessionId, dateKey)) {
        recordVisit({ viewerId, channelSlug: channel }).catch((error) => {
          console.error('Analytics visit update failed', error)
        })
      }
    } else if (type === 'channel' && channel && channel !== previousChannel) {
      const dateKey = getDateKeyInZone(new Date(), ANALYTICS_TIME_ZONE)
      if (shouldCountChannelView(viewerId, sessionId, dateKey, channel)) {
        recordChannelView({ viewerId, channelSlug: channel }).catch((error) => {
          console.error('Analytics channel update failed', error)
        })
      }
    }

    if (type === 'chat') {
      const text = censorChatText(normalizeChatText(payload.text))
      if (!text) return
      if (!channel) {
        peer.send(JSON.stringify({ type: 'chat_error', message: 'Pick a channel before chatting.' }))
        return
      }
      // Re-read the handshake cookie rather than trusting the name captured at open():
      // an expired or cleared session must stop being able to post immediately.
      const liveSession = getSessionFromPeer(peer)
      const liveUsername = liveSession?.username || null
      if (!liveUsername) {
        peer.send(JSON.stringify({ type: 'chat_error', message: 'Sign in required to chat.' }))
        return
      }
      const safeUsername = censorChatText(liveUsername)
      broadcastChat(channel, {
        type: 'chat',
        channel,
        username: safeUsername,
        text,
        kind: 'user',
        at: Date.now()
      })
      return
    }

    if (channel && username) {
      const shouldAnnounceJoin =
        (type === 'hello' && !hasHello) || (type === 'channel' && channel !== previousChannel)
      if (shouldAnnounceJoin && shouldBroadcastJoin(viewerId, channel)) {
        const safeUsername = censorChatText(username)
        broadcastChat(channel, {
          type: 'chat',
          channel,
          username: safeUsername,
          text: censorChatText(`${username} joined the chat`),
          kind: 'system',
          at: Date.now()
        })
      }
    }

    peer.send(
      JSON.stringify({
        type: 'ack',
        event: 'message',
        received: type,
        viewerId,
        channel
      })
    )
    broadcastCounts(peer)
  },
  close(peer) {
    sockets.delete(peer)
    peers.delete(peer.id)
    broadcastCounts(peer)
  }
})
