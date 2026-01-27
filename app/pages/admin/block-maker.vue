<template>
  <div class="maker-page">
    <AdminNav />
    <header class="maker-header">
      <div>
        <h1>Block Maker</h1>
        <p>Create or update blocks, then save them to JSON files.</p>
      </div>
      <div class="maker-actions">
        <a v-if="!isAuthorized" class="secondary" href="/api/auth/discord/login?redirect=/admin">
          Sign in with Discord
        </a>
        <a class="secondary" href="/admin">Back to Admin</a>
        <button v-if="isAuthorized" class="primary" type="button" @click="saveBlock">
          Save Block
        </button>
      </div>
    </header>

    <section v-if="isAuthorized" class="maker-controls">
      <label class="field">
        <span>Block Name</span>
        <input v-model.trim="blockName" type="text" placeholder="Saturday Morning Mix" />
      </label>
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
      <template v-for="(row, index) in rows" :key="row._uid">
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
              @click="openPreview(row)"
            />
          </div>
          <input v-model.trim="row.title" type="text" class="cell-input" placeholder="Video title" />
          <input v-model.number="row.durationSeconds" type="number" min="0" class="cell-input" />
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

    <section v-if="isAuthorized" class="maker-cards">
      <template v-for="(row, index) in rows" :key="row._uid">
        <article
          class="video-card"
          :class="{
            dragging: row._uid === dragUid,
            'drag-target': index === hoverIndex && row._uid !== dragUid
          }"
          @dragover.prevent
          @dragenter.prevent="onDragEnter(index)"
          @drop="onDrop()"
        >
          <div class="card-head">
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
            <div class="card-meta">
              <span class="card-index">#{{ index + 1 }}</span>
              <span class="card-start">{{ formatClockOffset(getStartSeconds(index)) }}</span>
            </div>
            <button class="delete-row" type="button" @click="removeRow(index)">Delete</button>
          </div>
          <div class="card-body">
            <label class="card-field">
              <span>Video ID</span>
              <input
                v-model.trim="row.id"
                type="text"
                class="cell-input"
                placeholder="YouTube ID or URL"
                @input="queueUpdate(row, index)"
                @blur="updateVideoInfo(row, index)"
              />
            </label>
            <div class="cell-preview">
              <img
                v-if="getPreviewUrl(row.id)"
                :src="getPreviewUrl(row.id)"
                alt=""
                loading="lazy"
                @click="openPreview(row)"
              />
            </div>
            <label class="card-field">
              <span>Title</span>
              <input v-model.trim="row.title" type="text" class="cell-input" placeholder="Video title" />
            </label>
            <label class="card-field">
              <span>Length (sec)</span>
              <input v-model.number="row.durationSeconds" type="number" min="0" class="cell-input" />
            </label>
          </div>
          <div class="card-status">Status: {{ getFetchStatus(index) || 'Idle' }}</div>
        </article>
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

    <section v-else class="locked">
      <h2>Sign in required</h2>
      <p>Only approved Discord accounts can access the Block Maker.</p>
      <a class="primary" href="/api/auth/discord/login?redirect=/admin">Sign in with Discord</a>
    </section>

    <div v-if="isPreviewOpen" class="preview-overlay" @click.self="closePreview">
      <div class="preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-title">
        <div class="preview-header">
          <h3 id="preview-title">{{ previewTitle || 'Preview' }}</h3>
          <button class="secondary" type="button" @click="closePreview">Close</button>
        </div>
        <div class="preview-body">
          <div class="preview-screen">
            <div class="preview-screen-inner">
              <iframe
                v-if="previewEmbedUrl"
                :key="previewEmbedUrl"
                class="preview-player"
                :src="previewEmbedUrl"
                title="Video preview"
                frameborder="0"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowfullscreen
              ></iframe>
              <div class="preview-scanlines"></div>
              <div class="preview-vignette"></div>
            </div>
          </div>
        </div>
        <div class="preview-footer">
          <span class="status">TV Preview</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const route = useRoute()
const router = useRouter()

const { data: authData } = await useFetch('/api/auth/me')
const isAuthorized = computed(() => authData.value?.authenticated && authData.value?.allowed)

const blockName = ref('')
const blockSlug = ref('')
const rows = ref([])
const fetchStatus = ref({})
const dragUid = ref(null)
const hoverIndex = ref(null)
const updateTimers = ref({})
const isPreviewOpen = ref(false)
const previewVideoId = ref('')
const previewTitle = ref('')
let videoUidCounter = 0

function toRow(video) {
  return {
    id: typeof video?.id === 'string' ? video.id : '',
    title: typeof video?.title === 'string' ? video.title : '',
    durationSeconds: Number(video?.durationSeconds) || 0,
    _uid: `vid-${videoUidCounter++}`
  }
}

function ensureRows() {
  if (!rows.value.length) {
    rows.value.push({ id: '', title: '', durationSeconds: 0, _uid: `vid-${videoUidCounter++}` })
  }
}

function loadFromPayload(payload) {
  blockName.value = typeof payload?.channel === 'string' ? payload.channel : ''
  const videos = Array.isArray(payload?.videos) ? payload.videos : []
  rows.value = videos.map((video) => toRow(video))
  fetchStatus.value = {}
  ensureRows()
}

function buildPayload() {
  return {
    channel: blockName.value || 'Block',
    note: 'Replace each id with a YouTube video ID and durationSeconds with the full length in seconds.',
    videos: rows.value.map((video) => ({
      id: video.id,
      title: video.title,
      durationSeconds: Number(video.durationSeconds) || 0
    }))
  }
}

function addRow() {
  if (!isAuthorized.value) return
  rows.value.push({ id: '', title: '', durationSeconds: 0, _uid: `vid-${videoUidCounter++}` })
}

function insertRow(index) {
  if (!isAuthorized.value) return
  rows.value.splice(index, 0, { id: '', title: '', durationSeconds: 0, _uid: `vid-${videoUidCounter++}` })
}

function removeRow(index) {
  if (!isAuthorized.value) return
  if (rows.value.length <= 1) return
  rows.value.splice(index, 1)
}

function getFetchStatus(index) {
  return fetchStatus.value[index] || ''
}

function setFetchStatus(index, status) {
  fetchStatus.value[index] = status
}

function formatClockOffset(seconds) {
  const total = Math.max(0, Math.floor(seconds))
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function getStartSeconds(index) {
  let cursor = 0
  for (let i = 0; i < index; i += 1) {
    cursor += Number(rows.value[i]?.durationSeconds) || 0
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

const previewEmbedUrl = computed(() => {
  if (!previewVideoId.value) return ''
  const params = new URLSearchParams({
    autoplay: '1',
    controls: '0',
    rel: '0',
    modestbranding: '1',
    playsinline: '1'
  })
  return `https://www.youtube.com/embed/${previewVideoId.value}?${params.toString()}`
})

function openPreview(row) {
  const videoId = normalizeVideoId(row?.id)
  if (!videoId) return
  previewVideoId.value = videoId
  previewTitle.value = row?.title || 'Preview'
  isPreviewOpen.value = true
}

function closePreview() {
  isPreviewOpen.value = false
  previewVideoId.value = ''
  previewTitle.value = ''
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

function queueUpdate(row, index) {
  const trimmed = row.id?.trim() || ''
  if (trimmed.includes('youtube.com') || trimmed.includes('youtu.be') || trimmed.startsWith('http')) {
    const normalized = normalizeVideoId(trimmed)
    if (normalized && normalized !== row.id) {
      row.id = normalized
    }
  }
  if (!import.meta.client) return
  if (updateTimers.value[index]) {
    window.clearTimeout(updateTimers.value[index])
  }
  updateTimers.value[index] = window.setTimeout(() => {
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
  const fromIndex = rows.value.findIndex((row) => row._uid === dragUid.value)
  if (fromIndex < 0 || fromIndex === targetIndex) return
  const [moved] = rows.value.splice(fromIndex, 1)
  rows.value.splice(targetIndex, 0, moved)
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

async function loadBlock(slug) {
  if (!isAuthorized.value) return
  if (!import.meta.client) return
  const cleanSlug = typeof slug === 'string' ? slug : ''
  if (!cleanSlug) {
    blockSlug.value = ''
    blockName.value = ''
    rows.value = []
    fetchStatus.value = {}
    ensureRows()
    return
  }
  try {
    const response = await $fetch(`/api/blocks/${cleanSlug}`)
    blockSlug.value = response?.slug || cleanSlug
    loadFromPayload(response?.payload || {})
  } catch (error) {
    blockSlug.value = cleanSlug
    rows.value = []
    fetchStatus.value = {}
    ensureRows()
    alert('Failed to load block. Check server logs for details.')
  }
}

async function saveBlock() {
  if (!import.meta.client || !isAuthorized.value) return
  const name = blockName.value.trim()
  if (!name) {
    alert('Please enter a block name before saving.')
    return
  }
  const currentSlug =
    blockSlug.value || (typeof route.query.block === 'string' ? route.query.block : '')
  const normalizedName = name.toLowerCase()
  try {
    const blocksResponse = await $fetch('/api/blocks')
    const blocksList = Array.isArray(blocksResponse?.blocks) ? blocksResponse.blocks : []
    const conflict = blocksList.find((block) => {
      const blockNameValue = String(block?.name || '').trim().toLowerCase()
      if (!blockNameValue) return false
      if (currentSlug && block?.slug === currentSlug) return false
      return blockNameValue === normalizedName
    })
    if (conflict) {
      alert('Save failed: block name already exists. Please choose a unique name.')
      return
    }
  } catch (error) {
    const statusMessage =
      error?.data?.statusMessage ||
      error?.response?._data?.statusMessage ||
      error?.message ||
      'Unable to check block names.'
    alert(`Save failed: ${statusMessage}`)
    return
  }
  try {
    const response = await $fetch('/api/blocks/save', {
      method: 'POST',
      body: {
        slug: blockSlug.value || null,
        name,
        payload: buildPayload()
      }
    })
    if (response?.slug) {
      blockSlug.value = response.slug
    }
    router.push('/admin')
  } catch (error) {
    const statusMessage =
      error?.data?.statusMessage ||
      error?.response?._data?.statusMessage ||
      error?.message ||
      ''
    if (String(statusMessage).toLowerCase().includes('block name already exists')) {
      alert('Save failed: block name already exists. Please choose a unique name.')
      return
    }
    alert(`Save failed: ${statusMessage || 'Unknown error'}`)
  }
}

watch(
  isAuthorized,
  (value) => {
    if (!value) return
    const slug = typeof route.query.block === 'string' ? route.query.block : ''
    if (slug) {
      loadBlock(slug)
    } else {
      ensureRows()
    }
  },
  { immediate: true }
)

watch(
  () => route.query.block,
  (value) => {
    if (!isAuthorized.value) return
    const slug = typeof value === 'string' ? value : ''
    loadBlock(slug)
  }
)
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
  align-items: center;
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
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.secondary {
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid #7c6845;
  background: #1a1b20;
  color: #f7e4b4;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
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

.cell-status {
  font-size: 12px;
  color: #f9d98f;
}

.maker-cards {
  display: none;
  gap: 16px;
}

.video-card {
  background: rgba(0, 0, 0, 0.35);
  border-radius: 14px;
  border: 1px solid #5e4a2f;
  padding: 14px;
  display: grid;
  gap: 12px;
}

.video-card.dragging {
  opacity: 0.5;
}

.video-card.drag-target {
  outline: 2px dashed rgba(249, 217, 143, 0.6);
  outline-offset: 2px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: #cab688;
}

.card-index {
  font-size: 13px;
  color: #f7e4b4;
}

.card-start {
  font-family: 'VT323', monospace;
  font-size: 14px;
}

.card-body {
  display: grid;
  grid-template-columns: 1.6fr 110px 1.6fr 160px;
  gap: 12px;
  align-items: center;
}

.card-field {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: #cab688;
}

.card-field span {
  text-transform: uppercase;
  letter-spacing: 1px;
}

.card-status {
  font-size: 12px;
  color: #f9d98f;
  text-transform: uppercase;
  letter-spacing: 1px;
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
  cursor: pointer;
}

.cell-input {
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid #5e4a2f;
  background: #141418;
  color: #f7e4b4;
  font-family: 'Orbitron', sans-serif;
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

.preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(4, 4, 6, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1000;
}

.preview-modal {
  width: min(920px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #1a1b20, #2a2419 80%);
  border-radius: 16px;
  border: 1px solid #7c6845;
  box-shadow: 0 18px 30px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.preview-header,
.preview-footer {
  padding: 14px 18px;
  background: rgba(11, 10, 9, 0.7);
  border-bottom: 1px solid rgba(124, 104, 69, 0.5);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.preview-header h3 {
  margin: 0;
  font-size: 18px;
}

.preview-body {
  padding: 18px;
  overflow-y: auto;
}

.preview-footer {
  border-top: 1px solid rgba(124, 104, 69, 0.5);
  border-bottom: none;
}

.preview-screen {
  background: #1b1c1d;
  border-radius: 14px;
  padding: 18px;
  border: 2px solid #4f422c;
}

.preview-screen-inner {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
  background: radial-gradient(circle at center, #243f2e 0%, #0b0c0d 70%);
}

.preview-player {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
}

.preview-scanlines,
.preview-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.preview-scanlines {
  background: repeating-linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.15),
    rgba(0, 0, 0, 0.15) 2px,
    transparent 2px,
    transparent 4px
  );
  mix-blend-mode: multiply;
}

.preview-vignette {
  box-shadow: inset 0 0 80px rgba(0, 0, 0, 0.6);
}

@media (max-width: 900px) {
  .maker-page {
    padding: 16px;
  }

  .maker-table {
    display: none;
  }

  .maker-cards {
    display: grid;
  }

  .card-body {
    grid-template-columns: 1fr;
  }
}
</style>
