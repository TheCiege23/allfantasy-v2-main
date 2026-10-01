#!/usr/bin/env node
/**
 * Generate the home-screen icons in public/icons/, and the native iOS app icon
 * and launch splash in ios-app/, from public/af-crest.svg — one script, so the
 * web and native marks cannot drift apart.
 *
 * Replaces generate-icons.ps1, which stretched public/af-crest.png — an older
 * crest variant, as a JPEG on a 1024px black square — to every size, so each
 * icon was a small cyan-rim crest sitting high on black.
 *
 * ⚠ OPAQUE ON PURPOSE. iOS renders an apple-touch-icon's transparent pixels
 * black, and app/layout.tsx uses icon-192 as that icon. So every file here is
 * flattened onto BG with no alpha channel; __tests__/af-crest.test.tsx asserts
 * the colour type from the bytes.
 *
 * ⚠ TWO CROPS, BECAUSE TWO PLATFORMS MASK DIFFERENTLY.
 *   icon-<n>.png           "any": iOS rounds the corners and keeps the square,
 *                          so the crest can be large (CREST_ANY of the height).
 *   icon-maskable-<n>.png  Android adaptive icons may cut to a CIRCLE of 80% of
 *                          the side. The crest's widest points are its shoulder
 *                          corners; at CREST_MASKABLE they sit at ~0.36 of the
 *                          side from centre, inside the 0.40 safe radius.
 *
 * BG is a deep navy rather than the shield's own field (#012967): on the field
 * colour the shield merges into the tile and only the rim is left to read.
 *
 *   node scripts/build-pwa-icons.mjs
 */
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BG = '#06122e'
const CREST_ANY = 0.7
const CREST_MASKABLE = 0.62
const ANY_SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
const MASKABLE_SIZES = [192, 512]

/*
 * The native iOS shell (ios-app/, the project ios-testflight.yml archives).
 * It only reaches users with the next TestFlight build — that workflow is
 * manual, so regenerating these ships nothing by itself.
 *
 * App icon: one 1024 "universal" image, the only slot its Contents.json
 * declares. App Store Connect REJECTS an app icon with an alpha channel, and
 * iOS applies its own corner mask, so it is the same opaque square as the web
 * "any" icons.
 *
 * Splash: kept exactly as it was — crest at ~21% of the height on BLACK — with
 * only the crest replaced. The background must stay #000000: that is the
 * SplashScreen.backgroundColor in ios-app/capacitor.config.json, and a splash
 * image that disagreed with it would flash at the hand-off.
 */
const IOS_ASSETS = 'ios-app/ios/App/App/Assets.xcassets'
const IOS_APP_ICON = `${IOS_ASSETS}/AppIcon.appiconset/AppIcon-512@2x.png`
const IOS_SPLASHES = ['', '-1', '-2'].map((s) => `${IOS_ASSETS}/Splash.imageset/splash-2732x2732${s}.png`)
const SPLASH_BG = '#000000'
const CREST_SPLASH = 0.214

/*
 * Google Play store-listing icon — uploaded by hand in Play Console, never
 * served, so it lives beside the Play runbook, not in public/.
 *
 * ⚠ THE ONE ICON HERE THAT CARRIES AN ALPHA CHANNEL. Play's spec is a 512²
 * "32-bit PNG" in sRGB; every other icon in this script is deliberately 24-bit
 * (App Store Connect rejects icon alpha, iOS paints it black). So this is the
 * same opaque navy tile with an alpha channel ADDED and set fully opaque — it
 * satisfies the 32-bit rule without introducing a single transparent pixel.
 *
 * Play rounds the corners itself at 30% of the size (more than iOS), so the
 * asset is a full square. At CREST_ANY the crest's nearest pixel sits 77px
 * inside that mask (measured 2026-10-01, not tested — re-measure if CREST_ANY
 * grows). The test asserts only the format: 512², colour type 6, alpha min 255.
 */
const PLAY_ICON = 'docs/play-store/play-store-icon-512.png'

async function icon(size, fraction, out, bg = BG, { alpha = false } = {}) {
  // Rasterise the vector at the target size directly — never resize a raster up.
  const crest = await sharp(path.join(root, 'public/af-crest.svg'), { density: 600 })
    .resize({ height: Math.round(size * fraction), fit: 'inside' })
    .png()
    .toBuffer()
  const meta = await sharp(crest).metadata()

  const tile = sharp({ create: { width: size, height: size, channels: 3, background: bg } })
    .composite([
      {
        input: crest,
        left: Math.round((size - (meta.width ?? 0)) / 2),
        top: Math.round((size - (meta.height ?? 0)) / 2),
      },
    ])
    .flatten({ background: bg })
  // Flatten first in both cases, so an alpha channel, when asked for, is uniformly opaque.
  await (alpha ? tile.ensureAlpha(1) : tile.removeAlpha()).png({ compressionLevel: 9 }).toFile(path.join(root, out))
  console.log(out)
}

async function main() {
  for (const size of ANY_SIZES) await icon(size, CREST_ANY, `public/icons/icon-${size}.png`)
  for (const size of MASKABLE_SIZES) await icon(size, CREST_MASKABLE, `public/icons/icon-maskable-${size}.png`)
  await icon(1024, CREST_ANY, IOS_APP_ICON)
  for (const out of IOS_SPLASHES) await icon(2732, CREST_SPLASH, out, SPLASH_BG)
  await icon(512, CREST_ANY, PLAY_ICON, BG, { alpha: true })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
