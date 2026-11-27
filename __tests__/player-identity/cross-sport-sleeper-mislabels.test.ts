// @vitest-environment node
/**
 * Detecting rows already written with ANOTHER SPORT's player under the same Sleeper id, and the
 * guard on the repair. Real collisions: NFL 1466 Travis Kelce (TE, KC) / NBA 1466 JaVale McGee (C);
 * NFL 4866 Saquon Barkley (RB, PHI) / NBA 4866 AJ Dybantsa (SF); NFL 4984 Josh Allen (QB, BUF) /
 * NBA 4984 Cameron Corhen (PF).
 */
import { describe, expect, it } from 'vitest'

import {
  applyCardCorrections,
  applySnapshotCorrections,
  findCardMislabels,
  findSnapshotMislabels,
  isCrossSportPosition,
  sqlJsonText,
  staleAdpPlayers,
  writeRefusal,
  type IdReadings,
} from '@/lib/data-repair/crossSportSleeperMislabels'
import { endpointMatches } from '@/lib/db/databaseEndpoint'

const NFL = {
  '1466': { sport: 'NFL', name: 'Travis Kelce', position: 'TE', team: 'KC' },
  '4866': { sport: 'NFL', name: 'Saquon Barkley', position: 'RB', team: 'PHI' },
  '4984': { sport: 'NFL', name: 'Josh Allen', position: 'QB', team: 'BUF' },
}
const NBA = {
  '1466': { sport: 'NBA', name: 'JaVale McGee', position: 'C', team: null },
  '4866': { sport: 'NBA', name: 'AJ Dybantsa', position: 'SF', team: null },
  '4984': { sport: 'NBA', name: 'Cameron Corhen', position: 'PF', team: null },
}
/** Readings for an NFL row: the NFL player is right, the NBA one is the impostor. */
const nflReadings = new Map<string, IdReadings>(
  Object.keys(NFL).map((id) => [id, { right: NFL[id as keyof typeof NFL], others: [NBA[id as keyof typeof NBA]] }]),
)
const nbaReadings = new Map<string, IdReadings>(
  Object.keys(NBA).map((id) => [id, { right: NBA[id as keyof typeof NBA], others: [NFL[id as keyof typeof NFL]] }]),
)

const player = (id: string, position: string | null, team: string | null = null) => ({
  id, position, team, slot: null, starter: null, reserve: null, taxi: null,
})

describe('contextSnapshot positions', () => {
  const snapshot = {
    version: 1,
    source: 'backfill_rebuilt',
    sides: [
      { rosterId: '1', rosterBefore: [player('1466', 'C'), player('4984', 'QB', 'BUF')] },   // Kelce stored as McGee's C
      { rosterId: '2', rosterBefore: [player('4866', 'SF'), player('9999', 'WR')] },        // Barkley stored as Dybantsa's SF
    ],
  }

  it('🛑 finds the positions that are the other sport’s player, and nothing else', () => {
    const fixes = findSnapshotMislabels(snapshot, nflReadings)
    expect(fixes.map((f) => [f.playerId, f.stored.position, f.correct.position, f.wrongSport])).toEqual([
      ['1466', 'C', 'TE', 'NBA'],
      ['4866', 'SF', 'RB', 'NBA'],
    ])
  })

  it('CONTROL: a correct NFL snapshot is not flagged', () => {
    const right = { ...snapshot, sides: [{ rosterId: '1', rosterBefore: [player('1466', 'TE', 'KC'), player('4866', 'RB'), player('4984', 'QB')] }] }
    expect(findSnapshotMislabels(right, nflReadings)).toEqual([])
  })

  it('CONTROL: an NBA snapshot holding NBA positions is not flagged — the same ids, the other sport', () => {
    const nba = { ...snapshot, sides: [{ rosterId: '1', rosterBefore: [player('1466', 'C'), player('4866', 'SF')] }] }
    expect(findSnapshotMislabels(nba, nbaReadings)).toEqual([])
    // …and the same NBA snapshot holding NFL positions IS.
    const wrong = { ...snapshot, sides: [{ rosterId: '1', rosterBefore: [player('1466', 'TE'), player('4984', 'QB')] }] }
    expect(findSnapshotMislabels(wrong, nbaReadings).map((f) => f.playerId)).toEqual(['1466', '4984'])
  })

  it('drift is not this bug: a position that matches no sport’s row is left alone', () => {
    expect(isCrossSportPosition('WR', nflReadings.get('1466')!)).toBe(false)
    expect(isCrossSportPosition('C', { right: null, others: [NBA['1466']] })).toBe(false)
  })

  it('the repair replaces only the flagged players', () => {
    const fixes = findSnapshotMislabels(snapshot, nflReadings)
    const next = applySnapshotCorrections(snapshot, fixes)
    expect(next.sides[0]!.rosterBefore[0]).toMatchObject({ id: '1466', position: 'TE', team: 'KC' })
    expect(next.sides[0]!.rosterBefore[1]).toEqual(snapshot.sides[0]!.rosterBefore[1])
    expect(next.sides[1]!.rosterBefore[0]).toMatchObject({ id: '4866', position: 'RB', team: 'PHI' })
    expect(next.sides[1]!.rosterBefore[1]).toEqual(player('9999', 'WR'))
    expect(snapshot.sides[0]!.rosterBefore[0]!.position).toBe('C') // input untouched
  })
})

describe('league-chat trade cards', () => {
  const metadata = {
    chimmy: true,
    tradeCard: {
      gave: [{ kind: 'player', sleeperId: '1466', name: 'JaVale McGee', position: 'C', team: null }],
      got: [{ kind: 'player', sleeperId: '4984', name: 'Josh Allen', position: 'QB', team: 'BUF' }, { kind: 'pick', season: 2027, round: 1 }],
    },
  }

  it('🛑 an NFL card naming JaVale McGee under 1466 is found; Josh Allen under 4984 is not', () => {
    const fixes = findCardMislabels(metadata, nflReadings)
    expect(fixes).toHaveLength(1)
    expect(fixes[0]).toMatchObject({ list: 'gave', index: 0, playerId: '1466', wrongSport: 'NBA' })
    expect(fixes[0]!.correct.name).toBe('Travis Kelce')
  })

  it('the repair renames the card and the text when the wrong name occurs exactly once', () => {
    const fixes = findCardMislabels(metadata, nflReadings)
    const out = applyCardCorrections(metadata, 'Dana traded JaVale McGee for Josh Allen', fixes)
    expect(out.text).toBe('Dana traded Travis Kelce for Josh Allen')
    expect((out.metadata as typeof metadata).tradeCard.gave[0]).toMatchObject({ name: 'Travis Kelce', position: 'TE', team: 'KC' })
    expect(out.textUnfixed).toEqual([])
    const twice = applyCardCorrections(metadata, 'JaVale McGee, JaVale McGee', fixes)
    expect(twice.text).toBe('JaVale McGee, JaVale McGee')
    expect(twice.textUnfixed).toEqual(['JaVale McGee'])
  })
})

describe('imported-draft ADP', () => {
  it('🛑 an NBA draft whose 1466 resolved to NFL Kelce leaves a stale key; a correctly resolved id does not', () => {
    const old = new Map([
      ['1466', { name: 'Travis Kelce', position: 'TE' }],
      ['4866', { name: 'AJ Dybantsa', position: 'SF' }],
    ])
    const fixed = new Map([
      ['1466', { name: 'JaVale McGee', position: 'C' }],
      ['4866', { name: 'AJ Dybantsa', position: 'SF' }],
    ])
    const r = staleAdpPlayers(['1466', '4866'], old, fixed)
    expect(r.changedIds.map((c) => c.id)).toEqual(['1466'])
    expect(r.staleKeys).toEqual(['Travis Kelce|TE'])
  })
})

describe('the printed review SQL', () => {
  it('🛑 a NULL value is the json null, never SQL NULL (jsonb_set with NULL wipes the document)', () => {
    expect(sqlJsonText(null)).toBe(`'null'::jsonb`)
    expect(sqlJsonText("O'Brien")).toBe(`to_jsonb('O''Brien'::text)`)
  })
})

describe('the repair guard', () => {
  const url = 'postgresql://u:p@ep-real-thing-123-pooler.us-east-2.aws.neon.tech/db'
  it('🛑 refuses --write without --endpoint', () => {
    expect(writeRefusal(['--write'], url, endpointMatches, 'ep-real-thing-123')).toMatch(/^REFUSING/)
  })
  it('🛑 refuses --write naming another endpoint', () => {
    expect(writeRefusal(['--write', '--endpoint=ep-other-1'], url, endpointMatches, 'ep-real-thing-123')).toMatch(/^REFUSING/)
  })
  it('refuses --write with no database at all', () => {
    expect(writeRefusal(['--write', '--endpoint=ep-real-thing-123'], undefined, endpointMatches, null)).toMatch(/^REFUSING/)
  })
  it('allows a dry run, and a write naming the resolved endpoint', () => {
    expect(writeRefusal([], url, endpointMatches, 'ep-real-thing-123')).toBeNull()
    expect(writeRefusal(['--write', '--endpoint=ep-real-thing-123'], url, endpointMatches, 'ep-real-thing-123')).toBeNull()
  })
})
