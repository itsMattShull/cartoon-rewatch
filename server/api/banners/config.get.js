import { defineEventHandler } from 'h3'
import { requireAdmin } from '../../utils/auth'
import { defaultBanners, readBanners, withResolvedTagline } from '../../utils/banners'

// The full editable config, for the admin settings form.
//
// Admin-gated because it carries the raw theme config — scheduled-colour rules with
// admin-authored labels and dates ("Launch day", "Investor demo"). /api/settings is
// public and strips those, shipping only each channel's already-resolved colour, so
// this is the one route that hands back the rules themselves.
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  let banners
  try {
    banners = await readBanners()
  } catch {
    banners = defaultBanners()
  }
  return { banners: withResolvedTagline(banners) }
})
