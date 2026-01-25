<template>
  <div class="blocks-page">
    <header class="blocks-header">
      <div>
        <h1>Blocks</h1>
        <p>Manage block playlists and set which block is active on each channel.</p>
      </div>
      <div class="blocks-actions">
        <a v-if="!isAuthorized" class="secondary" href="/api/auth/discord/login">
          Sign in with Discord
        </a>
        <a v-if="isAuthorized" class="primary" href="/block-maker">Create Block</a>
      </div>
    </header>

    <section v-if="isAuthorized" class="channels-section">
      <div class="section-header">
        <h2>Channel Blocks</h2>
        <span class="status">{{ isLoading ? 'Loading...' : `${channels.length} channels` }}</span>
      </div>
      <div class="channels-grid">
        <article v-for="channel in channels" :key="channel.slug" class="channel-card">
          <div class="channel-card-head">
            <div>
              <h3>{{ channel.name }}</h3>
              <p class="channel-slug">{{ channel.slug }}</p>
            </div>
            <span class="active-label">Active</span>
          </div>
          <div class="active-block">
            <span class="label">Current block</span>
            <strong>{{ getBlockName(activeBlocks[channel.slug]) }}</strong>
          </div>
          <div class="channel-controls">
            <label class="field">
              <span>Set active block</span>
              <select
                v-model="selectedBlocks[channel.slug]"
                @change="setActiveBlock(channel.slug, selectedBlocks[channel.slug])"
              >
                <option value="">No active block</option>
                <option v-for="block in blocks" :key="block.slug" :value="block.slug">
                  {{ block.name }}
                </option>
              </select>
            </label>
          </div>
        </article>
      </div>
    </section>

    <section v-if="isAuthorized" class="blocks-section">
      <div class="section-header">
        <h2>All Blocks</h2>
        <span class="status">{{ blocks.length }} blocks</span>
      </div>
      <div class="blocks-table">
        <div class="table-head">
          <span>Name</span>
          <span>Created</span>
          <span>Created By</span>
          <span>Updated</span>
          <span>Updated By</span>
          <span></span>
        </div>
        <div v-if="!blocks.length" class="empty">No blocks yet. Create your first block.</div>
        <div v-for="block in pagedBlocks" :key="block.slug" class="table-row">
          <div class="block-name">
            <span>{{ block.name }}</span>
            <small>{{ block.slug }}</small>
          </div>
          <span>{{ formatDate(block.createdAt) }}</span>
          <span>{{ formatUser(block.createdBy) }}</span>
          <span>{{ formatDate(block.updatedAt) }}</span>
          <span>{{ formatUser(block.updatedBy) }}</span>
          <div class="row-actions">
            <a class="secondary" :href="`/block-maker?block=${block.slug}`">Edit</a>
            <button class="danger" type="button" @click="confirmDelete(block)">Delete</button>
          </div>
        </div>
      </div>
      <div class="blocks-cards">
        <div v-if="!blocks.length" class="empty">No blocks yet. Create your first block.</div>
        <article v-for="block in pagedBlocks" :key="block.slug" class="block-card">
          <div class="card-title">
            <h3>{{ block.name }}</h3>
            <span class="card-slug">{{ block.slug }}</span>
          </div>
          <div class="card-meta">
            <div>
              <span class="meta-label">Created</span>
              <span class="meta-value">{{ formatDate(block.createdAt) }}</span>
              <span class="meta-sub">{{ formatUser(block.createdBy) }}</span>
            </div>
            <div>
              <span class="meta-label">Updated</span>
              <span class="meta-value">{{ formatDate(block.updatedAt) }}</span>
              <span class="meta-sub">{{ formatUser(block.updatedBy) }}</span>
            </div>
          </div>
          <div class="card-actions">
            <a class="secondary" :href="`/block-maker?block=${block.slug}`">Edit</a>
            <button class="danger" type="button" @click="confirmDelete(block)">Delete</button>
          </div>
        </article>
      </div>
      <div v-if="totalPages > 1" class="pagination">
        <button class="secondary" type="button" :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">
          Prev
        </button>
        <span class="page-label">Page {{ currentPage }} of {{ totalPages }}</span>
        <button
          class="secondary"
          type="button"
          :disabled="currentPage === totalPages"
          @click="goToPage(currentPage + 1)"
        >
          Next
        </button>
      </div>
    </section>

    <section v-else class="locked">
      <h2>Sign in required</h2>
      <p>Only approved Discord accounts can access Blocks.</p>
      <a class="primary" href="/api/auth/discord/login">Sign in with Discord</a>
    </section>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import toonamiData from '../assets/channels/toonami.json'
import adultSwimData from '../assets/channels/adult-swim.json'
import saturdayMorningData from '../assets/channels/saturday-morning.json'

const { data: authData } = await useFetch('/api/auth/me')
const isAuthorized = computed(() => authData.value?.authenticated)

const channels = [
  { slug: 'toonami', name: toonamiData?.channel || 'Toonami' },
  { slug: 'adult-swim', name: adultSwimData?.channel || 'Adult Swim' },
  { slug: 'saturday-morning', name: saturdayMorningData?.channel || 'Saturday Morning' }
]

const blocks = ref([])
const activeBlocks = ref({})
const selectedBlocks = ref({})
const isLoading = ref(false)
const currentPage = ref(1)
const pageSize = 50

function getBlockName(slug) {
  if (!slug) return 'None'
  const found = blocks.value.find((block) => block.slug === slug)
  return found?.name || slug
}

function formatDate(value) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function formatUser(value) {
  if (!value) return 'Unknown'
  const text = String(value).trim()
  if (!text) return 'Unknown'
  if (/^\\d+$/.test(text)) return 'Unknown'
  return text
}

const totalPages = computed(() => {
  const total = Math.ceil(blocks.value.length / pageSize)
  return total > 0 ? total : 1
})

const pagedBlocks = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return blocks.value.slice(start, start + pageSize)
})

function goToPage(page) {
  const next = Math.min(Math.max(1, page), totalPages.value)
  currentPage.value = next
}

async function refreshAll() {
  if (!isAuthorized.value) return
  if (!import.meta.client) return
  isLoading.value = true
  try {
    const [blocksResponse, activeResponse] = await Promise.all([
      $fetch('/api/blocks'),
      $fetch('/api/blocks/active')
    ])
    blocks.value = Array.isArray(blocksResponse?.blocks) ? blocksResponse.blocks : []
    activeBlocks.value = activeResponse?.active || {}
    selectedBlocks.value = { ...activeBlocks.value }
    if (currentPage.value > totalPages.value) {
      currentPage.value = totalPages.value
    }
  } catch (error) {
    alert('Failed to load blocks. Check server logs for details.')
  } finally {
    isLoading.value = false
  }
}

async function setActiveBlock(channelSlug, selection) {
  if (!isAuthorized.value) return
  const nextSlug = selection ?? selectedBlocks.value?.[channelSlug] ?? ''
  try {
    await $fetch('/api/blocks/active', {
      method: 'POST',
      body: {
        channelSlug,
        blockSlug: nextSlug || ''
      }
    })
    activeBlocks.value = { ...activeBlocks.value, [channelSlug]: nextSlug || '' }
  } catch (error) {
    alert('Failed to update active block. Check server logs for details.')
  }
}

async function confirmDelete(block) {
  if (!isAuthorized.value) return
  const name = block?.name || block?.slug || 'this block'
  const ok = window.confirm(`Delete \"${name}\"? This cannot be undone.`)
  if (!ok) return
  try {
    await $fetch('/api/blocks/delete', {
      method: 'POST',
      body: { slug: block.slug }
    })
    await refreshAll()
    if (currentPage.value > totalPages.value) {
      currentPage.value = totalPages.value
    }
  } catch (error) {
    alert('Failed to delete block. Check server logs for details.')
  }
}

watch(
  isAuthorized,
  (value) => {
    if (value) {
      refreshAll()
    }
  },
  { immediate: true }
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

.blocks-page {
  min-height: 100vh;
  padding: 24px;
  background: radial-gradient(circle at top, #2b2e35 0%, #101015 45%, #070707 100%);
  color: #f7f0d8;
  font-family: 'Orbitron', sans-serif;
}

.blocks-header {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 18px;
}

.blocks-header h1 {
  margin: 0 0 6px;
  font-size: 26px;
}

.blocks-header p {
  margin: 0;
  color: #d9caa3;
}

.blocks-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
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

.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 20px 0 12px;
}

.section-header h2 {
  margin: 0;
  font-size: 20px;
}

.status {
  font-size: 12px;
  color: #cab688;
}

.channels-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.channel-card {
  background: rgba(0, 0, 0, 0.35);
  border-radius: 14px;
  border: 1px solid #5e4a2f;
  padding: 16px;
  display: grid;
  gap: 12px;
}

.channel-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.channel-card h3 {
  margin: 0;
  font-size: 18px;
}

.channel-slug {
  margin: 4px 0 0;
  font-size: 12px;
  color: #cab688;
}

.active-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #f9d98f;
}

.active-block {
  display: grid;
  gap: 6px;
}

.active-block .label {
  font-size: 11px;
  color: #cab688;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.channel-controls {
  display: grid;
  gap: 10px;
}

.field {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: #cab688;
}

.field select {
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid #7c6845;
  background: #1a1b20;
  color: #f7e4b4;
  font-family: 'Orbitron', sans-serif;
}

.blocks-table {
  background: rgba(0, 0, 0, 0.35);
  border-radius: 14px;
  border: 1px solid #5e4a2f;
  padding: 12px;
  overflow-x: auto;
}

.blocks-cards {
  display: none;
  gap: 12px;
}

.block-card {
  border-radius: 14px;
  border: 1px solid #5e4a2f;
  background: rgba(0, 0, 0, 0.35);
  padding: 14px;
  display: grid;
  gap: 12px;
}

.card-title h3 {
  margin: 0;
  font-size: 18px;
}

.card-slug {
  font-size: 11px;
  color: #cab688;
}

.card-meta {
  display: grid;
  gap: 10px;
}

.meta-label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #cab688;
}

.meta-value {
  display: block;
  font-size: 13px;
}

.meta-sub {
  display: block;
  font-size: 12px;
  color: #cab688;
}

.card-actions {
  display: flex;
  gap: 8px;
}

.table-head,
.table-row {
  display: grid;
  grid-template-columns: 1.4fr 0.9fr 0.9fr 0.9fr 0.9fr 160px;
  gap: 12px;
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
  padding: 10px 0;
  border-bottom: 1px solid rgba(201, 174, 122, 0.12);
}

.table-row:last-child {
  border-bottom: none;
}

.block-name {
  display: grid;
  gap: 4px;
}

.block-name small {
  font-size: 11px;
  color: #cab688;
}

.row-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.danger {
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid #b45b4f;
  background: #2a1f13;
  color: #f0c6b4;
  cursor: pointer;
  font-family: 'Orbitron', sans-serif;
}

.pagination {
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  color: #cab688;
}

.pagination button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.page-label {
  font-size: 12px;
}

.empty {
  padding: 16px 0;
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
  .blocks-page {
    padding: 16px;
  }

  .channels-grid {
    grid-template-columns: 1fr;
  }

  .table-head,
  .table-row {
    grid-template-columns: 1.2fr 0.9fr 0.9fr 0.9fr 0.9fr 120px;
  }
}

@media (max-width: 720px) {
  .blocks-table {
    display: none;
  }

  .blocks-cards {
    display: grid;
  }

  .pagination {
    justify-content: center;
  }
}
</style>
