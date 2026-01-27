import { defineWebSocketHandler } from 'h3'
import { recordChannelView, recordVisit } from '../utils/analytics'
import { normalizeChannelSlug } from '../utils/channels'
import { getSessionCookieName, verifySession } from '../utils/auth'

const globalState = globalThis.__crt80_viewers || {
  peers: new Map(),
  sockets: new Set()
}
globalThis.__crt80_viewers = globalState

const peers = globalState.peers
const sockets = globalState.sockets

const MAX_CHAT_LENGTH = 400

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
  const header = getCookieHeader(peer)
  const cookies = parseCookies(header)
  const token = cookies[getSessionCookieName()]
  return verifySession(token)
}

function normalizeViewerId(value, fallback) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return fallback || null
}

function updatePeer(peer, viewerId, channel, hasHello = false, username = null, userId = null) {
  peers.set(peer.id, { viewerId, channel, hasHello, username, userId })
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

function normalizeChatText(input) {
  if (typeof input !== 'string') return ''
  return input.trim().slice(0, MAX_CHAT_LENGTH)
}

export default defineWebSocketHandler({
  open(peer) {
    sockets.add(peer)
    const session = getSessionFromPeer(peer)
    updatePeer(peer, peer.id, null, false, session?.username || null, session?.id || null)
    broadcastCounts(peer)
    peer.send(JSON.stringify({ type: 'ack', event: 'open' }))
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

    const viewerId = normalizeViewerId(payload.viewerId, peer.id)
    const channel = normalizeChannelSlug(payload.channel)
    const existing = peers.get(peer.id)
    const previousChannel = existing?.channel
    const hasHello = existing?.hasHello === true
    const username = existing?.username || null
    const userId = existing?.userId || null

    updatePeer(peer, viewerId, channel || null, hasHello || type === 'hello', username, userId)

    if (type === 'hello' && !hasHello) {
      recordVisit({ viewerId, channelSlug: channel }).catch((error) => {
        console.error('Analytics visit update failed', error)
      })
    } else if (type === 'channel' && channel && channel !== previousChannel) {
      recordChannelView({ viewerId, channelSlug: channel }).catch((error) => {
        console.error('Analytics channel update failed', error)
      })
    }

    if (type === 'chat') {
      const text = normalizeChatText(payload.text)
      if (!text) return
      if (!username) {
        peer.send(JSON.stringify({ type: 'chat_error', message: 'Sign in required to chat.' }))
        return
      }
      broadcastChat(channel, {
        type: 'chat',
        channel,
        username,
        text,
        kind: 'user',
        at: Date.now()
      })
      return
    }

    if (channel && username) {
      const shouldAnnounceJoin =
        (type === 'hello' && !hasHello) || (type === 'channel' && channel !== previousChannel)
      if (shouldAnnounceJoin) {
        broadcastChat(channel, {
          type: 'chat',
          channel,
          username,
          text: `${username} joined the chat`,
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
