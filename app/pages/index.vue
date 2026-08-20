<template>
  <div class="page" :class="{ theater: theaterMode }">
    <!-- Banner text is always rendered through {{ }} / :alt. Never switch these to
         v-html to support markup: the content is admin-supplied and shown publicly. -->
    <div v-if="showAnnouncement" class="announcement" role="status">
      <p class="announcement-text">{{ announcement.text }}</p>
      <a
        v-if="announcementHref"
        class="announcement-link"
        :href="announcementHref"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ announcement.linkLabel || 'Learn more' }}
      </a>
      <button
        class="announcement-dismiss"
        type="button"
        aria-label="Dismiss announcement"
        @click="dismissAnnouncement"
      >
        ✕
      </button>
    </div>

    <header class="title-bar">
      <div class="brand">
        <span class="brand-mark">Cartoon ReWatch</span>
        <!-- Admin-supplied, like the banners above: always rendered through {{ }}.
             Never switch this to v-html to support markup. -->
        <span v-if="tagline" class="brand-sub">{{ tagline }}</span>
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
              <div class="player-shell" v-show="!isDailymotionActive">
                <div id="yt-player"></div>
              </div>
              <div v-show="isDailymotionActive" class="player-shell dm-player">
                <div id="dm-player"></div>
              </div>
            </ClientOnly>
              <div class="scanlines"></div>
              <div class="vignette"></div>
              <div v-if="!isOn" class="screen-off">POWER OFF</div>
              <button
                v-if="needsUserAction && isOn && isYouTubeActive"
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
              <a
                v-if="showChannelStrip && channelStripHref"
                class="support-slot strip-link"
                :href="channelStripHref"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ channelStrip.text }}
              </a>
              <span v-else-if="showChannelStrip" class="support-slot">{{ channelStrip.text }}</span>
            </div>
            <span class="channel-status" :class="{ off: !isOn }">
              {{ isOn ? 'LIVE' : 'OFFLINE' }}
            </span>
          </div>
        </div>
      </section>

      <aside class="controls">
        <!-- On phones .controls sits below the TV, so the promo stack is ordered after
             the panel to keep the remote controls reachable without scrolling past promos. -->
        <div v-if="visiblePromos.length" class="promo-stack">
          <component
            :is="promo.href ? 'a' : 'div'"
            v-for="(promo, index) in visiblePromos"
            :key="promo.id"
            class="promo-slot"
            v-bind="promo.href ? { href: promo.href, target: '_blank', rel: 'noopener noreferrer' } : {}"
          >
            <img
              class="promo-banner"
              :src="promo.src"
              :alt="promo.alt"
              :width="promo.width || null"
              :height="promo.height || null"
              :style="promo.width && promo.height ? { aspectRatio: `${promo.width} / ${promo.height}` } : null"
              :loading="index === 0 ? 'eager' : 'lazy'"
              decoding="async"
              fetchpriority="low"
              referrerpolicy="no-referrer"
            />
          </component>
        </div>
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
              <button class="toggle" type="button" :disabled="!canControlAudio" @click="toggleMute">
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
                :disabled="!canControlAudio"
                @input="handleVolumeInput"
              />
              <div class="volume-scale">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>

            <div class="controls-row single">
              <!-- The visible label contains "Theater Mode" so the accessible name
                   matches it (WCAG 2.5.3 Label in Name) and voice control works.
                   aria-pressed is announced automatically on the focused button, so
                   no aria-live region is needed here. The glyph is a non-colour cue
                   for the pressed state (1.4.1). -->
              <button
                class="toggle theater-toggle"
                :class="{ active: theaterMode }"
                type="button"
                :aria-pressed="theaterMode ? 'true' : 'false'"
                @click="theaterMode = !theaterMode"
              >
                <span class="toggle-glyph" aria-hidden="true">{{ theaterMode ? '◼' : '◻' }}</span>
                Theater Mode
              </button>
            </div>
            <p class="theater-hint">
              Dims the site around the screen and gives the picture the full width.
              Press Esc to leave.
            </p>
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
              <p v-if="authErrorMessage" class="chat-auth-error">{{ authErrorMessage }}</p>
              <p v-else>Sign in with Discord to chat.</p>
              <a class="secondary" :href="chatLoginHref">
                Sign in with Discord
              </a>
            </div>
            <div v-else class="chat-auth signed-in">
              <p>Chatting as {{ chatUsername }}.</p>
              <a class="secondary" href="/api/auth/logout?redirect=/">Sign out</a>
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
import { safeImageUrl, safeLinkUrl } from '#shared/url-safety.js'
import { buildPaletteStyle, derivePalette } from '#shared/palette.js'
import {
  compareOccurrences,
  expandRecurringRules,
  getEffectiveOccurrence,
  getTimeZoneOffsetMs,
  normalizeRecurringList
} from '#shared/schedule-time.js'
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

function normalizeVideoSource(input) {
  if (!input) return ''
  const cleaned = String(input).trim().toLowerCase()
  if (cleaned === 'youtube' || cleaned === 'yt') return 'youtube'
  if (cleaned === 'dailymotion' || cleaned === 'dm') return 'dailymotion'
  return ''
}

function stripUrlParams(value) {
  return String(value || '').split(/[?#]/)[0]
}

function cleanDailymotionId(value) {
  return stripUrlParams(value).split('_')[0]
}

function stripProviderPrefix(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  const prefixed = trimmed.match(/^(yt|youtube|dm|dailymotion):(.+)$/i)
  return prefixed ? prefixed[2].trim() : trimmed
}

function normalizeYouTubeId(input) {
  const trimmed = stripProviderPrefix(input)
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'youtu.be') {
      return stripUrlParams(url.pathname.replace('/', ''))
    }
    if (host.includes('youtube.com')) {
      const param = url.searchParams.get('v')
      if (param) return stripUrlParams(param)
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts[0] === 'shorts' || parts[0] === 'embed') {
        return stripUrlParams(parts[1] || '')
      }
    }
  } catch (error) {
    // Not a URL.
  }
  if (trimmed.includes('youtu.be/')) {
    const id = trimmed.split('youtu.be/')[1]?.split(/[?&#]/)[0]
    if (id) return id
  }
  if (trimmed.includes('v=')) {
    const id = trimmed.split('v=')[1]?.split(/[?&#]/)[0]
    if (id) return id
  }
  if (trimmed.includes('/shorts/')) {
    const id = trimmed.split('/shorts/')[1]?.split(/[?&#]/)[0]
    if (id) return id
  }
  if (trimmed.includes('/embed/')) {
    const id = trimmed.split('/embed/')[1]?.split(/[?&#]/)[0]
    if (id) return id
  }
  return trimmed
}

function normalizeDailymotionId(input) {
  const trimmed = stripProviderPrefix(input)
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'dai.ly') {
      return cleanDailymotionId(url.pathname.split('/').filter(Boolean)[0] || '')
    }
    if (host.includes('dailymotion.com')) {
      const parts = url.pathname.split('/').filter(Boolean)
      const videoIndex = parts.indexOf('video')
      if (videoIndex >= 0) {
        return cleanDailymotionId(parts[videoIndex + 1] || '')
      }
      if (parts[0] === 'embed' && parts[1] === 'video') {
        return cleanDailymotionId(parts[2] || '')
      }
    }
  } catch (error) {
    // Not a URL.
  }
  if (trimmed.includes('dai.ly/')) {
    const id = trimmed.split('dai.ly/')[1]?.split(/[?&#]/)[0]
    if (id) return cleanDailymotionId(id)
  }
  if (trimmed.includes('dailymotion.com/video/')) {
    const id = trimmed.split('dailymotion.com/video/')[1]?.split(/[?&#]/)[0]
    if (id) return cleanDailymotionId(id)
  }
  if (trimmed.includes('dailymotion.com/embed/video/')) {
    const id = trimmed.split('dailymotion.com/embed/video/')[1]?.split(/[?&#]/)[0]
    if (id) return cleanDailymotionId(id)
  }
  return cleanDailymotionId(trimmed)
}

function buildPlaylist(payload, fallbackName, fallbackTitlePrefix = 'Video') {
  const payloadName = typeof payload?.channel === 'string' ? payload.channel.trim() : ''
  const fallback = typeof fallbackName === 'string' ? fallbackName.trim() : ''
  const name = fallback || payloadName || 'Channel'
  const videos = Array.isArray(payload?.videos) ? payload.videos : []
  const normalizedVideos = videos
    .map((video, videoIndex) => {
      const rawId = typeof video?.id === 'string' ? video.id.trim() : ''
      const source = normalizeVideoSource(video?.source) || 'youtube'
      const id = source === 'dailymotion'
        ? normalizeDailymotionId(rawId)
        : normalizeYouTubeId(rawId)
      if (!id) return null
      const duration = Number(video?.durationSeconds)
      return {
        id,
        source,
        title: video?.title || `${name} ${fallbackTitlePrefix} ${videoIndex + 1}`,
        durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0
      }
    })
    .filter(Boolean)

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
const recurringByChannel = ref({})
const blockPlaylists = ref({})

const activeChannelIndex = ref(0)
const isOn = ref(true)
const isMuted = ref(false)
const volumePercent = ref(100)
const maxVolumePercent = 100
const needsUserAction = ref(false)
const playerReady = ref(false)
const currentYouTubeId = ref('')
const currentDailymotionId = ref('')
const currentDailymotionOffset = ref(0)
const currentDailymotionStartedAt = ref(0)
const lastLoggedVideoKey = ref('')
const lastLoggedVideoMeta = ref('')
const now = ref(new Date())
const screenInner = ref(null)
const supportSlot = ref(null)
const hasLoadedChannel = ref(false)
const viewerCounts = ref({ total: 0, channels: {} })
const viewerId = ref(null)
const activePanel = ref('chat')
const { data: authData, refresh: refreshAuth } = await useFetch('/api/auth/me')
// Banners ride along in this existing SSR fetch, so they cost no extra round trip and
// are present in the first paint. Do not move them to $fetch in onMounted — that
// reintroduces a post-hydration request and makes every banner shift the layout.
const { data: scheduleSettings, refresh: refreshSettings } = await useFetch('/api/settings')

const banners = computed(() => scheduleSettings.value?.banners ?? null)
const announcement = computed(
  () => banners.value?.announcement ?? { enabled: false, text: '', linkUrl: '', linkLabel: '' }
)
const channelStrip = computed(
  () => banners.value?.channelStrip ?? { enabled: false, text: '', linkUrl: '' }
)
// Already resolved server-side (absent -> default, '' -> hidden), so SSR and hydration
// render the same string and the header never shifts after load.
const tagline = computed(() => banners.value?.tagline?.text ?? '')

// Dismissal lives in a cookie rather than localStorage so the server renders the same
// thing the client will: reading it after hydration would render the bar for returning
// visitors and then yank it away, shifting the whole page upward mid-load.
// The value is the dismissed text, so editing the announcement re-shows it.
// `decode` is not optional here. useCookie's default decoder runs the raw value
// through destr, which turns a numeric string back into a Number — so a stored
// "1682" reads back as 1682 and never matches the string it is compared against.
// Both cookies on this page store digit strings, so both must opt out.
const rawCookie = (value) => value
const announcementDismissed = useCookie('crt80_ann_dismissed', {
  maxAge: 60 * 60 * 24 * 180,
  sameSite: 'lax',
  path: '/',
  decode: rawCookie
})

// Theater mode: a per-viewer display preference, so it is deliberately client-side
// only — no auth check, nothing on the server, nothing in /api/settings (that store
// is admin-managed global site config).
//
// A cookie rather than localStorage for the same reason the dismissal above uses one:
// theater changes the page layout, and localStorage cannot be read during SSR, so
// every returning viewer would get a flash of the normal layout and a reflow on each
// load. The cookie is readable server-side, so the first paint is already correct.
// Note this makes / vary per viewer — which it already did, via /api/auth/me and the
// cookie above — so / must stay uncacheable if a CDN is ever put in front of it.
const theaterCookie = useCookie('crt80_theater', {
  maxAge: 60 * 60 * 24 * 180,
  sameSite: 'lax',
  path: '/',
  decode: rawCookie
})
const theaterMode = computed({
  get: () => theaterCookie.value === '1',
  set: (value) => {
    theaterCookie.value = value ? '1' : '0'
  }
})

// The channel whose colour scheme is showing. A cookie for the same reason as the two
// above: the palette changes the colour of the entire page, and localStorage cannot be
// read during SSR, so every returning viewer would get a flash of the previous channel's
// colours and a full-page recolour on load.
//
// This makes / vary on a THIRD cookie — see the note on theaterCookie above; / must stay
// uncacheable if a CDN is ever put in front of it.
//
// A slug, not the index the old localStorage key held. loadActiveBlocks filters the list
// to channels that currently have an active block and then re-indexes it, so index 2
// means a different channel depending on what is scheduled. `decode: rawCookie` for the
// same destr reason as the others, and it matters here beyond digits: channel slugs are
// admin-created with no reserved-word check, so a channel called `true`, `null` or `2000`
// would read back as a non-string and throw on lookup.
const channelCookie = useCookie('crt80_channel', {
  maxAge: 60 * 60 * 24 * 180,
  sameSite: 'lax',
  path: '/',
  decode: rawCookie
})

// Seeded from the cookie on BOTH sides so the server and the first client render agree.
// Deliberately not driven off activeChannelSlug, which is '' until loadActiveBlocks
// resolves after mount and would therefore mismatch SSR immediately.
const paletteSlug = ref(typeof channelCookie.value === 'string' ? channelCookie.value : '')

const brandColor = computed(() => {
  const theme = scheduleSettings.value?.theme
  if (!theme) return ''
  // activeColor, not default, is the fallback: on a first visit there is no cookie, so
  // the server resolved the colour of the channel this viewer is about to land on —
  // the first one with an active block, which is the same rule restoreSavedChannel
  // applies on the client. Falling back to the site default here instead would render
  // the wrong palette on the server and repaint after hydration.
  return theme.colors?.[paletteSlug.value] || theme.activeColor || theme.default || ''
})

// Emitted as --cr-ch-* inputs in an inline style attribute on <html>, which theme.css's
// var() fallbacks consume. See buildPaletteStyle for why the indirection.
const paletteStyle = computed(() => buildPaletteStyle(brandColor.value))

// What the mobile browser's address bar butts against: the top of .page's radial
// gradient normally, and the flat root surface in theater mode. Theater is a cookie, so
// this is already correct during SSR.
const themeColor = computed(() => {
  const palette = derivePalette(brandColor.value).base
  return theaterMode.value ? palette['--cr-surface-root'] : palette['--cr-surface-page-top']
})

function announcementKey(text) {
  // Short, stable, cookie-safe fingerprint of the current announcement text.
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0
  }
  return String(hash)
}

const showAnnouncement = computed(() => {
  const value = announcement.value
  if (!value?.enabled || !value.text) return false
  return announcementDismissed.value !== announcementKey(value.text)
})

// Re-sanitised at render time. The stored config is validated on write, but that is not
// the only path into this data (hand edits, restores, schema changes), and Vue does not
// sanitise bound href/src attributes.
const announcementHref = computed(() => safeLinkUrl(announcement.value?.linkUrl))
const channelStripHref = computed(() => safeLinkUrl(channelStrip.value?.linkUrl))
const showChannelStrip = computed(
  () => Boolean(channelStrip.value?.enabled && channelStrip.value?.text)
)

const visiblePromos = computed(() =>
  (banners.value?.ads ?? [])
    .filter((ad) => ad?.enabled)
    .map((ad) => ({
      id: ad.id,
      src: safeImageUrl(ad.imageUrl),
      href: safeLinkUrl(ad.linkUrl),
      alt: ad.alt || '',
      width: ad.width || 0,
      height: ad.height || 0
    }))
    .filter((promo) => promo.src)
)

function dismissAnnouncement() {
  announcementDismissed.value = announcementKey(announcement.value?.text || '')
}
const weekStartOffset = computed(() => {
  const day = scheduleSettings.value?.scheduleDay ?? 5
  const hour = scheduleSettings.value?.scheduleHour ?? 19
  return day * 86400 + hour * 3600
})
const isChatAuthorized = computed(() => Boolean(authData.value?.authenticated))
const chatUsername = computed(() => authData.value?.user?.username || '')

const route = useRoute()

// Fixed lookup with a generic fallback — never render the raw query value. Echoing it
// back would let any link put attacker-chosen copy on the real site.
const AUTH_ERROR_MESSAGES = {
  session: 'Your sign-in could not be completed. This is usually a blocked or expired cookie — try again, and check that cookies are enabled.',
  discord: 'Discord could not confirm your account. Please try again in a moment.',
  notAllowed: 'That Discord account is not an approved admin. You can still sign in to chat.'
}

const authErrorMessage = computed(() => {
  const code = route.query.authError
  if (typeof code !== 'string' || !code) return ''
  return AUTH_ERROR_MESSAGES[code] || 'Sign-in failed. Please try again.'
})

// Return to the page they were on, not always '/'.
const chatLoginHref = computed(() => {
  const path = route.fullPath && route.fullPath.startsWith('/') ? route.fullPath : '/'
  return `/api/auth/discord/login?scope=chat&redirect=${encodeURIComponent(path)}`
})
const chatMessagesByChannel = ref({})
const chatInput = ref('')
const chatLogRef = ref(null)
const pageSessionId = ref(null)

let player = null
let youTubeInitPending = false
let dailymotionPlayer = null
let dailymotionInitPending = false
let dailymotionDebugBound = false
let dailymotionSyncPending = false
let clockInterval = null
let syncInterval = null
let resizeObserver = null
let viewerSocket = null
let viewerReconnectDelay = 1000
let viewerReconnectTimer = null
let viewerShouldReconnect = true
let viewerHelloTimer = null
// Raw block payloads keyed by slug, kept across reloads so a broadcast doesn't refetch
// blocks this client already has.
let blockPayloadCache = {}
let scheduleReloadTimer = null
let themeRevalidateTimer = null
const pendingChannelSlug = ref('')
// Superseded by the crt80_channel cookie. Read once on mount to migrate anyone whose
// preference is still only in localStorage, then removed.
const legacyStorageKey = 'crt80:lastChannel'
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

  const nowMs = now.value.getTime()
  let scheduledStartMs = null
  if (channel.blockSlug) {
    const latest = getLatestScheduleEntry(channel.slug, nowMs)
    if (latest && latest.blockSlug === channel.blockSlug) {
      scheduledStartMs = latest.startMs
    }
  }

  const positionSeconds = Number.isFinite(scheduledStartMs)
    ? Math.max(0, Math.floor((nowMs - scheduledStartMs) / 1000))
    : getSecondsSinceWeekStartInZone(now.value, scheduleTimeZone, weekStartOffset.value)

  return getVideoAt(channel, positionSeconds)
})

const activeVideoSource = computed(() => scheduleInfo.value?.video?.source || 'youtube')
const isDailymotionActive = computed(() => activeVideoSource.value === 'dailymotion')
const isYouTubeActive = computed(() => activeVideoSource.value !== 'dailymotion')
const canControlAudio = computed(() => isYouTubeActive.value && playerReady.value && isOn.value)

const currentVideoTitle = computed(() =>
  scheduleInfo.value?.video?.title || 'Add YouTube or Dailymotion IDs in JSON'
)
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
// A NUMBER, not a Date. getZoneMinuteStart truncates to the minute, but returning a
// fresh Date object every second meant Vue's identity check fired on every clock tick,
// invalidating the whole guide — every row, and two toLocaleTimeString calls per block —
// 60x more often than the value actually changed.
const guideStart = computed(() => getZoneMinuteStart(now.value, scheduleTimeZone).getTime())

const requestUrl = useRequestURL()
const canonicalUrl = computed(() => requestUrl.origin + requestUrl.pathname)
// The link-preview image. Falls back to the logo that was hardcoded here, at the
// dimensions it actually is, so an untouched deployment unfurls exactly as before.
const DEFAULT_SOCIAL_IMAGE = { path: '/logo.png', width: 1204, height: 623, type: 'image/png', alt: 'Cartoon ReWatch logo' }

const EMBED_MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

const socialImage = computed(() => {
  const embed = banners.value?.embed
  // normalizeEmbed only ever stores an uploaded /api/banner-image/<hash>.<ext> path, so
  // the extension is one of four known values rather than something guessed off a URL.
  const match = /^\/api\/banner-image\/[0-9a-f]{32}\.(png|jpg|gif|webp)$/.exec(embed?.imageUrl || '')
  if (!match) return DEFAULT_SOCIAL_IMAGE
  return {
    path: embed.imageUrl,
    // probeImage legitimately returns 0x0 for a JPEG whose dimensions it could not find.
    // Facebook rejects an image advertised as 0 wide, so the tags are omitted below
    // rather than sent as zeroes.
    width: embed.width || 0,
    height: embed.height || 0,
    type: EMBED_MIME[match[1]],
    alt: embed.alt || DEFAULT_SOCIAL_IMAGE.alt
  }
})
const socialImageUrl = computed(() => `${requestUrl.origin}${socialImage.value.path}`)

const pageTitle = 'Cartoon ReWatch — Live Cartoon Channel Player'
const pageDescription =
  'Stream a nostalgic, always-on cartoon channel with classic blocks from Toonami, Adult Swim, Saturday Mornings, and more.'

useHead({
  title: pageTitle,
  htmlAttrs: {
    lang: 'en',
    // The per-channel palette. Passed as the computed itself, NOT paletteStyle.value:
    // every other entry in this call unwraps eagerly because those values are constant,
    // but this one has to stay reactive or the page never recolours on a channel flip.
    style: paletteStyle
  },
  meta: [
    { name: 'description', content: pageDescription },
    { name: 'robots', content: 'index,follow' },
    // Was `var(--cr-surface-4)`, which is not valid in a meta attribute and did nothing.
    // Now the real colour, tracking the channel — and --cr-surface-page-top rather than
    // -4, because the top of .page's gradient is what the mobile address bar butts
    // against. Theater mode paints .page flat --cr-surface-root instead.
    { name: 'theme-color', content: themeColor },
    { property: 'og:title', content: pageTitle },
    { property: 'og:description', content: pageDescription },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: canonicalUrl.value },
    { property: 'og:site_name', content: 'Cartoon ReWatch' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: pageTitle },
    { name: 'twitter:description', content: pageDescription },
    { property: 'og:image', content: socialImageUrl },
    { property: 'og:image:secure_url', content: socialImageUrl },
    { property: 'og:image:type', content: () => socialImage.value.type },
    { property: 'og:image:alt', content: () => socialImage.value.alt },
    { name: 'twitter:image', content: socialImageUrl },
    { name: 'twitter:image:alt', content: () => socialImage.value.alt }
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

// Split out because unhead drops a meta tag whose content is '' but happily emits
// `content="0"`, and an og:image:width of 0 makes Facebook reject the image outright.
useHead(() => ({
  meta: socialImage.value.width && socialImage.value.height
    ? [
        { property: 'og:image:width', content: String(socialImage.value.width) },
        { property: 'og:image:height', content: String(socialImage.value.height) }
      ]
    : []
}))

const guideHeaderSegments = computed(() => {
  const startSeconds = getSecondsSinceWeekStartInZone(guideStart.value, scheduleTimeZone, weekStartOffset.value)
  const minuteOfHour = Math.floor((startSeconds % 3600) / 60)
  const windowSeconds = guideHours * 3600
  const segments = []
  let remaining = windowSeconds
  let cursor = 0
  let firstSegment = minuteOfHour === 0 ? 3600 : (60 - minuteOfHour) * 60
  while (remaining > 0) {
    const segmentSeconds = Math.min(firstSegment, remaining)
    const stamp = new Date(guideStart.value + cursor * 1000)
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

// getTimeZoneOffsetMs now comes from #shared/schedule-time.js — the same implementation
// the server and the admin form use, so all three agree on when a block starts. The copy
// that lived here also rebuilt an Intl.DateTimeFormat on every call, which cost ~75µs
// against ~7µs for the shared (memoised) one, once per second forever.
function getSecondsSinceWeekStartInZone(input, timeZone, weekStartOffsetSeconds = 500400) {
  const ms = typeof input === 'number' ? input : input.getTime()
  const offset = getTimeZoneOffsetMs(ms, timeZone)
  const zoned = new Date(ms + offset)
  const dayOfWeek = zoned.getUTCDay()
  const secondsSinceSundayMidnight =
    dayOfWeek * 86400 +
    zoned.getUTCHours() * 3600 +
    zoned.getUTCMinutes() * 60 +
    zoned.getUTCSeconds()
  return (secondsSinceSundayMidnight - weekStartOffsetSeconds + 604800) % 604800
}

function getZoneMinuteStart(input, timeZone) {
  const ms = typeof input === 'number' ? input : input.getTime()
  const offset = getTimeZoneOffsetMs(ms, timeZone)
  const zoned = new Date(ms + offset)
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
    normalized.push({ id, blockSlug, startTime, startMs, recurring: false })
  }
  normalized.sort(compareOccurrences)
  return normalized
}

/**
 * One-off entries merged with the rule occurrences that fall inside [fromMs, toMs].
 *
 * Rules are expanded here rather than on the server on purpose: the whole app is
 * deterministic by clock, and a rule is too, so a tab left open for a week computes the
 * same schedule as a freshly loaded one. A server-side expansion would have to pick a
 * window, and a browser that outlived it would silently drift onto a different episode.
 */
function getOccurrencesInRange(channelSlug, fromMs, toMs) {
  const oneOffs = scheduleByChannel.value?.[channelSlug] || []
  const rules = recurringByChannel.value?.[channelSlug] || []
  const merged = oneOffs.filter((entry) => entry.startMs >= fromMs && entry.startMs <= toMs)
  if (rules.length) {
    merged.push(...expandRecurringRules(rules, fromMs, toMs, scheduleTimeZone))
  }
  merged.sort(compareOccurrences)
  return merged
}

function getLatestScheduleEntry(channelSlug, nowMs) {
  return getEffectiveOccurrence(
    scheduleByChannel.value?.[channelSlug] || [],
    recurringByChannel.value?.[channelSlug] || [],
    nowMs,
    scheduleTimeZone
  )
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

function buildGuideBlocksForChannel(channel, windowStartMs, windowSeconds) {
  if (!channel) return []
  const activeSlug = channel.blockSlug
  const activePlaylist = {
    videos: channel.videos || [],
    totalDuration: channel.totalDuration || 0
  }
  if (!activeSlug || activePlaylist.videos.length === 0) return []

  const windowEndMs = windowStartMs + windowSeconds * 1000
  const entries = getOccurrencesInRange(channel.slug, windowStartMs, windowEndMs)

  const segments = []
  let cursorMs = windowStartMs
  if (cursorMs < windowEndMs) {
    const segmentEndMs = entries.length ? Math.min(entries[0].startMs, windowEndMs) : windowEndMs
    if (segmentEndMs > cursorMs) {
      // Anchor the currently-playing cell to the occurrence already in effect, exactly as
      // scheduleInfo does. Seeding it from the week anchor instead made the guide show a
      // different show than the player for the whole of the current segment — rare with
      // hand-placed entries, permanent once a channel has a daily repeat.
      const current = getLatestScheduleEntry(channel.slug, cursorMs)
      segments.push({
        startMs: cursorMs,
        endMs: segmentEndMs,
        blockSlug: activeSlug,
        scheduleStartMs: current && current.blockSlug === activeSlug ? current.startMs : null
      })
    }
    cursorMs = segmentEndMs
  }

  for (let index = 0; index < entries.length && cursorMs < windowEndMs; index += 1) {
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
      : getSecondsSinceWeekStartInZone(new Date(segment.startMs), scheduleTimeZone, weekStartOffset.value)
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
  const stamp = new Date(guideStart.value + offsetSeconds * 1000)
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
    // Every connected client receives this in the same instant, and each reload is a
    // handful of requests. Spread them over a few seconds so a block change doesn't
    // arrive as one synchronised burst against a single-process server.
    if (scheduleReloadTimer) return
    scheduleReloadTimer = window.setTimeout(() => {
      scheduleReloadTimer = null
      loadActiveBlocks({ syncPlayer: true })
    }, Math.random() * 4000)
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

// The chat identity is read from the cookie at the WebSocket handshake, so a socket
// opened while signed out stays anonymous for its whole life. Reconnect when auth flips
// (a sign-in completed in another tab, or a session that expired) instead of requiring a
// manual reload before chat works.
watch(isChatAuthorized, () => {
  if (typeof window === 'undefined') return
  if (!viewerShouldReconnect) return
  connectViewerSocket()
})

function handleAuthRecheck() {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
  refreshAuth()
}

function setChannel(index) {
  if (!channels.value.length) return
  activeChannelIndex.value = index
  const slug = channels.value[index]?.slug || ''
  if (slug) {
    channelCookie.value = slug
    // Repaints the page in the new channel's colours. One attribute write; the palette
    // itself is memoised per hex, so flipping back and forth costs a Map lookup.
    paletteSlug.value = slug
  }
  syncToSchedule(true)
}

/**
 * Restores the viewer's last channel. Must run AFTER loadActiveBlocks().
 *
 * The version this replaces ran at the top of onMounted and compared the saved index
 * against `channels.value.length` — but `channels` is `ref([])` until loadActiveBlocks
 * resolves further down the same function, so the guard was `saved < 0` and the restore
 * has never once fired. Anyone who switched channels got dropped back to channel 1 on
 * every load.
 *
 * Resolving by slug rather than index also fixes the reason an index was never right:
 * loadActiveBlocks filters to channels with an active block and re-indexes, so a stored
 * index silently points at a different channel whenever scheduling changes.
 */
function restoreSavedChannel() {
  if (typeof window === 'undefined' || !channels.value.length) return

  let slug = typeof channelCookie.value === 'string' ? channelCookie.value : ''

  if (!slug) {
    const legacy = Number.parseInt(window.localStorage.getItem(legacyStorageKey) || '', 10)
    if (Number.isFinite(legacy) && legacy >= 0 && legacy < channels.value.length) {
      slug = channels.value[legacy]?.slug || ''
    }
  }
  window.localStorage.removeItem(legacyStorageKey)

  const index = slug ? channels.value.findIndex((channel) => channel.slug === slug) : -1

  // No stored preference, or it names a channel that has since been removed or lost its
  // active block: stay on whichever channel is showing, but adopt ITS colour. Without
  // this a first-time visitor watches channel 1 under the site default palette rather
  // than that channel's own, until they happen to switch away and back.
  if (index < 0) {
    const current = channels.value[activeChannelIndex.value]?.slug || ''
    if (current) paletteSlug.value = current
    return
  }

  activeChannelIndex.value = index
  channelCookie.value = slug
  paletteSlug.value = slug
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
  if (isOn.value) {
    syncToSchedule(true)
    return
  }
  if (isDailymotionActive.value) {
    currentDailymotionStartedAt.value = 0
    if (dailymotionPlayer && typeof dailymotionPlayer.pause === 'function') {
      dailymotionPlayer.pause()
    }
    return
  }
  if (player && typeof player.pauseVideo === 'function') {
    player.pauseVideo()
  }
}

function applyVolume({ forceUnmute = false } = {}) {
  if (!canControlAudio.value || !player || typeof player.setVolume !== 'function') return
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
  if (!canControlAudio.value) return
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
  if (!canControlAudio.value || !player) return
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

function ensureDailymotionApi() {
  if (window.dailymotion && typeof window.dailymotion.createPlayer === 'function') {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const existing = document.getElementById('dm-player-api')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject())
      return
    }

    const tag = document.createElement('script')
    tag.id = 'dm-player-api'
    tag.src = 'https://geo.dailymotion.com/libs/player.js'
    tag.async = true
    tag.addEventListener('load', () => resolve())
    tag.addEventListener('error', () => reject())
    document.body.appendChild(tag)
  })
}

function logDailymotion(message, payload) {
  const prefix = '[Dailymotion]'
  if (payload !== undefined) {
    console.error(`${prefix} ${message}`, payload)
    return
  }
  console.error(`${prefix} ${message}`)
}

function bindDailymotionDebugEvents(playerInstance) {
  if (!playerInstance || dailymotionDebugBound) return
  const events = window.dailymotion?.events || {}
  const errorEvents = [
    events.PLAYER_ERROR,
    events.PLAYER_PLAYBACKPERMISSION,
    events.PLAYER_HEAVYADSINTERVENTION
  ].filter(Boolean)
  if (!errorEvents.length) return
  errorEvents.forEach((eventName) => {
    if (typeof playerInstance.on !== 'function') return
    playerInstance.on(eventName, (payload) => {
      logDailymotion(`Event ${eventName}`, payload)
    })
  })
  dailymotionDebugBound = true
}

async function checkDailymotionSync(info) {
  if (!dailymotionPlayer || dailymotionSyncPending || typeof dailymotionPlayer.getState !== 'function') return
  dailymotionSyncPending = true
  try {
    const state = await dailymotionPlayer.getState()
    const currentTime = Number(state?.videoTime)
    if (!Number.isFinite(currentTime)) return
    const desiredOffset = Number(info?.offsetSeconds || 0)
    if (!Number.isFinite(desiredOffset)) return
    if (Math.abs(currentTime - desiredOffset) <= 6) return
    if (typeof dailymotionPlayer.seek === 'function') {
      await dailymotionPlayer.seek(Math.floor(desiredOffset))
    } else {
      await ensureDailymotionPlayer(info, { forceRecreate: true })
    }
  } catch (error) {
    logDailymotion('getState/seek failed', error)
  } finally {
    dailymotionSyncPending = false
  }
}

async function ensureDailymotionPlayer(info, { forceRecreate = false } = {}) {
  if (!info?.video?.id || dailymotionInitPending) return
  dailymotionInitPending = true
  try {
    await ensureDailymotionApi()
    await nextTick()
    const container = document.getElementById('dm-player')
    if (!container) return
    if (dailymotionPlayer && typeof dailymotionPlayer.pause === 'function') {
      await dailymotionPlayer.pause()
    }
    if (forceRecreate && dailymotionPlayer && typeof dailymotionPlayer.destroy === 'function') {
      await dailymotionPlayer.destroy()
      dailymotionPlayer = null
    }
    if (!dailymotionPlayer || typeof dailymotionPlayer.load !== 'function') {
      if (dailymotionPlayer && typeof dailymotionPlayer.destroy === 'function') {
        await dailymotionPlayer.destroy()
      }
      container.innerHTML = ''
      const startTime = Math.max(0, Math.floor(info.offsetSeconds || 0))
      dailymotionPlayer = await window.dailymotion.createPlayer('dm-player', {
        video: info.video.id,
        params: { startTime }
      })
      dailymotionDebugBound = false
      bindDailymotionDebugEvents(dailymotionPlayer)
    } else {
      bindDailymotionDebugEvents(dailymotionPlayer)
      await dailymotionPlayer.load(info.video.id)
    }
    if (Number.isFinite(info.offsetSeconds) && info.offsetSeconds > 0) {
      if (typeof dailymotionPlayer.seek === 'function') {
        await dailymotionPlayer.seek(Math.floor(info.offsetSeconds))
      }
    }
  } catch (error) {
    logDailymotion('Player init/load failed', error)
  } finally {
    dailymotionInitPending = false
  }
}

function ensureYouTubePlayer(info) {
  if (player || playerReady.value || youTubeInitPending) return
  youTubeInitPending = true
  ensureYouTubeApi()
    .then(() => {
      youTubeInitPending = false
      if (!player && info?.video) {
        createYouTubePlayer(info)
      }
    })
    .catch(() => {
      youTubeInitPending = false
    })
}

function createYouTubePlayer(info) {
  if (!info?.video) return
  const initialVideo = info.video
  const startSeconds = info.offsetSeconds

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
          currentYouTubeId.value = player?.getVideoData?.().video_id || ''
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

function logActiveVideoInfo(info) {
  const video = info?.video
  if (!video) return
  const source = video.source || 'youtube'
  const id = video.id || ''
  const title = video.title || ''
  const durationSeconds = Number.isFinite(video.durationSeconds) ? video.durationSeconds : 0
  const key = `${source}:${id}`
  const meta = `${title}|${durationSeconds}`
  if (key === lastLoggedVideoKey.value && meta === lastLoggedVideoMeta.value) return
  lastLoggedVideoKey.value = key
  lastLoggedVideoMeta.value = meta
  console.log('[Player] Video', { source, id, title, durationSeconds })
}

function syncDailymotionToSchedule(info, force = false) {
  if (!info?.video) return
  needsUserAction.value = false
  if (player && typeof player.pauseVideo === 'function') {
    player.pauseVideo()
    currentYouTubeId.value = ''
  }
  const desiredId = info.video.id
  const desiredOffset = info.offsetSeconds
  if (!desiredId) {
    currentDailymotionId.value = ''
    currentDailymotionOffset.value = 0
    currentDailymotionStartedAt.value = 0
    return
  }
  let shouldLoad = force || desiredId !== currentDailymotionId.value
  if (!shouldLoad) {
    const lastStart = currentDailymotionStartedAt.value
    const elapsedSeconds = lastStart ? (now.value.getTime() - lastStart) / 1000 : 0
    const estimatedOffset = currentDailymotionOffset.value + Math.max(0, elapsedSeconds)
    if (Math.abs(estimatedOffset - desiredOffset) > 6) {
      shouldLoad = true
    }
  }
  if (shouldLoad || !dailymotionPlayer) {
    currentDailymotionId.value = desiredId
    currentDailymotionOffset.value = desiredOffset
    currentDailymotionStartedAt.value = now.value.getTime()
    void ensureDailymotionPlayer(info)
  } else {
    void checkDailymotionSync(info)
  }
}

function syncToSchedule(force = false) {
  if (!isOn.value || !channels.value.length) return
  const info = scheduleInfo.value
  if (!info || !info.video) return

  logActiveVideoInfo(info)

  if (info.video.source === 'dailymotion') {
    syncDailymotionToSchedule(info, force)
    return
  }

  if (currentDailymotionId.value && dailymotionPlayer) {
    currentDailymotionStartedAt.value = 0
    if (typeof dailymotionPlayer.pause === 'function') {
      dailymotionPlayer.pause()
    }
  }

  if (!player || !playerReady.value) {
    ensureYouTubePlayer(info)
    return
  }

  const desiredId = info.video.id
  const desiredOffset = info.offsetSeconds

  let shouldLoad = force || desiredId !== currentYouTubeId.value

  if (!shouldLoad) {
    const currentTime = player.getCurrentTime?.() ?? 0
    if (Math.abs(currentTime - desiredOffset) > 6) {
      shouldLoad = true
    }
  }

  if (shouldLoad) {
    currentYouTubeId.value = desiredId
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

    const recurringSource =
      scheduleResponse?.recurring && typeof scheduleResponse.recurring === 'object'
        ? scheduleResponse.recurring
        : {}
    const recurringMap = {}
    for (const [slug, rules] of Object.entries(recurringSource)) {
      // Re-normalised client-side: the stored JSON is not the only route in here, and a
      // malformed rule must degrade to "no rule" rather than throw during expansion.
      const normalized = normalizeRecurringList(rules)
      recurringMap[slug] = normalized
      for (const rule of normalized) {
        if (rule.blockSlug) scheduledBlockSlugs.add(rule.blockSlug)
      }
    }
    recurringByChannel.value = recurringMap

    const blockSlugs = new Set()
    for (const channel of list) {
      const blockSlug = typeof active?.[channel.slug] === 'string' ? active[channel.slug] : ''
      if (blockSlug) blockSlugs.add(blockSlug)
    }
    for (const slug of scheduledBlockSlugs) {
      blockSlugs.add(slug)
    }

    // Only fetch blocks we don't already hold. Every schedule_update broadcast makes all
    // connected clients re-run this at once; refetching the full set each time turned one
    // block change into (viewers x blocks) requests in a single burst, and recurring
    // rules reference more distinct blocks than one-off entries did.
    const payloads = { ...blockPayloadCache }
    const missing = [...blockSlugs].filter((slug) => !(slug in payloads))
    await Promise.all(
      missing.map(async (blockSlug) => {
        try {
          const response = await $fetch(`/api/blocks/${blockSlug}`)
          payloads[blockSlug] = response?.payload || null
        } catch (error) {
          payloads[blockSlug] = null
        }
      })
    )

    // Drop anything no longer referenced so the cache cannot grow without bound.
    for (const slug of Object.keys(payloads)) {
      if (!blockSlugs.has(slug)) delete payloads[slug]
    }
    blockPayloadCache = payloads

    const playlists = {}
    for (const slug of blockSlugs) {
      playlists[slug] = buildPlaylist(payloads[slug], slug, 'Video')
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
    recurringByChannel.value = {}
    blockPlaylists.value = {}
    blockPayloadCache = {}
  }
}

// A scheduled colour starts and ends on a civil-date boundary, so there is exactly one
// moment a left-open tab needs to hear about: the next local midnight, which the server
// already computed as theme.revalidateAt. One timer, not a poll.
//
// Skipped entirely under prefers-reduced-motion. Recolouring the whole page under
// someone who is sitting reading it, with no interaction of their own, is a large
// involuntary visual change — exactly what that preference is asking us not to do. They
// get the palette the page loaded with until they reload.
function scheduleThemeRevalidate() {
  if (typeof window === 'undefined') return
  window.clearTimeout(themeRevalidateTimer)
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

  const at = Number(scheduleSettings.value?.theme?.revalidateAt)
  if (!Number.isFinite(at)) return
  // setTimeout clamps above ~24.8 days and fires immediately on a negative delay; both
  // are reachable with a skewed clock, so bound the wait and re-arm rather than trust it.
  const delay = Math.min(Math.max(at - Date.now(), 60_000), 6 * 3600_000)
  themeRevalidateTimer = window.setTimeout(async () => {
    await refreshSettings()
    scheduleThemeRevalidate()
  }, delay)
}

// Without this the only way out of theater mode is the Controls tab, which is not the
// default tab — so a viewer who toggles it on while reading chat has no visible exit.
function handleTheaterKeydown(event) {
  if (event.key !== 'Escape' || !theaterMode.value) return
  theaterMode.value = false
}

onMounted(async () => {
  window.addEventListener('keydown', handleTheaterKeydown)
  viewerId.value = getOrCreateViewerId()
  pageSessionId.value = getOrCreatePageSessionId()
  hasLoadedChannel.value = true
  injectSupportButton()
  clockInterval = window.setInterval(() => {
    now.value = new Date()
  }, 1000)

  await loadActiveBlocks()
  restoreSavedChannel()
  scheduleThemeRevalidate()
  viewerShouldReconnect = true
  connectViewerSocket()
  syncToSchedule(true)

  resizeObserver = new ResizeObserver(() => {
    syncPlayerSize()
  })
  if (screenInner.value) {
    resizeObserver.observe(screenInner.value)
  }

  syncInterval = window.setInterval(() => {
    syncToSchedule(false)
  }, 15000)

  // Picks up a sign-in completed in another tab, and a session that expired while this
  // one sat open.
  document.addEventListener('visibilitychange', handleAuthRecheck)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleTheaterKeydown)
  if (clockInterval) window.clearInterval(clockInterval)
  if (syncInterval) window.clearInterval(syncInterval)
  if (themeRevalidateTimer) window.clearTimeout(themeRevalidateTimer)
  if (resizeObserver) resizeObserver.disconnect()
  if (player && player.destroy) player.destroy()
  if (dailymotionPlayer && typeof dailymotionPlayer.destroy === 'function') {
    dailymotionPlayer.destroy()
  }
  viewerShouldReconnect = false
  if (viewerReconnectTimer) window.clearTimeout(viewerReconnectTimer)
  if (viewerHelloTimer) window.clearTimeout(viewerHelloTimer)
  if (scheduleReloadTimer) window.clearTimeout(scheduleReloadTimer)
  if (viewerSocket) viewerSocket.close()
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleAuthRecheck)
  }
})
</script>

<style scoped>
.page {
  font-weight: 500;
  min-height: 100vh;
  padding: clamp(14px, 3vw, 24px);
  overflow-x: hidden;
  background: radial-gradient(circle at top, var(--cr-surface-page-top) 0%, var(--cr-surface-1) 45%, var(--cr-surface-root) 100%);
  color: var(--cr-text);
  font-family: var(--cr-font);
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
  background: linear-gradient(90deg, var(--cr-surface-4), var(--cr-surface-titlebar-mid) 60%, var(--cr-surface-titlebar-end));
  border: 2px solid var(--cr-line-3);
  border-radius: 12px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
  margin-bottom: 24px;
}

.brand {
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* min-width:0 is load-bearing now the tagline is admin-supplied: a flex item defaults
     to min-width:auto and cannot shrink below its min-content width, so one long
     unbroken token (a URL, a hashtag) would push the title-bar past its own border and
     get clipped by .page's overflow-x:hidden with no way to scroll to it. */
  min-width: 0;
  flex: 1 1 auto;
}

.brand-mark {
  font-size: 27px;
  letter-spacing: 0.09em;
  color: var(--cr-accent);
  text-shadow: 0 0 12px color-mix(in srgb, var(--cr-accent) 40%, transparent);
}

.brand-sub {
  font-size: 13px;
  letter-spacing: 0.02em;
  color: var(--cr-text-muted-4);
  /* Breaks unbroken tokens, and hard-caps header growth at two lines so a long tagline
     can never push the TV further below the fold. Same clamp pattern as
     .announcement-text. */
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  /* Keeps a stray RTL run from reordering the line around it. */
  unicode-bidi: isolate;
}

.clock {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-family: var(--cr-font);
}

.clock-label {
  font-size: 12px;
  color: var(--cr-text-muted-2);
  text-transform: uppercase;
  letter-spacing: 2px;
}

.clock-time {
  font-variant-numeric: tabular-nums;
  font-size: 22px;
  color: var(--cr-text-bright);
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
  background: linear-gradient(135deg, var(--cr-bezel-0), var(--cr-bezel-40) 40%, var(--cr-bezel-100) 100%);
  border-radius: clamp(18px, 4vw, 32px);
  padding: clamp(14px, 3vw, 22px);
  box-shadow: 0 18px 30px rgba(0, 0, 0, 0.55);
  border: 3px solid var(--cr-bezel-rim);
}

.screen {
  background: var(--cr-surface-screen);
  border-radius: clamp(12px, 3vw, 18px);
  padding: clamp(10px, 2.6vw, 18px);
  border: 2px solid var(--cr-line-subtle);
  min-height: 0;
}

.screen-inner {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
  background: radial-gradient(circle at center, var(--cr-surface-glow) 0%, var(--cr-surface-screen-in) 70%);
  min-height: 0;
  /* .scanlines below uses mix-blend-mode: multiply. Nothing between here and the root
     element established a stacking context, so the blend group climbed to the document
     and its backdrop was the whole page. Pinning it here bounds the blend to the video
     box and makes the effect immune to any ancestor later gaining opacity/filter/
     transform/contain — several of which are natural ways to write a "dim everything
     but the video" mode. The backdrop here is already opaque, so this is a visual no-op. */
  isolation: isolate;
}

.player-shell {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.dm-player {
  border: 0;
}

.dm-player #dm-player {
  width: 100%;
  height: 100%;
}

.player-shell :deep(iframe),
.player-shell :deep(div) {
  width: 100%;
  height: 100%;
}

.screen-inner.off .player-shell {
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
  letter-spacing: 0.1em;
  color: var(--cr-text-muted-3);
  text-shadow: 0 0 12px var(--cr-accent-glow);
  background: radial-gradient(circle at center, var(--cr-surface-screen-off) 0%, var(--cr-surface-void) 80%);
}

.audio-overlay {
  position: absolute;
  bottom: 18px;
  right: 18px;
  padding: 10px 16px;
  border-radius: 999px;
  border: 1px solid var(--cr-text-ctrl);
  background: var(--cr-scrim-overlay);
  color: var(--cr-text-ctrl);
  font-family: var(--cr-font);
  font-size: 15px;
  cursor: pointer;
}

.channel-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 12px;
  padding: 14px 8px 0;
  font-family: var(--cr-font);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--cr-accent);
  text-transform: uppercase;
  letter-spacing: 0.08em;
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

  .player-shell {
    overflow: hidden;
    inset: 0;
    width: 100% !important;
    height: 100% !important;
  }

  .player-shell :deep(iframe) {
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
  :global(iframe.player-shell),
  :global(iframe.dm-player) {
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

  /* ---- Theater mode, desktop half -------------------------------------------
     This is the only breakpoint where theater changes layout. Below 1201px the
     page is already a single stacked column, so there is nothing to reclaim. */

  .page.theater .tv-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  /* Everything above stretches the TV to match the sidebar column's height and
     center-crops a 16:9 iframe into whatever box that produces. With no column
     beside it, .screen-inner has no height driver at all and would collapse to
     zero, so the stretch has to be unwound and a real 16:9 ratio restored. */
  .page.theater .tv-frame {
    align-self: start;
  }

  .page.theater .bezel {
    height: auto;
    display: block;
    /* Size the set so the whole picture is visible without scrolling.
       Two things make this less obvious than it looks:

       1. svh, not vh — vh resolves against the toolbar-retracted viewport, so a
          vh-derived size is taller than what is actually on screen. Not dvh
          either: a height-derived *width* recomputed on every frame of a mobile
          toolbar slide would drive the ResizeObserver -> player.setSize path
          continuously. svh is the static, pessimistic value, which is what a
          "guarantee it fits" constraint wants.
       2. The floor is normal mode's own picture width, not an arbitrary minimum.
          Above the fold there is ~400px of chrome here (page padding, the
          announcement, the title bar, the cabinet and the channel strip), so on a
          short viewport a strict fit would compute a picture NARROWER than the one
          you get with the sidebar still attached — theater would be a downgrade.
          Flooring at `100% - sidebar - gap` means theater is never worse than
          normal, and is genuinely bigger whenever the viewport has the height for it.

       rem units so the chrome allowance tracks the user's font size at 200% zoom. */
    max-width: min(
      100%,
      max(
        calc(100% - var(--controls-max) - 24px),
        calc((100svh - var(--theater-chrome)) * 16 / 9)
      )
    );
    margin-inline: auto;
  }

  .page.theater .screen {
    flex: none;
    display: block;
  }

  .page.theater .screen-inner {
    flex: none;
    height: auto;
    aspect-ratio: 16 / 9;
  }

  /* Undo the center-crop. Specificity is the whole game here and it is easy to get
     wrong. The rule being overridden is :global(iframe#yt-player) above, which
     carries an ID — (1,0,1) — and both sides mark width/height !important, so the
     tie is settled by specificity. A plain `:deep(iframe)` override is only (0,4,1)
     and loses, because no number of classes outranks one ID. Repeating the ID
     *inside* :deep() compiles to `.page.theater .player-shell[data-v] iframe#yt-player`
     = (1,4,1), which wins honestly.
     Do NOT write this as `.page.theater :global(iframe#yt-player)`: :global() drops
     everything to its left, so that compiles to a bare `iframe#yt-player` which
     outranks nothing but, sitting later in the sheet, silently un-crops the player
     in normal desktop mode too. (Verified against the built CSS.) */
  .page.theater .player-shell,
  .page.theater .player-shell :deep(iframe),
  .page.theater .player-shell :deep(iframe#yt-player) {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    width: 100% !important;
    height: 100% !important;
    min-width: 0;
    min-height: 0;
    max-width: none;
    max-height: none;
    transform: none !important;
  }

  /* The panel and the ads move below the picture rather than away. Side by side,
     because a 1550px-wide chat log is unreadable and a 1550px-wide ad banner is a
     728px creative upscaled 2.1x. Ads stay in the first column to match their DOM
     position — using `order` here would put tab order and visual order in conflict. */
  .page.theater .controls {
    display: grid;
    grid-template-columns: minmax(0, var(--controls-max)) minmax(0, 1fr);
    align-items: start;
    gap: 24px;
    max-width: 100%;
    justify-self: stretch;
  }

  .page.theater .promo-stack {
    max-width: var(--controls-max);
  }

  /* .promo-stack is v-if'd away when no ads are enabled, which would drop the panel into
     the narrow ad column and waste the whole wide one — the guide would come out no
     bigger than it is with the sidebar attached. Collapse to one column and hold the
     panel to the width it would have had beside the ads, so it measures the same
     either way. */
  .page.theater .controls:not(:has(> .promo-stack)) {
    grid-template-columns: minmax(0, 1fr);
  }

  .page.theater .controls:not(:has(> .promo-stack)) .panel {
    max-width: calc(100% - var(--controls-max) - 24px);
    margin-inline: auto;
  }
}

.channel-name {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
  overflow-wrap: anywhere;
}

.channel-name-text {
  white-space: nowrap;
}

.support-slot {
  display: inline-flex;
  text-transform: none;
  letter-spacing: normal;
  font-size: 13px;
}

.channel-name a[data-patreon-widget-type] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid var(--cr-accent-border);
  background: linear-gradient(180deg, color-mix(in srgb, var(--cr-chip-grad-0) 95%, transparent), color-mix(in srgb, var(--cr-chip-grad-1) 95%, transparent));
  color: var(--cr-accent);
  font-size: 13px;
  text-transform: none;
  letter-spacing: 0.5px;
  text-decoration: none;
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.35);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.channel-name a[data-patreon-widget-type]:hover {
  border-color: var(--cr-accent);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.4);
  transform: translateY(-1px);
}

.channel-name a[data-patreon-widget-type]:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--cr-accent) 90%, transparent);
  outline-offset: 2px;
}

.channel-status {
  padding: 4px 10px;
  border: 1px solid var(--cr-accent);
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

.promo-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.promo-slot {
  display: block;
  min-width: 0;
}

.promo-banner {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 10px;
  /* Reserves the box before the bytes arrive. The inline aspect-ratio from the stored
     intrinsic size wins where we know it; this is the fallback for older records. */
  background: var(--cr-surface-3);
}

.announcement {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: var(--content-max);
  margin: 0 auto 16px;
  padding: 10px 14px;
  border: 1px solid var(--cr-line-2);
  border-radius: 12px;
  background: linear-gradient(90deg, var(--cr-surface-4), var(--cr-surface-titlebar-end));
  color: var(--cr-text);
  font-size: 14px;
}

.announcement-text {
  margin: 0;
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
}

.announcement-link {
  color: var(--cr-accent);
  white-space: nowrap;
  flex: 0 0 auto;
}

.announcement-dismiss {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  border: 1px solid var(--cr-line-2);
  border-radius: 10px;
  background: transparent;
  color: var(--cr-text-muted-5);
  font-size: 14px;
  cursor: pointer;
}

.strip-link {
  color: var(--cr-accent);
}

.panel {
  flex: 1;
  max-width: 100%;
  background: linear-gradient(180deg, var(--cr-surface-3), var(--cr-surface-panel-bot) 80%);
  border-radius: 20px;
  padding: 18px;
  border: 2px solid var(--cr-line-2);
  box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.6);
}

.panel-header {
  font-size: 18px;
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-bottom: 12px;
  color: var(--cr-accent);
}

.panel-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.viewer-inline {
  font-size: 10px;
  color: var(--cr-text-muted-4);
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
  color: var(--cr-text-muted-4);
}

.now-name {
  font-size: 18px;
  margin-top: 6px;
}

.now-time {
  font-variant-numeric: tabular-nums;
  font-family: var(--cr-font);
  font-size: 16px;
  margin-top: 4px;
  color: var(--cr-text-lcd);
}


.panel-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.tab-button {
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--cr-line-2) 60%, transparent);
  background: rgba(0, 0, 0, 0.2);
  color: var(--cr-text-ctrl);
  padding: 8px 10px;
  font-family: var(--cr-font);
  text-transform: uppercase;
  letter-spacing: 1px;
  font-size: 12px;
  cursor: pointer;
}

.tab-button.active {
  border-color: var(--cr-accent);
  color: var(--cr-accent);
  background: var(--cr-accent-soft-2);
}

.panel-section {
  display: grid;
  gap: 12px;
  border: 1px dashed color-mix(in srgb, var(--cr-line-2) 60%, transparent);
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
  /* Already a clipping scroll container, so `paint` changes nothing visually; `layout`
     makes it a layout root so the theater grid change does not re-lay-out the whole
     message list as part of the ancestor reflow. */
  contain: layout paint;
}

.chat-message {
  display: grid;
  grid-template-columns: minmax(90px, auto) minmax(0, 1fr);
  column-gap: 10px;
  align-items: start;
  font-family: var(--cr-font);
  color: var(--cr-text);
}

.chat-message.system {
  font-style: italic;
  color: var(--cr-text-dim-1);
  grid-template-columns: minmax(0, 1fr);
}

.chat-user {
  font-size: 14px;
  color: var(--cr-accent);
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
  border: 1px solid color-mix(in srgb, var(--cr-line-2) 60%, transparent);
  background: rgba(0, 0, 0, 0.2);
  font-size: 12px;
  color: var(--cr-text-muted-4);
}

.chat-auth-error {
  color: var(--cr-warning);
}

.chat-auth.signed-in {
  font-size: 12px;
  opacity: 0.85;
}

.chat-auth a {
  text-decoration: none;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--cr-line-3);
  color: var(--cr-text);
  font-family: var(--cr-font);
  font-size: 12px;
}

.chat-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.chat-input input {
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--cr-line-2) 60%, transparent);
  background: rgba(0, 0, 0, 0.3);
  color: var(--cr-text);
  padding: 8px 10px;
  font-family: var(--cr-font);
  font-size: 16px;
}

.chat-input button {
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--cr-line-2) 60%, transparent);
  background: var(--cr-accent-soft-2);
  color: var(--cr-accent);
  padding: 8px 14px;
  font-family: var(--cr-font);
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

/* A third button in the shared 2-up grid would orphan onto a second row, and a 3-up
   grid leaves ~42px of text width in the 280px minimum panel column. */
.controls-row.single {
  grid-template-columns: minmax(0, 1fr);
}

.theater-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.toggle-glyph {
  font-size: 12px;
  line-height: 1;
}

.theater-hint {
  margin: -4px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--cr-text-muted-5);
}

.volume-control {
  margin-bottom: 16px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--cr-line-strong) 45%, transparent);
  background: rgba(0, 0, 0, 0.3);
}

.volume-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  text-transform: uppercase;
  letter-spacing: 2px;
  font-size: 11px;
  color: var(--cr-text-muted-4);
  margin-bottom: 10px;
}

.volume-value {
  font-variant-numeric: tabular-nums;
  font-family: var(--cr-font);
  font-size: 18px;
  color: var(--cr-text-lcd);
  text-transform: none;
  letter-spacing: 1px;
}

.volume-slider {
  width: 100%;
  appearance: none;
  height: 6px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--cr-slider-track-0), var(--cr-accent) 55%, var(--cr-slider-track-1));
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
  background: var(--cr-text-ctrl);
  border: 2px solid var(--cr-surface-btn-top);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
}

.volume-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--cr-text-ctrl);
  border: 2px solid var(--cr-surface-btn-top);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
}

.volume-scale {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 10px;
  color: var(--cr-text-dim-2);
  letter-spacing: 1px;
}

.dial,
.toggle,
.channel-button {
  font-family: var(--cr-font);
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 10px 12px;
  /* These render ~39px tall, under the 44px touch-target floor that
     .announcement-dismiss already observes. */
  min-height: 44px;
  border-radius: 12px;
  border: 1px solid var(--cr-line-strong);
  background: linear-gradient(180deg, var(--cr-surface-btn-top), var(--cr-surface-btn-bot));
  color: var(--cr-text-ctrl);
  cursor: pointer;
  box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.6);
}

.toggle.active,
.channel-button.active {
  border-color: var(--cr-accent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--cr-accent) 40%, transparent);
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
  color: var(--cr-text-muted-4);
  display: flex;
  align-items: center;
}

.guide-left-row {
  font-size: 13px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--cr-line-strong) 40%, transparent);
  display: flex;
  align-items: center;
}

.guide-scroll {
  overflow-x: auto;
  padding-bottom: 6px;
  /* Same reasoning as .chat-log: this is a ~3000px-wide scrolling grid, and without a
     layout root the theater column change reflows all of it. */
  contain: layout paint;
}

.guide-header {
  display: flex;
  font-family: var(--cr-font);
  text-transform: uppercase;
  align-items: center;
  height: 44px;
}

.guide-hour {
  font-variant-numeric: tabular-nums;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--cr-line-strong) 35%, transparent);
  border-right: none;
  color: var(--cr-accent);
  background: rgba(0, 0, 0, 0.4);
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.guide-hour:last-child {
  border-right: 1px solid color-mix(in srgb, var(--cr-line-strong) 35%, transparent);
}

.guide-row {
  display: flex;
  align-items: center;
  height: 44px;
  margin-top: 8px;
}

.guide-block {
  height: 100%;
  background: linear-gradient(135deg, color-mix(in srgb, var(--cr-guide-block-0) 95%, transparent), color-mix(in srgb, var(--cr-guide-block-1) 95%, transparent));
  border: 1px solid color-mix(in srgb, var(--cr-line-strong) 50%, transparent);
  border-right: none;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  overflow: hidden;
  flex-shrink: 0;
}

.guide-block:last-child {
  border-right: 1px solid color-mix(in srgb, var(--cr-line-strong) 50%, transparent);
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
  color: var(--cr-text-muted-5);
}

.code {
  font-family: var(--cr-font-mono);
  font-size: 14px;
}

/* ===========================================================================
   Theater mode — dimming
   ---------------------------------------------------------------------------
   The chrome recedes by re-pointing the --cr-* tokens at darker values, NOT by
   putting opacity on the subtree.

   Group opacity was the obvious approach and it is the wrong one here. It
   composites text and its background toward the backdrop together, so it breaks
   theme.css's documented ">=4.5:1 against every surface" contract at any useful
   strength (body text lands at 2.65:1 at 35%); it multiplies with the opacities
   already nested inside these regions (.channel-status.off is 0.6, :disabled is
   0.5); it dims the :focus-visible ring along with everything else; it cannot
   preserve pairs that had no headroom to begin with (.panel's border is 3.18:1
   today, so it fails 1.4.11 at *any* dim level); it dims ad creatives whose
   internal contrast we do not control; and forced-colors mode does not override
   it, so the users who asked the OS for maximum contrast would be the ones who
   could not turn it off.

   Re-mapping tokens keeps every ratio conformant by construction. Verified
   across all 25 text and non-text pairs in these regions: none drops below AA,
   and six improve — including the .panel border (3.18 -> 3.41) and the volume
   slider track (2.79 -> 3.36), both of which are marginal or failing today.
   Meanwhile the panel surface loses 66% of its luminance and body text 32%, so
   the chrome genuinely recedes.

   Nothing inside .tv-frame is touched: the bezel, the screen and the channel
   banner are the television, which is the one thing this mode must not dim.
   Keeping .channel-banner out also avoids compounding with .channel-status.off.
   =========================================================================== */

.page.theater {
  /* Flat instead of the radial gradient — this is the "lights down" cue, and a
     full-viewport gradient is also among the more expensive things to raster. */
  background: var(--cr-surface-root);

  /* Vertical space the picture cannot have, used by the .bezel cap above. Measured
     rather than guessed: page padding + the title bar sit ~250px above the picture
     when the announcement is showing, ~170px when it is not, plus a little for the
     channel strip underneath.

     This budgets for the picture fitting, not the whole cabinet — reserving the
     cabinet's bottom edge and the page's bottom padding as well left ~110px of
     viewport height unused and made theater *smaller* than normal mode on a 900px
     screen. The last inch of the bezel may now fall below the fold; the picture
     never does. */
  --theater-chrome: 15rem;
}

.page.theater:has(> .announcement) {
  --theater-chrome: 20rem;
}

/* Written as :not(...) rather than a separate restore rule: when the region is
   hovered or focused the selector simply stops matching and the tokens inherit
   their normal values from :root again.

   :has(:focus-visible), not :focus-within. The theater toggle lives inside
   .controls, so with :focus-within the very act of clicking it left the button
   focused and cancelled the dim on the panel — the mode looked broken until you
   clicked somewhere else. :focus-visible is not set by a mouse click on a button,
   so the panel dims immediately, while keyboard focus and the chat text field
   (which always matches :focus-visible) still restore it.

   Deliberately not transitioned: a transition would repaint these regions for
   ~15 frames on every pointer edge crossing, and the layout half of this mode
   snaps anyway, so a fading recolour beside an instant reflow reads as a glitch. */
.page.theater .title-bar:not(:hover):not(:has(:focus-visible)),
.page.theater .announcement:not(:hover):not(:has(:focus-visible)),
.page.theater .controls:not(:hover):not(:has(:focus-visible)) {
  --cr-surface-3: var(--cr-ch-theater-surface-3, #0a0f15);
  --cr-surface-4: var(--cr-ch-theater-surface-4, #080d13);
  --cr-surface-panel-bot: var(--cr-ch-theater-surface-panel-bot, #0a141d);
  --cr-surface-titlebar-mid: var(--cr-ch-theater-surface-titlebar-mid, #0a121a);
  --cr-surface-titlebar-end: var(--cr-ch-theater-surface-titlebar-end, #071722);
  --cr-surface-btn-top: var(--cr-ch-theater-surface-btn-top, #0a1f2e);
  --cr-surface-btn-bot: var(--cr-ch-theater-surface-btn-bot, #07141e);

  --cr-text: var(--cr-ch-theater-text, #b9cdda);
  --cr-text-bright: var(--cr-ch-theater-text-bright, #bcd4e0);
  --cr-text-ctrl: var(--cr-ch-theater-text-ctrl, #9dc0d2);
  --cr-text-lcd: var(--cr-ch-theater-text-lcd, #96b9cb);
  --cr-text-muted-2: var(--cr-ch-theater-text-muted-2, #87a9bb);
  --cr-text-muted-4: var(--cr-ch-theater-text-muted-4, #7ba0b3);
  --cr-text-muted-5: var(--cr-ch-theater-text-muted-5, #749cb0);
  --cr-text-dim-1: var(--cr-ch-theater-text-dim-1, #6f95a8);
  --cr-text-dim-2: var(--cr-ch-theater-text-dim-2, #6d93a6);
  --cr-accent: var(--cr-ch-theater-accent, #7fb4cd);

  --cr-line-2: var(--cr-ch-theater-line-2, #2a6d95);
  --cr-line-3: var(--cr-ch-theater-line-3, #2f7ba6);
  --cr-line-strong: var(--cr-ch-theater-line-strong, #3789b5);
  --cr-brand-400: var(--cr-ch-theater-brand-400, #1f9ed6);
  --cr-slider-track-0: var(--cr-ch-theater-slider-track-0, #0a6d96);
  --cr-slider-track-1: var(--cr-ch-theater-slider-track-1, #b5d2e0);
}

/* Ads are images, so the token remap does not reach them. This is the one place
   a real opacity is used, kept mild and lifted on hover: the banners have to stay
   legible and clickable, since dimming them is not meant to cost impressions. */
.page.theater .promo-slot:not(:hover):not(:has(:focus-visible)) .promo-banner {
  opacity: 0.8;
}

/* Theater is layout-only for anyone who has asked for maximum contrast or reduced
   transparency. The widened picture is free; only the recolouring is dropped.

   The values below are the :root values restated, not `initial` — `initial` on a
   custom property means the guaranteed-invalid value, so every var() referencing it
   would fail rather than fall back to the theme. If a browser does not understand
   these media features the block simply never applies, which is the safe direction:
   the dim it would have undone is itself AA-conformant.

   They restate the CHANNEL palette (`var(--cr-ch-x, <shipped literal>)`), not the
   shipped blue, so that cancelling the dim restores whatever :root currently holds.
   Restating the blue literals here would be wrong for a viewer who has asked only for
   reduced transparency: theme.css resets :root to the audited blue for forced-colors
   and prefers-contrast, but deliberately not for that one, so this block would have
   painted blue chrome onto an otherwise recoloured page. */
@media (forced-colors: active),
  (prefers-contrast: more),
  (prefers-contrast: custom),
  (prefers-reduced-transparency: reduce) {
  .page.theater .title-bar:not(:hover):not(:has(:focus-visible)),
  .page.theater .announcement:not(:hover):not(:has(:focus-visible)),
  .page.theater .controls:not(:hover):not(:has(:focus-visible)) {
    --cr-surface-3: var(--cr-ch-surface-3, #151c25);
    --cr-surface-4: var(--cr-ch-surface-4, #18212b);
    --cr-surface-panel-bot: var(--cr-ch-surface-panel-bot, #142739);
    --cr-surface-titlebar-mid: var(--cr-ch-surface-titlebar-mid, #1c2d3e);
    --cr-surface-titlebar-end: var(--cr-ch-surface-titlebar-end, #0d324c);
    --cr-surface-btn-top: var(--cr-ch-surface-btn-top, #0e334d);
    --cr-surface-btn-bot: var(--cr-ch-surface-btn-bot, #0c2336);

    --cr-text: var(--cr-ch-text, #e4f1f9);
    --cr-text-bright: var(--cr-ch-text-bright, #e2f5fe);
    --cr-text-ctrl: var(--cr-ch-text-ctrl, #c0e7fa);
    --cr-text-lcd: var(--cr-ch-text-lcd, #bce3f6);
    --cr-text-muted-2: var(--cr-ch-text-muted-2, #a3cbe0);
    --cr-text-muted-4: var(--cr-ch-text-muted-4, #89bdd6);
    --cr-text-muted-5: var(--cr-ch-text-muted-5, #80bbd6);
    --cr-text-dim-1: var(--cr-ch-text-dim-1, #77b0cc);
    --cr-text-dim-2: var(--cr-ch-text-dim-2, #75afca);
    --cr-accent: var(--cr-ch-accent, #9fe0ff);

    --cr-line-2: var(--cr-ch-line-2, #25709e);
    --cr-line-3: var(--cr-ch-line-3, #4096c6);
    --cr-line-strong: var(--cr-ch-line-strong, #359acc);
    --cr-brand-400: var(--cr-ch-brand-400, #0ba0df);
    --cr-slider-track-0: var(--cr-ch-slider-track-0, #016794);
    --cr-slider-track-1: var(--cr-ch-slider-track-1, #cbe9ff);
  }

  .page.theater .promo-slot .promo-banner {
    opacity: 1;
  }
}

@media (max-width: 1200px) {
  .page {
    padding: 16px;
  }

  .panel {
    order: 1;
  }

  .promo-stack {
    order: 2;
  }

  /* Cap the stack on phones: an unbounded column of banners otherwise pushes
     the controls far below the fold. */
  .promo-stack > .promo-slot:nth-child(n + 3) {
    display: none;
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

  /* ---- Theater mode, small-screen half ---------------------------------------
     The column is already stacked here, so there is no sidebar to reclaim and the
     desktop rules would be a no-op. What is left to give is edge-to-edge width:
     drop the page gutter and square off the bezel so the picture runs the full
     width of the device. The recolouring above still applies, and it needs no
     hover to stay readable — which matters because touch has no hover. */
  .page.theater {
    padding-inline: 0;
  }

  .page.theater .title-bar,
  .page.theater .announcement {
    border-radius: 0;
    border-inline: 0;
  }

  .page.theater .bezel {
    border-radius: 0;
    border-inline: 0;
  }

  .page.theater .controls,
  .page.theater .channel-banner {
    padding-inline: 16px;
  }
}

@media (max-width: 600px) {
  .channel-name {
    flex-basis: 100%;
    order: 3;
    justify-content: center;
  }

  .announcement {
    font-size: 13px;
  }

  .announcement-text {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .title-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  /* The bar stacks into a left-aligned column here, but .clock keeps align-items:flex-end
     and renders its text right-aligned inside a shrink-to-fit box. Barely noticeable at
     one line; obvious once a two-line tagline makes the header taller. */
  .clock {
    align-items: flex-start;
  }

  .channel-banner {
    padding: 10px 5px;
  }
}
</style>
