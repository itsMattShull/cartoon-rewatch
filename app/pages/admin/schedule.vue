<template>
  <div class="schedule-page">
    <AdminNav />
    <header class="schedule-header">
      <div>
        <h1>Channel Schedule</h1>
        <p v-if="channelName">Manage blocks for {{ channelName }}.</p>
        <p v-else>Pick a channel from Admin to edit its schedule.</p>
      </div>
      <div class="schedule-actions">
        <a class="secondary" href="/admin">Back to Admin</a>
      </div>
    </header>

    <section v-if="!isAuthorized" class="locked">
      <h2>Sign in required</h2>
      <p>Only approved Discord accounts can edit schedules.</p>
      <a class="primary" href="/api/auth/discord/login?redirect=/admin">Sign in with Discord</a>
    </section>

    <section v-else-if="!channelSlug" class="empty-state">
      <h2>No channel selected</h2>
      <p>Open the Admin page and click Schedule on a channel to get started.</p>
      <a class="primary" href="/admin">Go to Admin</a>
    </section>

    <section v-else class="schedule-body">
      <div class="panel add-panel">
        <div class="panel-header">
          <h2>{{ editingId ? 'Edit schedule entry' : 'Add schedule entry' }}</h2>
          <span class="panel-sub">Times are stored in CST (America/Chicago).</span>
        </div>

        <div class="form-grid">
          <label class="field">
            <span>Block</span>
            <select v-model="formBlockSlug">
              <option value="">Select a block</option>
              <option v-for="block in blocks" :key="block.slug" :value="block.slug">
                {{ block.name }}
              </option>
            </select>
          </label>

          <label class="field">
            <span>Date (CST)</span>
            <input v-model="formDate" type="date" />
          </label>

          <label class="field">
            <span>Hour (CST)</span>
            <select v-model="formHour">
              <option value="">Select hour</option>
              <option v-for="option in hourOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>

        <div class="form-actions">
          <div class="status" v-if="formError">{{ formError }}</div>
          <div class="actions">
            <button class="secondary" type="button" :disabled="isSaving" @click="resetForm">
              {{ editingId ? 'Cancel Edit' : 'Reset' }}
            </button>
            <button
              class="primary"
              type="button"
              :disabled="isSaving || !canSave"
              @click="saveSchedule"
            >
              {{ isSaving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Schedule' }}
            </button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2>Upcoming schedule</h2>
          <label class="toggle">
            <input v-model="showHistory" type="checkbox" />
            <span>Show past entries</span>
          </label>
        </div>

        <div v-if="isLoading" class="empty">Loading schedule...</div>
        <div v-else-if="!filteredEntries.length" class="empty">
          No schedule entries yet.
        </div>

        <div v-else class="schedule-table">
          <div class="table-head">
            <span>Date &amp; Time (CST)</span>
            <span>Block</span>
            <span>Status</span>
            <span></span>
          </div>
          <div v-for="entry in filteredEntries" :key="entry.id" class="table-row">
            <div class="cell">
              <strong>{{ formatScheduleTime(entry.startTime) }}</strong>
            </div>
            <div class="cell">
              <span>{{ getBlockName(entry.blockSlug) }}</span>
              <small>{{ entry.blockSlug }}</small>
            </div>
            <div class="cell">
              <span class="tag" :class="{ current: entry.id === currentEntryId }">
                {{ entry.id === currentEntryId ? 'Current' : entry.startMs > nowMs ? 'Upcoming' : 'Past' }}
              </span>
            </div>
            <div class="cell actions">
              <button class="danger" type="button" @click="deleteEntry(entry)">Delete</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const scheduleTimeZone = 'America/Chicago'

const route = useRoute()
const channelSlug = computed(() => String(route.query.channel || '').trim())

const { data: authData } = await useFetch('/api/auth/me')
const isAuthorized = computed(() => authData.value?.authenticated && authData.value?.allowed)

const channels = ref([])
const blocks = ref([])
const scheduleEntries = ref([])
const isLoading = ref(false)
const isSaving = ref(false)
const showHistory = ref(false)

const formBlockSlug = ref('')
const formDate = ref('')
const formHour = ref('')
const editingId = ref('')
const formError = ref('')
const nowMs = ref(Date.now())
let clockTimer = null

const channelName = computed(() => {
  const slug = channelSlug.value
  if (!slug) return ''
  const channel = channels.value.find((entry) => entry.slug === slug)
  return channel?.name || slug
})

function formatHourLabel(hour) {
  const normalized = ((Number(hour) % 24) + 24) % 24
  const period = normalized < 12 ? 'AM' : 'PM'
  const display = normalized % 12 === 0 ? 12 : normalized % 12
  return `${display} ${period}`
}

const hourOptions = computed(() =>
  Array.from({ length: 24 }, (_, hour) => ({
    value: String(hour),
    label: formatHourLabel(hour)
  }))
)

const canSave = computed(() => {
  if (!formBlockSlug.value || !formDate.value || formHour.value === '') return false
  const startMs = getZonedDateUtcMs(formDate.value, formHour.value)
  if (!Number.isFinite(startMs)) return false
  return startMs > Date.now()
})

const filteredEntries = computed(() => {
  const entries = [...scheduleEntries.value].sort((a, b) => a.startMs - b.startMs)
  if (showHistory.value) return entries
  const now = nowMs.value
  let currentIndex = -1
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].startMs <= now) currentIndex = i
  }
  const upcoming = entries.filter((entry) => entry.startMs > now)
  if (currentIndex >= 0) {
    return [entries[currentIndex], ...upcoming]
  }
  return upcoming
})

const currentEntryId = computed(() => {
  const now = nowMs.value
  let current = null
  for (const entry of scheduleEntries.value) {
    if (entry.startMs <= now) current = entry
  }
  return current?.id || ''
})

function getBlockName(slug) {
  if (!slug) return 'Unknown block'
  const found = blocks.value.find((block) => block.slug === slug)
  return found?.name || slug
}

function formatScheduleTime(iso) {
  if (!iso) return 'Unknown'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: scheduleTimeZone,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

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

function getZonedDateUtcMs(dateInput, hourInput) {
  const dateText = typeof dateInput === 'string' ? dateInput.trim() : ''
  if (!dateText) return null
  const [yearText, monthText, dayText] = dateText.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null

  const hour = Number(hourInput)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null

  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, 0, 0))
  const offset = getTimeZoneOffsetMs(utcGuess, scheduleTimeZone)
  return utcGuess.getTime() - offset
}

function getCstParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: scheduleTimeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit'
  }).formatToParts(date)
  const values = {}
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value
  }
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: values.hour
  }
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return []
  const normalized = []
  for (const entry of entries) {
    const startMs = Date.parse(entry?.startTime)
    if (!entry?.id || !entry?.blockSlug || !Number.isFinite(startMs)) continue
    normalized.push({
      id: entry.id,
      blockSlug: entry.blockSlug,
      startTime: entry.startTime,
      startMs
    })
  }
  normalized.sort((a, b) => a.startMs - b.startMs)
  return normalized
}

function setDefaultForm() {
  const now = new Date()
  const parts = getCstParts(now)
  formDate.value = parts.date
  formHour.value = parts.hour
}

function resetForm() {
  editingId.value = ''
  formBlockSlug.value = ''
  formError.value = ''
  setDefaultForm()
}

function editEntry(entry) {
  if (!entry) return
  editingId.value = entry.id
  formBlockSlug.value = entry.blockSlug
  const parts = getCstParts(new Date(entry.startTime))
  formDate.value = parts.date
  formHour.value = parts.hour
  formError.value = ''
}

async function deleteEntry(entry) {
  if (!entry) return
  const ok = window.confirm('Delete this schedule entry?')
  if (!ok) return
  try {
    await $fetch('/api/schedule/delete', {
      method: 'POST',
      body: {
        channelSlug: channelSlug.value,
        id: entry.id
      }
    })
    await refreshAll()
  } catch (error) {
    alert('Failed to delete schedule entry. Check server logs for details.')
  }
}

async function saveSchedule() {
  if (!canSave.value || !channelSlug.value) return
  isSaving.value = true
  formError.value = ''
  const startMs = getZonedDateUtcMs(formDate.value, formHour.value)
  if (!Number.isFinite(startMs) || startMs <= Date.now()) {
    const message = 'Schedule time must be in the future.'
    formError.value = message
    alert(message)
    isSaving.value = false
    return
  }
  try {
    await $fetch('/api/schedule/save', {
      method: 'POST',
      body: {
        channelSlug: channelSlug.value,
        blockSlug: formBlockSlug.value,
        date: formDate.value,
        hour: Number(formHour.value),
        id: editingId.value || undefined
      }
    })
    await refreshAll()
    resetForm()
  } catch (error) {
    const message =
      error?.data?.statusMessage || 'Failed to save schedule. Check server logs for details.'
    formError.value = message
    alert(message)
  } finally {
    isSaving.value = false
  }
}

async function refreshAll() {
  if (!isAuthorized.value || !channelSlug.value) return
  isLoading.value = true
  try {
    const [channelsResponse, blocksResponse, scheduleResponse] = await Promise.all([
      $fetch('/api/channels'),
      $fetch('/api/blocks'),
      $fetch(`/api/schedule/${channelSlug.value}`)
    ])
    channels.value = Array.isArray(channelsResponse?.channels) ? channelsResponse.channels : []
    blocks.value = Array.isArray(blocksResponse?.blocks) ? blocksResponse.blocks : []
    scheduleEntries.value = normalizeEntries(scheduleResponse?.entries || [])
  } catch (error) {
    alert('Failed to load schedule data. Check server logs for details.')
  } finally {
    isLoading.value = false
  }
}

watch(
  () => [isAuthorized.value, channelSlug.value],
  ([authorized, slug]) => {
    if (authorized && slug) {
      refreshAll()
    }
  },
  { immediate: true }
)

onMounted(() => {
  setDefaultForm()
  clockTimer = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 30000)
})

onBeforeUnmount(() => {
  if (clockTimer) window.clearInterval(clockTimer)
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

.schedule-page {
  min-height: 100vh;
  padding: 24px;
  background: radial-gradient(circle at top, #2b2e35 0%, #101015 45%, #070707 100%);
  color: #f7f0d8;
  font-family: 'Orbitron', sans-serif;
}

.schedule-header {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 18px;
}

.schedule-header h1 {
  margin: 0 0 6px;
  font-size: 26px;
}

.schedule-header p {
  margin: 0;
  color: #d9caa3;
}

.schedule-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.schedule-body {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

@media (min-width: 1100px) {
  .schedule-body {
    align-items: start;
  }
}

@media (min-width: 1100px) {
  .add-panel {
    max-width: 33.333%;
  }
}

.panel {
  background: rgba(0, 0, 0, 0.35);
  border-radius: 14px;
  border: 1px solid #5e4a2f;
  padding: 16px;
  display: grid;
  gap: 16px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-header h2 {
  margin: 0;
  font-size: 18px;
}

.panel-sub {
  font-size: 12px;
  color: #cab688;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.field {
  display: grid;
  gap: 6px;
  font-size: 12px;
}

.field span {
  color: #cab688;
}

input,
select {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #7c6845;
  background: #1a1b20;
  color: #f7e4b4;
  font-family: 'Orbitron', sans-serif;
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.form-actions .status {
  font-size: 12px;
  color: #f3c488;
}

.actions {
  display: flex;
  gap: 10px;
}

.primary {
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid #f9d98f;
  background: #3a2c1c;
  color: #f7e4b4;
  font-family: 'Orbitron', sans-serif;
  font-size: 14px;
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
  font-family: 'Orbitron', sans-serif;
  font-size: 14px;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.danger {
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid #b85a4a;
  background: #3a1d1d;
  color: #fbd3c8;
  font-family: 'Orbitron', sans-serif;
  font-size: 13px;
  cursor: pointer;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #cab688;
}

.schedule-table {
  display: grid;
  gap: 8px;
}

.table-head,
.table-row {
  display: grid;
  grid-template-columns: minmax(160px, 1.2fr) minmax(140px, 1fr) minmax(90px, 0.6fr) minmax(160px, 0.8fr);
  gap: 12px;
  align-items: center;
}

.table-head {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #cab688;
}

.table-row {
  background: rgba(0, 0, 0, 0.35);
  border-radius: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(124, 104, 69, 0.5);
}

.cell {
  display: grid;
  gap: 4px;
}

.cell small {
  font-size: 11px;
  color: #cab688;
}

.cell.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.tag {
  display: inline-flex;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid #7c6845;
  color: #f7e4b4;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.tag.current {
  border-color: #f9d98f;
  color: #f9d98f;
}

.empty,
.empty-state,
.locked {
  padding: 24px;
  border-radius: 14px;
  border: 1px solid #5e4a2f;
  background: rgba(0, 0, 0, 0.35);
  display: grid;
  gap: 12px;
}

.empty-state h2,
.locked h2 {
  margin: 0;
}

@media (max-width: 900px) {
  .table-head,
  .table-row {
    grid-template-columns: 1fr;
  }

  .cell.actions {
    justify-content: flex-start;
  }
}
</style>
