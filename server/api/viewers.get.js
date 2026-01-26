import { defineWebSocketHandler } from 'h3'
import { recordChannelView, recordVisit } from '../utils/analytics'
import { normalizeChannelSlug } from '../utils/channels'

const globalState = globalThis.__crt80_viewers || {
  peers: new Map(),
  sockets: new Set()
}
globalThis.__crt80_viewers = globalState

const peers = globalState.peers
const sockets = globalState.sockets

function normalizeViewerId(value, fallback) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return fallback || null
}

function updatePeer(peer, viewerId, channel, hasHello = false) {
  peers.set(peer.id, { viewerId, channel, hasHello })
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

export default defineWebSocketHandler({
  open(peer) {
    sockets.add(peer)
    updatePeer(peer, peer.id, null, false)
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
    if (type !== 'hello' && type !== 'channel') return

    const viewerId = normalizeViewerId(payload.viewerId, peer.id)
    const channel = normalizeChannelSlug(payload.channel)
    const existing = peers.get(peer.id)
    const previousChannel = existing?.channel
    const hasHello = existing?.hasHello === true

    updatePeer(peer, viewerId, channel || null, hasHello || type === 'hello')

    if (type === 'hello' && !hasHello) {
      recordVisit({ viewerId, channelSlug: channel }).catch((error) => {
        console.error('Analytics visit update failed', error)
      })
    } else if (type === 'channel' && channel && channel !== previousChannel) {
      recordChannelView({ viewerId, channelSlug: channel }).catch((error) => {
        console.error('Analytics channel update failed', error)
      })
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
