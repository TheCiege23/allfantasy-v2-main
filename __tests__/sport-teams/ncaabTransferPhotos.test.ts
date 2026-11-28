/**
 * A college basketball transfer's ESPN photo is carried from his old school's row — by ESPN id, never by
 * name (lib/sport-teams/ncaabPlayerPoolRules.ts, 2026-11-27).
 */
import { describe, expect, it } from 'vitest'
import { buildNcaabTransferPhotoIndex, espnIdOfNcaabHeadshot } from '@/lib/sport-teams/ncaabPlayerPoolRules'
import { readEspnNcaabHeadshots } from '@/lib/espn/ncaabRosterSnapshot'

const photo = (id: string) => `https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/${id}.png`

describe('espnIdOfNcaabHeadshot', () => {
  it('reads the id from an ESPN college basketball headshot only', () => {
    expect(espnIdOfNcaabHeadshot(photo('5174955'))).toBe('5174955')
    expect(espnIdOfNcaabHeadshot('https://example.com/players/full/5174955.png')).toBeNull()
    expect(espnIdOfNcaabHeadshot(null)).toBeNull()
  })
})

describe('buildNcaabTransferPhotoIndex', () => {
  const index = buildNcaabTransferPhotoIndex({
    roster: [
      { id: 'espn:ncaab:5174955', name: 'Paulius Murauskas', jerseyNumber: '23' },
      { id: 'espn:ncaab:4895746', name: 'Jayden Reid', jerseyNumber: '0' },
      { id: 'espn:ncaab:5311606', name: 'Jayden Reid', jerseyNumber: '1' },
      // Two current players with one name AND one number: nobody can be sure which, so neither.
      { id: 'espn:ncaab:111', name: 'Chris Smith', jerseyNumber: '5' },
      { id: 'espn:ncaab:222', name: 'Chris Smith', jerseyNumber: '5' },
    ],
    storedImageUrls: [photo('5174955'), photo('111'), photo('222'), null, 'https://example.com/x.png'],
  })

  it('carries the photo whose ESPN id is the current roster entry\'s', () => {
    expect(index({ name: 'Paulius Murauskas', number: 23 })).toBe(photo('5174955'))
  })
  it('a different jersey is a different player: no photo', () => {
    expect(index({ name: 'Paulius Murauskas', number: 5 })).toBeNull()
  })
  it('a current player whose ESPN id has no stored photo gets none — never another Jayden Reid\'s', () => {
    expect(index({ name: 'Jayden Reid', number: 0 })).toBeNull()
  })
  it('an ambiguous name and number gets nothing', () => {
    expect(index({ name: 'Chris Smith', number: 5 })).toBeNull()
  })
  it('accents and punctuation do not break the match', () => {
    const i = buildNcaabTransferPhotoIndex({ roster: [{ id: 'espn:ncaab:9', name: "D'Angelo Núñez", jerseyNumber: 3 }], storedImageUrls: [photo('9')] })
    expect(i({ name: 'DAngelo Nunez', number: '3' })).toBe(photo('9'))
  })
})

describe('a photo ESPN sent with its roster, not yet on any vendor row', () => {
  const now = new Date('2026-11-28T00:00:00Z')
  const snapshot = (teamId: string, athletes: Array<{ id: string; headshotUrl?: string }>) => ({
    data: { seasonYear: 2027, teamId, school: `School ${teamId}`, observedAt: now.toISOString(), athletes },
  })
  const db = {
    sportsDataCache: {
      findMany: async () => [
        snapshot('103', [{ id: '5177694', headshotUrl: photo('5177694') }, { id: '5314627' }]),
        // Listed by two schools at once: dropped until a refresh settles the transfer.
        snapshot('2', [{ id: '777', headshotUrl: photo('777') }]),
        snapshot('3', [{ id: '777', headshotUrl: photo('777') }]),
      ],
    },
  } as never

  it('gives the player the photo ESPN sent, found by his ESPN id (Money Williams, 2026-11-28)', async () => {
    const photos = await readEspnNcaabHeadshots(db, 2027, now)
    const index = buildNcaabTransferPhotoIndex({
      roster: [
        { id: 'espn:ncaab:5177694', name: 'Money Williams', jerseyNumber: '0' },
        { id: 'espn:ncaab:5314627', name: 'Kellen Pickett', jerseyNumber: '4' },
        { id: 'espn:ncaab:777', name: 'Two Schools', jerseyNumber: '1' },
      ],
      storedImageUrls: [...photos.values()],
    })
    expect(index({ name: 'Money Williams', number: 0 })).toBe(photo('5177694'))
    // ESPN has no photo for him: none, never a guess.
    expect(index({ name: 'Kellen Pickett', number: 4 })).toBeNull()
    expect(index({ name: 'Two Schools', number: 1 })).toBeNull()
  })
})
