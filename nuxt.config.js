// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/theme.css'],
  app: {
    head: {
      link: [
        // Fonts are linked here rather than @import-ed inside <style scoped>.
        // Nuxt inlines scoped styles into the SSR HTML in production, so an @import
        // sits in the document head and hard-blocks first paint until Google Fonts
        // answers — and the gstatic handshake then serialises after it. Preconnecting
        // both origins and using a plain stylesheet link overlaps that work with HTML
        // parsing instead.
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          // Variable-range form: one woff2 covering 400-700, rather than three static files.
          href: 'https://fonts.googleapis.com/css2?family=Jost:wght@400..700&display=swap'
        }
      ]
    }
  },
  nitro: {
    experimental: {
      websocket: true
    }
  }
})
