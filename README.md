# Cartoon ReWatch

Always-on retro cartoon web TV built with Nuxt 4.

The app plays channel blocks (YouTube and Dailymotion), supports live channel switching, has a Discord-authenticated admin area, tracks viewer analytics, and broadcasts live viewer/chat updates over WebSockets.

## Features

- 24/7 channel playback with a TV-style UI
- Multiple channels with per-channel active blocks
- Block Maker for creating/editing playlists
- Schedule editor with one-off entries and repeating blocks (times stored in `America/Chicago`)
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

## Scheduling

`assets/schedules/schedules.json` holds two things per channel:

- `channels[slug]` — one-off entries, `{ id, blockSlug, startTime }` at an absolute UTC instant.
- `recurring[slug]` — repeating rules, `{ id, blockSlug, days, hour, minute, startDate,
  endDate, exceptions, enabled }`. Days are `0`–`6` (Sunday first) in `America/Chicago`,
  `endDate` is **inclusive**, and `exceptions` is a list of `YYYY-MM-DD` civil dates to skip
  (that's what the "Skip" button on a single airing writes).

Rules are stored once and expanded on read, never pre-generated into rows. `/api/schedule`
ships the raw rules and the browser expands them with `shared/schedule-time.js` — the same
module the server uses. That keeps the whole system deterministic by clock: a tab left open
for a week computes the same schedule as one loaded a second ago, which a server-side
expansion window could not guarantee.

All zone conversion goes through `zonedWallToUtc()` in `shared/schedule-time.js`. It solves
two candidate instants and checks each for self-consistency rather than correcting a single
guess — the single-pass form it replaced was wrong by an hour for about ten hours a year
around the DST transitions, could make two different hours resolve to the same instant, and
left one local hour unreachable on the fall-back date. Non-existent local times (the
spring-forward gap) shift forward preserving minutes; ambiguous ones (the fall-back fold)
take the first occurrence and never fire twice.

`server/plugins/schedule.server.js` reconciles to the desired state — "what should be active
right now" — rather than scanning for what became due since the last tick. It runs once at
startup and then on each wall-clock minute, so a deploy spanning an occurrence heals itself
instead of skipping that occurrence forever. It compares the applied *occurrence key* stored
in `.data/schedule-state.json`, not the block slug, which is what makes it idempotent and what
lets a manual block switch (`/api/blocks/active`) survive until a genuinely new occurrence
begins.

## Banners

Banners are edited at `/admin/settings` and stored in `.data/banners.json`:

- **Header tagline** - the line under "Cartoon ReWatch". An absent key renders the built-in
  default (`Grab cereal and enjoy.`); an empty string hides the line. Note that
  `/api/banners/save` replaces the whole config rather than patching it, so any new field
  must be added to `DEFAULTS` and `normalizeBanners` in `server/utils/banners.js` *and* to
  `emptyBanners()`/`cloneBanners()` in `app/pages/admin/settings.vue`, or it is erased on
  every save.

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
- Admin **read** endpoints go through `requireAdmin()` too — `/api/analytics`, `/api/blocks`,
  `/api/schedule/<channel>`, `/api/youtube-info` and `/api/dailymotion-info`. A signed-in
  chat user is not an admin, so "is there a session" is not a gate.

### OAuth state

The `state` parameter is an HMAC-signed token carrying `{nonce, scope, redirect, attempt}`,
and `discord_state` holds the nonce. Both are required to complete a login:

- The signature proves *we* minted the state. It proves nothing about **which browser**, so a
  missing or mismatched cookie never completes the login — the `code` is discarded unexchanged
  and the flow restarts, carrying the original scope and redirect. Previously a lost cookie
  silently downgraded a chat login to an admin login, and any non-allow-listed user then hit a
  hard `403 Not authorized`.
- `attempt` bounds that retry to one round, so a browser that never returns the cookie (an
  apex vs `www.` mismatch against `DISCORD_REDIRECT_URI` does this) lands on a readable error
  instead of looping through Discord forever. **If users still hit this, fix the host
  mismatch** — set the OAuth cookies' domain or redirect apex→www at the edge.
- State tokens are signed with an HKDF-derived key separate from `SESSION_SECRET`, and the MAC
  input is domain-separated. Both token types are `base64url(json).hmac`, so without this a
  state handed to an anonymous caller could be replayed as a session cookie.

## Deployment

On push to `master`, `.github/workflows/deploy.yml` deploys over SSH and runs:

1. `git pull origin master` on `/var/www/cartoonrewatch`
2. `npm ci`
3. `npm run build`
4. `pm2 restart 0 --update-env`

PM2 config is in `ecosystem.config.cjs` and runs `.output/server/index.mjs`.
