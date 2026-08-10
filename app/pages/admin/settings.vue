<template>
  <div class="settings-page">
    <AdminNav />
    <header class="settings-header">
      <h1>Site Settings</h1>
      <p>Configure the weekly schedule start and the banners shown on the site.</p>
    </header>

    <section v-if="!isAuthorized" class="locked">
      <h2>Sign in required</h2>
      <p>Only approved Discord accounts can change site settings.</p>
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

      <div class="panel">
        <div class="panel-header">
          <h2>Announcement Banner</h2>
          <span class="panel-sub">Shown across the top of the front page</span>
        </div>

        <label class="check">
          <input type="checkbox" v-model="bannerForm.announcement.enabled" />
          <span>Show the announcement banner</span>
        </label>

        <label class="field">
          <span>
            Message
            <em class="counter" :class="{ over: announcementChars > MAX_ANNOUNCEMENT }">
              {{ announcementChars }}/{{ MAX_ANNOUNCEMENT }}
            </em>
          </span>
          <input
            type="text"
            v-model="bannerForm.announcement.text"
            :maxlength="MAX_ANNOUNCEMENT"
            placeholder="New channel added this Friday"
          />
        </label>

        <div class="form-grid">
          <label class="field">
            <span>Link URL (optional)</span>
            <input
              type="url"
              v-model="bannerForm.announcement.linkUrl"
              placeholder="https://example.com"
            />
          </label>
          <label class="field">
            <span>Link label</span>
            <input type="text" v-model="bannerForm.announcement.linkLabel" placeholder="Learn more" />
          </label>
        </div>
        <p class="hint">
          Visitors can dismiss this. Editing the message shows it again to everyone.
        </p>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2>Channel Strip Text</h2>
          <span class="panel-sub">Middle of the CH / LIVE strip under the TV</span>
        </div>

        <label class="check">
          <input type="checkbox" v-model="bannerForm.channelStrip.enabled" />
          <span>Show text in the channel strip</span>
        </label>

        <div class="form-grid">
          <label class="field">
            <span>
              Text
              <em class="counter" :class="{ over: stripChars > MAX_STRIP }">
                {{ stripChars }}/{{ MAX_STRIP }}
              </em>
            </span>
            <input
              type="text"
              v-model="bannerForm.channelStrip.text"
              :maxlength="MAX_STRIP"
              placeholder="Support this project"
            />
          </label>
          <label class="field">
            <span>Link URL (optional)</span>
            <input
              type="url"
              v-model="bannerForm.channelStrip.linkUrl"
              placeholder="https://example.com"
            />
          </label>
        </div>
        <p class="hint">Keep this short — the strip shares one line with CH and LIVE.</p>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2>Sidebar Banners</h2>
          <span class="panel-sub">{{ bannerForm.ads.length }} of {{ MAX_ADS }} used</span>
        </div>

        <p v-if="!bannerForm.ads.length" class="hint">No banners yet.</p>

        <div v-for="(ad, index) in bannerForm.ads" :key="ad.id" class="banner-row">
          <div class="banner-preview">
            <img v-if="ad.imageUrl" :src="ad.imageUrl" :alt="ad.alt || 'Banner preview'" />
            <span v-else class="banner-preview-empty">No image</span>
          </div>

          <div class="banner-fields">
            <label class="field">
              <span>Name (admin only)</span>
              <input type="text" v-model="ad.label" placeholder="Cartoon ReOrbit" />
            </label>

            <label class="field">
              <span>Image URL or upload</span>
              <input type="text" v-model="ad.imageUrl" placeholder="https://example.com/banner.png" />
            </label>

            <div class="upload-row">
              <label class="upload-button">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  @change="uploadImage($event, index)"
                />
                <span>{{ uploadingIndex === index ? 'Uploading...' : 'Upload image' }}</span>
              </label>
              <span v-if="ad.width && ad.height" class="dims">{{ ad.width }}×{{ ad.height }}</span>
            </div>

            <label class="field">
              <span>Click-through link</span>
              <input type="url" v-model="ad.linkUrl" placeholder="https://example.com" />
            </label>

            <label class="field">
              <span>Alt text (required to enable)</span>
              <input type="text" v-model="ad.alt" :maxlength="MAX_ALT" placeholder="Cartoon ReOrbit" />
            </label>

            <label class="check">
              <input type="checkbox" v-model="ad.enabled" />
              <span>Show on the site</span>
            </label>
          </div>

          <div class="banner-actions">
            <!-- Explicit move buttons, not drag: HTML5 drag-and-drop emits no events
                 from touch input, so a drag handle is unusable on a phone. -->
            <button
              class="icon-button"
              type="button"
              aria-label="Move banner up"
              :disabled="index === 0"
              @click="moveAd(index, -1)"
            >
              ↑
            </button>
            <button
              class="icon-button"
              type="button"
              aria-label="Move banner down"
              :disabled="index === bannerForm.ads.length - 1"
              @click="moveAd(index, 1)"
            >
              ↓
            </button>
            <button
              class="icon-button danger"
              type="button"
              aria-label="Delete banner"
              @click="removeAd(index)"
            >
              ✕
            </button>
          </div>
        </div>

        <div class="form-actions">
          <button
            class="secondary"
            type="button"
            :disabled="bannerForm.ads.length >= MAX_ADS"
            @click="addAd"
          >
            Add banner
          </button>
          <div class="actions">
            <div class="status" :class="{ error: isBannerError }">{{ bannerStatus }}</div>
            <button class="secondary" type="button" :disabled="isSavingBanners" @click="resetBanners">
              Reset
            </button>
            <button class="primary" type="button" :disabled="isSavingBanners" @click="saveBanners">
              {{ isSavingBanners ? 'Saving...' : 'Save Banners' }}
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

const MAX_ADS = 6
const MAX_ANNOUNCEMENT = 140
const MAX_STRIP = 40
const MAX_ALT = 120

function emptyBanners() {
  return {
    announcement: { enabled: false, text: '', linkUrl: '', linkLabel: '' },
    channelStrip: { enabled: false, text: '', linkUrl: '' },
    ads: []
  }
}

function cloneBanners(source) {
  const base = emptyBanners()
  if (!source) return base
  return {
    announcement: { ...base.announcement, ...(source.announcement || {}) },
    channelStrip: { ...base.channelStrip, ...(source.channelStrip || {}) },
    ads: (source.ads || []).map((ad) => ({ ...ad }))
  }
}

const bannerForm = ref(cloneBanners(settingsData.value?.banners))
const isSavingBanners = ref(false)
const bannerStatus = ref('')
const isBannerError = ref(false)
const uploadingIndex = ref(-1)

const announcementChars = computed(() => bannerForm.value.announcement.text.length)
const stripChars = computed(() => bannerForm.value.channelStrip.text.length)

function addAd() {
  if (bannerForm.value.ads.length >= MAX_ADS) return
  bannerForm.value.ads.push({
    // Stable key for v-for; the server re-validates and may replace it.
    id: `ad-${Date.now().toString(36)}`,
    label: '',
    imageUrl: '',
    linkUrl: '',
    alt: '',
    width: 0,
    height: 0,
    enabled: false
  })
}

function removeAd(index) {
  bannerForm.value.ads.splice(index, 1)
}

function moveAd(index, delta) {
  const target = index + delta
  if (target < 0 || target >= bannerForm.value.ads.length) return
  const ads = bannerForm.value.ads
  ;[ads[index], ads[target]] = [ads[target], ads[index]]
}

async function uploadImage(event, index) {
  const input = event.target
  const file = input.files?.[0]
  if (!file) return
  uploadingIndex.value = index
  bannerStatus.value = ''
  isBannerError.value = false
  try {
    const body = new FormData()
    body.append('file', file)
    const result = await $fetch('/api/banners/upload', { method: 'POST', body })
    const ad = bannerForm.value.ads[index]
    ad.imageUrl = result.imageUrl
    ad.width = result.width
    ad.height = result.height
    bannerStatus.value = `Uploaded (${Math.round(result.bytes / 1024)} KB). Save to publish.`
    if (result.bytes > 500 * 1024) {
      bannerStatus.value += ' Large files slow the page down for visitors.'
    }
  } catch (error) {
    isBannerError.value = true
    bannerStatus.value = error?.data?.statusMessage || 'Upload failed.'
  } finally {
    uploadingIndex.value = -1
    // Allow re-selecting the same file after a failure.
    input.value = ''
  }
}

function resetBanners() {
  bannerForm.value = cloneBanners(settingsData.value?.banners)
  bannerStatus.value = ''
  isBannerError.value = false
}

async function saveBanners() {
  isSavingBanners.value = true
  bannerStatus.value = ''
  isBannerError.value = false
  try {
    const result = await $fetch('/api/banners/save', {
      method: 'POST',
      body: bannerForm.value
    })
    await refreshSettings()
    bannerForm.value = cloneBanners(result.banners)
    bannerStatus.value = 'Banners saved.'
  } catch (error) {
    isBannerError.value = true
    bannerStatus.value = error?.data?.statusMessage || 'Failed to save banners.'
  } finally {
    isSavingBanners.value = false
  }
}

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
.settings-page {
  font-weight: 500;
  min-height: 100vh;
  padding: 24px;
  background: radial-gradient(circle at top, var(--cr-surface-page-top) 0%, var(--cr-surface-1) 45%, var(--cr-surface-root) 100%);
  color: var(--cr-text);
  font-family: var(--cr-font);
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
  color: var(--cr-text-muted-1);
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
  border: 1px solid var(--cr-line-1);
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
  color: var(--cr-text-muted-5);
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
  color: var(--cr-text-muted-5);
}

select {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--cr-line-2);
  background: var(--cr-surface-3);
  color: var(--cr-text-ctrl);
  font-family: var(--cr-font);
  font-size: 13px;
}

.current-setting {
  font-size: 13px;
  color: var(--cr-text-muted-5);
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
  color: var(--cr-accent);
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
  color: var(--cr-success);
  min-height: 18px;
}

.status.error {
  color: var(--cr-warning);
}

.actions {
  display: flex;
  gap: 10px;
  margin-left: auto;
}

.primary {
  padding: 10px 18px;
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

.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.secondary {
  padding: 10px 16px;
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

.secondary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 16px minimum on every control: anything smaller triggers iOS Safari's auto-zoom
   on focus and leaves the admin page zoomed. */
input[type='text'],
input[type='url'] {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--cr-line-2);
  background: var(--cr-surface-3);
  color: var(--cr-text-ctrl);
  font-family: var(--cr-font);
  font-size: 16px;
  width: 100%;
}

.check {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--cr-text-muted-5);
  cursor: pointer;
}

.check input {
  width: 20px;
  height: 20px;
  accent-color: var(--cr-brand-500);
}

.counter {
  font-style: normal;
  margin-left: 6px;
  color: var(--cr-text-dim-2);
}

.counter.over {
  color: var(--cr-warning);
}

.hint {
  margin: 0;
  font-size: 13px;
  color: var(--cr-text-muted-5);
  line-height: 1.5;
}

.banner-row {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr) auto;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--cr-line-1);
  border-radius: 12px;
  background: rgba(3, 8, 14, 0.4);
}

.banner-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  padding: 8px;
  border: 1px dashed var(--cr-line-2);
  border-radius: 10px;
  background: var(--cr-surface-1);
}

/* contain, not cover: the point of the preview is to judge the whole banner. */
.banner-preview img {
  max-width: 100%;
  max-height: 120px;
  object-fit: contain;
}

.banner-preview-empty {
  font-size: 12px;
  color: var(--cr-text-dim-2);
}

.banner-fields {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.banner-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.icon-button {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  border: 1px solid var(--cr-line-2);
  background: var(--cr-surface-3);
  color: var(--cr-text-ctrl);
  font-size: 16px;
  cursor: pointer;
}

.icon-button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.icon-button.danger {
  border-color: var(--cr-danger-border);
  color: var(--cr-danger-text-2);
}

.upload-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.upload-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid var(--cr-line-2);
  background: var(--cr-surface-3);
  color: var(--cr-text-ctrl);
  font-size: 14px;
  cursor: pointer;
}

.upload-button input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.dims {
  font-size: 12px;
  color: var(--cr-text-dim-2);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 900px) {
  .banner-row {
    grid-template-columns: 1fr;
  }

  .banner-actions {
    flex-direction: row;
    justify-content: flex-end;
  }
}

.info-panel h2 {
  margin: 0;
  font-size: 16px;
}

.info-panel p {
  margin: 0;
  font-size: 13px;
  color: var(--cr-text-muted-5);
  line-height: 1.6;
}

.locked {
  padding: 24px;
  border-radius: 14px;
  border: 1px solid var(--cr-line-1);
  background: rgba(0, 0, 0, 0.35);
  display: grid;
  gap: 12px;
  max-width: 500px;
}

.locked h2 {
  margin: 0;
}
</style>
