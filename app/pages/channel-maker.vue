<template>
  <div class="maker-page">
    <header class="maker-header">
      <div>
        <h1>Channel Maker</h1>
        <p>Pick a channel, edit video IDs, and export updated JSON.</p>
      </div>
      <div class="maker-actions">
        <a v-if="!isAuthorized" class="secondary" href="/api/auth/discord/login">
          Sign in with Discord
        </a>
        <div v-else class="auth-meta">
          <span class="auth-label">Signed in</span>
          <a class="secondary" href="/api/auth/logout">Sign out</a>
        </div>
        <button v-if="isAuthorized" class="secondary" type="button" @click="resetChannelToFile">
          Pull Current
        </button>
        <button v-if="isAuthorized" class="primary" type="button" @click="saveChannel">
          Save Channel
        </button>
      </div>
    </header>

    <section v-if="isAuthorized" class="maker-controls">
      <label class="field">
        <span>Channel</span>
        <select v-model.number="selectedChannelIndex">
          <option v-for="(channel, index) in editableChannels" :key="channel.name" :value="index">
            {{ channel.name }}
          </option>
        </select>
      </label>
      <button class="primary add-row" type="button" @click="addRow">
        + Add Video
      </button>
      <div class="helper">
        Paste this export into <span class="code">assets/channels/{{ selectedChannelSlug }}.json</span>.
      </div>
    </section>

    <section v-if="isAuthorized" class="maker-table">
      <div class="table-head">
        <span></span>
        <span>#</span>
        <span>Start</span>
        <span>Video ID</span>
        <span>Preview</span>
        <span>Title</span>
        <span>Length (sec)</span>
        <span>Status</span>
        <span></span>
      </div>
      <template v-for="(row, index) in selectedChannel?.videos ?? []" :key="row._uid">
        <div
          class="table-row"
          :class="{
            dragging: row._uid === dragUid,
            'drag-target': index === hoverIndex && row._uid !== dragUid
          }"
          @dragover.prevent
          @dragenter.prevent="onDragEnter(index)"
          @drop="onDrop()"
        >
          <button
            class="drag-handle"
            type="button"
            draggable="true"
            aria-label="Drag to reorder"
            @dragstart="onDragStart(row, $event)"
            @dragend="onDragEnd"
          >
            ⠿
          </button>
          <span class="cell-index">{{ index + 1 }}</span>
          <span class="cell-start">{{ formatClockOffset(getStartSeconds(index)) }}</span>
          <input
            v-model.trim="row.id"
            type="text"
            class="cell-input"
            placeholder="YouTube ID or URL"
            @input="queueUpdate(row, index)"
            @blur="updateVideoInfo(row, index)"
          />
          <div class="cell-preview">
            <img
              v-if="getPreviewUrl(row.id)"
              :src="getPreviewUrl(row.id)"
              alt=""
              loading="lazy"
            />
          </div>
          <input
            v-model.trim="row.title"
            type="text"
            class="cell-input"
            placeholder="Video title"
          />
          <input
            v-model.number="row.durationSeconds"
            type="number"
            min="0"
            class="cell-input"
          />
          <span class="cell-status">{{ getFetchStatus(index) }}</span>
          <button class="delete-row" type="button" @click="removeRow(index)">Delete</button>
        </div>
        <div class="insert-line">
          <button
            class="insert-button"
            type="button"
            aria-label="Add video here"
            @click="insertRow(index + 1)"
          >
            +
          </button>
          <span class="insert-rule"></span>
        </div>
      </template>
    </section>

    <section v-if="isAuthorized" class="export">
      <label>Export JSON</label>
      <textarea readonly :value="exportJson"></textarea>
      <p class="note">
        Titles and durations are fetched server-side. If a video is restricted, fill in the fields manually.
      </p>
    </section>
    <section v-else class="locked">
      <h2>Sign in required</h2>
      <p>Only approved Discord accounts can access the Channel Maker.</p>
      <a class="primary" href="/api/auth/discord/login">Sign in with Discord</a>
    </section>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import toonamiData from '../assets/channels/toonami.json'
import adultSwimData from '../assets/channels/adult-swim.json'
import saturdayMorningData from '../assets/channels/saturday-morning.json'

const selectedChannelIndex = ref(0)
const fetchStatus = ref({})
let videoUidCounter = 0
const dragUid = ref(null)
const hoverIndex = ref(null)
const updateTimers = ref({})
const storagePrefix = 'crt80:channel:'
let isLoadingFromStorage = false
const { data: authData } = await useFetch('/api/auth/me')
const isAuthorized = computed(() => authData.value?.authenticated)

function makeSlug(name, index) {
  return (name || `channel-${index + 1}`).toLowerCase().replace(/\s+/g, '-')
}

function toPlainChannel(channel, index) {
  const name = channel?.channel || channel?.name || `Channel ${index + 1}`
  const slug = makeSlug(name, index)
  const videos = Array.isArray(channel?.videos) ? channel.videos : []
  return {
    name,
    slug,
    videos: videos.map((video) => ({
      id: typeof video.id === 'string' ? video.id : '',
      title: typeof video.title === 'string' ? video.title : '',
      durationSeconds: Number(video.durationSeconds) || 0
    }))
  }
}

function toEditableChannel(plainChannel, index) {
  return {
    name: plainChannel.name,
    slug: plainChannel.slug || makeSlug(plainChannel.name, index),
    videos: plainChannel.videos.map((video) => ({
      id: video.id,
      title: video.title,
      durationSeconds: Number(video.durationSeconds) || 0,
      _uid: `vid-${index}-${videoUidCounter++}`
    }))
  }
}

function addRow() {
  if (!isAuthorized.value) return
  const rows = selectedChannel.value?.videos
  if (!rows) return
  rows.push({
    id: '',
    title: '',
    durationSeconds: 0,
    _uid: `vid-new-${videoUidCounter++}`
  })
}

function insertRow(index) {
  if (!isAuthorized.value) return
  const rows = selectedChannel.value?.videos
  if (!rows) return
  rows.splice(index, 0, {
    id: '',
    title: '',
    durationSeconds: 0,
    _uid: `vid-new-${videoUidCounter++}`
  })
}

function removeRow(index) {
  if (!isAuthorized.value) return
  const rows = selectedChannel.value?.videos
  if (!rows || rows.length <= 1) return
  rows.splice(index, 1)
}

const fileChannels = [toonamiData, adultSwimData, saturdayMorningData].map((channel, index) =>
  toPlainChannel(channel, index)
)

const editableChannels = ref(fileChannels.map((channel, index) => toEditableChannel(channel, index)))

const selectedChannel = computed(() => editableChannels.value[selectedChannelIndex.value])
const selectedChannelSlug = computed(() => selectedChannel.value?.slug || 'channel')

const exportJson = computed(() => {
  const channel = selectedChannel.value
  if (!channel) return ''
  const payload = {
    channel: channel.name,
    note: 'Replace each id with a YouTube video ID and durationSeconds with the full length in seconds.',
    videos: channel.videos.map((video) => ({
      id: video.id,
      title: video.title,
      durationSeconds: Number(video.durationSeconds) || 0
    }))
  }
  return JSON.stringify(payload, null, 2)
})

function getStorageKey(slug) {
  return `${storagePrefix}${slug}`
}

function saveChannelToStorage(channel) {
  if (!import.meta.client || !channel || isLoadingFromStorage || !isAuthorized.value) return
  const payload = {
    channel: channel.name,
    note: 'Replace each id with a YouTube video ID and durationSeconds with the full length in seconds.',
    videos: channel.videos.map((video) => ({
      id: video.id,
      title: video.title,
      durationSeconds: Number(video.durationSeconds) || 0
    }))
  }
  window.localStorage.setItem(getStorageKey(channel.slug), JSON.stringify(payload))
}

function loadChannelFromStorage(index) {
  if (!import.meta.client) return
  const fallback = fileChannels[index]
  if (!fallback) return
  const key = getStorageKey(fallback.slug)
  const stored = window.localStorage.getItem(key)
  if (!stored) {
    editableChannels.value.splice(index, 1, toEditableChannel(fallback, index))
    return
  }
  try {
    const parsed = JSON.parse(stored)
    const plain = toPlainChannel(parsed, index)
    isLoadingFromStorage = true
    editableChannels.value.splice(index, 1, toEditableChannel(plain, index))
  } catch (error) {
    editableChannels.value.splice(index, 1, toEditableChannel(fallback, index))
  } finally {
    isLoadingFromStorage = false
  }
}

function resetChannelToFile() {
  if (!isAuthorized.value) return
  const index = selectedChannelIndex.value
  const fallback = fileChannels[index]
  if (!fallback) return
  editableChannels.value.splice(index, 1, toEditableChannel(fallback, index))
  if (import.meta.client) {
    window.localStorage.setItem(getStorageKey(fallback.slug), JSON.stringify(fallback))
  }
}

function getFetchStatus(index) {
  return fetchStatus.value[`${selectedChannelIndex.value}-${index}`] || ''
}

function setFetchStatus(index, status) {
  fetchStatus.value[`${selectedChannelIndex.value}-${index}`] = status
}

function formatClockOffset(seconds) {
  const total = Math.max(0, Math.floor(seconds))
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function getStartSeconds(index) {
  const rows = selectedChannel.value?.videos ?? []
  let cursor = 0
  for (let i = 0; i < index; i += 1) {
    cursor += Number(rows[i]?.durationSeconds) || 0
  }
  return cursor
}

function normalizeVideoId(input) {
  if (!input) return ''
  const trimmed = input.trim()
  try {
    const url = new URL(trimmed)
    const host = url.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      return url.pathname.replace('/', '')
    }
    if (host.includes('youtube.com')) {
      const param = url.searchParams.get('v')
      if (param) return param
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts[0] === 'shorts' || parts[0] === 'embed') {
        return parts[1] || ''
      }
    }
  } catch (error) {
    // Not a URL, fall back to regex.
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

function getPreviewUrl(id) {
  const videoId = normalizeVideoId(id)
  if (!videoId) return ''
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

async function fetchFromServer(videoId) {
  const response = await fetch(`/api/youtube-info?id=${encodeURIComponent(videoId)}`)
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || `Request failed (${response.status})`)
  }
  return response.json()
}

async function updateVideoInfo(row, index) {
  const videoId = normalizeVideoId(row.id)
  if (!videoId || !import.meta.client || !isAuthorized.value) return
  if (videoId !== row.id) row.id = videoId
  setFetchStatus(index, 'Loading...')
  try {
    const apiResult = await fetchFromServer(videoId)
    if (apiResult?.title) row.title = apiResult.title
    if (Number.isFinite(apiResult?.durationSeconds)) {
      row.durationSeconds = apiResult.durationSeconds
    }
    setFetchStatus(index, apiResult?.title ? 'OK' : 'Not found')
  } catch (error) {
    setFetchStatus(index, error?.message || 'Error')
  }
}

async function saveChannel() {
  if (!import.meta.client || !isAuthorized.value) return
  const channel = selectedChannel.value
  if (!channel) return
  try {
    await $fetch('/api/channel/save', {
      method: 'POST',
      body: {
        slug: channel.slug,
        payload: JSON.parse(exportJson.value)
      }
    })
    alert('Channel saved to JSON file.')
  } catch (error) {
    alert('Save failed. Check server logs for details.')
  }
}

function queueUpdate(row, index) {
  const trimmed = row.id?.trim() || ''
  if (trimmed.includes('youtube.com') || trimmed.includes('youtu.be') || trimmed.startsWith('http')) {
    const normalized = normalizeVideoId(trimmed)
    if (normalized && normalized !== row.id) {
      row.id = normalized
    }
  }
  const key = `${selectedChannelIndex.value}-${index}`
  if (updateTimers.value[key]) {
    window.clearTimeout(updateTimers.value[key])
  }
  updateTimers.value[key] = window.setTimeout(() => {
    updateVideoInfo(row, index)
  }, 600)
}

function onDragStart(row, event) {
  dragUid.value = row._uid
  hoverIndex.value = null
  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', row._uid || '')
  }
}

function onDragEnter(targetIndex) {
  if (dragUid.value === null) return
  const rows = selectedChannel.value?.videos
  if (!rows) return
  const fromIndex = rows.findIndex((row) => row._uid === dragUid.value)
  if (fromIndex < 0 || fromIndex === targetIndex) return
  const [moved] = rows.splice(fromIndex, 1)
  rows.splice(targetIndex, 0, moved)
  hoverIndex.value = targetIndex
}

function onDragEnd() {
  dragUid.value = null
  hoverIndex.value = null
}

function onDrop() {
  dragUid.value = null
  hoverIndex.value = null
}

watch(selectedChannelIndex, (index) => {
  loadChannelFromStorage(index)
})

watch(
  selectedChannel,
  (channel) => {
    saveChannelToStorage(channel)
  },
  { deep: true }
)

onMounted(() => {
  loadChannelFromStorage(selectedChannelIndex.value)
})

</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=VT323&family=Orbitron:wght@400;600&display=swap');

:global(html),
:global(body) {
  margin: 0;
  padding: 0;
  background: #070707;
}

.maker-page {
  min-height: 100vh;
  padding: 24px;
  background: radial-gradient(circle at top, #2b2e35 0%, #101015 45%, #070707 100%);
  color: #f7f0d8;
  font-family: 'Orbitron', sans-serif;
}

.maker-header {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 18px;
}

.maker-header h1 {
  margin: 0 0 6px;
  font-size: 26px;
}

.maker-header p {
  margin: 0;
  color: #d9caa3;
}

.maker-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
}

.field {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: #cab688;
}

.field input,
.field select {
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid #7c6845;
  background: #1a1b20;
  color: #f7e4b4;
  font-family: 'Orbitron', sans-serif;
}

.primary {
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid #f9d98f;
  background: #3a2c1c;
  color: #f7e4b4;
  cursor: pointer;
}

.secondary {
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid #7c6845;
  background: #1a1b20;
  color: #f7e4b4;
  cursor: pointer;
}

.auth-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #cab688;
}

.auth-label {
  text-transform: uppercase;
  letter-spacing: 1px;
}

.maker-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  margin-bottom: 18px;
}

.helper {
  font-size: 12px;
  color: #cab688;
}

.code {
  font-family: 'VT323', monospace;
  font-size: 14px;
}

.maker-table {
  background: rgba(0, 0, 0, 0.35);
  border-radius: 14px;
  border: 1px solid #5e4a2f;
  padding: 12px;
  overflow-x: auto;
}

.table-head,
.table-row {
  display: grid;
  grid-template-columns: 36px 40px 90px 1.1fr 110px 1.5fr 120px 120px 90px;
  gap: 10px;
  align-items: center;
}

.table-head {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #cab688;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(201, 174, 122, 0.2);
  margin-bottom: 8px;
}

.table-row {
  padding: 6px 0;
}

.table-row.dragging {
  opacity: 0.5;
}

.table-row.drag-target {
  outline: 2px dashed rgba(249, 217, 143, 0.6);
  outline-offset: 2px;
}

.drag-handle {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid #5e4a2f;
  background: #1a1b20;
  color: #f7e4b4;
  cursor: grab;
}

.drag-handle:active {
  cursor: grabbing;
}

.cell-preview {
  width: 100px;
  height: 56px;
  border-radius: 8px;
  border: 1px solid rgba(181, 138, 86, 0.5);
  background: rgba(0, 0, 0, 0.35);
  display: grid;
  place-items: center;
  overflow: hidden;
}

.cell-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cell-input {
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid #5e4a2f;
  background: #141418;
  color: #f7e4b4;
  font-family: 'Orbitron', sans-serif;
}

.cell-status {
  font-size: 12px;
  color: #f9d98f;
}

.add-row {
  height: fit-content;
}

.delete-row {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid #b45b4f;
  background: #2a1f13;
  color: #f0c6b4;
  cursor: pointer;
}

.insert-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0 10px;
}

.insert-button {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid rgba(249, 217, 143, 0.8);
  background: rgba(24, 20, 14, 0.8);
  color: #f7e4b4;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.insert-rule {
  flex: 1;
  height: 1px;
  background: rgba(181, 138, 86, 0.5);
}

.insert-line:hover .insert-rule {
  background: rgba(249, 217, 143, 0.7);
}

.export {
  margin-top: 18px;
  display: grid;
  gap: 8px;
}

.export textarea {
  width: 100%;
  min-height: 220px;
  border-radius: 12px;
  border: 1px solid #5e4a2f;
  background: #141418;
  color: #f7e4b4;
  padding: 12px;
  font-family: 'VT323', monospace;
  font-size: 14px;
}

.note {
  font-size: 12px;
  color: #cab688;
}

.locked {
  margin-top: 40px;
  padding: 24px;
  border-radius: 16px;
  border: 1px solid #7c6845;
  background: rgba(0, 0, 0, 0.4);
  text-align: center;
}

.locked h2 {
  margin: 0 0 8px;
}

.locked p {
  margin: 0 0 16px;
  color: #cab688;
}

@media (max-width: 900px) {
  .maker-page {
    padding: 16px;
  }

  .table-head,
  .table-row {
    grid-template-columns: 32px 36px 70px 1fr 80px 1fr 90px 80px 80px;
  }
}
</style>
