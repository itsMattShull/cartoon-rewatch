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
          <h2>Header Tagline</h2>
          <span class="panel-sub">The line under "Cartoon ReWatch"</span>
        </div>

        <label class="field">
          <span>
            Tagline
            <em class="counter" :class="{ over: taglineChars > MAX_TAGLINE }">
              {{ taglineChars }}/{{ MAX_TAGLINE }}
            </em>
          </span>
          <input
            type="text"
            v-model="bannerForm.tagline.text"
            :maxlength="MAX_TAGLINE"
            placeholder="Grab cereal and enjoy."
          />
        </label>
        <p class="hint">
          Leave this empty to hide the line entirely. Saved with the Save Banners button
          at the bottom of this page.
        </p>
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
          <h2>Channel Colours</h2>
          <span class="panel-sub">The site recolours when a viewer switches channel</span>
        </div>

        <div class="colour-row">
          <span class="colour-name">Site default</span>
          <div class="colour-controls">
            <input
              type="color"
              class="swatch"
              aria-label="Site default colour"
              :value="swatchColor('site')"
              @change="setColor('site', $event.target.value)"
            />
            <input
              type="text"
              class="hex"
              inputmode="text"
              autocapitalize="off"
              autocorrect="off"
              autocomplete="off"
              spellcheck="false"
              aria-label="Site default colour hex"
              :value="hexFieldValue('site')"
              @input="onHexInput('site', $event.target.value)"
              @blur="onHexBlur('site')"
            />
            <button class="ghost" type="button" @click="previewKey = 'site'">Preview</button>
          </div>
        </div>

        <div v-for="channel in channelList" :key="channel.slug" class="colour-row">
          <span class="colour-name">
            {{ channel.name }}
            <em v-if="!bannerForm.theme.channels[channel.slug]" class="inherit-note">
              using site default
            </em>
          </span>
          <div class="colour-controls">
            <input
              type="color"
              class="swatch"
              :aria-label="`${channel.name} colour`"
              :value="swatchColor(channel.slug)"
              @change="setColor(channel.slug, $event.target.value)"
            />
            <input
              type="text"
              class="hex"
              inputmode="text"
              autocapitalize="off"
              autocorrect="off"
              autocomplete="off"
              spellcheck="false"
              :aria-label="`${channel.name} colour hex`"
              :placeholder="bannerForm.theme.default"
              :value="hexFieldValue(channel.slug)"
              @input="onHexInput(channel.slug, $event.target.value)"
              @blur="onHexBlur(channel.slug)"
            />
            <button class="ghost" type="button" @click="previewKey = channel.slug">Preview</button>
            <button
              v-if="bannerForm.theme.channels[channel.slug]"
              class="ghost"
              type="button"
              @click="clearChannelColor(channel.slug)"
            >
              Reset
            </button>
          </div>
        </div>

        <div v-if="orphanChannelColors.length" class="orphans">
          <p class="hint">These channels no longer exist. Their colour is kept in case the
            channel comes back, the same way schedules are.</p>
          <div v-for="slug in orphanChannelColors" :key="slug" class="colour-row">
            <span class="colour-name">{{ slug }}</span>
            <div class="colour-controls">
              <span class="swatch static" :style="{ background: swatchColor(slug) }" />
              <code class="hex-static">{{ bannerForm.theme.channels[slug] }}</code>
              <button class="ghost" type="button" @click="clearChannelColor(slug)">Remove</button>
            </div>
          </div>
        </div>

        <!-- The admin pages deliberately keep the stable blue theme, so this is the only
             place the chosen colour can actually be seen before saving. A row of tiny
             swatches would be useless on a phone; this is a miniature of the real page
             chrome instead. -->
        <div class="preview" :style="previewStyle">
          <div class="preview-page">
            <div class="preview-titlebar">
              <strong>Cartoon ReWatch</strong>
              <span>Grab cereal and enjoy.</span>
            </div>
            <div class="preview-body">
              <span class="preview-guide" />
              <span class="preview-guide" />
              <a class="preview-link" href="#" @click.prevent>Accent link</a>
              <button class="preview-btn" type="button">Button</button>
            </div>
          </div>
        </div>

        <p class="hint">
          You picked <code>{{ previewHex }}</code>, the site will use
          <code>{{ previewBrand }}</code>. The palette keeps its own lightness ladder, so
          only the hue and how vivid it is carry across.
        </p>
        <p class="hint">
          Text contrast in this palette: {{ previewContrast.toFixed(1) }}:1 (needs 4.5:1).
        </p>
        <p v-if="previewCollision" class="hint warn">
          This hue is close to the {{ previewCollision.status }} colour
          ({{ previewCollision.separationDeg }}&deg; apart), which stays fixed so errors and
          warnings keep their meaning. They will be harder to tell apart from ordinary text.
        </p>
        <p class="hint">
          Sidebar banner images do not recolour, so a strongly coloured channel can clash
          with them.
        </p>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2>Scheduled Colours</h2>
          <span class="panel-sub">{{ overrides.length }} of {{ MAX_THEME_OVERRIDES }} used</span>
        </div>

        <p class="hint">
          A scheduled colour overrides the channel colour for a range of dates. Dates are
          whole days in CST, and the end date is included.
        </p>

        <div v-if="overrideDraft" class="override-form">
          <label class="field">
            <span>Name</span>
            <input type="text" v-model="overrideDraft.label" placeholder="Halloween" />
          </label>

          <div class="colour-controls">
            <input type="color" class="swatch" aria-label="Scheduled colour" v-model="overrideDraft.color" />
            <input
              type="text"
              class="hex"
              autocapitalize="off"
              autocorrect="off"
              autocomplete="off"
              spellcheck="false"
              aria-label="Scheduled colour hex"
              v-model="overrideDraft.color"
            />
          </div>

          <div class="form-grid">
            <label class="field">
              <span>Start date</span>
              <input type="date" v-model="overrideDraft.startDate" />
            </label>
            <label class="field">
              <span>End date (included)</span>
              <input type="date" v-model="overrideDraft.endDate" />
            </label>
          </div>

          <div class="field">
            <span>Channels</span>
            <!-- Chips rather than <select multiple>, which iOS renders as an inline
                 scrolling listbox with ~20px rows. -->
            <div class="chips">
              <button
                class="chip"
                type="button"
                :aria-pressed="overrideDraft.channels.length === 0"
                :class="{ on: overrideDraft.channels.length === 0 }"
                @click="overrideDraft.channels = []"
              >
                All channels
              </button>
              <button
                v-for="channel in channelList"
                :key="channel.slug"
                class="chip"
                type="button"
                :aria-pressed="overrideDraft.channels.includes(channel.slug)"
                :class="{ on: overrideDraft.channels.includes(channel.slug) }"
                @click="toggleOverrideChannel(channel.slug)"
              >
                {{ channel.name }}
              </button>
            </div>
          </div>

          <label class="check">
            <input type="checkbox" v-model="overrideDraft.enabled" />
            <span>Active</span>
          </label>

          <div class="override-actions">
            <span class="status error">{{ overrideError }}</span>
            <button class="secondary" type="button" @click="cancelOverride">Cancel</button>
            <button class="primary" type="button" :disabled="Boolean(overrideError)" @click="commitOverride">
              {{ editingOverrideId ? 'Update' : 'Add' }}
            </button>
          </div>
        </div>

        <button
          v-else
          class="secondary"
          type="button"
          :disabled="overrides.length >= MAX_THEME_OVERRIDES"
          @click="startNewOverride"
        >
          Add scheduled colour
        </button>

        <p v-if="!overrides.length" class="hint">No scheduled colours.</p>

        <!-- Summary cards with one edit form above, rather than every rule rendered as an
             editable row: admin/schedule.vue settled on this because a row of every
             control per rule is several screens tall on a phone. -->
        <div v-for="rule in overrides" :key="rule.id" class="rule-card">
          <span class="rule-dot" :style="{ background: rule.color }" />
          <div class="rule-text">
            <strong>
              {{ rule.label || 'Untitled' }}
              <em v-if="isOverrideActive(rule)" class="rule-live">active now</em>
              <em v-else-if="!rule.enabled" class="rule-paused">paused</em>
            </strong>
            <span>{{ describeOverride(rule) }}</span>
          </div>
          <div class="rule-actions">
            <button class="ghost" type="button" @click="editOverride(rule)">Edit</button>
            <button class="ghost" type="button" @click="toggleOverrideEnabled(rule)">
              {{ rule.enabled ? 'Pause' : 'Resume' }}
            </button>
            <button class="ghost danger" type="button" @click="removeOverride(rule.id)">Delete</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h2>Link Preview Image</h2>
          <span class="panel-sub">Shown when the site is shared in chat or social</span>
        </div>

        <div class="upload-row">
          <label class="upload-button">
            <input type="file" accept="image/png,image/jpeg,image/webp" @change="uploadEmbedImage" />
            <span>{{ embedUploading ? 'Uploading...' : 'Upload image' }}</span>
          </label>
          <span v-if="bannerForm.embed.width" class="dims">
            {{ bannerForm.embed.width }}&times;{{ bannerForm.embed.height }} &middot;
            {{ (bannerForm.embed.width / bannerForm.embed.height).toFixed(2) }}:1
          </span>
          <button v-if="bannerForm.embed.imageUrl" class="ghost" type="button" @click="clearEmbedImage">
            Remove
          </button>
        </div>

        <template v-if="bannerForm.embed.imageUrl">
          <div class="chips">
            <button
              v-for="target in EMBED_TARGETS"
              :key="target.id"
              class="chip"
              type="button"
              :aria-pressed="embedPreviewTarget === target.id"
              :class="{ on: embedPreviewTarget === target.id }"
              @click="embedPreviewTarget = target.id"
            >
              {{ target.label }}
            </button>
            <button
              class="chip"
              type="button"
              :aria-pressed="embedPreviewLight"
              :class="{ on: embedPreviewLight }"
              @click="embedPreviewLight = !embedPreviewLight"
            >
              {{ embedPreviewLight ? 'Light bg' : 'Dark bg' }}
            </button>
          </div>

          <!-- The whole image at contain, with everything outside the platform's safe
               area dimmed. The ad-banner preview uses contain to judge the whole image;
               here the question is the opposite one, what gets cut off. -->
          <div class="embed-preview" :class="{ light: embedPreviewLight }">
            <img :src="bannerForm.embed.imageUrl" :alt="bannerForm.embed.alt || 'Embed preview'" />
            <span
              class="embed-mask"
              :class="{ crops: embedTarget.crops }"
              :style="{ aspectRatio: String(embedTarget.ratio) }"
            />
          </div>
          <p class="hint">
            {{ embedTarget.crops
              ? `${embedTarget.label} crops to the outlined area.`
              : `${embedTarget.label} keeps the whole image and letterboxes it.` }}
          </p>

          <label class="field">
            <span>Alt text (required)</span>
            <input type="text" v-model="bannerForm.embed.alt" :maxlength="MAX_ALT" placeholder="Cartoon ReWatch" />
          </label>
        </template>

        <p v-else class="hint">
          No image set — links currently preview with the site logo.
        </p>

        <p v-for="warning in embedWarnings" :key="warning" class="hint warn">{{ warning }}</p>
        <p class="hint">
          Chat apps cache previews for a long time. A new upload gets a new address, so
          the preview refreshes; re-sharing the same link may still show the old one for a
          while.
        </p>
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

        <button
          class="secondary"
          type="button"
          :disabled="bannerForm.ads.length >= MAX_ADS"
          @click="addAd"
        >
          Add banner
        </button>

      </div>

      <!-- One sticky bar for the whole page, outside every panel.
           It saves the tagline, announcement, channel strip, colours, scheduled
           colours, the embed image and the banners — /api/banners/save replaces the
           whole config, so they are one transaction and must be one button.
           It also has to be the ONLY sticky bar: a second one in an adjacent panel
           pins at the same time on a short viewport and the two overlap. -->
      <div class="banner-save-bar">
        <div class="status" :class="{ error: isBannerError }">
          {{ bannerStatus || (hasBannerChanges ? 'Unsaved changes' : '') }}
        </div>
        <div class="actions">
          <button class="secondary" type="button" :disabled="isSavingBanners" @click="resetBanners">
            Reset
          </button>
          <button class="primary" type="button" :disabled="isSavingBanners" @click="saveBanners">
            {{ isSavingBanners ? 'Saving...' : 'Save' }}
          </button>
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
import {
  REFERENCE_BRAND,
  contrastRatio,
  derivePalette,
  normalizeHex,
  statusHueCollision
} from '#shared/palette.js'
import { MAX_THEME_OVERRIDES } from '#shared/theme-config.js'

const { data: authData } = await useFetch('/api/auth/me')
const isAuthorized = computed(() => authData.value?.authenticated && authData.value?.allowed)

const { data: settingsData, refresh: refreshSettings } = await useFetch('/api/settings')

// The editable config comes from the admin-only route, not /api/settings: the public one
// deliberately omits the scheduled-colour rules.
const { data: configData, refresh: refreshConfig } = await useFetch('/api/banners/config')

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
const MAX_TAGLINE = 48

// These two functions and the server's normalizeBanners must list the same fields.
// /api/banners/save replaces the whole config rather than patching it, so any key
// missing here is silently erased on every save from this page.
function emptyBanners() {
  return {
    tagline: { text: '' },
    announcement: { enabled: false, text: '', linkUrl: '', linkLabel: '' },
    channelStrip: { enabled: false, text: '', linkUrl: '' },
    theme: { default: REFERENCE_BRAND, channels: {}, overrides: [] },
    embed: { imageUrl: '', width: 0, height: 0, alt: '' },
    ads: []
  }
}

function cloneBanners(source) {
  const base = emptyBanners()
  if (!source) return base
  return {
    tagline: { ...base.tagline, ...(source.tagline || {}) },
    announcement: { ...base.announcement, ...(source.announcement || {}) },
    channelStrip: { ...base.channelStrip, ...(source.channelStrip || {}) },
    // theme.channels and theme.overrides need explicit deep copies. A shallow per-key
    // merge would alias the saved objects, so editing the form would mutate what
    // hasBannerChanges compares against and the dirty indicator would never light up.
    theme: {
      default: source.theme?.default || base.theme.default,
      channels: { ...(source.theme?.channels || {}) },
      overrides: (source.theme?.overrides || []).map((rule) => ({
        ...rule,
        channels: [...(rule.channels || [])]
      }))
    },
    embed: { ...base.embed, ...(source.embed || {}) },
    ads: (source.ads || []).map((ad) => ({ ...ad }))
  }
}

const bannerForm = ref(cloneBanners(configData.value?.banners))
const isSavingBanners = ref(false)
const bannerStatus = ref('')
const isBannerError = ref(false)
const uploadingIndex = ref(-1)

const announcementChars = computed(() => bannerForm.value.announcement.text.length)
const stripChars = computed(() => bannerForm.value.channelStrip.text.length)
// Count by code point so the counter agrees with the server's cap, which slices the
// same way — otherwise an emoji reads as 2 characters here and 1 there.
const taglineChars = computed(() => Array.from(bannerForm.value.tagline.text || '').length)

const hasBannerChanges = computed(() => {
  const saved = cloneBanners(configData.value?.banners)
  return JSON.stringify(saved) !== JSON.stringify(bannerForm.value)
})

// --- Channel colours -------------------------------------------------------

const { data: channelsData } = await useFetch('/api/channels')
const channelList = computed(() => channelsData.value?.channels || [])

// An <input type="color"> cannot represent "no value": assigning it anything invalid
// silently resets it to #000000. So the draft text the admin is typing is kept separate
// from the committed value, and only a complete, valid hex is written back. Sharing one
// ref between the swatch and the text field makes the field unusable — typing "#e" would
// commit black and snap the text you are mid-way through typing to "#000000".
const hexDrafts = ref({})

function committedColor(key) {
  if (key === 'site') return bannerForm.value.theme.default || REFERENCE_BRAND
  return bannerForm.value.theme.channels[key] || ''
}

// What the swatch shows. A channel with no override of its own displays the site colour
// it is actually inheriting, rather than an arbitrary one.
function swatchColor(key) {
  return committedColor(key) || bannerForm.value.theme.default || REFERENCE_BRAND
}

function hexFieldValue(key) {
  return hexDrafts.value[key] ?? committedColor(key)
}

function setColor(key, value) {
  const hex = normalizeHex(value)
  if (!hex) return
  if (key === 'site') bannerForm.value.theme.default = hex
  else bannerForm.value.theme.channels[key] = hex
}

function onHexInput(key, value) {
  hexDrafts.value[key] = value
  // Commit only once it parses, so a partial "#e8" leaves the site colour alone.
  const hex = normalizeHex(value)
  if (hex) setColor(key, hex)
}

// Normalise on blur — strip whitespace, add a missing #, expand a 3-digit shorthand,
// lowercase — or revert. Phone keyboards and colour apps paste "E8720C", "#E8720C\n"
// and non-breaking spaces; rejecting those silently at save time would be baffling.
function onHexBlur(key) {
  const hex = normalizeHex(hexDrafts.value[key])
  if (hex) setColor(key, hex)
  delete hexDrafts.value[key]
}

function clearChannelColor(slug) {
  delete bannerForm.value.theme.channels[slug]
  delete hexDrafts.value[slug]
}

// Channels that still hold a colour but no longer exist. Deleting a channel deliberately
// leaves its config behind — schedules do the same, so recreating a slug restores its
// setup — but silently keeping an invisible entry is worse than showing it with a way to
// remove it.
const orphanChannelColors = computed(() => {
  const known = new Set(channelList.value.map((channel) => channel.slug))
  return Object.keys(bannerForm.value.theme.channels).filter((slug) => !known.has(slug))
})

// --- Preview ---------------------------------------------------------------

const previewKey = ref('site')
const previewHex = computed(() => swatchColor(previewKey.value))
const previewPalette = computed(() => derivePalette(previewHex.value).base)

// The picked colour is only a hue and chroma instruction: the palette's lightness ladder
// is fixed, so a bright gold becomes a dark olive. Showing both side by side is the only
// way an admin finds that out before saving rather than after.
const previewBrand = computed(() => previewPalette.value['--cr-brand-500'])

const previewStyle = computed(() => {
  const style = {}
  for (const [name, value] of Object.entries(previewPalette.value)) style[name] = value
  return style
})

const previewCollision = computed(() => statusHueCollision(previewHex.value))

const previewContrast = computed(() =>
  contrastRatio(previewPalette.value['--cr-accent'], previewPalette.value['--cr-surface-1'])
)

// --- Scheduled colours -----------------------------------------------------

const overrides = computed(() => bannerForm.value.theme.overrides)
const editingOverrideId = ref('')
const overrideDraft = ref(null)

function blankOverride() {
  const today = new Date().toISOString().slice(0, 10)
  return {
    id: `ovr-${Date.now().toString(36)}`,
    label: '',
    color: bannerForm.value.theme.default || REFERENCE_BRAND,
    channels: [],
    startDate: today,
    endDate: today,
    enabled: true
  }
}

function startNewOverride() {
  overrideDraft.value = blankOverride()
  editingOverrideId.value = ''
}

function editOverride(rule) {
  overrideDraft.value = { ...rule, channels: [...rule.channels] }
  editingOverrideId.value = rule.id
}

function cancelOverride() {
  overrideDraft.value = null
  editingOverrideId.value = ''
}

const overrideError = computed(() => {
  const draft = overrideDraft.value
  if (!draft) return ''
  if (!normalizeHex(draft.color)) return 'Pick a colour.'
  if (!draft.startDate || !draft.endDate) return 'Both dates are required.'
  if (draft.endDate < draft.startDate) return 'The end date is before the start date.'
  return ''
})

function commitOverride() {
  const draft = overrideDraft.value
  if (!draft || overrideError.value) return
  const rule = { ...draft, color: normalizeHex(draft.color) }
  const index = overrides.value.findIndex((entry) => entry.id === rule.id)
  if (index >= 0) overrides.value.splice(index, 1, rule)
  else overrides.value.push(rule)
  cancelOverride()
}

function removeOverride(id) {
  const index = overrides.value.findIndex((entry) => entry.id === id)
  if (index >= 0) overrides.value.splice(index, 1)
  if (editingOverrideId.value === id) cancelOverride()
}

function toggleOverrideEnabled(rule) {
  rule.enabled = !rule.enabled
}

function toggleOverrideChannel(slug) {
  const list = overrideDraft.value.channels
  const index = list.indexOf(slug)
  if (index >= 0) list.splice(index, 1)
  else list.push(slug)
}

const todayCivil = new Date().toISOString().slice(0, 10)

// Which rule is winning right now. Twenty summary cards otherwise look identical, and
// "why is the site not orange" has no answer visible on the page.
function isOverrideActive(rule) {
  return rule.enabled && todayCivil >= rule.startDate && todayCivil <= rule.endDate
}

function describeOverride(rule) {
  const scope = rule.channels.length
    ? rule.channels
        .map((slug) => channelList.value.find((c) => c.slug === slug)?.name || slug)
        .join(', ')
    : 'All channels'
  const range =
    rule.startDate === rule.endDate ? rule.startDate : `${rule.startDate} to ${rule.endDate}`
  return `${range} - ${scope}`
}

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

// --- Embed image -----------------------------------------------------------

const embedUploading = ref(false)
const embedPreviewTarget = ref('discord')
const embedPreviewLight = ref(false)

// How each platform treats an image that is not its preferred shape. Discord and Slack
// letterbox; X and iMessage centre-crop, so the mask is what shows what survives.
const EMBED_TARGETS = [
  { id: 'discord', label: 'Discord', ratio: 1.91, crops: false },
  { id: 'x', label: 'X', ratio: 1.91, crops: true },
  { id: 'imessage', label: 'iMessage', ratio: 1.5, crops: true },
  { id: 'slack', label: 'Slack', ratio: 1.91, crops: false }
]
const embedTarget = computed(
  () => EMBED_TARGETS.find((t) => t.id === embedPreviewTarget.value) || EMBED_TARGETS[0]
)

const embedWarnings = computed(() => {
  const embed = bannerForm.value.embed
  const warnings = []
  if (!embed.imageUrl) return warnings
  const { width, height } = embed
  if (width && height) {
    if (width < 600 || height < 315) {
      warnings.push('Smaller than 600x315 — some platforms will show a small thumbnail instead of a large preview.')
    }
    if (height > width) {
      warnings.push('Portrait image. X and iMessage centre-crop to landscape, so most of this will be cut off.')
    }
  }
  if (/\.(gif|webp)$/.test(embed.imageUrl)) {
    warnings.push('GIF and WebP previews are unreliable — several platforms will not render them. PNG or JPEG is safer.')
  }
  if (/\.png$/.test(embed.imageUrl)) {
    warnings.push('If this PNG has a transparent background, check it against both preview backgrounds below — Slack composites on white, Discord on dark.')
  }
  return warnings
})

/**
 * Shrinks an image in the browser before uploading.
 *
 * Without this the panel most likely to be used from a phone is the one most likely to
 * fail: an iPhone photo-library pick arrives as roughly 4032x3024 and ~3MB, which trips
 * both the 2MB body cap and the 4000px dimension cap on the server. Re-encoding to fit
 * 1200x630 also happens to produce the recommended embed size.
 *
 * Falls back to the original file if anything here fails; the server re-validates either
 * way, so the worst case is the error the admin would have got anyway.
 */
async function downscaleForEmbed(file) {
  const MAX_W = 1200
  const MAX_H = 630
  try {
    if (typeof createImageBitmap !== 'function' || file.type === 'image/gif') return file
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_W / bitmap.width, MAX_H / bitmap.height)
    if (scale >= 1 && file.size <= 1_500_000) {
      bitmap.close?.()
      return file
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    // PNG keeps transparency, which a logo usually needs; everything else re-encodes as
    // JPEG, which is what keeps a photo under the cap.
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.85))
    if (!blob) return file
    return new File([blob], 'embed', { type })
  } catch {
    return file
  }
}

async function uploadEmbedImage(event) {
  const input = event.target
  const file = input.files?.[0]
  if (!file) return
  embedUploading.value = true
  bannerStatus.value = ''
  isBannerError.value = false
  try {
    const prepared = await downscaleForEmbed(file)
    const body = new FormData()
    body.append('file', prepared)
    const result = await $fetch('/api/banners/upload', { method: 'POST', body })
    bannerForm.value.embed.imageUrl = result.imageUrl
    bannerForm.value.embed.width = result.width
    bannerForm.value.embed.height = result.height
    bannerStatus.value = `Uploaded (${Math.round(result.bytes / 1024)} KB). Save to publish.`
  } catch (error) {
    isBannerError.value = true
    bannerStatus.value = error?.data?.statusMessage || 'Upload failed.'
  } finally {
    embedUploading.value = false
    input.value = ''
  }
}

function clearEmbedImage() {
  bannerForm.value.embed = { imageUrl: '', width: 0, height: 0, alt: '' }
}

function resetBanners() {
  bannerForm.value = cloneBanners(configData.value?.banners)
  bannerStatus.value = ''
  isBannerError.value = false
  hexDrafts.value = {}
  cancelOverride()
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
    await Promise.all([refreshSettings(), refreshConfig()])
    bannerForm.value = cloneBanners(result.banners)
    hexDrafts.value = {}
    bannerStatus.value = 'Saved.'
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
  /* Matches the front page. A flat 24px burns 48px of a 375px viewport. */
  padding: clamp(14px, 3vw, 24px);
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
  min-height: 44px;
  border-radius: 10px;
  border: 1px solid var(--cr-line-2);
  background: var(--cr-surface-3);
  color: var(--cr-text-ctrl);
  font-family: var(--cr-font);
  /* 16px for the same reason as the text inputs below: iOS Safari auto-zooms any form
     control under 16px on focus, and that applies to <select> too. */
  font-size: 16px;
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
   on focus and leaves the admin page zoomed.
   
   This used to name only text and url, which was fine while those were the only
   controls here. Date, time, number and select fall through to the UA default of
   ~13.3px, so adding the scheduled-colour panel would have reintroduced the zoom bug
   that admin/schedule.vue already had to fix once. Written as a broad selector with
   the non-text types excluded, so the next input type added is covered by default. */
input:not([type='checkbox']):not([type='radio']):not([type='color']):not([type='file']),
select {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--cr-line-2);
  background: var(--cr-surface-3);
  color: var(--cr-text-ctrl);
  font-family: var(--cr-font);
  font-size: 16px;
  /* 44px is the minimum comfortable touch target; the padding above computes to ~41. */
  min-height: 44px;
  width: 100%;
}

/* iOS gives date and time inputs an intrinsic width that ignores the grid track they
   sit in, so an empty optional date renders as a stubby box in a full-width row. */
input[type='date'],
input[type='time'] {
  appearance: none;
  -webkit-appearance: none;
  min-width: 0;
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

.banner-save-bar {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  padding: 12px;
  /* Without the safe-area inset the button sits under the iPhone home indicator. */
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
  /* No negative margins: this used to sit inside the banners panel and bleed to its
     edges. At page level it is already full width. */
  border-radius: 14px;
  background: var(--cr-surface-2, rgba(6, 14, 22, 0.96));
  border-top: 1px solid var(--cr-line-1);
}

.banner-save-bar .actions {
  margin-left: auto;
}

@media (max-width: 600px) {
  .banner-save-bar .actions {
    width: 100%;
  }

  .banner-save-bar .actions > button {
    flex: 1;
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

/* --- Channel colours ------------------------------------------------------ */

.colour-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 0;
  border-bottom: 1px solid var(--cr-line-subtle);
}

.colour-name {
  font-size: 14px;
  color: var(--cr-text-muted-5);
}

.inherit-note {
  font-style: normal;
  font-size: 12px;
  color: var(--cr-text-dim-2);
}

/* Stacked, not one row: the name is admin-editable and unbounded, and a name plus three
   controls on one line does not fit a 375px viewport. */
.colour-controls {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.colour-controls .ghost {
  grid-column: 3;
}

/* A bare colour input is ~40x24 on iOS and ignores padding and background. */
.swatch {
  appearance: none;
  -webkit-appearance: none;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--cr-line-2);
  border-radius: 10px;
  background: none;
  cursor: pointer;
}

.swatch::-webkit-color-swatch-wrapper {
  padding: 2px;
}

.swatch::-webkit-color-swatch {
  border: none;
  border-radius: 8px;
}

.swatch::-moz-color-swatch {
  border: none;
  border-radius: 8px;
}

.swatch.static {
  display: block;
}

.hex,
.hex-static {
  font-family: var(--cr-font-mono);
}

.hex-static {
  font-size: 13px;
  color: var(--cr-text-dim-1);
}

.orphans {
  margin-top: 12px;
}

/* --- Preview -------------------------------------------------------------- */

/* Scoped to this element, so the derived tokens never leak into the admin chrome —
   admin pages deliberately stay on the stable blue theme. */
.preview {
  margin-top: 16px;
  border: 1px solid var(--cr-line-1);
  border-radius: 14px;
  overflow: hidden;
}

.preview-page {
  background: radial-gradient(circle at 50% 0%, var(--cr-surface-page-top), var(--cr-surface-root));
  padding: 14px;
}

.preview-titlebar {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--cr-line-2);
  background: linear-gradient(180deg, var(--cr-surface-titlebar-mid), var(--cr-surface-titlebar-end));
}

.preview-titlebar strong {
  color: var(--cr-text-bright);
  font-size: 15px;
}

.preview-titlebar span {
  color: var(--cr-text-muted-4);
  font-size: 12px;
}

.preview-body {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.preview-guide {
  flex: 1 1 60px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--cr-line-strong) 50%, transparent);
  background: linear-gradient(135deg, var(--cr-guide-block-0), var(--cr-guide-block-1));
}

.preview-link {
  color: var(--cr-accent);
  font-size: 14px;
}

.preview-btn {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--cr-line-2);
  background: linear-gradient(180deg, var(--cr-surface-btn-top), var(--cr-surface-btn-bot));
  color: var(--cr-text-ctrl);
  font-family: var(--cr-font);
  font-size: 13px;
}

.hint.warn {
  color: var(--cr-warning);
}

/* --- Chips ---------------------------------------------------------------- */

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.chip {
  min-height: 44px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--cr-line-2);
  background: var(--cr-surface-3);
  color: var(--cr-text-muted-5);
  font-family: var(--cr-font);
  font-size: 14px;
  cursor: pointer;
  /* Adjacent 44px targets are exactly where iOS double-tap zoom fires. */
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.chip.on {
  border-color: var(--cr-accent-border);
  background: var(--cr-accent-soft-2);
  color: var(--cr-text-bright);
}

/* --- Scheduled colours ---------------------------------------------------- */

.override-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--cr-line-2);
  background: var(--cr-surface-3);
}

.override-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.override-actions .status {
  flex: 1 1 100%;
}

.rule-card {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 12px 0;
  border-bottom: 1px solid var(--cr-line-subtle);
}

.rule-dot {
  width: 16px;
  height: 16px;
  margin-top: 3px;
  border-radius: 50%;
  border: 1px solid var(--cr-line-2);
}

.rule-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.rule-text strong {
  color: var(--cr-text-bright);
  font-size: 15px;
}

.rule-text span {
  color: var(--cr-text-muted-5);
  font-size: 13px;
}

.rule-live,
.rule-paused {
  margin-left: 8px;
  font-style: normal;
  font-size: 12px;
}

.rule-live {
  color: var(--cr-success);
}

.rule-paused {
  color: var(--cr-text-dim-2);
}

.rule-actions {
  grid-column: 2;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* Equal-weight actions that go full width on a phone, matching admin/schedule.vue:
   Pause is the recoverable action and must not be harder to hit than Delete. */
.rule-actions > button {
  flex: 1 1 auto;
  min-height: 44px;
}

.ghost {
  padding: 0 12px;
  min-height: 44px;
  border-radius: 10px;
  border: 1px solid var(--cr-line-2);
  background: transparent;
  color: var(--cr-text-muted-5);
  font-family: var(--cr-font);
  font-size: 14px;
  cursor: pointer;
  touch-action: manipulation;
}

.ghost.danger {
  border-color: var(--cr-danger-border);
  color: var(--cr-danger-text);
}

/* --- Embed preview -------------------------------------------------------- */

.embed-preview {
  position: relative;
  display: grid;
  place-items: center;
  margin-top: 10px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid var(--cr-line-1);
  background: #2b2d31;
}

/* Slack composites previews on white. A transparent-background logo looks fine on the
   admin page's dark panel and disappears there, so both are one tap apart. */
.embed-preview.light {
  background: #ffffff;
}

.embed-preview img {
  display: block;
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
}

/* Outlines the area the platform keeps. Pointer-events off so it never blocks the image. */
.embed-mask {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  height: calc(100% - 20px);
  max-width: calc(100% - 20px);
  pointer-events: none;
  border: 1px dashed var(--cr-accent-border);
  border-radius: 4px;
}

.embed-mask.crops {
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
}

@media (max-width: 600px) {
  .colour-controls {
    grid-template-columns: 44px minmax(0, 1fr);
  }

  .colour-controls .ghost {
    grid-column: span 2;
  }
}
</style>
