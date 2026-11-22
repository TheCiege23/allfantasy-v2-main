/**
 * Chimmy and the music player (2026-11-16, owner's decision): "play some hype music", "play Drake" or
 * "stop the music" gets a card; one tap plays or stops it; nothing plays without the tap.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { MUSIC_STATION_IDS, cleanSearchTerm, isMusicRequest, readMusicCard, stationMenu } from '@/lib/chimmy/musicCards'
import { executeChimmyTool, type ChimmyToolContext } from '@/lib/chimmy/tools/chimmyTools'
import type { MusicCard } from '@/lib/chimmy/musicCards'

const read = (p: string) => readFileSync(path.resolve(__dirname, '..', '..', p), 'utf8')
const ctx = (): ChimmyToolContext & { musicCards: MusicCard[] } => ({ leagueId: null, userId: 'u1', musicCards: [] })

describe('play_music', () => {
  it('a station: one card, by id, and the answer never says it is playing', async () => {
    const c = ctx()
    const text = await executeChimmyTool('play_music', { station: 'game-day' }, c)
    expect(c.musicCards).toEqual([{ kind: 'station', stationId: 'game-day', label: 'Game day hype' }])
    expect(text).toMatch(/starts playing when the user taps Play.*never say it is playing/)
  })

  it('a search and a stop', async () => {
    const s = ctx()
    await executeChimmyTool('play_music', { search: '  Drake \n' }, s)
    expect(s.musicCards).toEqual([{ kind: 'search', term: 'Drake' }])
    const stop = ctx()
    await executeChimmyTool('play_music', { stop: true }, stop)
    expect(stop.musicCards).toEqual([{ kind: 'stop' }])
  })

  it('refuses an unknown station, none or two asks, a second card, and a surface without cards', async () => {
    const c = ctx()
    expect(await executeChimmyTool('play_music', { station: 'polka' }, c)).toMatch(/no station "polka"/)
    expect(await executeChimmyTool('play_music', {}, c)).toMatch(/exactly one/)
    expect(await executeChimmyTool('play_music', { station: 'rock', stop: true }, c)).toMatch(/exactly one/)
    expect(c.musicCards).toEqual([])
    await executeChimmyTool('play_music', { station: 'rock' }, c)
    expect(await executeChimmyTool('play_music', { station: 'pop' }, c)).toMatch(/already a music card/)
    expect(c.musicCards).toHaveLength(1)
    expect(await executeChimmyTool('play_music', { station: 'rock' }, { leagueId: null, userId: 'u1' })).toMatch(/cannot show a music card/)
  })

  it('needs no league, and the tool offers every station by id', async () => {
    expect(MUSIC_STATION_IDS.length).toBeGreaterThan(20)
    for (const id of ['game-day', 'hiphop-hype', 'rock', 'lofi']) expect(stationMenu()).toContain(id)
  })
})

describe('reading a card back', () => {
  it('only a known station or a clean search', () => {
    expect(readMusicCard({ musicCard: { kind: 'station', stationId: 'rock', label: 'anything' } })).toEqual({ kind: 'station', stationId: 'rock', label: 'Rock hits' })
    expect(readMusicCard({ musicCard: { kind: 'station', stationId: 'nope' } })).toBeNull()
    expect(readMusicCard({ musicCard: { kind: 'search', term: 'a\u0000b' } })).toEqual({ kind: 'search', term: 'a b' })
    expect(readMusicCard({ musicCard: { kind: 'search', term: '' } })).toBeNull()
    expect(readMusicCard({ musicCard: { kind: 'stop' } })).toEqual({ kind: 'stop' })
    expect(readMusicCard({})).toBeNull()
    expect(cleanSearchTerm('x'.repeat(200))).toHaveLength(80)
  })
})

describe('isMusicRequest (the off-topic filter lets these through)', () => {
  it.each(['play some hype music', 'Play Drake', '@chimmy put on a football podcast', 'please play lofi', 'stop the music', 'can you play some songs for the draft'])(
    '%s → music',
    (t) => expect(isMusicRequest(t)).toBe(true),
  )
  it.each(['what is the weather', 'stop', 'who won the game', 'tell me a joke'])('%s → not music', (t) => expect(isMusicRequest(t)).toBe(false))
})

describe('wiring', () => {
  it('the route lets a music request through the off-topic filter and returns the card', () => {
    const route = read('app/api/chat/chimmy/route.ts')
    expect(route).toMatch(/!mockDraftBoard && !isMusicRequest\(message\) && !hasSportsContent\(domainInput, hasImage\)/)
    expect(route).toMatch(/musicCards: \[\] as MusicCard\[\] \}/)
    expect(route).toMatch(/\.\.\.\(toolContext\.musicCards\.length > 0 \? \{ musicCard: toolContext\.musicCards\[0\] \} : \{\}\)/)
  })
  it('the Chimmy drawer reads the card and draws it under the answer', () => {
    const panel = read('components/core-app/comms/ChimmyPanel.tsx')
    expect(panel).toMatch(/musicCard: readMusicCard\(payload\.meta\)/)
    expect(panel).toMatch(/t\.role === 'chimmy' && t\.musicCard \? <ChimmyMusicCard card=\{t\.musicCard\} \/> : null/)
  })
})
