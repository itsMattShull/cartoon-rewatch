# Cartoon ReWatch

Always-on retro cartoon web TV built with Nuxt 4.

The app plays channel blocks (YouTube and Dailymotion), supports live channel switching, has a Discord-authenticated admin area, tracks viewer analytics, and broadcasts live viewer/chat updates over WebSockets.

## Features

- 24/7 channel playback with a TV-style UI
- Multiple channels with per-channel active blocks
- Block Maker for creating/editing playlists
- Schedule editor (times stored in `America/Chicago`)
- Live viewer counts and channel chat via WebSockets (`/api/viewers`)
- Discord OAuth for authentication
- Admin analytics dashboard (unique viewers, returning %, visits, channel breakdown)

## Tech Stack

- Nuxt 4 / Vue 3
- Nitro server + WebSocket handlers
- JSON file storage under `assets/` (blocks, channels, schedules)
- PM2 for production process management
- GitHub Actions SSH deploy to server

## Requirements

- Node.js `24.1.0` (matches deploy workflow)
- npm

## Local Development

Install dependencies:

```bash
npm ci
```

Create `.env` in project root:

```bash
NODE_ENV=development
PORT=3000

DISCORD_CLIENT_ID=your_discord_app_client_id
DISCORD_CLIENT_SECRET=your_discord_app_client_secret
DISCORD_REDIRECT_URI=http://localhost:3000/api/auth/discord/callback
DISCORD_ALLOWED_IDS=123456789012345678,987654321098765432
SESSION_SECRET=replace-with-a-long-random-string

# Optional but recommended for YouTube auto-fill in Block Maker
YOUTUBE_API_KEY=your_youtube_data_api_key

# Optional analytics output file (defaults vary by NODE_ENV)
# ANALYTICS_FILE=.data/analytics.json

# Optional extra chat censor terms (comma or newline separated)
# CHAT_CENSOR_EXTRA=phrase one,phrase two
```

Start dev server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Scripts

- `npm run dev` - start local dev server
- `npm run build` - build production output
- `npm run preview` - run built app locally
- `npm run generate` - static generate (if needed)

## Project Data Files

This project stores most runtime content as JSON:

- `assets/blocks/*.json` - block playlists
- `assets/blocks/active-blocks.json` - active block per channel
- `assets/blocks/blocks-index.json` - block metadata (created/updated/by)
- `assets/channels/channels-index.json` - channel list and names
- `assets/schedules/schedules.json` - scheduled block switches
- `assets/discord-users.json` - Discord ID to username cache

Default channel payloads currently exist in:

- `assets/channels/toonami.json`
- `assets/channels/adult-swim.json`
- `assets/channels/saturday-morning.json`

## Auth and Access

- Discord login endpoints:
  - `/api/auth/discord/login`
  - `/api/auth/discord/callback`
- Admin routes (for allowed Discord IDs):
  - `/admin`
  - `/admin/block-maker`
  - `/admin/schedule`
  - `/admin/analytics`
- Chat login uses Discord with `scope=chat` and is separate from admin allow-list checks.

## Deployment

On push to `master`, `.github/workflows/deploy.yml` deploys over SSH and runs:

1. `git pull origin master` on `/var/www/cartoonrewatch`
2. `npm ci`
3. `npm run build`
4. `pm2 restart 0 --update-env`

PM2 config is in `ecosystem.config.cjs` and runs `.output/server/index.mjs`.
