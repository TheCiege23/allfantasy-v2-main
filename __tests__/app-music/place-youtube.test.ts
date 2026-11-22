/**
 * Where the one YouTube player goes (2026-11-17): the chat's Music tab first, then a page's own slot (the draft room's
 * music row on a phone), then the corner box. A slot under 200×200 is refused — YouTube wants a playing player at
 * least that big and visible.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { musicBus, placeYouTube } from '@/components/app-music/musicBus'

const chat = { left: 10, top: 20, width: 320, height: 180 }
const slot = { left: 12, top: 90, width: 200, height: 200 }

describe('placeYouTube', () => {
  it('the chat Music tab wins while it is showing', () => {
    expect(placeYouTube(chat, slot)).toEqual({ where: 'chat', rect: chat })
  })

  it("a page's slot is used when the chat is not showing", () => {
    expect(placeYouTube(null, slot)).toEqual({ where: 'slot', rect: slot })
  })

  it('no slot: the corner box', () => {
    expect(placeYouTube(null, null)).toEqual({ where: 'corner', rect: null })
  })

  it('🛑 a slot smaller than 200×200 is refused, in either direction', () => {
    expect(placeYouTube(null, { ...slot, width: 199 }).where).toBe('corner')
    expect(placeYouTube(null, { ...slot, height: 199 }).where).toBe('corner')
  })
})

describe('musicBus.setSlot', () => {
  afterEach(() => musicBus.setSlot(null))

  it('stores the slot and tells listeners, but not when nothing moved', () => {
    const listener = vi.fn()
    const off = musicBus.subscribe(listener)
    musicBus.setSlot(slot)
    expect(musicBus.getSlot()).toEqual(slot)
    expect(listener).toHaveBeenCalledTimes(1)
    musicBus.setSlot({ ...slot })
    expect(listener).toHaveBeenCalledTimes(1)
    musicBus.setSlot(null)
    expect(musicBus.getSlot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    off()
  })
})
