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
      <div ref="addPanelRef" class="panel add-panel">
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
            <span>Time (CST)</span>
            <input v-model="formTime" type="time" />
          </label>
        </div>

        <div class="form-actions">
          <div class="status" :class="{ error: formError }">{{ formError || formBlocker }}</div>
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

      <div class="panel repeat-panel">
        <div class="panel-header">
          <h2>{{ editingRuleId ? 'Edit repeating block' : 'Repeating blocks' }}</h2>
          <span class="panel-sub">Runs automatically on the days you pick</span>
        </div>

        <div class="form-grid">
          <label class="field">
            <span>Block</span>
            <select v-model="ruleBlockSlug">
              <option value="">Select a block</option>
              <option v-for="block in blocks" :key="block.slug" :value="block.slug">
                {{ block.name }}
              </option>
            </select>
          </label>
        </div>

        <div class="field">
          <span class="field-label">Quick pick</span>
          <div class="presets">
            <button
              v-for="preset in DAY_PRESETS"
              :key="preset.key"
              class="preset-chip"
              type="button"
              :class="{ on: activePreset === preset.key }"
              :aria-pressed="activePreset === preset.key"
              @click="applyPreset(preset)"
            >
              {{ preset.label }}
            </button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">Days (CST)</span>
          <!-- A zero-gap segmented strip, not seven separate checkboxes: at 375px there
               is no room for seven gapped 44px targets, and native checkboxes are ~13px
               hit areas. Shared borders mean the full cell width is live. -->
          <div class="day-strip" role="group" aria-label="Days of week">
            <button
              v-for="day in WEEKDAYS"
              :key="day.value"
              class="day-cell"
              type="button"
              :class="{ on: ruleDays.includes(day.value) }"
              :aria-pressed="ruleDays.includes(day.value)"
              :aria-label="day.full"
              @click="toggleDay(day.value)"
            >
              {{ day.short }}
            </button>
          </div>
        </div>

        <div class="form-grid two">
          <label class="field">
            <span>Start time (CST)</span>
            <!-- One native time input beats an hour select plus a 60-option minute
                 select: iOS renders a single wheel with hour/minute/AM-PM side by side. -->
            <input v-model="ruleTime" type="time" />
          </label>
          <label class="field">
            <span>First day (optional)</span>
            <div class="date-row">
              <input v-model="ruleStartDate" type="date" :max="ruleEndDate || null" />
              <button
                class="secondary clear-date"
                type="button"
                :disabled="!ruleStartDate"
                aria-label="Clear first day"
                @click="ruleStartDate = ''"
              >
                Clear
              </button>
            </div>
            <em class="hint-inline">{{ ruleStartDate ? '' : 'Starts right away' }}</em>
          </label>
          <label class="field">
            <span>Last day (optional)</span>
            <div class="date-row">
              <input v-model="ruleEndDate" type="date" :min="ruleStartDate || null" />
              <button
                class="secondary clear-date"
                type="button"
                :disabled="!ruleEndDate"
                aria-label="Clear last day"
                @click="ruleEndDate = ''"
              >
                Clear
              </button>
            </div>
            <em class="hint-inline">
              {{ ruleEndDate ? 'Runs through this day, included' : 'Repeats indefinitely' }}
            </em>
          </label>
        </div>

        <div class="form-actions">
          <div class="status" :class="{ error: ruleError }">{{ ruleError || ruleBlocker }}</div>
          <div class="actions">
            <button class="secondary" type="button" :disabled="isSavingRule" @click="resetRuleForm">
              {{ editingRuleId ? 'Cancel Edit' : 'Reset' }}
            </button>
            <button
              class="primary"
              type="button"
              :disabled="isSavingRule || Boolean(ruleBlocker)"
              @click="saveRule"
            >
              {{ isSavingRule ? 'Saving...' : editingRuleId ? 'Save Changes' : 'Add Repeat' }}
            </button>
          </div>
        </div>

        <div v-if="rules.length" class="rule-list">
          <div
            v-for="rule in rules"
            :key="rule.id"
            class="rule-card"
            :class="{ highlight: highlightedRuleId === rule.id, off: !rule.enabled }"
            :ref="(el) => setRuleRef(rule.id, el)"
          >
            <div class="rule-main">
              <strong>{{ getBlockName(rule.blockSlug) }}</strong>
              <span class="rule-when">{{ describeRule(rule) }}</span>
              <small v-if="rule.startDate || rule.endDate">
                {{ rule.startDate ? `From ${rule.startDate}` : '' }}
                {{ rule.endDate ? `Until ${rule.endDate}` : '' }}
              </small>
              <small v-if="rule.exceptions.length">
                {{ rule.exceptions.length }} skipped date{{ rule.exceptions.length === 1 ? '' : 's' }}
              </small>
            </div>
            <div class="rule-actions">
              <button class="secondary" type="button" @click="editRule(rule)">Edit</button>
              <!-- Pausing is the safer primary action on a small screen than a
                   destructive delete, and `enabled` is already in the stored shape. -->
              <button class="secondary" type="button" @click="toggleRuleEnabled(rule)">
                {{ rule.enabled ? 'Pause' : 'Resume' }}
              </button>
              <button class="danger" type="button" @click="deleteRule(rule)">Delete</button>
            </div>
          </div>
        </div>
        <p v-else class="hint">No repeating blocks yet.</p>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2>Upcoming schedule</h2>
          <label class="toggle">
            <input v-model="showHistory" type="checkbox" />
            <span>Show past entries</span>
          </label>
        </div>
        <p v-if="rules.length" class="hint">
          Rows marked Repeat come from a repeating block above. Skip one airing with Skip,
          or change them all by editing the repeat.
        </p>

        <div v-if="isLoading" class="empty">Loading schedule...</div>
        <div v-else-if="!filteredEntries.length" class="empty">
          No schedule entries yet.
        </div>

        <div v-else class="schedule-table">
          <div class="table-head">
            <span>Time (CST)</span>
            <span>Block</span>
            <span>Status</span>
            <span></span>
          </div>
          <template v-for="group in groupedEntries" :key="group.key">
            <div class="day-group-head">{{ group.label }}</div>
            <div v-for="entry in group.entries" :key="entry.id" class="table-row">
              <div class="cell time">
                <strong>{{ formatScheduleClock(entry.startTime) }}</strong>
              </div>
              <div class="cell block">
                <span>{{ getBlockName(entry.blockSlug) }}</span>
                <small v-if="entry.recurring">Repeats {{ describeRuleDays(entry.ruleId) }}</small>
                <small v-else>{{ entry.blockSlug }}</small>
              </div>
              <div class="cell status">
                <span class="tag" :class="{ current: entry.id === currentEntryId }">
                  {{ entry.id === currentEntryId ? 'Current' : entry.startMs > nowMs ? 'Upcoming' : 'Past' }}
                </span>
                <span v-if="entry.recurring" class="tag repeat">Repeat</span>
              </div>
              <!-- Never render an empty action slot for rule rows: with no hover or
                   tooltip on touch, a blank space where a button sits on the row above
                   just reads as broken. Give them equal-weight actions instead. -->
              <div class="cell actions">
                <template v-if="entry.recurring">
                  <button
                    v-if="entry.startMs > nowMs"
                    class="secondary"
                    type="button"
                    @click="skipOccurrence(entry)"
                  >
                    Skip
                  </button>
                  <button class="secondary" type="button" @click="focusRule(entry.ruleId)">
                    Edit repeat ›
                  </button>
                </template>
                <template v-else>
                  <button class="secondary" type="button" @click="editEntry(entry)">Edit</button>
                  <button class="danger" type="button" @click="deleteEntry(entry)">Delete</button>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  SCHEDULE_TIME_ZONE,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  compareOccurrences,
  describeRule,
  getZonedParts,
  zonedDateTimeToUtc
} from '#shared/schedule-time.js'

// Same module the server and the front page use, so the Save button and the server's
// validation can never disagree about which instant a time means.
const scheduleTimeZone = SCHEDULE_TIME_ZONE

const WEEKDAYS = WEEKDAY_LABELS.map((full, value) => ({
  value,
  full,
  // Two letters: single letters give two T's and two S's, and there is no hover on touch
  // to disambiguate them.
  short: WEEKDAY_SHORT[value]
}))

const DAY_PRESETS = [
  { key: 'daily', label: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
  { key: 'weekdays', label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { key: 'weekends', label: 'Weekends', days: [0, 6] }
]

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
const formTime = ref('19:00')
const editingId = ref('')
const formError = ref('')
const nowMs = ref(Date.now())
let clockTimer = null

const rules = ref([])
const occurrences = ref([])
const ruleBlockSlug = ref('')
const ruleDays = ref([])
const ruleTime = ref('19:00')
const ruleStartDate = ref('')
const ruleEndDate = ref('')
const editingRuleId = ref('')
const ruleError = ref('')
const isSavingRule = ref(false)
const highlightedRuleId = ref('')
const previewDays = ref(14)
const ruleRefs = new Map()

function setRuleRef(id, el) {
  if (el) ruleRefs.set(id, el)
  else ruleRefs.delete(id)
}

// Presets are DERIVED, never stored. Storing one would immediately raise "user picked
// Weekdays then unchecked Wednesday — what is the preset now?", and every answer is
// wrong. Comparing the day set means picking Mon–Fri by hand lights Weekdays for free.
const daysKey = computed(() => [...ruleDays.value].sort((a, b) => a - b).join(','))
const activePreset = computed(() => {
  const key = daysKey.value
  return DAY_PRESETS.find((preset) => preset.days.join(',') === key)?.key || ''
})

function applyPreset(preset) {
  ruleDays.value = [...preset.days]
}

function toggleDay(value) {
  const next = new Set(ruleDays.value)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  ruleDays.value = [...next].sort((a, b) => a - b)
}

function parseTimeInput(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null
  const [hour, minute] = value.split(':').map(Number)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null
  return { hour, minute }
}

// A disabled button with no explanation is a dead end on touch — no hover, no tooltip,
// no cursor change. Always say what is missing.
const ruleBlocker = computed(() => {
  if (!ruleBlockSlug.value) return 'Pick a block.'
  if (!ruleDays.value.length) return 'Pick at least one day.'
  if (!parseTimeInput(ruleTime.value)) return 'Pick a start time.'
  if (ruleStartDate.value && ruleEndDate.value && ruleEndDate.value < ruleStartDate.value) {
    return 'The last day must not be before the first day.'
  }
  return ''
})

const channelName = computed(() => {
  const slug = channelSlug.value
  if (!slug) return ''
  const channel = channels.value.find((entry) => entry.slug === slug)
  return channel?.name || slug
})

const formBlocker = computed(() => {
  if (!formBlockSlug.value) return 'Pick a block.'
  if (!formDate.value) return 'Pick a date.'
  const time = parseTimeInput(formTime.value)
  if (!time) return 'Pick a time.'
  const startMs = getZonedDateUtcMs(formDate.value, time.hour, time.minute)
  if (!Number.isFinite(startMs)) return 'That date and time is not valid.'
  // Leave a minute of headroom: the server applies the same grace, so a browser clock a
  // few seconds behind can't produce a rejection the admin cannot act on.
  if (startMs <= Date.now()) return 'Pick a time in the future.'
  return ''
})

const canSave = computed(() => !formBlocker.value)

// Sorting is split out of the filter so it doesn't re-run on every 30s clock tick — the
// merged list is much longer now that rule occurrences are in it.
const sortedEntries = computed(() =>
  [...scheduleEntries.value, ...occurrences.value].sort(compareOccurrences)
)

const filteredEntries = computed(() => {
  const entries = sortedEntries.value
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

// Day headers give the list scroll landmarks and let each row show just a time, halving
// the text per row on a phone.
const groupedEntries = computed(() => {
  const groups = []
  let current = null
  for (const entry of filteredEntries.value) {
    const parts = getCstParts(entry.startMs)
    if (!current || current.key !== parts.date) {
      current = { key: parts.date, label: formatDayLabel(entry.startMs), entries: [] }
      groups.push(current)
    }
    current.entries.push(entry)
  }
  return groups
})

const currentEntryId = computed(() => {
  const now = nowMs.value
  let current = null
  for (const entry of sortedEntries.value) {
    if (entry.startMs <= now) current = entry
  }
  return current?.id || ''
})

function describeRuleDays(ruleId) {
  const rule = rules.value.find((item) => item.id === ruleId)
  return rule ? describeRule(rule) : 'on a schedule'
}

function getBlockName(slug) {
  if (!slug) return 'Unknown block'
  const found = blocks.value.find((block) => block.slug === slug)
  return found?.name || slug
}

// Time only — the day is already the group header above the row.
function formatScheduleClock(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: scheduleTimeZone,
    timeStyle: 'short'
  }).format(date)
}

function formatDayLabel(ms) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: scheduleTimeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(new Date(ms))
}

// The zone math is imported rather than duplicated here. The copy that used to live in
// this file was a single-pass guess-and-correct, identical to the server's — which meant
// both were wrong by an hour for ten hours a year, and agreed with each other while
// being wrong.
function getZonedDateUtcMs(dateInput, hourInput, minuteInput = 0) {
  const resolved = zonedDateTimeToUtc(dateInput, hourInput, minuteInput, scheduleTimeZone)
  return resolved ? resolved.ms : null
}

function getCstParts(date) {
  const parts = getZonedParts(date instanceof Date ? date.getTime() : date, scheduleTimeZone)
  return {
    date: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
    hour: String(parts.hour).padStart(2, '0'),
    minute: String(parts.minute).padStart(2, '0')
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
  formTime.value = `${parts.hour}:${parts.minute}`
}

function resetForm() {
  editingId.value = ''
  formBlockSlug.value = ''
  formError.value = ''
  setDefaultForm()
}

const addPanelRef = ref(null)

function editEntry(entry) {
  if (!entry) return
  editingId.value = entry.id
  formBlockSlug.value = entry.blockSlug
  // The form sits above the list, so on a phone it is off-screen when the tap happens —
  // without the scroll, Edit looks like it did nothing.
  nextTick(() => {
    addPanelRef.value?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  })
  const parts = getCstParts(new Date(entry.startTime))
  formDate.value = parts.date
  // Carry the minutes through: reading an entry back as hour-only silently rewrote a
  // 7:31 entry to 7:00 on the next save.
  formTime.value = `${parts.hour}:${parts.minute}`
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
    formError.value = 'Failed to delete schedule entry. Check server logs for details.'
  }
}

async function saveSchedule() {
  if (!canSave.value || !channelSlug.value) return
  isSaving.value = true
  formError.value = ''
  const time = parseTimeInput(formTime.value)
  const startMs = time ? getZonedDateUtcMs(formDate.value, time.hour, time.minute) : null
  if (!Number.isFinite(startMs) || startMs <= Date.now()) {
    formError.value = 'Schedule time must be in the future.'
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
        hour: time.hour,
        minute: time.minute,
        id: editingId.value || undefined
      }
    })
    await refreshAll()
    resetForm()
  } catch (error) {
    formError.value =
      error?.data?.statusMessage || 'Failed to save schedule. Check server logs for details.'
  } finally {
    isSaving.value = false
  }
}

function resetRuleForm() {
  editingRuleId.value = ''
  ruleBlockSlug.value = ''
  ruleDays.value = []
  ruleTime.value = '19:00'
  ruleStartDate.value = ''
  ruleEndDate.value = ''
  ruleError.value = ''
}

function editRule(rule) {
  if (!rule) return
  editingRuleId.value = rule.id
  ruleBlockSlug.value = rule.blockSlug
  ruleDays.value = [...rule.days]
  ruleTime.value = `${String(rule.hour).padStart(2, '0')}:${String(rule.minute).padStart(2, '0')}`
  ruleStartDate.value = rule.startDate || ''
  ruleEndDate.value = rule.endDate || ''
  ruleError.value = ''
  focusRule(rule.id)
}

/**
 * Scrolls the rule card into view and flashes it. Without the scroll, tapping
 * "Edit repeat" from a row further down the page looks like a no-op, because the rules
 * panel is off-screen above.
 */
function focusRule(ruleId) {
  highlightedRuleId.value = ruleId
  nextTick(() => {
    const el = ruleRefs.get(ruleId)
    if (el?.scrollIntoView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
  window.setTimeout(() => {
    if (highlightedRuleId.value === ruleId) highlightedRuleId.value = ''
  }, 2000)
}

async function saveRule() {
  if (ruleBlocker.value || !channelSlug.value) return
  const time = parseTimeInput(ruleTime.value)
  if (!time) return
  isSavingRule.value = true
  ruleError.value = ''
  try {
    await $fetch('/api/schedule/recurring/save', {
      method: 'POST',
      body: {
        channelSlug: channelSlug.value,
        blockSlug: ruleBlockSlug.value,
        days: ruleDays.value,
        hour: time.hour,
        minute: time.minute,
        startDate: ruleStartDate.value || null,
        endDate: ruleEndDate.value || null,
        id: editingRuleId.value || undefined,
        // Preserve skipped dates and paused state across an edit.
        exceptions: editingRuleId.value
          ? rules.value.find((r) => r.id === editingRuleId.value)?.exceptions || []
          : [],
        enabled: editingRuleId.value
          ? rules.value.find((r) => r.id === editingRuleId.value)?.enabled !== false
          : true
      }
    })
    await refreshAll()
    resetRuleForm()
  } catch (error) {
    ruleError.value =
      error?.data?.statusMessage || 'Failed to save the repeating block. Check server logs.'
  } finally {
    isSavingRule.value = false
  }
}

async function toggleRuleEnabled(rule) {
  if (!rule) return
  try {
    await $fetch('/api/schedule/recurring/save', {
      method: 'POST',
      body: {
        channelSlug: channelSlug.value,
        blockSlug: rule.blockSlug,
        days: rule.days,
        hour: rule.hour,
        minute: rule.minute,
        startDate: rule.startDate,
        endDate: rule.endDate,
        exceptions: rule.exceptions,
        id: rule.id,
        enabled: !rule.enabled
      }
    })
    await refreshAll()
  } catch (error) {
    ruleError.value = error?.data?.statusMessage || 'Failed to update the repeating block.'
  }
}

async function deleteRule(rule) {
  if (!rule) return
  // Say how much this actually removes — copying the one-off wording would badly
  // understate the blast radius.
  const upcoming = occurrences.value.filter((entry) => entry.ruleId === rule.id).length
  const ok = window.confirm(
    `Delete this repeating block?${upcoming ? ` ${upcoming} upcoming airing${upcoming === 1 ? '' : 's'} in the next ${previewDays.value} days will stop.` : ''}`
  )
  if (!ok) return
  try {
    await $fetch('/api/schedule/recurring/delete', {
      method: 'POST',
      body: { channelSlug: channelSlug.value, id: rule.id }
    })
    await refreshAll()
    if (editingRuleId.value === rule.id) resetRuleForm()
  } catch (error) {
    ruleError.value = error?.data?.statusMessage || 'Failed to delete the repeating block.'
  }
}

async function skipOccurrence(entry) {
  if (!entry?.ruleId || !entry.civilDate) return
  const ok = window.confirm(`Skip this one airing on ${formatDayLabel(entry.startMs)}?`)
  if (!ok) return
  try {
    await $fetch('/api/schedule/recurring/delete', {
      method: 'POST',
      body: { channelSlug: channelSlug.value, id: entry.ruleId, skipDate: entry.civilDate }
    })
    await refreshAll()
  } catch (error) {
    ruleError.value = error?.data?.statusMessage || 'Failed to skip that airing.'
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
    rules.value = Array.isArray(scheduleResponse?.rules) ? scheduleResponse.rules : []
    occurrences.value = Array.isArray(scheduleResponse?.occurrences)
      ? scheduleResponse.occurrences
      : []
    previewDays.value = Number(scheduleResponse?.previewDays) || 14
  } catch (error) {
    formError.value = 'Failed to load schedule data. Check server logs for details.'
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
.schedule-page {
  font-weight: 500;
  min-height: 100vh;
  /* Matches the front page. The flat 24px burned 48px of a 375px viewport — which is
     exactly what made a row of seven 44px day toggles impossible to fit. */
  padding: clamp(14px, 3vw, 24px);
  background: radial-gradient(circle at top, var(--cr-surface-page-top) 0%, var(--cr-surface-1) 45%, var(--cr-surface-root) 100%);
  color: var(--cr-text);
  font-family: var(--cr-font);
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
  color: var(--cr-text-muted-1);
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
  border: 1px solid var(--cr-line-1);
  padding: 16px;
  display: grid;
  gap: 16px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  /* Without wrap these overflow at 375px — settings.vue already wraps both of these. */
  flex-wrap: wrap;
}

.panel-header h2 {
  margin: 0;
  font-size: 18px;
}

.panel-sub {
  font-size: 12px;
  color: var(--cr-text-muted-5);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.field {
  display: grid;
  gap: 6px;
  font-size: 13px;
}

.field span {
  color: var(--cr-text-muted-5);
}

input,
select {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--cr-line-2);
  background: var(--cr-surface-3);
  color: var(--cr-text-ctrl);
  font-family: var(--cr-font);
  /* 16px minimum on every control: anything smaller triggers iOS Safari's auto-zoom on
     focus and leaves the page zoomed. This page never had it, so every date field and
     select zoomed the admin out on tap. Applies to <select> too, not just text inputs. */
  font-size: 16px;
}

/* iOS gives date/time inputs an intrinsic width that ignores the grid track, so without
   an explicit width an empty optional date renders as a stubby box in a full-width row. */
input[type='date'],
input[type='time'] {
  appearance: none;
  -webkit-appearance: none;
  min-width: 0;
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.form-actions .status {
  font-size: 13px;
  color: var(--cr-text-muted-5);
}

.form-actions .status.error {
  color: var(--cr-warning);
}

.actions {
  display: flex;
  gap: 10px;
  margin-left: auto;
}

@media (max-width: 600px) {
  .form-actions .actions {
    width: 100%;
  }

  .form-actions .actions > button {
    flex: 1;
  }
}

.field-label {
  color: var(--cr-text-muted-5);
  font-size: 13px;
  display: block;
  margin-bottom: 6px;
}

.form-grid.two {
  grid-template-columns: 1fr;
}

@media (min-width: 700px) {
  .form-grid.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preset-chip {
  min-height: 44px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--cr-line-2);
  background: var(--cr-surface-3);
  color: var(--cr-text-muted-5);
  font-family: var(--cr-font);
  font-size: 14px;
  cursor: pointer;
  touch-action: manipulation;
}

.preset-chip.on {
  border-color: var(--cr-accent);
  color: var(--cr-accent);
}

/* Zero gap with shared borders: at 375px seven gapped 44px targets do not fit, but seven
   flush cells do, and every pixel of each cell is live hit area. */
.day-strip {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0;
  border: 1px solid var(--cr-line-2);
  border-radius: 10px;
  overflow: hidden;
  /* Seven adjacent targets is exactly where a user taps fast; without this, two taps
     inside 300ms on neighbouring cells trigger iOS double-tap zoom. */
  touch-action: manipulation;
}

.day-cell {
  min-height: 48px;
  border: 0;
  border-right: 1px solid var(--cr-line-2);
  background: var(--cr-surface-3);
  color: var(--cr-text-muted-5);
  font-family: var(--cr-font);
  font-size: 13px;
  letter-spacing: 0.5px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.day-cell:last-child {
  border-right: 0;
}

.day-cell.on {
  background: rgba(159, 224, 255, 0.16);
  color: var(--cr-accent);
  box-shadow: inset 0 0 0 1px var(--cr-accent);
}

.date-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.clear-date {
  min-height: 44px;
  white-space: nowrap;
}

.hint-inline {
  font-style: normal;
  font-size: 12px;
  color: var(--cr-text-dim-2, var(--cr-text-muted-5));
  min-height: 14px;
}

.rule-list {
  display: grid;
  gap: 10px;
}

.rule-card {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(37, 112, 158, 0.5);
  background: rgba(0, 0, 0, 0.35);
  transition: border-color 0.3s ease, background 0.3s ease;
}

.rule-card.highlight {
  border-color: var(--cr-accent);
  background: rgba(159, 224, 255, 0.1);
}

.rule-card.off {
  opacity: 0.6;
}

.rule-main {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.rule-when {
  font-size: 13px;
  color: var(--cr-accent);
}

.rule-main small {
  font-size: 11px;
  color: var(--cr-text-muted-5);
}

.rule-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

@media (max-width: 600px) {
  .rule-actions {
    width: 100%;
  }

  .rule-actions > button {
    flex: 1;
  }
}

.primary {
  padding: 10px 16px;
  min-height: 44px;
  border-radius: 10px;
  border: 1px solid var(--cr-accent);
  background: var(--cr-surface-btn-top);
  color: var(--cr-text-ctrl);
  font-family: var(--cr-font);
  font-size: 14px;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.secondary {
  padding: 10px 16px;
  min-height: 44px;
  border-radius: 10px;
  border: 1px solid var(--cr-line-2);
  background: var(--cr-surface-3);
  color: var(--cr-text-ctrl);
  font-family: var(--cr-font);
  font-size: 14px;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.danger {
  padding: 10px 14px;
  min-height: 44px;
  border-radius: 10px;
  border: 1px solid var(--cr-danger-border-2);
  background: var(--cr-danger-bg-2);
  color: var(--cr-danger-text-2);
  font-family: var(--cr-font);
  font-size: 13px;
  cursor: pointer;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  font-size: 14px;
  color: var(--cr-text-muted-5);
  cursor: pointer;
}

.toggle input {
  width: 20px;
  height: 20px;
  accent-color: var(--cr-brand-500);
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
  color: var(--cr-text-muted-5);
}

.table-row {
  background: rgba(0, 0, 0, 0.35);
  border-radius: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(37, 112, 158, 0.5);
}

.cell {
  display: grid;
  gap: 4px;
}

.cell small {
  font-size: 11px;
  color: var(--cr-text-muted-5);
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
  border: 1px solid var(--cr-line-2);
  color: var(--cr-text-ctrl);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.tag.current {
  border-color: var(--cr-accent);
  color: var(--cr-accent);
}

.empty,
.empty-state,
.locked {
  padding: 24px;
  border-radius: 14px;
  border: 1px solid var(--cr-line-1);
  background: rgba(0, 0, 0, 0.35);
  display: grid;
  gap: 12px;
}

.empty-state h2,
.locked h2 {
  margin: 0;
}

.day-group-head {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 6px 0 -2px;
  padding: 6px 4px;
  background: var(--cr-surface-1);
  font-size: 12px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--cr-text-muted-5);
}

.tag.repeat {
  border-color: var(--cr-brand-500, var(--cr-accent));
  opacity: 0.85;
}

@media (max-width: 900px) {
  /* The head was four <span>s that stacked into a column of orphaned labels above the
     data, reading like a broken first row. With grid-areas below, the rows are
     self-describing and the head is pure noise. */
  .table-head {
    display: none;
  }

  .table-row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'time   status'
      'block  block'
      'action action';
    row-gap: 8px;
    column-gap: 12px;
    padding: 12px;
  }

  .cell.time {
    grid-area: time;
  }

  .cell.block {
    grid-area: block;
  }

  .cell.status {
    grid-area: status;
    justify-self: end;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .cell.actions {
    grid-area: action;
    justify-content: stretch;
  }

  .cell.actions > * {
    flex: 1;
  }
}
</style>
