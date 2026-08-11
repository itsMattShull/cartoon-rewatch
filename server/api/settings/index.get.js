import { defineEventHandler, getCookie } from 'h3'
import { readSettings } from '../../utils/settings'
import { defaultBanners, readBanners, withResolvedTagline } from '../../utils/banners'
import { getChannels } from '../../utils/channels'
import { defaultTheme, resolveChannelColors } from '#shared/theme-config.js'

// Public. The front page already awaits this during SSR, so banners ride along here
// rather than costing a third blocking request on the site's busiest route.
// Never put anything private in this payload.
export default defineEventHandler(async (event) => {
  const settings = await readSettings()
  let banners
  try {
    banners = await readBanners()
  } catch {
    // This response is awaited during SSR of the front page — degrade to no banners
    // rather than failing the whole page render.
    banners = defaultBanners()
  }

  // Colours are RESOLVED here rather than shipping the override rules to the browser.
  //
  // Three reasons, in order of importance. The rules carry admin-authored labels and
  // dates — "Investor demo", "Maintenance Thursday" — and this payload is public and
  // permanent in the SSR'd HTML. They are also bulky: 20 overrides is several KB on the
  // busiest anonymous route, which is per-viewer uncacheable. And the client's clock is
  // untrusted anyway, so client-side evaluation would only let a visitor pick whichever
  // colour they fancied while disagreeing with SSR about the first paint.
  //
  // What ships instead is every channel's answer plus when the answer next changes, so a
  // channel flip is a map lookup and there is nothing to recompute on a timer.
  let theme
  try {
    const { channels } = await getChannels({ includeDefaults: true })
    theme = resolveChannelColors(
      banners.theme ?? defaultTheme(),
      channels.map((channel) => channel.slug),
      Date.now()
    )
  } catch {
    theme = resolveChannelColors(defaultTheme(), [], Date.now())
  }

  // The palette for the channel this visitor is about to see, so the first paint is
  // already the right colour. An unknown or malformed cookie simply misses the lookup
  // and falls through to the site default.
  const cookieSlug = getCookie(event, 'crt80_channel')
  const activeColor =
    (typeof cookieSlug === 'string' && theme.colors[cookieSlug]) || theme.default

  return {
    ...settings,
    banners: withResolvedTagline(banners),
    theme: { ...theme, activeColor }
  }
})
