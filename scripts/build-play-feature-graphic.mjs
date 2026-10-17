#!/usr/bin/env node
/**
 * Generate docs/play-store/feature-graphic-1024x500.png — the Google Play
 * "feature graphic" shown across the top of the store listing.
 *
 * ⚠ PLAY'S RULES SHAPE EVERY CHOICE HERE (Play Console help, "Add preview
 * assets", read 2026-10-01):
 *   - 1024x500, JPEG or 24-bit PNG, NO alpha        → flattened, alpha removed
 *   - convey the app experience / value proposition → the live headline and
 *                                                    the "Your leagues" card
 *   - no prominent branding similar to the app icon → no crest
 *   - avoid pure white, black or dark grey          → a brand-navy gradient,
 *                                                    not the black OG card
 *   - keep the focal point central, away from edges → both elements inset
 *   - no price or promotional content               → the homepage's "free until
 *                                                    Oct 15" countdown is NOT used
 *
 * ⚠ THE HEADLINE IS LIFTED FROM THE LIVE PAGE, NOT RE-TYPESET. The site sets it
 * in Archivo via Google Fonts and the repo carries no font file, so drawing it
 * here would mean either a stand-in face or a font install on whatever machine
 * runs this. Lifting it from a 2x capture keeps the real face, weights and
 * colours, and the copy is the site's own (lib/i18n/landing-copy.ts h1a/h1b).
 *
 * Two steps, so the image is reproducible offline:
 *   node scripts/build-play-feature-graphic.mjs --capture   # public homepage → feature-graphic-src/
 *   node scripts/build-play-feature-graphic.mjs             # compose from the committed capture
 *
 * The capture reads ONE public page (no sign-in, nothing submitted) and records
 * where the h1 and the card are, from the DOM — so no pixel coordinate in this
 * file is hand-tuned to a particular screenshot.
 */
import sharp from 'sharp'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(root, 'docs/play-store/feature-graphic-src')
const OUT = path.join(root, 'docs/play-store/feature-graphic-1024x500.png')
const W = 1024
const H = 500
const SCALE = 2 // deviceScaleFactor of the capture

async function capture() {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: SCALE,
      isMobile: true,
      hasTouch: true,
      colorScheme: 'dark',
      locale: 'en-US',
    })
    const page = await ctx.newPage()
    await page.goto('https://www.allfantasy.ai/', { waitUntil: 'load', timeout: 60000 })
    await page.waitForTimeout(2500)
    const regions = await page.evaluate(() => {
      // The floating theme toggle is fixed-position chrome that sits on the card.
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el)
        if (cs.position === 'fixed' && /^(dark|light)$/i.test((el.textContent || '').trim())) el.style.display = 'none'
      }
      const rect = (el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height }
      }
      const h1 = document.querySelector('h1')
      // The card: the nearest ancestor of the "Your leagues" label that paints a rounded box.
      const label = [...document.querySelectorAll('body *')].find(
        (el) => el.children.length === 0 && el.textContent.trim() === 'Your leagues',
      )
      let card = label
      while (card && !(parseFloat(getComputedStyle(card).borderTopLeftRadius) > 0 && getComputedStyle(card).borderTopWidth !== '0px')) {
        card = card.parentElement
      }
      return {
        h1: h1 && { ...rect(h1), text: h1.innerText },
        card: card && { ...rect(card), radius: parseFloat(getComputedStyle(card).borderTopLeftRadius) },
      }
    })
    if (!regions.h1 || !regions.card) throw new Error(`capture could not find ${!regions.h1 ? 'the h1' : 'the card'}`)
    fs.mkdirSync(SRC, { recursive: true })
    await page.screenshot({ path: path.join(SRC, 'home-top.png') })
    fs.writeFileSync(path.join(SRC, 'regions.json'), JSON.stringify({ capturedAt: new Date().toISOString(), scale: SCALE, ...regions }, null, 2) + '\n')
    console.log('captured', JSON.stringify(regions))
  } finally {
    await browser.close()
  }
}

/** Crop a CSS-pixel rect out of the 2x capture. */
function crop(r, pad = 0) {
  return {
    left: Math.round((r.x - pad) * SCALE),
    top: Math.round((r.y - pad) * SCALE),
    width: Math.round((r.w + pad * 2) * SCALE),
    height: Math.round((r.h + pad * 2) * SCALE),
  }
}

/** Separable 1-D pass over a single-channel Float32 plane: min or box-mean, radius r. */
function pass(src, width, height, r, horizontal, op) {
  const out = new Float32Array(src.length)
  const len = horizontal ? width : height
  const lines = horizontal ? height : width
  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < len; i++) {
      let acc = op === 'min' ? Infinity : 0
      let n = 0
      for (let j = Math.max(0, i - r); j <= Math.min(len - 1, i + r); j++) {
        const v = src[horizontal ? l * width + j : j * width + l]
        if (op === 'min') acc = Math.min(acc, v)
        else acc += v
        n++
      }
      out[horizontal ? l * width + i : i * width + l] = op === 'min' ? acc : acc / n
    }
  }
  return out
}

/**
 * Lift text off the page's gradient: each pixel's distance from the background
 * becomes alpha, and its colour is the unblended text colour. Text on the page
 * is light-on-dark, so "brighter than the background" is "ink".
 *
 * ⚠ THE BACKGROUND IS ESTIMATED IN 2-D, AND THAT IS THE WHOLE TRICK. The hero's
 * gradient is lighter on the LEFT than the right. A first version estimated it
 * per ROW from the row's darkest pixels — all on the dark right — so the lighter
 * left-hand gradient read as faint "ink": a visible band above the first line,
 * and the same haze under every glyph. Measured against a background-only
 * render: 8 rows, up to 10 levels, x 126–246.
 *
 * Now: a min-filter wider than any letter stroke (so each window always holds
 * some background) gives the local background under the text, and a box blur of
 * the same radius smooths the min-filter's blockiness. MIN_SPAN / MIN_ALPHA then
 * keep gradient noise — a few levels — from being stretched into alpha.
 */
async function liftText(shot, rect) {
  const { data, info } = await sharp(shot).extract(crop(rect, 4)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const R = 24 // 2x px; Archivo 800 stems here are ~14px, so a 49px window always reaches background
  const bgPlane = [0, 1, 2].map((k) => {
    let p = new Float32Array(width * height)
    for (let i = 0; i < p.length; i++) p[i] = data[i * 3 + k]
    p = pass(pass(p, width, height, R, true, 'min'), width, height, R, false, 'min')
    return pass(pass(p, width, height, R, true, 'mean'), width, height, R, false, 'mean')
  })
  const MIN_SPAN = 120
  const MIN_ALPHA = 0.06
  let inkBright = 0
  for (let i = 0; i < width * height; i++) inkBright = Math.max(inkBright, data[i * 3], data[i * 3 + 1], data[i * 3 + 2])
  const out = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const c = [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]
    const bg = [bgPlane[0][i], bgPlane[1][i], bgPlane[2][i]]
    const bgBright = Math.max(bg[0], bg[1], bg[2])
    const span = Math.max(MIN_SPAN, inkBright - bgBright)
    const raw = Math.min(1, Math.max(0, (Math.max(c[0], c[1], c[2]) - bgBright) / span))
    const a = raw < MIN_ALPHA ? 0 : raw
    const q = i * 4
    for (let k = 0; k < 3; k++) {
      // Un-blend: the text colour that, over bg at alpha a, produced c.
      out[q + k] = a > 0 ? Math.round(Math.min(255, Math.max(0, (c[k] - (1 - a) * bg[k]) / a))) : 0
    }
    out[q + 3] = Math.round(a * 255)
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

/** The card, with the page outside its rounded corners cut away. */
async function liftCard(shot, rect) {
  const box = crop(rect)
  const r = Math.round(rect.radius * SCALE)
  const mask = Buffer.from(
    `<svg width="${box.width}" height="${box.height}"><rect width="${box.width}" height="${box.height}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  )
  return sharp(shot).extract(box).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
}

async function compose() {
  const regions = JSON.parse(fs.readFileSync(path.join(SRC, 'regions.json'), 'utf8'))
  const shot = path.join(SRC, 'home-top.png')

  const headline = await sharp(await liftText(shot, regions.h1)).resize({ width: 400 }).toBuffer()
  const card = await sharp(await liftCard(shot, regions.card)).resize({ height: 392 }).toBuffer()
  const hm = await sharp(headline).metadata()
  const cm = await sharp(card).metadata()

  // Headline left, card right, the pair centred as one unit with a fixed gap.
  const GAP = 56
  const groupW = (hm.width ?? 0) + GAP + (cm.width ?? 0)
  const left = Math.round((W - groupW) / 2)

  // Brand navy, NOT black — Play warns pure black/dark grey blends into its UI.
  const background = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#0a1f4a"/>
          <stop offset="1" stop-color="#06122e"/>
        </linearGradient>
        <radialGradient id="glow" cx="0.72" cy="0.5" r="0.45">
          <stop offset="0" stop-color="#22d3ee" stop-opacity="0.16"/>
          <stop offset="1" stop-color="#22d3ee" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
      <rect width="${W}" height="${H}" fill="url(#glow)"/>
    </svg>`,
  )

  await sharp(background)
    .composite([
      { input: headline, left, top: Math.round((H - (hm.height ?? 0)) / 2) },
      { input: card, left: left + (hm.width ?? 0) + GAP, top: Math.round((H - (cm.height ?? 0)) / 2) },
    ])
    .flatten({ background: '#06122e' })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(OUT)
  const meta = await sharp(OUT).metadata()
  console.log(`docs/play-store/feature-graphic-1024x500.png  ${meta.width}x${meta.height}  channels=${meta.channels}`)
}

;(process.argv.includes('--capture') ? capture().then(compose) : compose()).catch((err) => {
  console.error(err)
  process.exit(1)
})
