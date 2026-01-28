export function broadcastToViewers(payload) {
  const state = globalThis.__crt80_viewers
  if (!state?.sockets || typeof payload !== 'object') return 0
  const message = JSON.stringify(payload)
  let sent = 0
  for (const socket of state.sockets) {
    if (socket?.send) {
      socket.send(message)
      sent += 1
    }
  }
  return sent
}
