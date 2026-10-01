import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { AfCrest } from '@/components/core-app/AfCrest'

/**
 * The crest, and the reason it is drawn instead of loaded.
 */

describe('the shipped crest raster', () => {
  it('is a JPEG despite its .png name — which is why the rail does not use it', () => {
    /*
     * This is a fact about the repo, asserted so the reasoning in AfCrest's
     * header cannot quietly become false. If someone replaces the file with a
     * real transparent PNG, this test fails and the rail can go back to an
     * <img> — which would be a good outcome, and the failure is how anyone
     * would find out.
     */
    const buf = fs.readFileSync(path.join(process.cwd(), 'public', 'af-crest.png'))
    const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
    expect(isPng).toBe(false)
    expect(isJpeg).toBe(true)
  })

  it('/af-crest-transparent.png IS a real PNG with an alpha channel', () => {
    /*
     * The raster for consumers that cannot take SVG (email, notifications,
     * the Organization logo). Its whole reason to exist is transparency, so
     * assert the bytes, not the name — the name is exactly what lied last time.
     * IHDR colour type sits at byte 25: 6 = RGBA, 4 = grey+alpha.
     */
    const buf = fs.readFileSync(path.join(process.cwd(), 'public', 'af-crest-transparent.png'))
    expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
    expect([4, 6]).toContain(buf[25])
  })

  it('the PWA icons ARE real PNGs, so the install path is sound', () => {
    // iOS requires a home-screen install before push is permitted, and the
    // install uses these — so a mislabelled icon here would cost push.
    for (const name of ['icon-192.png', 'icon-512.png']) {
      const buf = fs.readFileSync(path.join(process.cwd(), 'public', 'icons', name))
      expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
        true,
      )
    }
  })
})

describe('AfCrest', () => {
  it('draws with no raster and no network request', () => {
    const { container } = render(<AfCrest />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })

  it('carries no opaque background — it must sit on a dark rail', () => {
    const { container } = render(<AfCrest />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('fill')).toBe('none')
    // No full-bleed rect painting a ground behind the mark.
    expect(container.querySelector('rect')).toBeNull()
  })

  it('keeps brand colour by default — a crest that follows the theme is decoration', () => {
    const { container } = render(<AfCrest />)
    const fills = Array.from(container.querySelectorAll('path')).map((p) => p.getAttribute('fill'))
    // rim ring, navy field, "A", "F" — the colours sampled off the master artwork.
    expect(fills).toEqual(['#0B8DCB', '#012967', '#FEFDF9', '#FEFDF9'])
  })

  it('sets the letters as paths, so they cannot reflow with the device font', () => {
    const { container } = render(<AfCrest />)
    expect(container.querySelector('text')).toBeNull()
  })

  it('takes the surrounding colour when asked to be furniture', () => {
    const { container } = render(<AfCrest tone="inherit" />)
    const fills = Array.from(container.querySelectorAll('path')).map((p) => p.getAttribute('fill'))
    // No field: the rim is a ring, so the crest reads as an outline, not a blob.
    expect(fills).toEqual(['currentColor', 'currentColor', 'currentColor'])
  })

  it('/af-crest.svg is the same drawing, for surfaces that need an <img>', () => {
    // The public file is a hand-copied mirror of this component. Every `d` the
    // component draws must appear in it verbatim, or the two have drifted.
    const svg = fs.readFileSync(path.join(process.cwd(), 'public', 'af-crest.svg'), 'utf8')
    const { container } = render(<AfCrest />)
    const ds = Array.from(container.querySelectorAll('path')).map((p) => p.getAttribute('d')!)
    for (const d of ds) expect(svg).toContain(`d="${d}"`)
    expect(svg).toContain(`viewBox="${container.querySelector('svg')!.getAttribute('viewBox')}"`)
    expect(svg).not.toMatch(/<rect/)
  })

  it('scales without a second asset', () => {
    const small = render(<AfCrest size={20} />).container.querySelector('svg')!
    const large = render(<AfCrest size={512} />).container.querySelector('svg')!
    expect(small.getAttribute('width')).toBe('20')
    expect(large.getAttribute('width')).toBe('512')
    // Same viewBox at both sizes — one drawing, not two.
    expect(small.getAttribute('viewBox')).toBe(large.getAttribute('viewBox'))
  })

  it('is hidden from screen readers when decorative, and labelled when not', () => {
    const bare = render(<AfCrest />).container.querySelector('svg')!
    expect(bare.getAttribute('aria-hidden')).toBe('true')

    const labelled = render(<AfCrest title="AllFantasy" />).container.querySelector('svg')!
    expect(labelled.getAttribute('aria-hidden')).toBeNull()
    expect(labelled.getAttribute('role')).toBe('img')
    expect(labelled.querySelector('title')?.textContent).toBe('AllFantasy')
  })
})
