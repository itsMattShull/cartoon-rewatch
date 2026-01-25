module.exports = {
  apps: [
    {
      name: 'cartoonrewatch',
      script: '.output/server/index.mjs',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        DISCORD_CLIENT_ID: 'YOUR_DISCORD_CLIENT_ID',
        DISCORD_CLIENT_SECRET: 'YOUR_DISCORD_CLIENT_SECRET',
        DISCORD_REDIRECT_URI: 'https://www.cartoonrewatch.com/api/auth/discord/callback',
        DISCORD_ALLOWED_IDS: 'DISCORD_ID_1,DISCORD_ID_2',
        SESSION_SECRET: 'REPLACE_WITH_A_LONG_RANDOM_STRING'
      }
    }
  ]
}
