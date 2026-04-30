<template>
  <div class="settings-page">
    <AdminNav />
    <header class="settings-header">
      <h1>Schedule Settings</h1>
      <p>Configure the day and hour that marks the start of the weekly schedule (CST).</p>
    </header>

    <section v-if="!isAuthorized" class="locked">
      <h2>Sign in required</h2>
      <p>Only approved Discord accounts can change schedule settings.</p>
      <a class="primary" href="/api/auth/discord/login?redirect=/admin/settings">Sign in with Discord</a>
    </section>

    <section v-else class="settings-body">
      <div class="panel">
        <div class="panel-header">
          <h2>Weekly Schedule Start</h2>
          <span class="panel-sub">All times are CST (America/Chicago)</span>
        </div>

        <div class="form-grid">
          <label class="field">
            <span>Day of Week (CST)</span>
            <select v-model="formDay">
              <option v-for="d in dayOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
            </select>
          </label>

          <label class="field">
            <span>Hour (CST)</span>
            <select v-model="formHour">
              <option v-for="h in hourOptions" :key="h.value" :value="h.value">{{ h.label }}</option>
            </select>
          </label>
        </div>

        <div class="current-setting">
          <span class="current-label">Current setting:</span>
          <span class="current-value">{{ currentSettingLabel }}</span>
        </div>

        <div class="form-actions">
          <div class="status" :class="{ error: isError }">{{ statusMessage }}</div>
          <div class="actions">
            <button class="secondary" type="button" :disabled="isSaving" @click="resetForm">
              Reset
            </button>
            <button
              class="primary"
              type="button"
              :disabled="isSaving || !hasChanges"
              @click="saveSettings"
            >
              {{ isSaving ? 'Saving...' : 'Save Settings' }}
            </button>
          </div>
        </div>
      </div>

      <div class="panel info-panel">
        <h2>What this controls</h2>
        <p>
          The weekly schedule start determines when the loop resets each week. Blocks scheduled in
          the calendar are anchored to real UTC timestamps, but the live guide and block air-time
          preview use this setting to calculate where in the week the current playback position falls.
        </p>
        <p>
          Changing this setting takes effect immediately for the live guide and block air-time
          previews. Existing scheduled block entries are unaffected.
        </p>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

const { data: authData } = await useFetch('/api/auth/me')
const isAuthorized = computed(() => authData.value?.authenticated && authData.value?.allowed)

const { data: settingsData, refresh: refreshSettings } = await useFetch('/api/settings')

const savedDay = computed(() => settingsData.value?.scheduleDay ?? 5)
const savedHour = computed(() => settingsData.value?.scheduleHour ?? 19)

const formDay = ref(savedDay.value)
const formHour = ref(savedHour.value)

const isSaving = ref(false)
const statusMessage = ref('')
const isError = ref(false)

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const dayOptions = DAY_NAMES.map((label, value) => ({ value, label }))

function formatHourLabel(hour) {
  const normalized = ((Number(hour) % 24) + 24) % 24
  const period = normalized < 12 ? 'AM' : 'PM'
  const display = normalized % 12 === 0 ? 12 : normalized % 12
  return `${display}:00 ${period}`
}

const hourOptions = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: formatHourLabel(hour)
}))

const hasChanges = computed(
  () => formDay.value !== savedDay.value || formHour.value !== savedHour.value
)

const currentSettingLabel = computed(() => {
  const day = DAY_NAMES[savedDay.value] ?? 'Unknown'
  const hour = formatHourLabel(savedHour.value)
  return `${day} at ${hour} CST`
})

function resetForm() {
  formDay.value = savedDay.value
  formHour.value = savedHour.value
  statusMessage.value = ''
  isError.value = false
}

async function saveSettings() {
  isSaving.value = true
  statusMessage.value = ''
  isError.value = false
  try {
    await $fetch('/api/settings/save', {
      method: 'POST',
      body: {
        scheduleDay: Number(formDay.value),
        scheduleHour: Number(formHour.value)
      }
    })
    await refreshSettings()
    formDay.value = savedDay.value
    formHour.value = savedHour.value
    statusMessage.value = 'Settings saved.'
  } catch (error) {
    isError.value = true
    statusMessage.value =
      error?.data?.statusMessage || 'Failed to save settings. Check server logs for details.'
  } finally {
    isSaving.value = false
  }
}
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=VT323&family=Orbitron:wght@400;600&display=swap');

:global(html),
:global(body) {
  margin: 0;
  padding: 0;
  background: #070707;
}

.settings-page {
  min-height: 100vh;
  padding: 24px;
  background: radial-gradient(circle at top, #2b2e35 0%, #101015 45%, #070707 100%);
  color: #f7f0d8;
  font-family: 'Orbitron', sans-serif;
}

.settings-header {
  margin-bottom: 24px;
}

.settings-header h1 {
  margin: 0 0 6px;
  font-size: 26px;
}

.settings-header p {
  margin: 0;
  color: #d9caa3;
  font-size: 14px;
}

.settings-body {
  display: grid;
  gap: 20px;
  max-width: 700px;
}

.panel {
  background: rgba(0, 0, 0, 0.35);
  border-radius: 14px;
  border: 1px solid #5e4a2f;
  padding: 20px;
  display: grid;
  gap: 16px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
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
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

@media (max-width: 500px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}

.field {
  display: grid;
  gap: 6px;
  font-size: 12px;
}

.field span {
  color: #cab688;
}

select {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #7c6845;
  background: #1a1b20;
  color: #f7e4b4;
  font-family: 'Orbitron', sans-serif;
  font-size: 13px;
}

.current-setting {
  font-size: 13px;
  color: #cab688;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.current-label {
  text-transform: uppercase;
  letter-spacing: 1px;
  font-size: 11px;
}

.current-value {
  color: #f9d98f;
  font-size: 14px;
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.status {
  font-size: 12px;
  color: #8fcd9e;
  min-height: 18px;
}

.status.error {
  color: #f3c488;
}

.actions {
  display: flex;
  gap: 10px;
  margin-left: auto;
}

.primary {
  padding: 10px 18px;
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

.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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

.secondary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.info-panel h2 {
  margin: 0;
  font-size: 16px;
}

.info-panel p {
  margin: 0;
  font-size: 13px;
  color: #cab688;
  line-height: 1.6;
}

.locked {
  padding: 24px;
  border-radius: 14px;
  border: 1px solid #5e4a2f;
  background: rgba(0, 0, 0, 0.35);
  display: grid;
  gap: 12px;
  max-width: 500px;
}

.locked h2 {
  margin: 0;
}
</style>
