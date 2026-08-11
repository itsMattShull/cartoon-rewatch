// Verifies shared/palette.js against the stylesheets, and asserts the contrast invariant.
//
//   node scripts/check-palette.mjs
//
// Two jobs:
//
//   1. DRIFT. palette.js carries the shipped palette as a JS object so it can run in the
//      browser bundle without parsing CSS. That is a second copy of theme.css's :root and
//      of index.vue's theater block, so it can drift. This re-parses both and asserts
//      they still agree.
//
//   2. CONTRAST. Sweeps the hue circle and asserts no documented colour pair loses more
//      than a rounding step of contrast against the shipped blue. This is the check that
//      turns "preserving luminance preserves contrast" from a comment into a property.
//      The rejected keep-OKLCH-L approach fails this hundreds of times.
//
// Run it after editing theme.css, the theater block in index.vue, or palette.js.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REFERENCE,
  REFERENCE_THEATER,
  contrastRatio,
  derivePalette
} from '../shared/palette.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const fail = (message) => failures.push(message)

// --- 1. Drift -------------------------------------------------------------

const css = fs.readFileSync(path.join(root, 'app/assets/css/theme.css'), 'utf8')
const rootStart = css.indexOf(':root {')
const rootBlock = css.slice(rootStart, css.indexOf('}', rootStart))

const cssTokens = new Map()
// Matches both the bare literal form and the `var(--cr-ch-x, <literal>)` indirection.
for (const m of rootBlock.matchAll(
  /(--cr-[a-z0-9-]+):\s*(var\(--cr-ch-[a-z0-9-]+,\s*(?:[^()]|\([^()]*\))*\)|#[0-9a-fA-F]{6}|rgba\([^)]*\));/g
)) {
  cssTokens.set(m[1], m[2])
}

const vue = fs.readFileSync(path.join(root, 'app/pages/index.vue'), 'utf8')
const theaterStart = vue.indexOf('.page.theater .title-bar:not(:hover)')
const theaterBlock = vue.slice(theaterStart, vue.indexOf('}', theaterStart))

// theme.css now maps tokens through var(--cr-ch-*, <literal>); the literal is the
// reference value, so pull that out rather than the var() wrapper.
const literalOf = (value) => {
  const m = /var\(--cr-ch-[a-z0-9-]+,\s*((?:[^()]|\([^()]*\))*)\)/.exec(value)
  return m ? m[1].trim() : value
}

for (const [name, expected] of Object.entries(REFERENCE)) {
  const actual = cssTokens.has(name) ? literalOf(cssTokens.get(name)) : null
  if (actual === null) fail(`theme.css is missing ${name} (palette.js has ${expected})`)
  else if (actual !== expected) fail(`${name}: theme.css has ${actual}, palette.js has ${expected}`)
}
for (const name of cssTokens.keys()) {
  if (!(name in REFERENCE)) fail(`theme.css defines ${name} but palette.js does not know it`)
}

const theaterTokens = new Map()
for (const m of theaterBlock.matchAll(/(--cr-[a-z0-9-]+):\s*([^;]+);/g)) {
  theaterTokens.set(m[1], literalOf(m[2].trim()))
}
for (const [name, expected] of Object.entries(REFERENCE_THEATER)) {
  const actual = theaterTokens.get(name)
  if (!actual) fail(`index.vue theater block is missing ${name}`)
  else if (actual !== expected) fail(`theater ${name}: index.vue has ${actual}, palette.js has ${expected}`)
}

// --- 2. Contrast ----------------------------------------------------------

// Pairs the design actually depends on. The first three are documented in theme.css's
// header or in the theater block's comments; the rest are text tokens against every
// surface they plausibly sit on. A pair already below its WCAG bar in the shipped theme
// (decorative hairlines) is still listed: the requirement is that it does not get WORSE,
// not that it passes.
const SURFACES = [
  '--cr-surface-root',
  '--cr-surface-1',
  '--cr-surface-2',
  '--cr-surface-3',
  '--cr-surface-4',
  '--cr-surface-page-top',
  '--cr-surface-panel-bot',
  '--cr-surface-titlebar-mid',
  '--cr-surface-btn-top',
  '--cr-surface-btn-bot'
]
const FOREGROUNDS = [
  '--cr-text',
  '--cr-text-bright',
  '--cr-text-ctrl',
  '--cr-text-lcd',
  '--cr-text-muted-1',
  '--cr-text-muted-2',
  '--cr-text-muted-3',
  '--cr-text-muted-4',
  '--cr-text-muted-5',
  '--cr-text-muted-6',
  '--cr-text-dim-1',
  '--cr-text-dim-2',
  '--cr-accent',
  '--cr-line-1',
  '--cr-line-2',
  '--cr-line-3',
  '--cr-line-strong',
  '--cr-brand-500',
  '--cr-slider-track-0',
  '--cr-slider-track-1',
  // Frozen status colours sit on ROTATED surfaces, so their ratios move even though
  // their own values do not. That has to be checked, not assumed.
  '--cr-success',
  '--cr-warning',
  '--cr-error-text',
  '--cr-danger-text'
]

const pairs = []
for (const fg of FOREGROUNDS) for (const bg of SURFACES) pairs.push([fg, bg])

// Two separate criteria, because an absolute tolerance is the wrong instrument at both
// ends of the range.
//
//   THRESHOLD: a pair that cleared its WCAG bar before must still clear it after. This is
//   the requirement that actually matters, and the one the rejected keep-OKLCH-L approach
//   breaks (it pushes --cr-line-2 on --cr-surface-4 from 3.01 to 2.73).
//
//   RELATIVE: no pair may lose more than 1.5% of its ratio. An absolute 0.05 would flag a
//   15:1 pair moving to 14.95:1 — a 0.3% change, invisible, and pure 8-bit quantisation
//   noise — while ignoring a 3.05:1 pair sliding to 3.00:1, which is the one to care about.
const RELATIVE_TOLERANCE = 0.015
const HUE_STEP = 3

// Non-text tokens are held to 1.4.11's 3:1; everything else to 1.4.3 AA's 4.5:1.
const NON_TEXT = new Set([
  '--cr-line-1',
  '--cr-line-2',
  '--cr-line-3',
  '--cr-line-strong',
  '--cr-brand-500',
  '--cr-slider-track-0',
  '--cr-slider-track-1'
])
const barFor = (token) => (NON_TEXT.has(token) ? 3 : 4.5)

let worst = { drop: 0, relative: 0 }
let checked = 0

for (let deg = 0; deg < 360; deg += HUE_STEP) {
  // A brand hex at this hue, at the reference palette's own chroma and lightness.
  const rad = (deg * Math.PI) / 180
  const brand = hexAtHue(rad)
  const { base, theater } = derivePalette(brand)
  for (const [table, refTable, label] of [
    [base, REFERENCE, 'base'],
    [theater, REFERENCE_THEATER, 'theater']
  ]) {
    for (const [fg, bg] of pairs) {
      if (!table[fg] || !table[bg]) continue
      if (!/^#/.test(table[fg]) || !/^#/.test(table[bg])) continue
      const before = contrastRatio(refTable[fg] ?? REFERENCE[fg], refTable[bg] ?? REFERENCE[bg])
      const after = contrastRatio(table[fg], table[bg])
      checked += 1
      const drop = before - after
      const relative = drop / before
      if (relative > worst.relative) worst = { drop, relative, fg, bg, before, after, deg, label }

      const bar = barFor(fg)
      if (before >= bar && after < bar) {
        fail(
          `hue ${deg}deg (${label}): ${fg} on ${bg} falls below ${bar}:1 — ` +
            `${before.toFixed(3)} -> ${after.toFixed(3)}`
        )
      } else if (relative > RELATIVE_TOLERANCE) {
        fail(
          `hue ${deg}deg (${label}): ${fg} on ${bg} ` +
            `${before.toFixed(3)} -> ${after.toFixed(3)} (${(relative * 100).toFixed(2)}% drop)`
        )
      }
    }
  }
}

// Builds a brand hex at a given hue, holding the reference brand's L and C.
function hexAtHue(hueRad) {
  const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
  const L = 0.5654
  const C = 0.1202
  const a = C * Math.cos(hueRad)
  const b = C * Math.sin(hueRad)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
    .map(l2s)
    .map((v) => Math.min(255, Math.max(0, Math.round(v * 255))))
  void s2l
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

// --- Report ---------------------------------------------------------------

if (failures.length) {
  console.error(`FAIL (${failures.length})\n`)
  for (const message of failures.slice(0, 40)) console.error(`  ${message}`)
  if (failures.length > 40) console.error(`  ... and ${failures.length - 40} more`)
  process.exit(1)
}

console.log(
  `ok — ${Object.keys(REFERENCE).length} base + ${Object.keys(REFERENCE_THEATER).length} ` +
    `theater tokens match the stylesheets`
)
console.log(
  `ok — ${checked} contrast pairs across ${360 / HUE_STEP} hues, ` +
    `worst relative drop ${(worst.relative*100).toFixed(2)}% (${worst.fg} on ${worst.bg} at ${worst.deg}deg, ` +
    `${worst.before?.toFixed(2)} -> ${worst.after?.toFixed(2)})`
)
