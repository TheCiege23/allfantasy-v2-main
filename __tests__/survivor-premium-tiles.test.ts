import { describe, expect, it } from 'vitest'

import {
  buildChallengeOutlookTile,
  buildExileStatusTile,
  buildJuryProjectionTile,
  buildSocialPulseTile,
  buildThreatMapTile,
  type PremiumCastRow,
} from '@/lib/survivor/premium/survivorPremiumTiles'
import { SURVIVOR_PREMIUM_COMMAND_TILES, resolveSurvivorPremiumTileAccess } from '@/lib/survivor/survivor-premium-access'

const cast: PremiumCastRow[] = [
  { userId: 'u-ana', displayName: 'Ana', tribeId: 't1', inGame: true, isJuror: false },
  { userId: 'u-bo', displayName: 'Bo', tribeId: 't1', inGame: true, isJuror: false },
  { userId: 'u-cy', displayName: 'Cy', tribeId: 't1', inGame: true, isJuror: false },
  { userId: 'u-di', displayName: 'Di', tribeId: 't2', inGame: true, isJuror: false },
  { userId: 'u-ed', displayName: 'Ed', tribeId: 't1', inGame: false, isJuror: true },
]
const scores = [
  { userId: 'u-ana', finalScore: 120.25, wonIndividualImmunity: false, wonTribeImmunity: true },
  { userId: 'u-bo', finalScore: 90, wonIndividualImmunity: true, wonTribeImmunity: false },
  { userId: 'u-cy', finalScore: 60, wonIndividualImmunity: false, wonTribeImmunity: false },
  { userId: 'u-di', finalScore: 200, wonIndividualImmunity: false, wonTribeImmunity: false },
]
const reads = [
  { week: 3, councilNumber: 1, votedNames: ['Ed', 'Ed', 'Cy'] },
  { week: 4, councilNumber: 1, votedNames: ['Cy', 'Cy', 'Bo'] },
]

describe('threat map', () => {
  it('pre-merge: the viewer’s own tribe, strongest first, with votes drawn at completed reads only', () => {
    const tile = buildThreatMapTile({ viewerUserId: 'u-bo', viewerTribeId: 't1', merged: false, tribeNames: { t1: 'Fire' }, cast, scores, reads })
    expect(tile.scope).toBe('tribe')
    expect(tile.scopeName).toBe('Fire')
    // Ed is out and Di is on another tribe.
    expect(tile.rows.map(r => [r.name, r.seasonPoints, r.votesAgainst, r.threat, r.onTheBlock, r.isYou])).toEqual([
      ['Ana', 120.3, 0, 'high', false, false],
      ['Bo', 90, 1, 'medium', true, true],
      ['Cy', 60, 3, 'low', true, false],
    ])
    expect(tile.lastRead).toEqual({ week: 4, names: [{ name: 'Cy', votes: 2 }, { name: 'Bo', votes: 1 }] })
  })

  it('after the merge, or for a viewer with no tribe, it is everyone still in', () => {
    expect(buildThreatMapTile({ viewerUserId: 'u-bo', viewerTribeId: 't1', merged: true, tribeNames: {}, cast, scores, reads }).rows.map(r => r.name)).toEqual(['Di', 'Ana', 'Bo', 'Cy'])
    expect(buildThreatMapTile({ viewerUserId: 'host', viewerTribeId: null, merged: false, tribeNames: {}, cast, scores, reads }).scope).toBe('cast')
  })

  it('carries names and numbers only, never a user id', () => {
    const json = JSON.stringify(buildThreatMapTile({ viewerUserId: 'u-bo', viewerTribeId: 't1', merged: true, tribeNames: {}, cast, scores, reads }))
    expect(json).not.toMatch(/u-(ana|bo|cy|di|ed)/)
  })
})

describe('social pulse', () => {
  it('counts messages per huddle member, quiet members included, and reads no content', () => {
    const tile = buildSocialPulseTile({
      viewerUserId: 'u-ana',
      channelName: 'Fire huddle',
      members: [{ userId: 'u-ana', displayName: 'Ana' }, { userId: 'u-bo', displayName: 'Bo' }, { userId: 'u-cy', displayName: 'Cy' }],
      messages: [
        { senderUserId: 'u-bo', createdAt: new Date('2026-10-20T10:00:00Z') },
        { senderUserId: 'u-bo', createdAt: new Date('2026-10-21T10:00:00Z') },
        { senderUserId: 'u-ana', createdAt: new Date('2026-10-19T10:00:00Z') },
      ],
    })
    expect(tile).toMatchObject({ available: true, totalMessages: 3, health: 'quiet' })
    if (!tile.available) return
    expect(tile.rows).toEqual([
      { name: 'Bo', isYou: false, messages: 2, lastActiveAt: '2026-10-21T10:00:00.000Z' },
      { name: 'Ana', isYou: true, messages: 1, lastActiveAt: '2026-10-19T10:00:00.000Z' },
      { name: 'Cy', isYou: false, messages: 0, lastActiveAt: null },
    ])
  })

  it('says why when there is no huddle to read', () => {
    expect(buildSocialPulseTile({ viewerUserId: 'u', channelName: null, members: [], messages: [] })).toEqual({ available: false, reason: 'You do not have a tribe huddle right now.' })
  })
})

describe('challenge outlook', () => {
  it('open first, then locked, then settled, with the viewer’s own entry', () => {
    const now = new Date('2026-10-22T12:00:00Z')
    const base = { challengeType: 'score_prop', scope: 'tribe', closesAt: null, rewardType: null, rewardAmount: null }
    const tile = buildChallengeOutlookTile({
      week: 7,
      now,
      challenges: [
        { ...base, id: 'c1', title: 'Settled one', status: 'settled', locksAt: null },
        { ...base, id: 'c2', title: 'Locked one', status: 'open', locksAt: new Date('2026-10-21T00:00:00Z') },
        { ...base, id: 'c3', title: '', status: 'open', locksAt: new Date('2026-10-23T00:00:00Z'), rewardType: 'faab', rewardAmount: 10, scope: 'individual' },
      ],
      submittedChallengeIds: new Set(['c3']),
    })
    expect(tile.items.map(i => [i.title, i.status, i.reward, i.scope, i.youSubmitted])).toEqual([
      ['score prop', 'open', 'faab (10)', 'individual', true],
      ['Locked one', 'locked', null, 'tribe', false],
      ['Settled one', 'settled', null, 'tribe', false],
    ])
  })
})

describe('jury projection', () => {
  it('lists read-out jurors and ranks contenders by immunity, then points, then fewest votes', () => {
    const tile = buildJuryProjectionTile({ viewerUserId: 'u-cy', finalistCount: 3, cast, scores, reads })
    expect(tile.jurors).toEqual(['Ed'])
    expect(tile.remaining).toBe(4)
    expect(tile.contenders.map(c => c.name)).toEqual(['Bo', 'Di', 'Ana', 'Cy'])
    expect(tile.contenders[0].reason).toBe('1 immunity win · 90 season points · 1 vote drawn')
    // A juror whose elimination has not been read yet stays hidden.
    expect(buildJuryProjectionTile({ viewerUserId: 'u-cy', finalistCount: 3, cast: cast.map(c => (c.userId === 'u-ed' ? { ...c, inGame: true } : c)), scores, reads }).jurors).toEqual([])
  })
})

describe('exile status', () => {
  it('shows the viewer’s own tokens only while they are on Exile', () => {
    const base = { enabled: true, returnWeek: 10, tokensNeeded: 4, currentWeek: 8, exileCount: 3 }
    expect(buildExileStatusTile({ ...base, viewer: { onExile: true, tokens: 2 } })).toEqual({ enabled: true, returnWeek: 10, weeksUntilReturn: 2, tokensNeeded: 4, onExile: 3, you: { onExile: true, tokens: 2 } })
    expect(buildExileStatusTile({ ...base, viewer: { onExile: false, tokens: 9 } })).toMatchObject({ you: { onExile: false } })
    expect(JSON.stringify(buildExileStatusTile({ ...base, viewer: { onExile: false, tokens: 9 } }))).not.toContain('9')
    expect(buildExileStatusTile({ ...base, enabled: false, viewer: { onExile: false, tokens: 0 } })).toEqual({ enabled: false })
  })
})

describe('tile access: the one rule the page and the server share', () => {
  it('a live player tile opens with the plan, and refuses without it', () => {
    expect(resolveSurvivorPremiumTileAccess({ tileId: 'threat_map', plan: 'af_pro', isCommissioner: false })).toEqual({ ok: true })
    expect(resolveSurvivorPremiumTileAccess({ tileId: 'threat_map', plan: 'af_supreme', isCommissioner: false })).toEqual({ ok: true })
    expect(resolveSurvivorPremiumTileAccess({ tileId: 'threat_map', plan: null, isCommissioner: true })).toEqual({ ok: false, reason: 'plan_required', requiredPlan: 'af_pro' })
    // AF Commissioner alone is not AF Pro.
    expect(resolveSurvivorPremiumTileAccess({ tileId: 'threat_map', plan: 'af_commissioner', isCommissioner: true })).toMatchObject({ ok: false, reason: 'plan_required' })
  })

  it('unbuilt tiles never open, whatever the plan', () => {
    for (const tile of SURVIVOR_PREMIUM_COMMAND_TILES.filter(t => t.status !== 'live')) {
      expect(resolveSurvivorPremiumTileAccess({ tileId: tile.tileId, plan: 'af_supreme', isCommissioner: true })).toEqual({ ok: false, reason: 'coming_next' })
    }
    expect(resolveSurvivorPremiumTileAccess({ tileId: 'nope', plan: 'af_supreme', isCommissioner: true })).toEqual({ ok: false, reason: 'unknown_tile' })
  })

  it('every live tile has a builder, and no live tile claims token runs that do not exist', () => {
    const live = SURVIVOR_PREMIUM_COMMAND_TILES.filter(t => t.status === 'live')
    expect(live.map(t => t.tileId).sort()).toEqual(['challenge_outlook', 'exile_status', 'jury_projection', 'social_pulse', 'threat_map'])
    expect(SURVIVOR_PREMIUM_COMMAND_TILES.every(t => t.tokenEligible === false)).toBe(true)
  })
})
