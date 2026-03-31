const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '.env') })

module.exports = {
  apps: [
    {
      name: 'cartoonrewatch',
      script: '.output/server/index.mjs',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: process.env.NODE_ENV || 'production',
        PORT: process.env.PORT || '3000',
        DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
        DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
        DISCORD_REDIRECT_URI: process.env.DISCORD_REDIRECT_URI,
        DISCORD_ALLOWED_IDS: process.env.DISCORD_ALLOWED_IDS,
        SESSION_SECRET: process.env.SESSION_SECRET,
        YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
        DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
        PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL
      }
    }
  ]
}
