<template>
  <div class="page">
    <header class="title-bar">
      <div class="brand">
        <span class="brand-mark">Cartoon ReWatch</span>
        <span class="brand-sub">Grab cereal and enjoy.</span>
      </div>
      <div class="clock">
        <span class="clock-label">Local Time</span>
        <span class="clock-time">{{ formattedClock }}</span>
      </div>
    </header>

    <main class="tv-layout">
      <section class="tv-frame">
        <div class="bezel">
          <div class="screen">
          <div ref="screenInner" class="screen-inner" :class="{ off: !isOn }">
            <ClientOnly>
              <div id="yt-player" class="player"></div>
            </ClientOnly>
              <div class="scanlines"></div>
              <div class="vignette"></div>
              <div v-if="!isOn" class="screen-off">POWER OFF</div>
              <button
                v-if="needsUserAction && isOn"
                class="audio-overlay"
                type="button"
                @click="enableAudio"
              >
                Tap to enable audio
              </button>
            </div>
          </div>
          <div class="channel-banner">
            <span class="channel-number">CH {{ displayChannelNumber }}</span>
            <div class="channel-name">
              <!-- <a
                target="_blank"
                href="https://www.patreon.com/join/MattShull?redirect_uri=https%3A%2F%2Fwww.cartoonrewatch.com&utm_medium=widget"
                data-patreon-widget-type="become-patron-button"
              >
                Support projects like this
              </a> -->
            </div>
            <span class="channel-status" :class="{ off: !isOn }">
              {{ isOn ? 'LIVE' : 'OFFLINE' }}
            </span>
          </div>
        </div>
      </section>

      <aside class="controls">
        <a href="https://www.cartoonreorbit.com" target="_blank"><img class="ad-banner" src="/ad1.gif" alt="" loading="lazy" /></a>
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">
              <span>{{ hasLoadedChannel ? activeChannel?.name ?? 'TV Controls' : 'Loading...' }}</span>
              <div><div class="viewer-inline">Total Viewers: {{ totalViewers }}</div><div class="viewer-inline">Channel Viewers: {{ channelViewers }}</div></div>
            </div>
          </div>
          <div class="now-playing">
            <div class="now-title">Now Playing</div>
            <div class="now-name">{{ currentVideoTitle }}</div>
            <div class="now-time">
              {{ formattedOffset }} / {{ formattedDuration }}
            </div>
          </div>

          <div class="controls-row">
            <button class="dial" type="button" @click="prevChannel">CH -</button>
            <button class="dial" type="button" @click="nextChannel">CH +</button>
          </div>



          <div class="panel-tabs">
            <button
              class="tab-button"
              :class="{ active: activePanel === 'chat' }"
              type="button"
              @click="activePanel = 'chat'"
            >
              Chat
            </button>
            <button
              class="tab-button"
              :class="{ active: activePanel === 'guide' }"
              type="button"
              @click="activePanel = 'guide'"
            >
              Guide
            </button>
            <button
              class="tab-button"
              :class="{ active: activePanel === 'controls' }"
              type="button"
              @click="activePanel = 'controls'"
            >
              Controls
            </button>
          </div>

          <div v-if="activePanel === 'controls'" class="panel-section">
            <div class="controls-row">
              <button class="toggle" :class="{ active: isOn }" type="button" @click="togglePower">
                Power
              </button>
              <button class="toggle" type="button" @click="toggleMute">
                {{ isMuted ? 'Unmute' : 'Mute' }}
              </button>
            </div>

            <div class="volume-control">
              <div class="volume-header">
                <span class="volume-label">Volume</span>
                <span class="volume-value">{{ volumeDisplay }}</span>
              </div>
              <input
                class="volume-slider"
                type="range"
                min="0"
                :max="maxVolumePercent"
                step="1"
                v-model.number="volumePercent"
                :disabled="!playerReady || !isOn"
                @input="handleVolumeInput"
              />
              <div class="volume-scale">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>
          </div>

          <div v-else-if="activePanel === 'chat'" class="panel-section chat-panel">
            <div ref="chatLogRef" class="chat-log">
              <div
                v-for="message in currentChatMessages"
                :key="message.id"
                class="chat-message"
                :class="{ system: message.kind === 'system' }"
              >
                <span v-if="message.kind !== 'system'" class="chat-user">{{ message.username }}</span>
                <span class="chat-text">{{ message.text }}</span>
              </div>
            </div>

            <div v-if="!isChatAuthorized" class="chat-auth">
              <p>Sign in with Discord to chat.</p>
              <a class="secondary" href="/api/auth/discord/login?redirect=/&scope=chat">
                Sign in with Discord
              </a>
            </div>

            <form class="chat-input" @submit.prevent="sendChatMessage">
              <input
                v-model.trim="chatInput"
                type="text"
                placeholder="Type a message"
                :disabled="!isChatAuthorized"
              />
              <button class="secondary" type="submit" :disabled="!isChatAuthorized || !chatInput.trim()">
                Send
              </button>
            </form>
          </div>

          <div v-else class="panel-section">
            <div class="guide">
              <div class="guide-left">
                <div class="guide-left-header">Guide</div>
                <div v-for="row in guideRows" :key="row.name" class="guide-left-row">
                  {{ row.name }}
                </div>
              </div>
              <div class="guide-scroll">
                <div class="guide-header">
                  <div
                    v-for="(segment, index) in guideHeaderSegments"
                    :key="`${segment.label}-${index}`"
                    class="guide-hour"
                    :style="{
                      width: `${(segment.durationSeconds / 3600) * hourWidth}px`,
                      flex: `0 0 ${(segment.durationSeconds / 3600) * hourWidth}px`
                    }"
                  >
                    {{ segment.label }}
                  </div>
                </div>
                <div v-for="row in guideRows" :key="`${row.name}-blocks`" class="guide-row">
                  <div
                    v-for="(block, index) in row.blocks"
                    :key="`${row.name}-${index}`"
                    class="guide-block"
                    :style="{
                      width: `${(block.durationSeconds / 3600) * hourWidth}px`,
                      flex: `0 0 ${(block.durationSeconds / 3600) * hourWidth}px`
                    }"
                    :title="`${block.title} • ${formatLocalTimeFromGuide(block.startOffsetSeconds)} - ${formatLocalTimeFromGuide(block.startOffsetSeconds + block.durationSeconds)}`"
                  >
                    <span class="guide-title">{{ block.title }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </main>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import toonamiData from '../../assets/channels/toonami.json'
import adultSwimData from '../../assets/channels/adult-swim.json'
import saturdayMorningData from '../../assets/channels/saturday-morning.json'

const defaultChannelPayloads = {
  toonami: toonamiData,
  'adult-swim': adultSwimData,
  'saturday-morning': saturdayMorningData
}
const defaultChannelNames = {
  toonami: toonamiData?.channel || 'Toonami',
  'adult-swim': adultSwimData?.channel || 'Adult Swim',
  'saturday-morning': saturdayMorningData?.channel || 'Saturday Morning'
}

function buildPlaylist(payload, fallbackName, fallbackTitlePrefix = 'Video') {
  const payloadName = typeof payload?.channel === 'string' ? payload.channel.trim() : ''
  const fallback = typeof fallbackName === 'string' ? fallbackName.trim() : ''
  const name = fallback || payloadName || 'Channel'
  const videos = Array.isArray(payload?.videos) ? payload.videos : []
  const normalizedVideos = videos
    .filter((video) => video && typeof video.id === 'string' && video.id.trim().length > 0)
    .map((video, videoIndex) => {
      const duration = Number(video.durationSeconds)
      return {
        id: video.id.trim(),
        title: video.title || `${name} ${fallbackTitlePrefix} ${videoIndex + 1}`,
        durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0
      }
    })

  const totalDuration = normalizedVideos.reduce((sum, video) => sum + Math.max(0, video.durationSeconds), 0)

  return {
    name,
    videos: normalizedVideos,
    totalDuration
  }
}

function buildChannel(payload, fallbackName, index, slug, blockSlug) {
  const fallback = typeof fallbackName === 'string' ? fallbackName.trim() : ''
  const name = fallback || `Channel ${index + 1}`
  const playlist = buildPlaylist(payload, name, 'Video')
  return {
    slug,
    name: playlist.name,
    videos: playlist.videos,
    totalDuration: playlist.totalDuration,
    blockSlug: blockSlug || ''
  }
}

const channels = ref([])
const scheduleByChannel = ref({})
const blockPlaylists = ref({})

const activeChannelIndex = ref(0)
const isOn = ref(true)
const isMuted = ref(false)
const volumePercent = ref(100)
const maxVolumePercent = 100
const needsUserAction = ref(false)
const playerReady = ref(false)
const currentVideoId = ref('')
const now = ref(new Date())
const screenInner = ref(null)
const supportSlot = ref(null)
const hasLoadedChannel = ref(false)
const viewerCounts = ref({ total: 0, channels: {} })
const viewerId = ref(null)
const activePanel = ref('chat')
const { data: authData } = await useFetch('/api/auth/me')
const isChatAuthorized = computed(() => authData.value?.authenticated)
const chatUsername = computed(() => authData.value?.user?.username || '')
const chatMessagesByChannel = ref({})
const chatInput = ref('')
const chatLogRef = ref(null)
const pageSessionId = ref(null)

let player = null
let clockInterval = null
let syncInterval = null
let resizeObserver = null
let viewerSocket = null
let viewerReconnectDelay = 1000
let viewerReconnectTimer = null
let viewerShouldReconnect = true
let viewerHelloTimer = null
const pendingChannelSlug = ref('')
const storageKey = 'crt80:lastChannel'
const viewerStorageKey = 'crt80:viewerId'

const activeChannel = computed(() => channels.value[activeChannelIndex.value])
const activeChannelSlug = computed(() => activeChannel.value?.slug || '')
const totalViewers = computed(() => viewerCounts.value?.total || 0)
const channelViewers = computed(() => {
  const slug = activeChannelSlug.value
  if (!slug) return 0
  return viewerCounts.value?.channels?.[slug] || 0
})
const currentChatMessages = computed(() => {
  const slug = activeChannelSlug.value
  if (!slug) return []
  return getChannelMessages(slug)
})

const scheduleInfo = computed(() => {
  const channel = activeChannel.value
  if (!channel) return null
  if (channel.totalDuration <= 0) {
    return channel.videos.length
      ? { index: 0, video: channel.videos[0], offsetSeconds: 0 }
      : null
  }

  const entries = scheduleByChannel.value?.[channel.slug] || []
  const nowMs = now.value.getTime()
  let scheduledStartMs = null
  if (channel.blockSlug) {
    const latest = getLatestScheduleEntry(entries, nowMs)
    if (latest && latest.blockSlug === channel.blockSlug) {
      scheduledStartMs = latest.startMs
    }
  }

  const positionSeconds = Number.isFinite(scheduledStartMs)
    ? Math.max(0, Math.floor((nowMs - scheduledStartMs) / 1000))
    : getSecondsSinceWeekStartInZone(now.value, scheduleTimeZone)

  return getVideoAt(channel, positionSeconds)
})

const currentVideoTitle = computed(() => scheduleInfo.value?.video?.title || 'Add video IDs in JSON')
const formattedOffset = computed(() => formatTime(scheduleInfo.value?.offsetSeconds ?? 0))
const formattedDuration = computed(() =>
  formatTime(scheduleInfo.value?.video?.durationSeconds ?? 0)
)
const displayChannelNumber = computed(() => {
  if (!channels.value.length) return '--'
  return String(activeChannelIndex.value + 1).padStart(2, '0')
})
const formattedClock = computed(() => formatClock(now.value))
const volumeDisplay = computed(() => `${Math.round(volumePercent.value)}%`)
const guideHours = 6
const hourWidth = 500
const scheduleTimeZone = 'America/Chicago'
const guideStart = computed(() => getZoneMinuteStart(now.value, scheduleTimeZone))

const requestUrl = useRequestURL()
const canonicalUrl = computed(() => requestUrl.origin + requestUrl.pathname)
const socialImageUrl = computed(() => `${requestUrl.origin}/logo.png`)
const socialImageWidth = 1204
const socialImageHeight = 623
const pageTitle = 'Cartoon ReWatch — Live Cartoon Channel Player'
const pageDescription =
  'Stream a nostalgic, always-on cartoon channel with classic blocks from Toonami, Adult Swim, Saturday Mornings, and more.'

useHead({
  title: pageTitle,
  htmlAttrs: { lang: 'en' },
  meta: [
    { name: 'description', content: pageDescription },
    { name: 'robots', content: 'index,follow' },
    { name: 'theme-color', content: '#1f2024' },
    { property: 'og:title', content: pageTitle },
    { property: 'og:description', content: pageDescription },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: canonicalUrl.value },
    { property: 'og:site_name', content: 'Cartoon ReWatch' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: pageTitle },
    { name: 'twitter:description', content: pageDescription },
    { property: 'og:image', content: socialImageUrl.value },
    { property: 'og:image:secure_url', content: socialImageUrl.value },
    { property: 'og:image:width', content: String(socialImageWidth) },
    { property: 'og:image:height', content: String(socialImageHeight) },
    { property: 'og:image:type', content: 'image/png' },
    { property: 'og:image:alt', content: 'Cartoon ReWatch logo' },
    { name: 'twitter:image', content: socialImageUrl.value },
    { name: 'twitter:image:alt', content: 'Cartoon ReWatch logo' }
  ],
  link: [{ rel: 'canonical', href: canonicalUrl.value }],
  script: [
    {
      type: 'application/ld+json',
      children: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Cartoon ReWatch',
        url: canonicalUrl.value,
        description: pageDescription
      })
    }
  ]
})
const guideHeaderSegments = computed(() => {
  const startSeconds = getSecondsSinceWeekStartInZone(guideStart.value, scheduleTimeZone)
  const minuteOfHour = Math.floor((startSeconds % 3600) / 60)
  const windowSeconds = guideHours * 3600
  const segments = []
  let remaining = windowSeconds
  let cursor = 0
  let firstSegment = minuteOfHour === 0 ? 3600 : (60 - minuteOfHour) * 60
  while (remaining > 0) {
    const segmentSeconds = Math.min(firstSegment, remaining)
    const stamp = new Date(guideStart.value.getTime() + cursor * 1000)
    segments.push({
      label: stamp.toLocaleTimeString([], { hour: 'numeric' }),
      durationSeconds: segmentSeconds,
      startOffsetSeconds: cursor
    })
    remaining -= segmentSeconds
    cursor += segmentSeconds
    firstSegment = 3600
  }
  return segments
})
const guideRows = computed(() => {
  const windowSeconds = guideHours * 3600
  const windowStart = guideStart.value
  return channels.value.map((channel) => ({
    name: channel.name,
    blocks: buildGuideBlocksForChannel(channel, windowStart, windowSeconds)
  }))
})

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date)

  const values = {}
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value
  }

  const asUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  )

  return asUTC - date.getTime()
}

function getSecondsSinceWeekStartInZone(date, timeZone) {
  const offset = getTimeZoneOffsetMs(date, timeZone)
  const zoned = new Date(date.getTime() + offset)
  const dayOfWeek = zoned.getUTCDay()
  return (
    dayOfWeek * 86400 +
    zoned.getUTCHours() * 3600 +
    zoned.getUTCMinutes() * 60 +
    zoned.getUTCSeconds()
  )
}

function getZoneMinuteStart(date, timeZone) {
  const offset = getTimeZoneOffsetMs(date, timeZone)
  const zoned = new Date(date.getTime() + offset)
  zoned.setUTCSeconds(0, 0)
  return new Date(zoned.getTime() - offset)
}

function formatClock(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatTime(seconds) {
  const clamped = Math.max(0, Math.floor(seconds))
  const mins = Math.floor(clamped / 60)
  const secs = clamped % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function normalizeScheduleEntries(entries) {
  if (!Array.isArray(entries)) return []
  const normalized = []
  for (const entry of entries) {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
    const blockSlug = typeof entry?.blockSlug === 'string' ? entry.blockSlug.trim() : ''
    const startTime = typeof entry?.startTime === 'string' ? entry.startTime : ''
    const startMs = Date.parse(startTime)
    if (!id || !blockSlug || !Number.isFinite(startMs)) continue
    normalized.push({ id, blockSlug, startTime, startMs })
  }
  normalized.sort((a, b) => a.startMs - b.startMs)
  return normalized
}

function getLatestScheduleEntry(entries, nowMs) {
  let current = null
  for (const entry of entries || []) {
    if (entry.startMs <= nowMs) current = entry
  }
  return current
}

function getNextScheduleEntry(entries, nowMs) {
  for (const entry of entries || []) {
    if (entry.startMs > nowMs) return entry
  }
  return null
}

function getPlaylistForBlock(slug) {
  if (!slug) return null
  const playlist = blockPlaylists.value?.[slug]
  if (!playlist || !Array.isArray(playlist.videos) || playlist.videos.length === 0) return null
  return playlist
}

function getVideoAt(playlist, positionSeconds) {
  if (!playlist || playlist.videos.length === 0) return null
  if (playlist.totalDuration <= 0) {
    return { index: 0, video: playlist.videos[0], offsetSeconds: 0 }
  }
  const position = positionSeconds % playlist.totalDuration
  let cursor = 0
  for (let index = 0; index < playlist.videos.length; index += 1) {
    const video = playlist.videos[index]
    const nextCursor = cursor + video.durationSeconds
    if (position < nextCursor) {
      return { index, video, offsetSeconds: position - cursor }
    }
    cursor = nextCursor
  }
  return { index: 0, video: playlist.videos[0], offsetSeconds: 0 }
}

function buildGuideBlocks(playlist, startSeconds, windowSeconds) {
  if (!playlist || playlist.videos.length === 0) return []
  if (playlist.totalDuration <= 0) {
    const video = playlist.videos[0]
    return [
      {
        title: video.title,
        durationSeconds: windowSeconds,
        startOffsetSeconds: 0
      }
    ]
  }
  const blocks = []
  let remaining = windowSeconds
  let info = getVideoAt(playlist, startSeconds)
  if (!info) return blocks

  let videoIndex = info.index
  let offsetInVideo = info.offsetSeconds
  let windowCursor = 0

  while (remaining > 0 && blocks.length < 200) {
    const video = playlist.videos[videoIndex]
    const remainingInVideo = Math.max(1, video.durationSeconds - offsetInVideo)
    const blockSeconds = Math.min(remainingInVideo, remaining)
    blocks.push({
      title: video.title,
      durationSeconds: blockSeconds,
      startOffsetSeconds: windowCursor
    })
    remaining -= blockSeconds
    windowCursor += blockSeconds
    offsetInVideo = 0
    videoIndex = (videoIndex + 1) % playlist.videos.length
  }

  return blocks
}

function buildGuideBlocksForChannel(channel, windowStart, windowSeconds) {
  if (!channel) return []
  const activeSlug = channel.blockSlug
  const activePlaylist = {
    videos: channel.videos || [],
    totalDuration: channel.totalDuration || 0
  }
  if (!activeSlug || activePlaylist.videos.length === 0) return []

  const entries = scheduleByChannel.value?.[channel.slug] || []
  const windowStartMs = windowStart.getTime()
  const windowEndMs = windowStartMs + windowSeconds * 1000
  const nextEntry = getNextScheduleEntry(entries, windowStartMs)

  const segments = []
  let cursorMs = windowStartMs
  let nextIndex = nextEntry ? entries.indexOf(nextEntry) : entries.length
  if (cursorMs < windowEndMs) {
    const segmentEndMs = nextEntry ? Math.min(nextEntry.startMs, windowEndMs) : windowEndMs
    if (segmentEndMs > cursorMs) {
      segments.push({
        startMs: cursorMs,
        endMs: segmentEndMs,
        blockSlug: activeSlug,
        scheduleStartMs: null
      })
    }
    cursorMs = segmentEndMs
  }

  for (let index = nextIndex; index < entries.length && cursorMs < windowEndMs; index += 1) {
    const entry = entries[index]
    if (!entry || entry.startMs < cursorMs) continue
    const nextStartMs = entries[index + 1]?.startMs ?? windowEndMs
    const segmentEndMs = Math.min(nextStartMs, windowEndMs)
    if (segmentEndMs <= entry.startMs) continue
    segments.push({
      startMs: entry.startMs,
      endMs: segmentEndMs,
      blockSlug: entry.blockSlug,
      scheduleStartMs: entry.startMs
    })
    cursorMs = segmentEndMs
  }

  const blocks = []
  let windowCursor = 0

  for (const segment of segments) {
    const segmentSeconds = Math.max(0, Math.floor((segment.endMs - segment.startMs) / 1000))
    if (!segmentSeconds) continue
    const playlist = segment.blockSlug === activeSlug
      ? activePlaylist
      : getPlaylistForBlock(segment.blockSlug)
    if (!playlist) {
      windowCursor += segmentSeconds
      continue
    }
    const startSeconds = segment.scheduleStartMs
      ? Math.max(0, Math.floor((segment.startMs - segment.scheduleStartMs) / 1000))
      : getSecondsSinceWeekStartInZone(new Date(segment.startMs), scheduleTimeZone)
    const segmentBlocks = buildGuideBlocks(playlist, startSeconds, segmentSeconds)
    for (const block of segmentBlocks) {
      blocks.push({
        ...block,
        startOffsetSeconds: block.startOffsetSeconds + windowCursor
      })
    }
    windowCursor += segmentSeconds
  }

  return blocks
}

function formatLocalTimeFromGuide(offsetSeconds) {
  const base = guideStart.value
  const stamp = new Date(base.getTime() + offsetSeconds * 1000)
  return stamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function createViewerId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function createPageSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function getOrCreateViewerId() {
  if (typeof window === 'undefined') return null
  let id = window.localStorage.getItem(viewerStorageKey)
  if (!id) {
    id = createViewerId()
    window.localStorage.setItem(viewerStorageKey, id)
  }
  return id
}

function getOrCreatePageSessionId() {
  if (typeof window === 'undefined') return null
  if (!window.__crt80_pageSessionId) {
    window.__crt80_pageSessionId = createPageSessionId()
  }
  return window.__crt80_pageSessionId
}

function getViewerSocketUrl() {
  if (typeof window === 'undefined') return ''
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/api/viewers`
}

function handleViewerMessage(event) {
  if (!event?.data) return
  let data = null
  try {
    data = JSON.parse(event.data)
  } catch (error) {
    data = null
  }
  if (!data || typeof data.type !== 'string') return
  if (data.type === 'counts') {
    const total = Number(data.total) || 0
    const channels = data.channels && typeof data.channels === 'object' ? data.channels : {}
    viewerCounts.value = { total, channels }
    return
  }
  if (data.type === 'chat') {
    addChatMessage(data)
  }
  if (data.type === 'chat_error') {
    addChatMessage({
      channel: activeChannelSlug.value,
      kind: 'system',
      username: 'System',
      text: data.message || 'Unable to send message.',
      at: Date.now()
    })
  }
  if (data.type === 'schedule_update' || data.type === 'active_update') {
    loadActiveBlocks({ syncPlayer: true })
    return
  }
}

function sendViewerMessage(type, payload) {
  if (!viewerSocket || viewerSocket.readyState !== WebSocket.OPEN) return
  viewerSocket.send(JSON.stringify({ type, ...payload }))
}

function scheduleViewerReconnect() {
  if (!viewerShouldReconnect || typeof window === 'undefined') return
  if (viewerReconnectTimer) return
  viewerReconnectTimer = window.setTimeout(() => {
    viewerReconnectTimer = null
    connectViewerSocket()
    viewerReconnectDelay = Math.min(viewerReconnectDelay * 1.6, 15000)
  }, viewerReconnectDelay)
}

function connectViewerSocket() {
  if (!viewerShouldReconnect || typeof window === 'undefined') return
  const url = getViewerSocketUrl()
  if (!url) return
  if (viewerSocket) {
    viewerSocket.close()
  }
  const socket = new WebSocket(url)
  viewerSocket = socket
  socket.addEventListener('open', () => {
    if (viewerSocket !== socket) return
    viewerReconnectDelay = 1000
    sendViewerMessage('hello', {
      viewerId: viewerId.value,
      channel: activeChannelSlug.value || null,
      sessionId: pageSessionId.value
    })
    if (viewerHelloTimer) {
      window.clearTimeout(viewerHelloTimer)
    }
    viewerHelloTimer = window.setTimeout(() => {
      sendViewerMessage('hello', {
        viewerId: viewerId.value,
        channel: activeChannelSlug.value || null,
        sessionId: pageSessionId.value
      })
    }, 800)
    if (pendingChannelSlug.value) {
      sendViewerMessage('channel', {
        viewerId: viewerId.value,
        channel: pendingChannelSlug.value,
        sessionId: pageSessionId.value
      })
      pendingChannelSlug.value = ''
    }
  })
  socket.addEventListener('message', (event) => {
    if (viewerSocket !== socket) return
    handleViewerMessage(event)
  })
  socket.addEventListener('close', () => {
    if (viewerSocket !== socket) return
    if (viewerHelloTimer) {
      window.clearTimeout(viewerHelloTimer)
      viewerHelloTimer = null
    }
    scheduleViewerReconnect()
  })
  socket.addEventListener('error', () => {
    if (viewerSocket !== socket) return
    if (viewerHelloTimer) {
      window.clearTimeout(viewerHelloTimer)
      viewerHelloTimer = null
    }
    scheduleViewerReconnect()
  })
}

function getChannelMessages(channel) {
  if (!chatMessagesByChannel.value[channel]) {
    chatMessagesByChannel.value[channel] = []
  }
  return chatMessagesByChannel.value[channel]
}

function addChatMessage(payload) {
  const channel = payload?.channel || activeChannelSlug.value
  if (!channel) return
  const messages = getChannelMessages(channel)
  messages.push({
    id: payload?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    username: payload?.username || '',
    text: payload?.text || '',
    kind: payload?.kind || 'user',
    at: payload?.at || Date.now()
  })
  if (messages.length > 200) {
    messages.splice(0, messages.length - 200)
  }
  if (channel === activeChannelSlug.value) {
    nextTick(() => {
      if (chatLogRef.value) {
        chatLogRef.value.scrollTop = chatLogRef.value.scrollHeight
      }
    })
  }
}

function sendChatMessage() {
  const text = chatInput.value.trim()
  if (!text || !activeChannelSlug.value) return
  if (!isChatAuthorized.value) return
  sendViewerMessage('chat', {
    channel: activeChannelSlug.value,
    text,
    sessionId: pageSessionId.value
  })
  chatInput.value = ''
}

watch(activeChannelSlug, (slug, prev) => {
  if (!slug || slug === prev) return
  if (!viewerId.value) return
  if (viewerSocket && viewerSocket.readyState === WebSocket.OPEN) {
    sendViewerMessage('channel', { viewerId: viewerId.value, channel: slug, sessionId: pageSessionId.value })
  } else {
    pendingChannelSlug.value = slug
  }
  nextTick(() => {
    if (chatLogRef.value) {
      chatLogRef.value.scrollTop = chatLogRef.value.scrollHeight
    }
  })
})

function setChannel(index) {
  if (!channels.value.length) return
  activeChannelIndex.value = index
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(storageKey, String(index))
  }
  syncToSchedule(true)
}

function nextChannel() {
  if (!channels.value.length) return
  const next = (activeChannelIndex.value + 1) % channels.value.length
  setChannel(next)
}

function prevChannel() {
  if (!channels.value.length) return
  const next = (activeChannelIndex.value - 1 + channels.value.length) % channels.value.length
  setChannel(next)
}

function togglePower() {
  isOn.value = !isOn.value
  if (!playerReady.value) return

  if (isOn.value) {
    syncToSchedule(true)
  } else if (player) {
    player.pauseVideo()
  }
}

function applyVolume({ forceUnmute = false } = {}) {
  if (!playerReady.value || !player || typeof player.setVolume !== 'function') return
  const targetVolume = Math.max(0, Math.min(100, Math.round(volumePercent.value)))
  player.setVolume(targetVolume)

  if (!forceUnmute) return

  needsUserAction.value = false
  if (targetVolume === 0) {
    if (!isMuted.value) {
      isMuted.value = true
      player.mute()
    }
    return
  }

  if (isMuted.value) {
    isMuted.value = false
    player.unMute()
  }
}

function handleVolumeInput() {
  applyVolume({ forceUnmute: true })
}

function toggleMute() {
  isMuted.value = !isMuted.value
  if (!playerReady.value || !player) return

  if (isMuted.value) {
    player.mute()
  } else {
    player.unMute()
    needsUserAction.value = false
    applyVolume()
  }
}

function enableAudio() {
  if (!playerReady.value || !player) return
  applyVolume({ forceUnmute: true })
  player.playVideo()
}

function ensureYouTubeApi() {
  if (window.YT && window.YT.Player) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const existing = document.getElementById('yt-iframe-api')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      return
    }

    const tag = document.createElement('script')
    tag.id = 'yt-iframe-api'
    tag.src = 'https://www.youtube.com/iframe_api'
    tag.async = true
    document.body.appendChild(tag)
    window.onYouTubeIframeAPIReady = () => resolve()
  })
}

function createPlayer() {
  if (!scheduleInfo.value) return

  const initialVideo = scheduleInfo.value.video
  const startSeconds = scheduleInfo.value.offsetSeconds

  player = new window.YT.Player('yt-player', {
    videoId: initialVideo.id,
    playerVars: {
      autoplay: 1,
      controls: 0,
      disablekb: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1
    },
    events: {
      onReady: () => {
        playerReady.value = true
        syncPlayerSize()
        syncToSchedule(true)
        applyVolume()
      },
      onStateChange: (event) => {
        if (event.data === window.YT.PlayerState.PLAYING) {
          needsUserAction.value = false
          currentVideoId.value = player?.getVideoData?.().video_id || ''
        }
        if (event.data === window.YT.PlayerState.ENDED) {
          syncToSchedule(true)
        }
      }
    }
  })

  if (player && typeof player.loadVideoById === 'function') {
    player.loadVideoById({ videoId: initialVideo.id, startSeconds })
  }
}

function syncPlayerSize() {
  if (window.matchMedia && window.matchMedia('(min-width: 1201px)').matches) {
    return
  }
  if (!player || !screenInner.value || !player.setSize) return
  const rect = screenInner.value.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  player.setSize(Math.floor(rect.width), Math.floor(rect.height))
}

function injectSupportButton() {
  if (!supportSlot.value || supportSlot.value.dataset.loaded === 'true') return
  const script = document.createElement('script')
  script.async = true
  script.src = 'https://c6.patreon.com/becomePatronButton.bundle.js'
  supportSlot.value.dataset.loaded = 'true'
  supportSlot.value.appendChild(script)
}

function syncToSchedule(force = false) {
  if (!playerReady.value || !player || !isOn.value || !channels.value.length) return
  const info = scheduleInfo.value
  if (!info || !info.video) return

  const desiredId = info.video.id
  const desiredOffset = info.offsetSeconds

  let shouldLoad = force || desiredId !== currentVideoId.value

  if (!shouldLoad) {
    const currentTime = player.getCurrentTime?.() ?? 0
    if (Math.abs(currentTime - desiredOffset) > 6) {
      shouldLoad = true
    }
  }

  if (shouldLoad) {
    currentVideoId.value = desiredId
    player.loadVideoById({ videoId: desiredId, startSeconds: desiredOffset })
    if (isMuted.value) {
      player.mute()
    } else {
      player.unMute()
    }
    applyVolume()
  }

  setTimeout(() => {
    const isPlaying = player.getPlayerState?.() === window.YT.PlayerState.PLAYING
    if (!isPlaying && !isMuted.value) {
      needsUserAction.value = true
    }
  }, 1200)
}

async function loadActiveBlocks({ syncPlayer = false } = {}) {
  if (!import.meta.client) return
  try {
    const [channelsResponse, activeResponse, scheduleResponse] = await Promise.all([
      $fetch('/api/channels'),
      $fetch('/api/blocks/active'),
      $fetch('/api/schedule')
    ])
    const list = Array.isArray(channelsResponse?.channels) ? channelsResponse.channels : []
    const active = activeResponse?.active || {}
    const scheduleChannels = scheduleResponse?.channels && typeof scheduleResponse.channels === 'object'
      ? scheduleResponse.channels
      : {}

    const scheduleMap = {}
    const scheduledBlockSlugs = new Set()
    for (const [slug, entries] of Object.entries(scheduleChannels)) {
      const normalized = normalizeScheduleEntries(entries)
      scheduleMap[slug] = normalized
      for (const entry of normalized) {
        if (entry.blockSlug) scheduledBlockSlugs.add(entry.blockSlug)
      }
    }
    scheduleByChannel.value = scheduleMap

    const blockSlugs = new Set()
    for (const channel of list) {
      const blockSlug = typeof active?.[channel.slug] === 'string' ? active[channel.slug] : ''
      if (blockSlug) blockSlugs.add(blockSlug)
    }
    for (const slug of scheduledBlockSlugs) {
      blockSlugs.add(slug)
    }

    const payloads = {}
    await Promise.all(
      [...blockSlugs].map(async (blockSlug) => {
        try {
          const response = await $fetch(`/api/blocks/${blockSlug}`)
          payloads[blockSlug] = response?.payload || null
        } catch (error) {
          payloads[blockSlug] = null
        }
      })
    )

    const playlists = {}
    for (const slug of blockSlugs) {
      const payload = payloads[slug]
      playlists[slug] = buildPlaylist(payload, slug, 'Video')
    }
    blockPlaylists.value = playlists

    const activeChannels = list.filter((channel) => {
      const blockSlug = typeof active?.[channel.slug] === 'string' ? active[channel.slug] : ''
      return Boolean(blockSlug)
    })

    channels.value = activeChannels.map((channel, index) => {
      const activeSlug = typeof active?.[channel.slug] === 'string' ? active[channel.slug] : ''
      const fallbackName = channel.name || defaultChannelNames[channel.slug] || channel.slug
      const payload = payloads[activeSlug] || defaultChannelPayloads[channel.slug]
      return buildChannel(payload, fallbackName, index, channel.slug, activeSlug)
    })

    if (activeChannelIndex.value >= channels.value.length) {
      activeChannelIndex.value = 0
    }

    if (syncPlayer) {
      nextTick(() => {
        syncToSchedule(true)
      })
    }
  } catch (error) {
    channels.value = []
    scheduleByChannel.value = {}
    blockPlaylists.value = {}
  }
}

onMounted(async () => {
  if (typeof window !== 'undefined') {
    const saved = Number.parseInt(window.localStorage.getItem(storageKey) || '', 10)
    if (Number.isFinite(saved) && saved >= 0 && saved < channels.value.length) {
      activeChannelIndex.value = saved
    }
  }
  viewerId.value = getOrCreateViewerId()
  pageSessionId.value = getOrCreatePageSessionId()
  hasLoadedChannel.value = true
  injectSupportButton()
  clockInterval = window.setInterval(() => {
    now.value = new Date()
  }, 1000)

  await loadActiveBlocks()
  viewerShouldReconnect = true
  connectViewerSocket()
  await ensureYouTubeApi()
  if (!player) {
    createPlayer()
  }

  resizeObserver = new ResizeObserver(() => {
    syncPlayerSize()
  })
  if (screenInner.value) {
    resizeObserver.observe(screenInner.value)
  }

  syncInterval = window.setInterval(() => {
    syncToSchedule(false)
  }, 15000)
})

onBeforeUnmount(() => {
  if (clockInterval) window.clearInterval(clockInterval)
  if (syncInterval) window.clearInterval(syncInterval)
  if (resizeObserver) resizeObserver.disconnect()
  if (player && player.destroy) player.destroy()
  viewerShouldReconnect = false
  if (viewerReconnectTimer) window.clearTimeout(viewerReconnectTimer)
  if (viewerHelloTimer) window.clearTimeout(viewerHelloTimer)
  if (viewerSocket) viewerSocket.close()
})
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=VT323&family=Orbitron:wght@400;600&display=swap');

:global(*),
:global(*::before),
:global(*::after) {
  box-sizing: border-box;
}

:global(html),
:global(body) {
  margin: 0;
  padding: 0;
  background: #070707;
}

.page {
  min-height: 100vh;
  padding: clamp(14px, 3vw, 24px);
  overflow-x: hidden;
  background: radial-gradient(circle at top, #2b2e35 0%, #101015 45%, #070707 100%);
  color: #f7f0d8;
  font-family: 'Orbitron', sans-serif;
  --content-max: 1680px;
  --controls-max: 480px;
}

.title-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  max-width: 100%;
  width: 100%;
  margin-inline: auto;
  max-width: var(--content-max);
  padding: 12px 18px;
  background: linear-gradient(90deg, #1f2024, #2f2b20 60%, #3b2b17);
  border: 2px solid #a88c5a;
  border-radius: 12px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
  margin-bottom: 24px;
}

.brand {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.brand-mark {
  font-size: 24px;
  letter-spacing: 4px;
  color: #f9d98f;
  text-shadow: 0 0 12px rgba(249, 217, 143, 0.4);
}

.brand-sub {
  font-size: 12px;
  letter-spacing: 2px;
  color: #cbb78f;
}

.clock {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-family: 'VT323', monospace;
}

.clock-label {
  font-size: 12px;
  color: #d7c7a4;
  text-transform: uppercase;
  letter-spacing: 2px;
}

.clock-time {
  font-size: 28px;
  color: #fdf0c2;
}


.tv-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, min(var(--controls-max), 35vw));
  gap: 24px;
  align-items: stretch;
  width: 100%;
  min-width: 0;
  max-width: var(--content-max);
  margin-inline: auto;
}

.tv-frame {
  display: flex;
  justify-content: center;
  width: 100%;
  min-width: 0;
  align-self: start;
}

.bezel {
  width: 100%;
  max-width: 100%;
  flex: 0 0 auto;
  min-height: 0;
  background: linear-gradient(135deg, #4b2f1b, #7a5630 40%, #3a2412 100%);
  border-radius: clamp(18px, 4vw, 32px);
  padding: clamp(14px, 3vw, 22px);
  box-shadow: 0 18px 30px rgba(0, 0, 0, 0.55);
  border: 3px solid #b58a56;
}

.screen {
  background: #1b1c1d;
  border-radius: clamp(12px, 3vw, 18px);
  padding: clamp(10px, 2.6vw, 18px);
  border: 2px solid #4f422c;
  min-height: 0;
}

.screen-inner {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
  background: radial-gradient(circle at center, #243f2e 0%, #0b0c0d 70%);
  min-height: 0;
}

.player {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.player :deep(iframe),
.player :deep(div) {
  width: 100%;
  height: 100%;
}

.screen-inner.off .player {
  opacity: 0;
}

.scanlines,
.vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.scanlines {
  background: repeating-linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.15),
    rgba(0, 0, 0, 0.15) 2px,
    transparent 2px,
    transparent 4px
  );
  mix-blend-mode: multiply;
}

.vignette {
  box-shadow: inset 0 0 80px rgba(0, 0, 0, 0.6);
}

.screen-off {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 28px;
  letter-spacing: 4px;
  color: #d1b985;
  text-shadow: 0 0 12px rgba(255, 213, 140, 0.4);
  background: radial-gradient(circle at center, #1c1b19 0%, #050505 80%);
}

.audio-overlay {
  position: absolute;
  bottom: 18px;
  right: 18px;
  padding: 10px 16px;
  border-radius: 999px;
  border: 1px solid #f7e4b4;
  background: rgba(24, 20, 14, 0.85);
  color: #f7e4b4;
  font-family: 'VT323', monospace;
  font-size: 18px;
  cursor: pointer;
}

.channel-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 12px;
  padding: 14px 8px 0;
  font-family: 'VT323', monospace;
  color: #f9d98f;
  text-transform: uppercase;
  letter-spacing: 2px;
}

@media (min-width: 1201px) {
  .tv-frame {
    align-self: stretch;
  }

  .controls {
    align-self: start;
  }

  .bezel {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .screen {
    flex: 1;
    display: flex;
  }

  .screen-inner {
    flex: 1;
    height: 100%;
    aspect-ratio: auto;
  }

  .player {
    overflow: hidden;
    inset: 0;
    width: 100% !important;
    height: 100% !important;
  }

  .player :deep(iframe) {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100% !important;
    height: auto !important;
    min-width: 100%;
    min-height: 100%;
    max-width: none;
    max-height: none;
    transform: translate(-50%, -50%);
  }

  :global(iframe#yt-player),
  :global(iframe.player) {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100% !important;
    height: auto !important;
    min-width: 100%;
    min-height: 100%;
    max-width: none;
    max-height: none;
    transform: translate(-50%, -50%);
  }

  .channel-banner {
    margin-top: 12px;
    margin-bottom: 0;
    padding-top: 0;
  }
}

.channel-name {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.channel-name-text {
  white-space: nowrap;
}

.support-slot {
  display: inline-flex;
  text-transform: none;
  letter-spacing: normal;
}

.channel-name a[data-patreon-widget-type] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid rgba(249, 217, 143, 0.8);
  background: linear-gradient(180deg, rgba(49, 36, 22, 0.95), rgba(28, 21, 13, 0.95));
  color: #f9d98f;
  font-size: 13px;
  text-transform: none;
  letter-spacing: 0.5px;
  text-decoration: none;
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.35);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.channel-name a[data-patreon-widget-type]:hover {
  border-color: rgba(249, 217, 143, 1);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.4);
  transform: translateY(-1px);
}

.channel-name a[data-patreon-widget-type]:focus-visible {
  outline: 2px solid rgba(249, 217, 143, 0.9);
  outline-offset: 2px;
}

.channel-status {
  padding: 4px 10px;
  border: 1px solid #f9d98f;
  border-radius: 999px;
}

.channel-status.off {
  opacity: 0.6;
}

.controls {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 14px;
  max-width: var(--controls-max);
  justify-self: end;
}

.ad-banner {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 10px;
}

.panel {
  flex: 1;
  max-width: 100%;
  background: linear-gradient(180deg, #1a1b20, #2a2419 80%);
  border-radius: 20px;
  padding: 18px;
  border: 2px solid #7c6845;
  box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.6);
}

.panel-header {
  font-size: 18px;
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-bottom: 12px;
  color: #f9d98f;
}

.panel-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.viewer-inline {
  font-size: 10px;
  color: #cbb78f;
  letter-spacing: 1px;
  text-transform: uppercase;
  white-space: nowrap;
}

.now-playing {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 16px;
}

.now-title {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: #cbb78f;
}

.now-name {
  font-size: 18px;
  margin-top: 6px;
}

.now-time {
  font-family: 'VT323', monospace;
  font-size: 16px;
  margin-top: 4px;
  color: #f3e0b8;
}


.panel-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.tab-button {
  border-radius: 10px;
  border: 1px solid rgba(124, 104, 69, 0.6);
  background: rgba(0, 0, 0, 0.2);
  color: #f7e4b4;
  padding: 8px 10px;
  font-family: 'Orbitron', sans-serif;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-size: 12px;
  cursor: pointer;
}

.tab-button.active {
  border-color: #f9d98f;
  color: #f9d98f;
  background: rgba(249, 217, 143, 0.12);
}

.panel-section {
  display: grid;
  gap: 12px;
  border: 1px dashed rgba(124, 104, 69, 0.6);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.2);
  padding: 12px;
}

.chat-panel {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-log {
  flex: 0 0 260px;
  height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 8px;
  padding-right: 4px;
}

.chat-message {
  display: grid;
  grid-template-columns: minmax(90px, auto) minmax(0, 1fr);
  column-gap: 10px;
  align-items: start;
  font-family: 'VT323', monospace;
  color: #f7f0d8;
}

.chat-message.system {
  font-style: italic;
  color: #bfa981;
  grid-template-columns: minmax(0, 1fr);
}

.chat-user {
  font-size: 14px;
  color: #f9d98f;
  white-space: nowrap;
}

.chat-text {
  font-size: 16px;
  color: inherit;
  white-space: pre-wrap;
  word-break: break-word;
  min-width: 0;
}

.chat-message.system .chat-user {
  display: none;
}

.chat-message.system .chat-text {
  grid-column: 1 / -1;
}

.chat-auth {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(124, 104, 69, 0.6);
  background: rgba(0, 0, 0, 0.2);
  font-size: 12px;
  color: #cbb78f;
}

.chat-auth a {
  text-decoration: none;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #a88c5a;
  color: #f7f0d8;
  font-family: 'Orbitron', sans-serif;
  font-size: 12px;
}

.chat-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.chat-input input {
  border-radius: 10px;
  border: 1px solid rgba(124, 104, 69, 0.6);
  background: rgba(0, 0, 0, 0.3);
  color: #f7f0d8;
  padding: 8px 10px;
  font-family: 'VT323', monospace;
  font-size: 16px;
}

.chat-input button {
  border-radius: 10px;
  border: 1px solid rgba(124, 104, 69, 0.6);
  background: rgba(249, 217, 143, 0.12);
  color: #f9d98f;
  padding: 8px 14px;
  font-family: 'Orbitron', sans-serif;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  cursor: pointer;
}

.chat-input button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.controls-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.volume-control {
  margin-bottom: 16px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(181, 138, 86, 0.45);
  background: rgba(0, 0, 0, 0.3);
}

.volume-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  text-transform: uppercase;
  letter-spacing: 2px;
  font-size: 11px;
  color: #cbb78f;
  margin-bottom: 10px;
}

.volume-value {
  font-family: 'VT323', monospace;
  font-size: 18px;
  color: #f3e0b8;
  text-transform: none;
  letter-spacing: 1px;
}

.volume-slider {
  width: 100%;
  appearance: none;
  height: 6px;
  border-radius: 999px;
  background: linear-gradient(90deg, #7a5630, #f9d98f 55%, #f9b65a);
  box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.6);
  cursor: pointer;
}

.volume-slider:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.volume-slider::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #f7e4b4;
  border: 2px solid #3a2c1c;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
}

.volume-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #f7e4b4;
  border: 2px solid #3a2c1c;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
}

.volume-scale {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 10px;
  color: #bfa77e;
  letter-spacing: 1px;
}

.dial,
.toggle,
.channel-button {
  font-family: 'Orbitron', sans-serif;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #b58a56;
  background: linear-gradient(180deg, #3a2c1c, #2a1f13);
  color: #f7e4b4;
  cursor: pointer;
  box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.6);
}

.toggle.active,
.channel-button.active {
  border-color: #f9d98f;
  box-shadow: 0 0 12px rgba(249, 217, 143, 0.4);
}

.guide {
  display: grid;
  grid-template-columns: minmax(90px, 110px) 1fr;
  gap: 12px;
  margin-top: 8px;
}

.guide-left {
  display: grid;
  grid-auto-rows: 44px;
  gap: 8px;
}

.guide-left-header {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: #cbb78f;
  display: flex;
  align-items: center;
}

.guide-left-row {
  font-size: 13px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 8px;
  border: 1px solid rgba(181, 138, 86, 0.4);
  display: flex;
  align-items: center;
}

.guide-scroll {
  overflow-x: auto;
  padding-bottom: 6px;
}

.guide-header {
  display: flex;
  font-family: 'VT323', monospace;
  text-transform: uppercase;
  align-items: center;
  height: 44px;
}

.guide-hour {
  padding: 6px 8px;
  border: 1px solid rgba(181, 138, 86, 0.35);
  border-right: none;
  color: #f9d98f;
  background: rgba(0, 0, 0, 0.4);
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.guide-hour:last-child {
  border-right: 1px solid rgba(181, 138, 86, 0.35);
}

.guide-row {
  display: flex;
  align-items: center;
  height: 44px;
  margin-top: 8px;
}

.guide-block {
  height: 100%;
  background: linear-gradient(135deg, rgba(51, 38, 24, 0.95), rgba(25, 19, 12, 0.95));
  border: 1px solid rgba(181, 138, 86, 0.5);
  border-right: none;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  overflow: hidden;
  flex-shrink: 0;
}

.guide-block:last-child {
  border-right: 1px solid rgba(181, 138, 86, 0.5);
}

.guide-title {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.note {
  margin-top: 16px;
  font-size: 12px;
  color: #cab688;
}

.code {
  font-family: 'VT323', monospace;
  font-size: 14px;
}

@media (max-width: 1200px) {
  .page {
    padding: 16px;
  }

  .tv-layout {
    grid-template-columns: 1fr;
  }

  .controls {
    order: 2;
    max-width: 100%;
    justify-self: stretch;
  }

  .bezel {
    padding: 0;
  }

  .channel-banner {
    padding: 10px 5px;
  }
}

@media (max-width: 600px) {
  .title-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .channel-banner {
    padding: 10px 5px;
  }
}
</style>
