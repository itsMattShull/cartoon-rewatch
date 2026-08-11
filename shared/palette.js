// Derives a full --cr-* palette from a single brand hex, by rotating the shipped blue
// palette to a new hue.
//
// Used by BOTH the server (to build the inline style for the SSR'd first paint) and the
// browser (to recolour instantly on a channel flip), so it is pure and isomorphic. Same
// reasoning as shared/schedule-time.js: if the two sides disagree, the page recolours a
// few hundred milliseconds after load, which is the flash the whole SSR path exists to
// avoid.
//
// ---------------------------------------------------------------------------
// The invariant: WCAG relative luminance, NOT OKLCH lightness.
// ---------------------------------------------------------------------------
//
// The obvious approach — rotate hue in OKLCH and keep L — is wrong, and it is worth
// writing down why, because it looks obviously right.
//
// OKLCH L is a perceptual lightness (a cube-root LMS construct). WCAG contrast is a
// function of relative luminance Y = 0.2126R + 0.7152G + 0.0722B on LINEARISED sRGB.
// They are different functions of the same colour. At fixed L and C, sweeping hue moves Y
// by up to ~1.4x. So "keep L" does not keep contrast, and this palette has documented
// contrast obligations (see the header of app/assets/css/theme.css).
//
// Measured, on this palette's own anchor pair — --cr-brand-500 on --cr-surface-page-top,
// which theme.css documents as 3.0:1 and uses as a border colour under WCAG 1.4.11:
//
//     keep OKLCH L : 2.82 .. 3.14 over the hue circle  (below 3:1 for over half of it)
//     keep WCAG Y  : 3.01 .. 3.03 over the hue circle
//
// The failure concentrates wherever foreground and background carry DIFFERENT chroma,
// because that is where their luminance shifts stop cancelling. --cr-line-2 (C=0.102) on
// --cr-surface-4 (C=0.023) is the worst real pair on the front page — it is the
// .announcement border and the .panel border — and "keep L" drops it from 3.01 to as low
// as 2.73.
//
// So: rotate hue, scale chroma, then solve for the lightness that reproduces the
// reference token's WCAG luminance exactly. Y is monotone in L at fixed (C, H) after
// gamut clamping, so a bisection always converges. That makes the palette
// non-regressive on contrast BY CONSTRUCTION rather than by assertion — every ratio in
// the shipped design is preserved to within 8-bit quantisation, including the pairs that
// are already below AA (decorative hairlines), which stay exactly where they are instead
// of sinking further.
//
// scripts/check-palette.mjs asserts the REFERENCE tables below still match the literals
// in theme.css and index.vue, and sweeps the hue circle asserting no documented pair
// regresses. Run it after touching either file.

// ---------------------------------------------------------------------------
// Colour space plumbing
// ---------------------------------------------------------------------------

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
}

function parseHex(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
}

/** WCAG 2.x relative luminance. The quantity this module holds fixed. */
function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function srgbToOklab(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

// Returns LINEAR-light rgb. Callers must apply linearToSrgb — forgetting that is the
// single easiest way to get plausible-looking but completely wrong colours out of here.
function oklabToLinearRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
}

function inGamut(linear) {
  return linear.every((v) => v >= -1e-6 && v <= 1 + 1e-6)
}

/**
 * sRGB for an OKLCH triple, reducing chroma until the colour fits the gamut.
 * Chroma is the only thing given up: L and H are held, so the solved luminance survives.
 */
function oklchToSrgb(L, C, H) {
  let lo = 0
  let hi = C
  if (inGamut(oklabToLinearRgb([L, C * Math.cos(H), C * Math.sin(H)]))) {
    lo = C
  } else {
    for (let i = 0; i < 18; i += 1) {
      const mid = (lo + hi) / 2
      if (inGamut(oklabToLinearRgb([L, mid * Math.cos(H), mid * Math.sin(H)]))) lo = mid
      else hi = mid
    }
  }
  return oklabToLinearRgb([L, lo * Math.cos(H), lo * Math.sin(H)])
    .map(linearToSrgb)
    .map((v) => Math.min(1, Math.max(0, v)))
}

function toByte(v) {
  return Math.min(255, Math.max(0, Math.round(v * 255)))
}

// Every colour this module emits is re-serialised from integers computed here. No input
// string is ever concatenated into the output, so a malformed stored value cannot reach
// the CSS text no matter how it got into the config file.
function formatHex(rgb) {
  return `#${rgb.map((v) => toByte(v).toString(16).padStart(2, '0')).join('')}`
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

// Below this chroma the hue is meaningless: for a neutral input, atan2(0, 0) returns
// float noise. #808080 and #ffffff both land on H=89.9deg and #000000 on H=0deg, so
// "grey" and "black" — which an admin reads as the same instruction, "no colour" —
// would otherwise produce a sepia site and a mauve site respectively.
export const MIN_BRAND_CHROMA = 0.012

// Chroma is scaled by the brand's chroma relative to the reference brand, but bounded.
// Below ~0.6 the palette washes out to near-grey; above ~1.35 the surfaces go neon and
// the TV cabinet stops reading as a separate material, which theme.css calls out
// explicitly ("Deliberately low chroma so the bezel still reads as a separate material").
export const MIN_CHROMA_SCALE = 0.6
export const MAX_CHROMA_SCALE = 1.35

// Per-band chroma ceilings, keyed off the REFERENCE token's lightness. The palette's
// lightness ladder already encodes each token's role, so banding by L gives
// role-appropriate caps without hand-maintaining a 71-entry table.
function bandChromaCap(L) {
  if (L < 0.3) return 0.04 // near-black page surfaces
  if (L < 0.55) return 0.11 // deep fills, glow
  if (L < 0.75) return 0.19 // brand ramp, lines
  return 0.1 // pale text, accent
}

// Status and chart colours are NOT rotated. theme.css: status colours are "distinguished
// by hue", and "an all-blue palette would make 'Saved' and 'Failed' — and Save and Delete
// — identical but for their text". Rotating them would reintroduce exactly that.
//
// Note this is a trade, not a free win: freezing them preserves their identity while the
// surfaces move around them, so a warm brand hue reduces their separation from ordinary
// chrome. isBrandHueSafe() below is what keeps that in bounds, and the admin UI warns.
const FROZEN = new Set([
  '--cr-success',
  '--cr-warning',
  '--cr-error-text',
  '--cr-danger-border',
  '--cr-danger-border-2',
  '--cr-danger-bg',
  '--cr-danger-bg-2',
  '--cr-danger-text',
  '--cr-danger-text-2',
  '--cr-chart-1',
  '--cr-chart-2',
  '--cr-chart-3',
  '--cr-chart-projected',
  '--cr-chart-axis'
])

export const REFERENCE_BRAND = '#227db6'

// The shipped palette, verbatim from theme.css :root. Kept here rather than parsed from
// the stylesheet so this module stays pure and usable in the browser bundle;
// scripts/check-palette.mjs asserts the two never drift.
export const REFERENCE = {
  '--cr-surface-root': '#03080e',
  '--cr-surface-void': '#03060a',
  '--cr-surface-screen-in': '#070d14',
  '--cr-surface-1': '#0b1118',
  '--cr-surface-2': '#11161c',
  '--cr-surface-3': '#151c25',
  '--cr-surface-screen-off': '#161c23',
  '--cr-surface-screen': '#171d24',
  '--cr-surface-4': '#18212b',
  '--cr-surface-btn-bot': '#0c2336',
  '--cr-surface-panel-bot': '#142739',
  '--cr-surface-titlebar-mid': '#1c2d3e',
  '--cr-surface-page-top': '#252f3b',
  '--cr-surface-btn-top': '#0e334d',
  '--cr-surface-titlebar-end': '#0d324c',
  '--cr-surface-glow': '#00435b',
  '--cr-bezel-0': '#313f4c',
  '--cr-bezel-40': '#445767',
  '--cr-bezel-100': '#212d39',
  '--cr-bezel-rim': '#6f879b',
  '--cr-line-subtle': '#11486a',
  '--cr-line-1': '#105279',
  '--cr-line-2': '#2772a0',
  '--cr-line-3': '#4096c6',
  '--cr-line-strong': '#359acc',
  '--cr-slider-track-0': '#016794',
  '--cr-slider-track-1': '#cbe9ff',
  '--cr-text': '#e4f1f9',
  '--cr-text-bright': '#e2f5fe',
  '--cr-text-ctrl': '#c0e7fa',
  '--cr-text-lcd': '#bce3f6',
  '--cr-text-muted-1': '#a5cee3',
  '--cr-text-muted-2': '#a3cbe0',
  '--cr-text-muted-3': '#82c3dd',
  '--cr-text-muted-4': '#89bdd6',
  '--cr-text-muted-5': '#80bbd6',
  '--cr-text-muted-6': '#80b7d1',
  '--cr-text-dim-1': '#77b0cc',
  '--cr-text-dim-2': '#75afca',
  '--cr-on-accent': '#151b22',
  '--cr-accent': '#9fe0ff',
  '--cr-accent-glow': 'rgba(164, 227, 255, 0.4)',
  '--cr-accent-soft': 'rgba(159, 224, 255, 0.08)',
  '--cr-accent-soft-2': 'rgba(159, 224, 255, 0.12)',
  '--cr-accent-border': 'rgba(159, 224, 255, 0.8)',
  '--cr-brand-700': '#0479af',
  '--cr-brand-600': '#088ecd',
  '--cr-brand-500': '#2580b9',
  '--cr-brand-400': '#0ba0df',
  '--cr-brand-300': '#16b1f0',
  '--cr-brand-200': '#58c5f1',
  '--cr-guide-block-0': '#102c42',
  '--cr-guide-block-1': '#0e1b27',
  '--cr-chip-grad-0': '#102a3e',
  '--cr-chip-grad-1': '#0e1d2a',
  '--cr-scrim-overlay': 'rgba(16, 26, 37, 0.85)',
  '--cr-scrim-modal-head': 'rgba(10, 18, 25, 0.7)',
  '--cr-success': '#8fcd9e',
  '--cr-warning': '#f3c488',
  '--cr-error-text': '#ffb7b7',
  '--cr-danger-border': '#b45b4f',
  '--cr-danger-border-2': '#b85a4a',
  '--cr-danger-bg': '#2b1519',
  '--cr-danger-bg-2': '#3a1d1d',
  '--cr-danger-text': '#f0c6b4',
  '--cr-danger-text-2': '#fbd3c8',
  '--cr-chart-1': '#9fe0ff',
  '--cr-chart-2': '#7fe3ff',
  '--cr-chart-3': '#f7a8ff',
  '--cr-chart-projected': '#ffcf5a',
  '--cr-chart-axis': '#89bdd6'
}

// The theater-mode dim variant, verbatim from the scoped block in index.vue. Derived
// through the same rotation so theater dimming follows the channel colour instead of
// staying blue on a recoloured page.
export const REFERENCE_THEATER = {
  '--cr-surface-3': '#0a0f15',
  '--cr-surface-4': '#080d13',
  '--cr-surface-panel-bot': '#0a141d',
  '--cr-surface-titlebar-mid': '#0a121a',
  '--cr-surface-titlebar-end': '#071722',
  '--cr-surface-btn-top': '#0a1f2e',
  '--cr-surface-btn-bot': '#07141e',
  '--cr-text': '#b9cdda',
  '--cr-text-bright': '#bcd4e0',
  '--cr-text-ctrl': '#9dc0d2',
  '--cr-text-lcd': '#96b9cb',
  '--cr-text-muted-2': '#87a9bb',
  '--cr-text-muted-4': '#7ba0b3',
  '--cr-text-muted-5': '#749cb0',
  '--cr-text-dim-1': '#6f95a8',
  '--cr-text-dim-2': '#6d93a6',
  '--cr-accent': '#7fb4cd',
  '--cr-line-2': '#2a6d95',
  '--cr-line-3': '#2f7ba6',
  '--cr-line-strong': '#3789b5',
  '--cr-brand-400': '#1f9ed6',
  '--cr-slider-track-0': '#0a6d96',
  '--cr-slider-track-1': '#b5d2e0'
}

const HEX_RE = /^#[0-9a-f]{6}$/
const RGBA_RE = /^rgba\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3}),\s*([0-9.]+)\)$/

/** Normalises admin input to a lowercase #rrggbb, or '' if it is not one. */
export function normalizeHex(input) {
  if (typeof input !== 'string') return ''
  let value = input.trim().toLowerCase().replace(/^0x/, '')
  if (!value.startsWith('#')) value = `#${value}`
  // Accept the 3-digit shorthand an admin may paste, expand it, then validate strictly.
  if (/^#[0-9a-f]{3}$/.test(value)) {
    value = `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
  }
  return HEX_RE.test(value) ? value : ''
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Solves for the sRGB colour at hue H and chroma C whose WCAG luminance matches the
 * reference token's. Bisects on L (Y is monotone in L at fixed C/H after gamut
 * clamping), then checks all eight 8-bit rounding corners and keeps whichever lands
 * closest — that last step is what pulls the residual down to the quantisation floor.
 */
function solveForLuminance(targetY, C, H) {
  let lo = 0
  let hi = 1
  let best = null
  for (let i = 0; i < 22; i += 1) {
    const mid = (lo + hi) / 2
    best = oklchToSrgb(mid, C, H)
    if (relativeLuminance(best) < targetY) lo = mid
    else hi = mid
  }
  let bestRgb = best.map(toByte)
  let bestErr = Math.abs(relativeLuminance(bestRgb.map((v) => v / 255)) - targetY)
  for (let mask = 0; mask < 8; mask += 1) {
    const corner = best.map((v, i) =>
      Math.min(255, Math.max(0, (mask >> i) & 1 ? Math.ceil(v * 255) : Math.floor(v * 255)))
    )
    const err = Math.abs(relativeLuminance(corner.map((v) => v / 255)) - targetY)
    if (err < bestErr) {
      bestErr = err
      bestRgb = corner
    }
  }
  return bestRgb.map((v) => v / 255)
}

function deriveOne(referenceValue, deltaHue, chromaScale) {
  const rgbaMatch = RGBA_RE.exec(referenceValue)
  const baseRgb = rgbaMatch
    ? [Number(rgbaMatch[1]) / 255, Number(rgbaMatch[2]) / 255, Number(rgbaMatch[3]) / 255]
    : parseHex(referenceValue)

  const [L, a, b] = srgbToOklab(baseRgb)
  const C = Math.hypot(a, b)
  // True neutrals have no hue to rotate; leave them exactly as they are.
  if (C < 0.002) return referenceValue

  const H = Math.atan2(b, a) + deltaHue
  const targetC = Math.min(C * chromaScale, bandChromaCap(L))
  const solved = solveForLuminance(relativeLuminance(baseRgb), targetC, H)

  if (rgbaMatch) {
    const alpha = Number(rgbaMatch[4])
    const [r, g, bl] = solved.map(toByte)
    return `rgba(${r}, ${g}, ${bl}, ${alpha})`
  }
  return formatHex(solved)
}

function derive(table, deltaHue, chromaScale) {
  const out = Object.create(null)
  for (const [name, value] of Object.entries(table)) {
    out[name] = FROZEN.has(name) ? value : deriveOne(value, deltaHue, chromaScale)
  }
  return out
}

const [refL, refA, refB] = srgbToOklab(parseHex(REFERENCE_BRAND))
const REF_CHROMA = Math.hypot(refA, refB)
const REF_HUE = Math.atan2(refB, refA)

/**
 * Returns { base, theater } token maps for a brand hex.
 *
 * Any input that is not a usable brand colour — malformed, or too close to neutral for
 * its hue to mean anything — returns the reference palette unchanged. Callers therefore
 * never need to special-case failure: the worst outcome is the site's shipped blue.
 */
export function derivePalette(brandHex) {
  const hex = normalizeHex(brandHex)
  if (!hex || hex === REFERENCE_BRAND) {
    return { base: { ...REFERENCE }, theater: { ...REFERENCE_THEATER } }
  }
  const [, a, b] = srgbToOklab(parseHex(hex))
  const chroma = Math.hypot(a, b)
  if (chroma < MIN_BRAND_CHROMA) {
    return { base: { ...REFERENCE }, theater: { ...REFERENCE_THEATER } }
  }
  const deltaHue = Math.atan2(b, a) - REF_HUE
  const chromaScale = Math.min(
    MAX_CHROMA_SCALE,
    Math.max(MIN_CHROMA_SCALE, chroma / REF_CHROMA)
  )
  return {
    base: derive(REFERENCE, deltaHue, chromaScale),
    theater: derive(REFERENCE_THEATER, deltaHue, chromaScale)
  }
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

// The derived palette is emitted as --cr-ch-* CHANNEL INPUTS, which theme.css maps onto
// the real --cr-* tokens via `var(--cr-ch-x, <shipped literal>)`.
//
// The indirection is load-bearing, for three reasons:
//   1. It goes in an inline style attribute on <html>, which beats any stylesheet rule
//      without !important — so the palette never loses a source-order fight with the
//      Nuxt CSS bundle, and it is an attribute value (escaped) rather than stylesheet
//      text, so there is no </style> to break out of.
//   2. Because the tokens are only INPUTS, theme.css can still override the real tokens
//      inside a media query — which is how the forced-colors / prefers-contrast reset
//      back to the audited blue works. Setting --cr-* directly on <html> would need
//      !important on ~70 declarations to achieve the same thing.
//   3. If the attribute is absent for any reason, every var() falls back to the shipped
//      literal, so the site renders exactly as it does today.
const CH_PREFIX = '--cr-ch-'
const CH_THEATER_PREFIX = '--cr-ch-theater-'

function declarations(tokens, prefix) {
  const parts = []
  for (const [name, value] of Object.entries(tokens)) {
    // Re-validate on the way out. The stored config is validated on write, but that is
    // not the only path into this data (hand edits, restores, schema changes) — the same
    // reasoning shared/url-safety.js applies to banner URLs.
    if (!HEX_RE.test(value) && !RGBA_RE.test(value)) continue
    parts.push(`${prefix}${name.slice('--cr-'.length)}:${value}`)
  }
  return parts
}

// A derivation is ~5 ms (94 tokens x a 22-step bisection), so the finished STRING is
// memoised rather than the token map — a cache hit then costs a Map lookup and no
// concatenation at all.
//
// LRU with eviction, not "stop inserting past N": a plain size cap would make the 33rd
// channel pay full cost on every single SSR request forever. Bounded because the browser
// also calls this while an admin drags a colour picker, which fires `input` continuously
// — a few hundred entries of ~3 KB each would otherwise accumulate in a long-lived tab.
//
// Keys are normalised hexes, i.e. one of 16.7M values from a strictly validated set,
// never anything a visitor controls. If a caller ever keys this by channel slug instead,
// the bound stops being decorative.
const STYLE_CACHE_MAX = 32
const styleCache = new Map()

/**
 * The inline style attribute for <html>. Returns '' for the reference brand so an
 * untouched deployment ships no attribute at all.
 */
export function buildPaletteStyle(brandHex) {
  const hex = normalizeHex(brandHex)
  if (!hex || hex === REFERENCE_BRAND) return ''

  const cached = styleCache.get(hex)
  if (cached !== undefined) {
    // Re-insert so the most recently used entry is last, making the first key the
    // eviction candidate.
    styleCache.delete(hex)
    styleCache.set(hex, cached)
    return cached
  }

  const { base, theater } = derivePalette(hex)
  const style = [
    ...declarations(base, CH_PREFIX),
    ...declarations(theater, CH_THEATER_PREFIX)
  ].join(';')

  styleCache.set(hex, style)
  if (styleCache.size > STYLE_CACHE_MAX) {
    styleCache.delete(styleCache.keys().next().value)
  }
  return style
}

// ---------------------------------------------------------------------------
// Admin-facing guards
// ---------------------------------------------------------------------------

// Hue of each frozen status/chart colour, in degrees. A brand whose derived accent lands
// near one of these makes that status indistinguishable from ordinary chrome — e.g. a
// yellow brand renders .chat-auth-error in a colour the eye cannot separate from an
// accent link.
const STATUS_HUES = [
  { name: 'error text', deg: 19 },
  { name: 'danger', deg: 29 },
  { name: 'warning', deg: 73 },
  { name: 'projected-chart', deg: 87 },
  { name: 'success', deg: 151 },
  { name: 'chart highlight', deg: -36 }
]
export const MIN_STATUS_HUE_SEPARATION_DEG = 25

/**
 * Reports the status colour a brand hue collides with, or null. Advisory: the admin can
 * still save, because "orange site" is a legitimate request and the alternative is
 * refusing most of the hue circle. The UI surfaces it so the choice is informed.
 */
export function statusHueCollision(brandHex) {
  const hex = normalizeHex(brandHex)
  if (!hex) return null
  const derived = derivePalette(hex).base['--cr-accent']
  if (!HEX_RE.test(derived)) return null
  const [, a, b] = srgbToOklab(parseHex(derived))
  if (Math.hypot(a, b) < 0.002) return null
  const deg = (Math.atan2(b, a) * 180) / Math.PI
  for (const status of STATUS_HUES) {
    let diff = Math.abs(deg - status.deg) % 360
    if (diff > 180) diff = 360 - diff
    if (diff < MIN_STATUS_HUE_SEPARATION_DEG) {
      return { status: status.name, separationDeg: Math.round(diff) }
    }
  }
  return null
}

/** WCAG contrast ratio between two hex colours. Exported for the admin preview. */
export function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(parseHex(hexA))
  const b = relativeLuminance(parseHex(hexB))
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}
