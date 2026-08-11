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
- Per-channel colour schemes, with date-ranged scheduled overrides
- Configurable link-preview (og:image) image

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

- `.data/banners.json` - banner, colour-scheme and embed-image configuration
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
  every save. That now covers `theme` and `embed` too — and `cloneBanners` does a shallow
  per-key merge, so nested structures like `theme.channels` and `theme.overrides` need
  explicit deep copies there or editing the form silently mutates the saved baseline.

- **Announcement banner** - dismissible bar at the top of the front page. Dismissal is
  keyed to the message text, so editing the text re-shows it to everyone.
- **Sidebar banners** - up to 6 image banners with click-through links. On screens under
  1200px they render below the control panel, and only the first two are shown.
- **Channel strip text** - the middle slot of the CH / LIVE strip under the TV.

Images can be an external `https` URL or uploaded. Uploads accept PNG, JPEG, GIF and
WebP up to 2 MB, identified by magic bytes rather than by filename or content type
(SVG is rejected — it can carry scripts). Files are stored under a content-hash name and
served from `/api/banner-image/<hash>.<ext>` with immutable caching and an `ETag`.

`pruneOrphanUploads` finds referenced files by walking the whole config for
`/api/banner-image/` URLs, rather than reading a hardcoded field list — so a new
image-bearing field is covered by construction instead of being silently collected on the
next unrelated save. It also skips files newer than 15 minutes, which closes a race where
a save landing between an upload and its assignment deleted the fresh file. Set
`client_max_body_size 2m;` on the upload path in nginx so oversized bodies are rejected
before Node buffers them.

Default channel payloads currently exist in:

- `assets/channels/toonami.json`
- `assets/channels/adult-swim.json`
- `assets/channels/saturday-morning.json`

## Colour Schemes

Each channel can carry a brand hex; the front page recolours when a viewer switches
channel. Edited at `/admin/settings`, stored in `.data/banners.json` under `theme`
alongside the banners, so colours, banners and the embed image are one config, one lock,
one atomic write and **one save button**. `/api/banners/save` replaces the whole config,
so two save buttons against one file would be a lost-update footgun.

### How the palette is derived

`shared/palette.js` rotates the shipped blue palette in `app/assets/css/theme.css` to the
chosen hue. It holds **WCAG relative luminance** fixed, not OKLCH lightness.

That distinction is the whole design. OKLCH `L` is a perceptual lightness; WCAG contrast
is a function of relative luminance on linearised sRGB. At fixed `L` and chroma, sweeping
hue moves luminance by up to ~1.4x — so "rotate hue, keep L", which looks obviously
correct, silently breaks contrast. Measured on this palette's own documented anchor pair
(`--cr-brand-500` on `--cr-surface-page-top`, a 1.4.11 border):

| approach | range over the hue circle |
| --- | --- |
| keep OKLCH L | 2.82 – 3.14 (under 3:1 for over half of it) |
| keep WCAG luminance | 3.01 – 3.03 |

The damage concentrates where foreground and background carry different chroma, because
that is where their luminance shifts stop cancelling.

`node scripts/check-palette.mjs` makes this a property rather than a claim: it asserts the
reference tables have not drifted from the stylesheets, then sweeps 120 hues x 330 colour
pairs asserting none crosses below its WCAG bar and none loses more than 1.5% of its
ratio. **Run it after editing `theme.css`, `palette.js`, or the theater block in
`index.vue`** — `palette.js` necessarily carries a second copy of those literals.

`--cr-brand-500` and `--cr-line-2` sit one and two 8-bit steps above where they were
originally hand-picked. Both cleared 3:1 by less than the quantisation floor, so a
rotation holding luminance to within a rounding step could still tip them under.

### Where the tokens go

Every token in `theme.css` is `var(--cr-ch-<name>, <shipped literal>)`. The derived
palette arrives as `--cr-ch-*` **inputs** in an inline `style` attribute on `<html>`. The
indirection is load-bearing three times over:

- An inline style attribute cannot lose a source-order fight with the Nuxt CSS bundle.
- `theme.css` can still override the real `--cr-*` tokens inside a media query — which is
  how forced-colors and `prefers-contrast` viewers get the audited blue back. Setting
  `--cr-*` directly on `<html>` would need `!important` on ~70 declarations to undo.
- If the attribute is absent, every `var()` falls back to the shipped literal and the site
  renders exactly as it did before this feature.

Theater mode's dim tokens work the same way, via `--cr-ch-theater-*`, and stay in
`index.vue`'s scoped block rather than being generated.

Status and chart colours are **not** rotated — they are distinguished by hue, and
rotating them would make "Saved" and "Failed" identical but for their text. The trade is
that a warm brand hue reduces their separation from ordinary chrome, so the admin panel
warns when the chosen hue lands within 25 degrees of one.

### Scheduled overrides

Overrides are civil **date ranges** (`startDate`/`endDate`, end inclusive), not recurring
rules, and deliberately do not reuse `shared/schedule-time.js`'s rule engine:

- `getEffectiveOccurrence` means "latest occurrence at or before now, runs until
  replaced", with an 8-day lookback. A bounded window contradicts both.
- `normalizeRecurringRule` rejects any rule without a `blockSlug`.
- A wall-clock start plus a duration reintroduces the DST bug `zonedWallToUtc` exists to
  eliminate: "all day" as `00:00 + 1440 minutes` overruns the 23-hour day and leaves a
  one-hour hole at 23:00 on the 25-hour day, once a year, silently.
- Date granularity also means SSR and a client with a skewed clock cannot disagree.

Resolution order is override (channel-scoped beats site-wide, then narrower range, then
id) → the channel's own colour → the site default.

`/api/settings` is public, so it ships each channel's **resolved** colour plus
`revalidateAt` (the next local midnight), never the rules themselves — those carry
admin-authored labels and dates. The admin form reads the raw config from the
admin-gated `/api/banners/config`.

### First paint

`crt80_channel` holds the active channel **slug** so the server can pick the palette
before rendering. This is the third per-viewer cookie on `/` (with `crt80_theater` and
`crt80_ann_dismissed`), so **`/` must stay uncacheable if a CDN is ever put in front of
it**.

A slug rather than an index because `loadActiveBlocks` filters the channel list to
channels with an active block and re-indexes it, so a stored index points at a different
channel whenever scheduling changes. `/api/settings` applies that same filter when there
is no cookie, so the server and the client agree on which channel a first-time visitor
lands on.

## Embed Image

The link-preview image (`og:image` / `twitter:image`) is set at `/admin/settings` and
stored in `.data/banners.json` under `embed`. Absent means the built-in `/logo.png`.

Restricted to an **uploaded** file — no external URLs. Not for SSRF (nothing fetches it
server-side) but because iMessage and WhatsApp generate previews on the sending or
receiving device, so a third-party host would collect real end-user IPs keyed to
"somebody shared this site in a private chat", and could swap the image under every
already-shared link.

Uploads are downscaled in the browser to fit 1200x630 before being sent: a phone photo
pick is ~4032x3024 and ~3MB, which trips both the 2 MB body cap and the 4000px dimension
cap. Chat clients cache previews aggressively; a new upload gets a new content-hash URL,
so the preview refreshes.

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
