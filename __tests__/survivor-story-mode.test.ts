import { describe, expect, it } from 'vitest'

import { SURVIVOR_STORY_MODE_DEFAULTS, parseSurvivorStoryModeInput, readSurvivorStoryMode, storyClosingLine, storyEpisodeTitle } from '@/lib/survivor/survivorStoryMode'
import { buildStoryModeTile } from '@/lib/survivor/premium/survivorHostTiles'

describe('story mode settings', () => {
  it('reads the defaults (today’s recap) when unset, and field by field when partial', () => {
    expect(readSurvivorStoryMode(null)).toEqual({ tone: 'classic', confessionals: true, postToChat: true })
    expect(readSurvivorStoryMode({ survivorStoryMode: { tone: 'playful' } })).toEqual({ ...SURVIVOR_STORY_MODE_DEFAULTS, tone: 'playful' })
    expect(readSurvivorStoryMode({ survivorStoryMode: { tone: 'shouty', postToChat: false } })).toEqual({ ...SURVIVOR_STORY_MODE_DEFAULTS, postToChat: false })
  })

  it('a save must name a real tone and real on/off values', () => {
    expect(parseSurvivorStoryModeInput({ tone: 'dramatic', confessionals: false, postToChat: true })).toEqual({ ok: true, value: { tone: 'dramatic', confessionals: false, postToChat: true } })
    expect(parseSurvivorStoryModeInput({ tone: 'shouty', confessionals: true, postToChat: true })).toMatchObject({ ok: false })
    expect(parseSurvivorStoryModeInput({ tone: 'classic', confessionals: 'yes', postToChat: true })).toMatchObject({ ok: false })
    expect(parseSurvivorStoryModeInput(null)).toMatchObject({ ok: false })
  })
})

describe('tone', () => {
  const week = { idolsPlayed: 0, tie: false, eliminated: 1, merged: false, remaining: 9 }
  it('classic keeps every title and ending the recap always had', () => {
    expect(storyEpisodeTitle('classic', week)).toBe('The Tribe Has Spoken')
    expect(storyEpisodeTitle('classic', { ...week, idolsPlayed: 1 })).toBe('Idol in Play')
    expect(storyEpisodeTitle('classic', { ...week, eliminated: 0 })).toBe('A Quiet Week on the Island')
    expect(storyClosingLine('classic', week)).toBe('9 managers remain. The merge is getting closer.')
    expect(storyClosingLine('classic', { ...week, merged: true })).toBe('9 managers remain.')
  })

  it('other tones change the words, never the facts', () => {
    expect(storyEpisodeTitle('dramatic', week)).toBe('The Torch Goes Dark')
    expect(storyEpisodeTitle('playful', { ...week, tie: true })).toBe('Well, That Was Awkward')
    expect(storyClosingLine('dramatic', week)).toContain('9 remain')
    expect(storyClosingLine('playful', { ...week, remaining: 0 })).toBeNull()
  })

  it('the tile previews one sample week in every tone, with no real manager in it', () => {
    const tile = buildStoryModeTile(SURVIVOR_STORY_MODE_DEFAULTS)
    expect(Object.keys(tile.previews)).toEqual(['classic', 'dramatic', 'playful'])
    expect(tile.previews.classic.title).toBe('The Tribe Has Spoken')
    expect(tile.previews.dramatic.title).toBe('The Torch Goes Dark')
    // Same scenes and facts in every tone; only the narration differs.
    expect(tile.previews.playful.scenes.map(s => s.label)).toEqual(tile.previews.classic.scenes.map(s => s.label))
    expect(tile.previews.classic.scenes.find(s => s.label === 'Tribal Council')?.text).toBe(tile.previews.dramatic.scenes.find(s => s.label === 'Tribal Council')?.text)
  })
})
