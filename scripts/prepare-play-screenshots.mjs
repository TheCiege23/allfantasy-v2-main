/**
 * Turn real phone screenshots of the app into Google Play phone screenshots.
 *
 * ⚠ NO `#!` SHEBANG, ON PURPOSE. __tests__/play-screenshot-crop.test.ts imports
 * this file, and Vite's SSR transform hoists imports above line 1. With a
 * shebang there, a CRLF checkout (this repo's Windows autocrlf) parsed as
 * `…["fileURLToPath"];#!/usr/bin/env node` and the suite failed to LOAD:
 * "Test Files 1 failed" over "Tests 95 passed", which reads as green at a
 * glance. An LF checkout passed, so it would have depended on the machine.
 * It is always run as `node scripts/…`, so the shebang bought nothing.
 *
 *   node scripts/prepare-play-screenshots.mjs <folder-of-phone-screenshots>
 *   → docs/play-store/screenshots/phone-1.png, phone-2.png, … (in filename order)
 *
 * ⚠ WHY THE APP'S SCREENS COME FROM A PHONE AND NOT FROM A SCRIPT. Play
 * screenshots should show the product, which is /core — and /core needs a
 * signed-in account. scripts/capture-pwa-screenshots.mjs only ever reads PUBLIC
 * pages, and on 2026-10-01 those gave two usable shots: the rest were sign-in
 * walls, a page stacking two headers, and /leagues/explore rendering internals.
 * So a person takes them on a phone from the DEMO account (never a real league:
 * other managers' names would be in the listing) and this script makes them
 * compliant. The shot list is in docs/play-store/RUNBOOK.md.
 *
 * Play's rules (Play Console help, "Add preview assets", read 2026-10-01):
 *   - JPEG or 24-bit PNG, NO alpha                   → flattened, alpha removed
 *   - longest side at most 2x the shortest           → a 20:9 phone capture
 *     (1080x2400 = 2.22:1) FAILS this, so it is cropped
 *   - promotion needs 4+ shots, 9:16, ≥1080px        → output is exactly 1080x1920
 *   - no "excess elements in the notification bar"  → the status bar is trimmed
 *
 * The crop keeps the TOP of the screen (where every /core screen puts its
 * content) below the status bar, and drops the bottom — the gesture/nav bar
 * first. `--status-bar=<fraction>` overrides the trim (default 0.035 of height).
 */
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const OUT_W = 1080
export const OUT_H = 1920

/**
 * The 9:16 window to cut from a w×h capture. Pure, so it is testable without
 * images: drop `statusBar` of the height from the top, then take the tallest
 * 9:16 box that fits, top-aligned; if the capture is WIDER than 9:16, centre it
 * horizontally instead.
 */
export function cropBox(w, h, statusBar = 0.035) {
  const top = Math.round(h * statusBar)
  const availH = h - top
  if (availH * 9 >= w * 16) {
    // Tall enough: full width, height = w * 16/9, starting just below the status bar.
    return { left: 0, top, width: w, height: Math.round((w * 16) / 9) }
  }
  // Too wide for 9:16 after the trim: full available height, centred width.
  const width = Math.round((availH * 9) / 16)
  return { left: Math.round((w - width) / 2), top, width, height: availH }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const src = process.argv.slice(2).find((a) => !a.startsWith('--'))
  const sbArg = process.argv.find((a) => a.startsWith('--status-bar='))
  const statusBar = sbArg ? Number(sbArg.split('=')[1]) : 0.035
  if (!src || !fs.existsSync(src)) {
    console.error('usage: node scripts/prepare-play-screenshots.mjs <folder> [--status-bar=0.035]')
    process.exit(2)
  }
  const files = fs
    .readdirSync(src)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort()
  if (files.length < 2) console.warn(`⚠ ${files.length} screenshot(s): Play needs at least 2 to publish, 4 for promotion`)
  if (files.length > 8) throw new Error(`${files.length} screenshots: Play accepts at most 8 per device type`)

  const outDir = path.join(root, 'docs/play-store/screenshots')
  fs.mkdirSync(outDir, { recursive: true })
  for (const f of fs.readdirSync(outDir)) if (/^phone-\d+\.png$/.test(f)) fs.unlinkSync(path.join(outDir, f))

  let i = 0
  for (const f of files) {
    i++
    const meta = await sharp(path.join(src, f)).metadata()
    const box = cropBox(meta.width, meta.height, statusBar)
    if (box.width < OUT_W) console.warn(`⚠ ${f}: only ${box.width}px wide after cropping — upscaled to 1080, may look soft`)
    const out = path.join(outDir, `phone-${i}.png`)
    await sharp(path.join(src, f))
      .extract(box)
      .resize(OUT_W, OUT_H, { fit: 'fill' })
      .flatten({ background: '#000000' })
      .removeAlpha()
      .png({ compressionLevel: 9 })
      .toFile(out)
    const m = await sharp(out).metadata()
    console.log(`phone-${i}.png  <- ${f}  (${meta.width}x${meta.height} → crop ${box.width}x${box.height}@${box.left},${box.top} → ${m.width}x${m.height}, channels=${m.channels})`)
  }
  console.log(`\n${i} Play phone screenshot(s) in docs/play-store/screenshots/`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
