#!/usr/bin/env node
/**
 * Generate public/af-crest-transparent.png — the crest as a real PNG with an
 * alpha channel, rendered from public/af-crest.svg.
 *
 * ⚠ WHY A RASTER AT ALL, WHEN /af-crest.svg EXISTS. Some consumers cannot take
 * SVG: mail clients (the verification email), the Notifications API (the
 * service worker's icon and badge), and Google's Organization `logo`. Those
 * were pointed at /af-crest.png, which is a JPEG with a `.png` name and an
 * opaque black square around the crest — a black box on the email's white card.
 *
 * ⚠ /af-crest.png IS LEFT ALONE ON PURPOSE. It is the source for the PWA icons
 * (generate-icons.ps1), and an iOS home-screen icon with transparency renders
 * the transparent area black — exactly the box this file exists to remove.
 * Emails already in inboxes also still point at it.
 *
 * Square canvas, so it drops into icon-shaped slots (a 28x28 email cell, a
 * notification icon) without being stretched; the crest is centred with a
 * small margin so a circular notification mask does not clip the rim.
 *
 *   node scripts/build-crest-png.mjs
 */
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SIZE = 512
const MARGIN = 16

async function main() {
  // density: the SVG's intrinsic height is 419, so render well above SIZE and
  // downsample — rasterising at 1x and then upscaling would soften the edges.
  const crest = await sharp(path.join(root, 'public/af-crest.svg'), { density: 300 })
    .resize({ height: SIZE - MARGIN * 2, fit: 'inside' })
    .png()
    .toBuffer()
  const meta = await sharp(crest).metadata()

  await sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: crest,
        left: Math.round((SIZE - (meta.width ?? 0)) / 2),
        top: Math.round((SIZE - (meta.height ?? 0)) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, 'public/af-crest-transparent.png'))

  const out = await sharp(path.join(root, 'public/af-crest-transparent.png')).metadata()
  console.log(`public/af-crest-transparent.png  ${out.width}x${out.height}  ${out.format}  alpha=${out.hasAlpha}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
