import { defineEventHandler } from 'h3'
import { readSettings } from '../../utils/settings'
import { defaultBanners, readBanners, withResolvedTagline } from '../../utils/banners'

// Public. The front page already awaits this during SSR, so banners ride along here
// rather than costing a third blocking request on the site's busiest route.
// Never put anything private in this payload.
export default defineEventHandler(async () => {
  const settings = await readSettings()
  let banners
  try {
    banners = await readBanners()
  } catch {
    // This response is awaited during SSR of the front page — degrade to no banners
    // rather than failing the whole page render.
    banners = defaultBanners()
  }
  return { ...settings, banners: withResolvedTagline(banners) }
})
