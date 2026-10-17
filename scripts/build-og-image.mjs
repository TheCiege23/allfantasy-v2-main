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
 * invents new branding: it crops public/af-crest-transparent.png and
 * public/branding/allfantasy-wordmark-logo.png to their artwork and lays them
 * out at the size social platforms actually crop to. The crest is transparent
 * and the wordmark is artwork-on-black, so both composite onto a black canvas
 * with no seams and no masking. Swap either source and re-run.
 *
 * The crest source is the transparent PNG (built from public/af-crest.svg by
 * scripts/build-crest-png.mjs), not public/af-crest.png — that file is an
 * older crest variant and would put the wrong mark on the card.
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

/**
 * The wordmark, re-inked in the crest's rim blue.
 *
 * ⚠ WHY. The source lettering is a dark blue bevel: measured against the black
 * card it runs from 2.15:1 along its bottom edge to 3.97:1 across the middle,
 * so no part of it reaches 4.5:1. That is a pass for large text on the full
 * 1200px card, but iMessage, Slack and X show this card at roughly 300px wide,
 * where the wordmark is small text. #0B8DCB is 5.69:1 on black, and it is the
 * crest's own rim colour, so crest and wordmark read as one mark.
 *
 * HOW. The source is artwork on black, so each pixel's brightest channel is how
 * much letter it holds. That becomes the alpha of a flat WORDMARK_INK fill:
 * anti-aliased edges stay soft, and the bevel's shading is replaced by one
 * colour. INK_FULL is the fraction of the bevel's peak at which coverage reaches
 * 1. Measured, core contrast from top to bottom of the letters:
 *   0.80  5.63 … 4.01   the dim bottom band (~70% of peak) only part-fills
 *   0.65  5.68 … 5.47   solid top to bottom — chosen
 *   0.55  5.69 … 5.68   also solid, but starts to thicken the strokes
 */
const WORDMARK_INK = { r: 0x0b, g: 0x8d, b: 0xcb }
const INK_FULL = 0.65

async function reink(buffer) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let peak = 0
  for (let i = 0; i < data.length; i += 3) peak = Math.max(peak, data[i], data[i + 1], data[i + 2])
  const out = Buffer.alloc(info.width * info.height * 4)
  for (let p = 0, q = 0; p < data.length; p += 3, q += 4) {
    const coverage = Math.min(1, Math.max(data[p], data[p + 1], data[p + 2]) / (peak * INK_FULL))
    out[q] = WORDMARK_INK.r
    out[q + 1] = WORDMARK_INK.g
    out[q + 2] = WORDMARK_INK.b
    out[q + 3] = Math.round(coverage * 255)
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
}

async function main() {
  const crest = await sharp(await artwork('public/af-crest-transparent.png'))
    .resize({ height: 300, fit: 'inside' })
    .toBuffer()

  const wordmark = await reink(
    await sharp(await artwork('public/branding/allfantasy-wordmark-logo.png'))
      .resize({ width: 470, fit: 'inside' })
      .toBuffer(),
  )

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
