import { createError, defineEventHandler, readBody } from 'h3'
import { assertSameOrigin, requireAdmin } from '../../utils/auth'
import {
  MAX_ADS,
  normalizeBanners,
  pruneOrphanUploads,
  withBannerLock,
  writeBanners
} from '../../utils/banners'
import { safeImageUrl, safeLinkUrl } from '#shared/url-safety.js'
import { normalizeHex } from '#shared/palette.js'
import { MAX_THEME_OVERRIDES } from '#shared/theme-config.js'
import { isCivilDate } from '#shared/schedule-time.js'

// Rejects bad URLs loudly instead of silently blanking them, so the admin finds out
// at save time rather than wondering why their banner never appears.
function assertUrls(body) {
  const announcementLink = body?.announcement?.linkUrl
  if (announcementLink && !safeLinkUrl(announcementLink)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Announcement link must be an http(s) URL or a site path starting with /'
    })
  }

  const stripLink = body?.channelStrip?.linkUrl
  if (stripLink && !safeLinkUrl(stripLink)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Channel strip link must be an http(s) URL or a site path starting with /'
    })
  }

  const ads = Array.isArray(body?.ads) ? body.ads : []
  if (ads.length > MAX_ADS) {
    throw createError({ statusCode: 400, statusMessage: `At most ${MAX_ADS} banners are allowed` })
  }

  ads.forEach((ad, index) => {
    const position = index + 1
    if (ad?.imageUrl && !safeImageUrl(ad.imageUrl)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Banner ${position}: image must be an https URL or an uploaded image`
      })
    }
    if (ad?.linkUrl && !safeLinkUrl(ad.linkUrl)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Banner ${position}: link must be an http(s) URL or a site path starting with /`
      })
    }
    if (ad?.enabled && !String(ad?.alt || '').trim()) {
      // The image is the only content inside the link, so without alt text the
      // link has no accessible name at all.
      throw createError({
        statusCode: 400,
        statusMessage: `Banner ${position}: alt text is required when a banner is enabled`
      })
    }
  })
}

// Colours are re-validated on the way out of shared/palette.js too, so this is not the
// only thing standing between a bad value and the stylesheet. It exists so an admin who
// pastes something wrong finds out at save time rather than wondering why the site is
// still blue — the same reasoning as assertUrls above.
function assertTheme(body) {
  const theme = body?.theme
  if (!theme) return

  if (theme.default && !normalizeHex(theme.default)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Site colour must be a hex value like #227db6'
    })
  }

  for (const [slug, hex] of Object.entries(theme.channels || {})) {
    if (hex && !normalizeHex(hex)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Channel "${slug}": colour must be a hex value like #227db6`
      })
    }
  }

  const overrides = Array.isArray(theme.overrides) ? theme.overrides : []
  if (overrides.length > MAX_THEME_OVERRIDES) {
    throw createError({
      statusCode: 400,
      statusMessage: `At most ${MAX_THEME_OVERRIDES} scheduled colours are allowed`
    })
  }
  overrides.forEach((override, index) => {
    const name = override?.label ? `"${override.label}"` : `${index + 1}`
    if (!normalizeHex(override?.color)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Scheduled colour ${name}: colour must be a hex value like #227db6`
      })
    }
    if (!isCivilDate(override?.startDate) || !isCivilDate(override?.endDate)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Scheduled colour ${name}: both dates are required`
      })
    }
    // endDate is inclusive, so equal dates are a legitimate one-day override.
    if (override.endDate < override.startDate) {
      throw createError({
        statusCode: 400,
        statusMessage: `Scheduled colour ${name}: the end date is before the start date`
      })
    }
  })
}

function assertEmbed(body) {
  const embed = body?.embed
  if (!embed?.imageUrl) return
  if (!String(embed.imageUrl).startsWith('/api/banner-image/')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The embed image must be uploaded, not linked from another site'
    })
  }
  if (!String(embed.alt || '').trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Embed image: alt text is required'
    })
  }
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  requireAdmin(event)

  const body = await readBody(event)
  assertUrls(body)
  assertTheme(body)
  assertEmbed(body)

  return withBannerLock(async () => {
    const saved = await writeBanners(normalizeBanners(body))
    // Drop uploads the new config no longer references.
    await pruneOrphanUploads(saved)
    return { ok: true, banners: saved }
  })
})
