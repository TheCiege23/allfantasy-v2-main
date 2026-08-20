#!/usr/bin/env node
/**
 * Generate public/og-image.jpg — the default OpenGraph / Twitter card.
 *
 * ⚠ WHY THIS EXISTS AS A SCRIPT AND NOT JUST A COMMITTED BINARY. The asset it
 * writes is committed, so nothing runs this at build time. It is here so the
 * card can be regenerated from the brand sources when they change, instead of
 * being a 1200x630 JPEG nobody can reproduce.
 *
 * ⚠ THE CARD IS COMPOSED FROM EXISTING BRAND ASSETS ON PURPOSE. Nothing here
 * invents new branding: it crops public/af-crest.png and
 * public/branding/allfantasy-wordmark-logo.png to their artwork and lays them
 * out at the size social platforms actually crop to. Both sources are already
 * artwork-on-black, so they composite onto a black canvas with no seams and no
 * masking. Swap either source and re-run.
 *
 * 1200x630 is the size Facebook, LinkedIn and X all crop toward; anything
 * squarer gets letterboxed or centre-cropped into nonsense, which is what
 * pointing og:image at the square crest would have done.
 *
 *   node scripts/build-og-image.mjs
 */
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const W = 1200
const H = 630

/**
 * `trim` reduces each source to its artwork.
 *
 * Both files are a logo floating in a large black field — the crest occupies
 * roughly the middle 45% of a 1024x1024 canvas — so compositing them raw would
 * lay down two mostly-empty rectangles and leave the logo tiny. The threshold is
 * above pure black because the sources carry a faint glow around the artwork
 * that a zero threshold treats as content and refuses to crop.
 */
async function artwork(file) {
  return sharp(path.join(root, file)).trim({ threshold: 18 }).toBuffer()
}

async function main() {
  const crest = await sharp(await artwork('public/af-crest.png'))
    .resize({ height: 300, fit: 'inside' })
    .toBuffer()

  const wordmark = await sharp(await artwork('public/branding/allfantasy-wordmark-logo.png'))
    .resize({ width: 470, fit: 'inside' })
    .toBuffer()

  const crestMeta = await sharp(crest).metadata()
  const wordMeta = await sharp(wordmark).metadata()

  // Crest left, wordmark right, the pair centred as one unit.
  const GAP = 52
  const groupW = (crestMeta.width ?? 0) + GAP + (wordMeta.width ?? 0)
  const left = Math.round((W - groupW) / 2)

  await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([
      {
        input: crest,
        left,
        top: Math.round((H - (crestMeta.height ?? 0)) / 2),
      },
      {
        input: wordmark,
        left: left + (crestMeta.width ?? 0) + GAP,
        top: Math.round((H - (wordMeta.height ?? 0)) / 2),
      },
    ])
    // mozjpeg at 88 keeps this comfortably under the 300KB most scrapers fetch
    // happily, without visible banding on the crest's blue gradient.
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(path.join(root, 'public/og-image.jpg'))

  const out = await sharp(path.join(root, 'public/og-image.jpg')).metadata()
  console.log(`public/og-image.jpg  ${out.width}x${out.height}  ${out.format}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
