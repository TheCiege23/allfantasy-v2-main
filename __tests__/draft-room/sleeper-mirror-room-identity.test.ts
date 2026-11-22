import { describe, expect, it } from 'vitest'
import {
  buildSleeperUserToRosterIdMap,
  remapSleeperMirrorPickRosterIds,
} from '@/lib/draft/sleeperMirrorRosterIds'
import { roundOneAnnouncementKey } from '@/lib/draft-room/resolvePickAnnouncementAssets'

/*
 * Shapes copied from a live Sleeper-mirrored tournament draft (2026-11-16): an unclaimed
 * import keeps its Sleeper id in platformUserId; a CLAIMED team has the AllFantasy user id
 * there and the Sleeper id only in playerData. The claimed team is the one whose roster tab
 * was empty.
 */
const unclaimed = {
  id: 'roster-unclaimed',
  platformUserId: '724755283171205120',
  playerData: { import: { provider: 'sleeper', sourceManagerId: '724755283171205120' } },
}
const claimed = {
  id: 'roster-claimed',
  platformUserId: '9791bae0-e47f-418a-ae40-285f6a2e7887',
  playerData: {
    source_manager_id: '591462610482806784',
    import: { provider: 'sleeper', sourceManagerId: '591462610482806784' },
  },
}
const sourceOnly = {
  id: 'roster-source-only',
  platformUserId: null,
  playerData: { source_manager_id: '334162612788940800' },
}

describe('Sleeper-mirrored picks map to this league\'s roster ids', () => {
  const map = buildSleeperUserToRosterIdMap([unclaimed, claimed, sourceOnly])

  it('maps a claimed team through playerData, where platformUserId no longer holds the Sleeper id', () => {
    expect(map.get('591462610482806784')).toBe('roster-claimed')
  })

  it('maps an unclaimed import through platformUserId, and a source_manager_id-only roster', () => {
    expect(map.get('724755283171205120')).toBe('roster-unclaimed')
    expect(map.get('334162612788940800')).toBe('roster-source-only')
  })

  it('rewrites only sleeper-mirror picks and leaves unknown ids alone', () => {
    const picks = [
      { id: 'a', rosterId: '591462610482806784', source: 'sleeper-mirror' },
      { id: 'b', rosterId: '591462610482806784', source: 'user' },
      { id: 'c', rosterId: '999', source: 'sleeper-mirror' },
    ]
    const out = remapSleeperMirrorPickRosterIds(picks, map)
    expect(out.map((p) => p.rosterId)).toEqual(['roster-claimed', '591462610482806784', '999'])
    // Positive control: the viewer's filter now finds their pick, and did not before.
    expect(picks.filter((p) => p.rosterId === 'roster-claimed')).toHaveLength(0)
    expect(out.filter((p) => p.rosterId === 'roster-claimed')).toHaveLength(1)
  })

  it('refuses to guess when two rosters claim the same Sleeper id', () => {
    const dup = buildSleeperUserToRosterIdMap([
      { id: 'r1', platformUserId: '42', playerData: null },
      { id: 'r2', platformUserId: null, playerData: { source_manager_id: '42' } },
    ])
    expect(dup.has('42')).toBe(false)
  })
})

describe('Round 1 announcement identity survives mirror row churn', () => {
  it('is the same key when the mirror recreates the row with a new id', () => {
    const before = { id: 'row-1', overall: 3, playerId: '9509', playerName: 'Bijan Robinson' }
    const afterSync = { ...before, id: 'row-1-recreated' }
    expect(before.id).not.toBe(afterSync.id)
    expect(roundOneAnnouncementKey(afterSync)).toBe(roundOneAnnouncementKey(before))
  })

  it('changes when a different player lands in the same seat', () => {
    const a = { overall: 3, playerId: '9509', playerName: 'Bijan Robinson' }
    const b = { overall: 3, playerId: '4866', playerName: 'Saquon Barkley' }
    expect(roundOneAnnouncementKey(a)).not.toBe(roundOneAnnouncementKey(b))
  })

  it('falls back to the player name when there is no player id', () => {
    expect(roundOneAnnouncementKey({ overall: 1, playerId: null, playerName: ' Ja\'Marr Chase ' })).toBe(
      "1:ja'marr chase",
    )
  })
})

describe('wiring', () => {
  // Source checks anchored to statement starts so an explanatory comment cannot satisfy them.
  const fs = require('node:fs') as typeof import('node:fs')
  const client = fs.readFileSync('components/app/draft-room/DraftRoomPageClient.tsx', 'utf8')
  const service = fs.readFileSync('lib/live-draft-engine/DraftSessionService.ts', 'utf8')

  it('the room de-duplicates Round 1 announcements by seat, not by row id', () => {
    expect(client).toMatch(/^\s*const seenKey = roundOneAnnouncementKey\(p\)/m)
    expect(client).not.toMatch(/^\s*if \(roundOneSeenPickIdsRef\.current\.has\(p\.id\)\)/m)
    expect(client).not.toMatch(/^\s*for \(const p of picks\) roundOneSeenPickIdsRef\.current\.add\(p\.id\)/m)
  })

  it('the snapshot ships the remapped picks', () => {
    expect(service).toMatch(/^\s*picks: clientPicks,/m)
  })
})
