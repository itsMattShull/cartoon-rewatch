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
- Editable site banners (announcement bar, sidebar ad banners, channel strip text)

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
- `assets/settings/settings.json` - weekly schedule start day/hour
- `assets/discord-users.json` - Discord ID to username cache

Runtime-only state lives under `.data/` (gitignored, preserved across deploys):

- `.data/banners.json` - banner configuration
- `.data/banners/` - uploaded banner images, named by content hash
- `.data/analytics.json` - analytics store

> Note: `assets/settings/settings.json` and `assets/discord-users.json` are tracked in
> git *and* written at runtime. If a future commit edits either file, the deploy's
> `git pull` will abort with "local changes would be overwritten" — after `pm2 stop`
> has already run. Moving them into `.data/` would remove that risk.

## Banners

Banners are edited at `/admin/settings` and stored in `.data/banners.json`:

- **Announcement banner** - dismissible bar at the top of the front page. Dismissal is
  keyed to the message text, so editing the text re-shows it to everyone.
- **Sidebar banners** - up to 6 image banners with click-through links. On screens under
  1200px they render below the control panel, and only the first two are shown.
- **Channel strip text** - the middle slot of the CH / LIVE strip under the TV.

Images can be an external `https` URL or uploaded. Uploads accept PNG, JPEG, GIF and
WebP up to 2 MB, identified by magic bytes rather than by filename or content type
(SVG is rejected — it can carry scripts). Files are stored under a content-hash name and
served from `/api/banner-image/<hash>.<ext>` with immutable caching. Set
`client_max_body_size 2m;` on the upload path in nginx so oversized bodies are rejected
before Node buffers them.

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
  - `/admin/settings`
- Chat login uses Discord with `scope=chat`. It issues the same session cookie, so the
  cookie alone does **not** imply admin rights: the signed payload carries a `scope`
  claim, and every admin write endpoint goes through `requireAdmin()`, which requires
  `scope === 'admin'` *and* membership of `DISCORD_ALLOWED_IDS`.
- Admin write endpoints also call `assertSameOrigin()`, which requires a same-origin
  `Origin` header. Calling them from curl needs `-H "Origin: https://<your-host>"`.

## Deployment

On push to `master`, `.github/workflows/deploy.yml` deploys over SSH and runs:

1. `git pull origin master` on `/var/www/cartoonrewatch`
2. `npm ci`
3. `npm run build`
4. `pm2 restart 0 --update-env`

PM2 config is in `ecosystem.config.cjs` and runs `.output/server/index.mjs`.
