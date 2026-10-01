/**
 * Fun-mode GIFs: Chimmy names a mood, never a URL; the server strips the line in every mode and
 * resolves the mood from our own catalog; the drawer renders only a known GIF host.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { chatGif: { findMany: vi.fn() } } }))

import { CHIMMY_GIF_MOODS, extractChimmyGifMood } from '@/lib/chimmy/chimmyGifMoods'
import { resolveChimmyGif } from '@/lib/chimmy/chimmyGif'
import { readChimmyGif } from '@/components/core-app/comms/ChimmyGif'
import { FUN_MODE_DIRECTIVE } from '@/lib/chimmy/funMode'

const ROW = { url: 'https://static.klipy.com/a.gif', previewUrl: 'https://static.klipy.com/a-small.gif', title: 'Heist', width: 200, height: 150 }

describe('extractChimmyGifMood', () => {
  it('strips a trailing [gif: mood] line and returns a known mood', () => {
    expect(extractChimmyGifMood('You fleeced him 🔥\n\n[gif: robbery]')).toEqual({ text: 'You fleeced him 🔥', mood: 'robbery' })
  })
  it('strips an unknown mood without returning it, and leaves text with no tag alone', () => {
    expect(extractChimmyGifMood('Nice.\n[gif: dancing-cat]')).toEqual({ text: 'Nice.', mood: null })
    expect(extractChimmyGifMood('Allen for a 2nd.')).toEqual({ text: 'Allen for a 2nd.', mood: null })
    // Only the last line counts; a tag mid-text is prose.
    expect(extractChimmyGifMood('[gif: hype] then more').mood).toBeNull()
  })
})

describe('resolveChimmyGif', () => {
  it('looks the mood up by its search terms and keeps only https rows', async () => {
    const findMany = vi.fn().mockResolvedValue([{ ...ROW, url: 'http://insecure/x.gif' }, ROW])
    const gif = await resolveChimmyGif('robbery', { findMany, pick: () => 0 })
    expect(findMany).toHaveBeenCalledWith(CHIMMY_GIF_MOODS.robbery)
    expect(gif).toEqual({ ...ROW, provider: 'klipy' })
  })
  it('no match, or a failed read, means no GIF', async () => {
    expect(await resolveChimmyGif('sad', { findMany: vi.fn().mockResolvedValue([]) })).toBeNull()
    expect(await resolveChimmyGif('sad', { findMany: vi.fn().mockRejectedValue(new Error('db')) })).toBeNull()
  })
})

describe('readChimmyGif (drawer)', () => {
  it('renders a known GIF host, preferring the preview, and nothing else', () => {
    expect(readChimmyGif(ROW)).toMatchObject({ url: ROW.previewUrl, provider: 'klipy' })
    expect(readChimmyGif({ ...ROW, url: 'https://evil.example/x.gif', previewUrl: 'https://evil.example/y.gif' })).toBeNull()
    expect(readChimmyGif({ ...ROW, url: 'javascript:alert(1)', previewUrl: '' })).toBeNull()
    expect(readChimmyGif(null)).toBeNull()
  })
})

describe('wiring', () => {
  it('Fun mode offers the GIF line; the route strips it on both paths and resolves only in Fun mode', () => {
    expect(FUN_MODE_DIRECTIVE).toMatch(/\[gif: celebration\]/)
    const route = readFileSync('app/api/chat/chimmy/route.ts', 'utf8')
    expect(route).toMatch(/^\s*const loopGifLine = extractChimmyGifMood\(loop\.text\)/m)
    expect(route).toMatch(/^\s*const loopGif = isFunModeTone\(tone\) && loopGifLine\.mood/m)
    expect(route).toMatch(/^\s*const fallbackGifLine = extractChimmyGifMood\(fastTakeBody\)/m)
    expect(route).toMatch(/^\s*isFunModeTone\(tone\) \? `RESPONSE STYLE — FUN MODE:\\n\$\{FUN_MODE_DIRECTIVE\}` : null,/m)
  })
})
