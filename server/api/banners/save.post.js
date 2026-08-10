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

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  requireAdmin(event)

  const body = await readBody(event)
  assertUrls(body)

  return withBannerLock(async () => {
    const saved = await writeBanners(normalizeBanners(body))
    // Drop uploads the new config no longer references.
    await pruneOrphanUploads(saved)
    return { ok: true, banners: saved }
  })
})
