/**
 * A pending Sleeper offer exists only on the manager's phone — no feed, no email (Guap, 2026-09-30) —
 * so a screenshot of it is read and placed on the league's rosters. These pin the two pure halves:
 * the parser that bounds what a vision model returned, and the matcher that decides which side is
 * the viewer's and refuses to guess a name.
 *
 * The fixture is the real Pirate League twinty trade (2026 wk 4): TheCiege24 received Case Keenum,
 * Justin Herbert, Rhamondre Stevenson and Matthew Golden for Joe Burrow and Romeo Doubs.
 */
import { describe, expect, it } from 'vitest'

import { parseOfferRead, type OfferRead } from '@/lib/trade-screenshot/offerRead'
import { findRosterPlayer, matchOfferToRosters, normalizePlayerName, screenshotDraftNote } from '@/lib/trade-screenshot/matchOffer'
import { rosterManagerHandles } from '@/lib/trade-screenshot/managerHandles'
import type { LeagueRoster } from '@/components/core-app/screens/useLeagueRosters'

const player = (id: string, name: string, position = 'QB') => ({
  id, name, position, team: null, imageUrl: null, byeWeek: null, injuryStatus: null, value: 1000,
})

const roster = (rosterId: string, ownerName: string, players: ReturnType<typeof player>[], picks: LeagueRoster['picks'] = []): LeagueRoster => ({
  rosterId, platformUserId: rosterId, players, picks, teamExternalId: rosterId, ownerName, avatarUrl: null,
  wins: 0, losses: 0, ties: 0, faabRemaining: 100, canReceiveProposal: true,
})

const ME = roster('1', 'TheCiege24', [player('6770', 'Joe Burrow'), player('8121', 'Romeo Doubs', 'WR'), player('4034', 'Tyrone Tracy Jr.', 'RB')], [
  { pickId: 'p-2027-1', season: 2027, round: 1, label: '2027 1st', itemType: 'future_pick', value: 2900 },
])
const HIBBO = roster('2', 'Hibboisthebest', [
  player('1737', 'Case Keenum'), player('6797', 'Justin Herbert'), player('7611', 'Rhamondre Stevenson', 'RB'), player('12501', 'Matthew Golden', 'WR'),
])
const OTHER = roster('3', 'cstanhope12', [player('9997', 'Zay Flowers', 'WR')])
const ROSTERS = [ME, HIBBO, OTHER]

const offer = (teams: Array<{ name: string | null; receives: string[] }>): OfferRead => ({
  kind: 'offer',
  unreadable: [],
  teams: teams.map((t) => ({ name: t.name, receives: t.receives.map((name) => ({ type: 'player' as const, name, position: null })) })),
})

describe('parseOfferRead — the model reply, bounded', () => {
  it('reads the JSON even with prose or a code fence around it', () => {
    const text = 'Here you go:\n```json\n{"isTradeOffer":true,"teams":[{"name":"A","receives":[{"type":"player","name":"Joe Burrow","position":"qb"},{"type":"pick","year":2027,"round":1},{"type":"faab","amount":"$35"}]}],"unreadable":[]}\n```'
    const r = parseOfferRead(text)
    expect(r).toEqual({
      kind: 'offer',
      unreadable: [],
      teams: [{ name: 'A', receives: [
        { type: 'player', name: 'Joe Burrow', position: 'QB' },
        { type: 'pick', year: 2027, round: 1, originalOwner: null },
        { type: 'faab', amount: 35 },
      ] }],
    })
  })

  it('a non-offer, garbage, or an empty read is never an offer', () => {
    expect(parseOfferRead('{"isTradeOffer":false,"teams":[]}')).toEqual({ kind: 'not_a_trade' })
    expect(parseOfferRead('I cannot help with that.')).toEqual({ kind: 'unparseable' })
    expect(parseOfferRead('{"teams": "nope"}')).toEqual({ kind: 'unparseable' })
    expect(parseOfferRead('{"isTradeOffer":true,"teams":[{"name":"A","receives":[]}]}')).toEqual({ kind: 'not_a_trade' })
    expect(parseOfferRead(null)).toEqual({ kind: 'unparseable' })
  })

  it('drops assets that do not fit the shape instead of inventing one', () => {
    const r = parseOfferRead('{"isTradeOffer":true,"teams":[{"name":"A","receives":[{"type":"player","name":""},{"type":"trophy"},{"type":"faab","amount":-5},{"type":"pick","year":"2027","round":9},{"type":"player","name":"Real Guy"}]}]}')
    expect(r.kind === 'offer' && r.teams[0]!.receives).toEqual([
      { type: 'pick', year: 2027, round: 9, originalOwner: null },
      { type: 'player', name: 'Real Guy', position: null },
    ])
  })
})

describe('normalizePlayerName / findRosterPlayer', () => {
  it('suffixes and punctuation do not split one man into two', () => {
    expect(normalizePlayerName('Tyrone Tracy, Jr.')).toBe(normalizePlayerName('Tyrone Tracy'))
    expect(findRosterPlayer(ME, 'Tyrone Tracy')?.id).toBe('4034')
  })

  it('"J. Burrow" matches only when one player fits', () => {
    expect(findRosterPlayer(ME, 'J. Burrow')?.id).toBe('6770')
    expect(findRosterPlayer(ME, 'Q. Williams')).toBeNull()
  })
})

describe('matchOfferToRosters — the players decide the sides', () => {
  const REAL = offer([
    { name: 'Hibboisthebest', receives: ['Joe Burrow', 'Romeo Doubs'] },
    { name: 'TheCiege24', receives: ['Case Keenum', 'Justin Herbert', 'Rhamondre Stevenson', 'Matthew Golden'] },
  ])

  it('the real Pirate League twinty offer: what I send, what I get, and who from', () => {
    const m = matchOfferToRosters({ read: REAL, rosters: ROSTERS, viewerRosterId: '1' })
    expect(m.ok && m.partnerRosterId).toBe('2')
    expect(m.ok && m.give.map((a) => a.kind === 'player' && a.playerId)).toEqual(['6770', '8121'])
    expect(m.ok && m.get.map((a) => a.kind === 'player' && a.playerId)).toEqual(['1737', '6797', '7611', '12501'])
    expect(m.ok && m.unmatched).toEqual([])
  })

  it('works with the columns in either order and the team labels unreadable', () => {
    const swapped = offer([
      { name: null, receives: ['Case Keenum', 'Justin Herbert', 'Rhamondre Stevenson', 'Matthew Golden'] },
      { name: null, receives: ['Joe Burrow', 'Romeo Doubs'] },
    ])
    const m = matchOfferToRosters({ read: swapped, rosters: ROSTERS, viewerRosterId: '1' })
    expect(m.ok && m.partnerRosterId).toBe('2')
    expect(m.ok && m.give).toHaveLength(2)
    expect(m.ok && m.get).toHaveLength(4)
  })

  /*
   * The viewer's OWN player alone must decide the sides. In the real offer the partner's four players
   * outvote a reversed reading of the viewer's two, so without this case that half of the rule could
   * be inverted with every test still green (it was — measured by mutation).
   */
  it('a player-for-picks offer: my own player alone decides which side is mine', () => {
    const read: OfferRead = {
      kind: 'offer',
      unreadable: [],
      teams: [
        { name: null, receives: [{ type: 'player', name: 'Joe Burrow', position: 'QB' }] },
        { name: null, receives: [{ type: 'pick', year: 2027, round: 1, originalOwner: null }] },
      ],
    }
    const m = matchOfferToRosters({ read, rosters: ROSTERS, viewerRosterId: '1' })
    expect(m.ok && m.give.map((a) => a.kind === 'player' && a.playerId)).toEqual(['6770'])
    // No player of theirs and no legible label: who sent it is the manager's to pick, and the pick is named.
    expect(m.ok && m.partnerRosterId).toBeNull()
    expect(m.ok && m.unmatched).toEqual(['2027 round 1 pick'])
    expect(m.ok ? screenshotDraftNote(m) : '').toMatch(/Pick the manager who sent it/)
  })

  /*
   * The real Sleeper DM card (AFC Dreaming!, 2026-09-30): "@TheCiege24 — 2028 2nd Rd (JeffersonTD)",
   * "@JeffersonTD — B. Allen RB-NYJ". Each @section is what that manager GETS; the bracket is the
   * pick's original owner. The viewer receives only a pick, so no player of the partner's can name
   * him — the pick's owner does.
   */
  it('the Sleeper DM card: an abbreviated name, and the partner named by the pick’s original owner', () => {
    const me = roster('1', 'TheCiege24', [player('11588', 'Braelon Allen', 'RB'), player('6770', 'Joe Burrow')])
    const jeff = roster('4', 'JeffersonTD', [player('9999', 'Somebody Else', 'WR')])
    const card: OfferRead = {
      kind: 'offer',
      unreadable: [],
      teams: [
        { name: '@TheCiege24', receives: [{ type: 'pick', year: 2028, round: 2, originalOwner: 'JeffersonTD' }] },
        { name: '@JeffersonTD', receives: [{ type: 'player', name: 'B. Allen', position: 'RB' }] },
      ],
    }
    const m = matchOfferToRosters({ read: card, rosters: [me, jeff, OTHER], viewerRosterId: '1' })
    expect(m.ok && m.partnerRosterId).toBe('4')
    expect(m.ok && m.give.map((a) => a.kind === 'player' && a.playerId)).toEqual(['11588'])
    expect(m.ok && m.get).toEqual([expect.objectContaining({ kind: 'pick', year: 2028, round: 2 })])
    expect(m.ok && m.unmatched).toEqual([])

    // Unreadable labels: the pick's owner still names the partner.
    const anon = { ...card, teams: card.teams.map((t) => ({ ...t, name: null })) }
    expect(matchOfferToRosters({ read: anon, rosters: [me, jeff, OTHER], viewerRosterId: '1' })).toMatchObject({ ok: true, partnerRosterId: '4' })
  })

  /*
   * The bug that test above hid: there the roster's label IS the manager's name. On an imported league
   * the roster is labelled with the Sleeper TEAM name ("Jeff the Great") while the DM card names the
   * manager, so the partner was never found (2026-09-30, AFC Dreaming!). The manager rides on `ownerHandles`.
   */
  it('the DM card names the manager; the roster is labelled with the team name', () => {
    const me = { ...roster('1', 'Ciege', [player('11588', 'Braelon Allen', 'RB')]), ownerHandles: ['TheCiege24'] }
    const jeff = { ...roster('4', 'Jeff the Great', [player('9999', 'Somebody Else', 'WR')]), ownerHandles: ['JeffersonTD'] }
    const card: OfferRead = {
      kind: 'offer',
      unreadable: [],
      teams: [
        { name: '@TheCiege24', receives: [{ type: 'pick', year: 2028, round: 2, originalOwner: 'JeffersonTD' }] },
        { name: '@JeffersonTD', receives: [{ type: 'player', name: 'B. Allen', position: 'RB' }] },
      ],
    }
    const m = matchOfferToRosters({ read: card, rosters: [me, jeff, OTHER], viewerRosterId: '1' })
    expect(m.ok && m.partnerRosterId).toBe('4')
    // Control: without the handle nothing links them — the pick stays for the manager to add.
    const bare = matchOfferToRosters({ read: card, rosters: [me, { ...jeff, ownerHandles: [] }, OTHER], viewerRosterId: '1' })
    expect(bare.ok && bare.partnerRosterId).toBeNull()
    // Labels alone (no pick owner) find the partner through the handle too.
    const labelled: OfferRead = { ...card, teams: [{ name: '@TheCiege24', receives: [{ type: 'faab', amount: 5 }] }, card.teams[1]!] }
    expect(matchOfferToRosters({ read: labelled, rosters: [me, jeff, OTHER], viewerRosterId: '1' })).toMatchObject({ partnerRosterId: '4' })
  })

  it('rosterManagerHandles: the stored manager name, the account name and the import names, deduped', () => {
    expect(rosterManagerHandles({ import: { ownerName: 'JeffersonTD', displayName: 'JeffersonTD' } }, ['JeffersonTD', 'jeff_account']))
      .toEqual(['JeffersonTD', 'jeff_account'])
    expect(rosterManagerHandles({ import: { ownerName: 'JeffersonTD' } })).toEqual(['JeffersonTD'])
    expect(rosterManagerHandles({ source_provider: 'sleeper' }, [null, undefined])).toEqual([])
    expect(rosterManagerHandles(null)).toEqual([])
  })

  it('reads the bracketed original owner off a pick', () => {
    const r = parseOfferRead('{"isTradeOffer":true,"teams":[{"name":"@TheCiege24","receives":[{"type":"pick","year":2028,"round":2,"originalOwner":"@JeffersonTD"}]}]}')
    expect(r.kind === 'offer' && r.teams[0]!.receives[0]).toEqual({ type: 'pick', year: 2028, round: 2, originalOwner: 'JeffersonTD' })
  })

  it('a name on no roster is listed for the manager — never swapped for a lookalike', () => {
    const typo = offer([
      { name: 'Hibboisthebest', receives: ['Joe Burrow', 'Romeo Doubbs'] },
      { name: 'TheCiege24', receives: ['Justin Herbert'] },
    ])
    const m = matchOfferToRosters({ read: typo, rosters: ROSTERS, viewerRosterId: '1' })
    expect(m.ok && m.give.map((a) => a.kind === 'player' && a.name)).toEqual(['Joe Burrow'])
    expect(m.ok && m.unmatched).toEqual(['Romeo Doubbs (not on TheCiege24 roster)'])
    expect(m.ok ? screenshotDraftNote(m) : '').toMatch(/add by hand before you analyze: Romeo Doubbs/)
  })

  it('picks come off the right roster; FAAB carries across', () => {
    const read: OfferRead = {
      kind: 'offer',
      unreadable: [],
      teams: [
        { name: 'Hibboisthebest', receives: [{ type: 'pick', year: 2027, round: 1, originalOwner: null }, { type: 'faab', amount: 20 }] },
        { name: 'TheCiege24', receives: [{ type: 'player', name: 'Justin Herbert', position: 'QB' }] },
      ],
    }
    const m = matchOfferToRosters({ read, rosters: ROSTERS, viewerRosterId: '1' })
    expect(m.ok && m.give).toEqual([
      expect.objectContaining({ kind: 'pick', year: 2027, round: 1, pickId: 'p-2027-1', value: 2900 }),
      { kind: 'faab', amount: 20 },
    ])
  })

  it('with no players to vote, the team labels decide — and a label nobody matches is refused', () => {
    const picksOnly: OfferRead = {
      kind: 'offer',
      unreadable: [],
      teams: [
        { name: 'The Ciege 24', receives: [{ type: 'faab', amount: 5 }] },
        { name: 'Hibboisthebest', receives: [{ type: 'pick', year: 2027, round: 1, originalOwner: null }] },
      ],
    }
    const m = matchOfferToRosters({ read: picksOnly, rosters: ROSTERS, viewerRosterId: '1' })
    expect(m.ok && m.partnerRosterId).toBe('2')
    const anon = { ...picksOnly, teams: picksOnly.teams.map((t) => ({ ...t, name: null })) }
    expect(matchOfferToRosters({ read: anon, rosters: ROSTERS, viewerRosterId: '1' })).toMatchObject({ ok: false })
  })

  it('refuses what it cannot place: no viewer team, one side, three teams, not a trade', () => {
    expect(matchOfferToRosters({ read: REAL, rosters: ROSTERS, viewerRosterId: null })).toMatchObject({ ok: false })
    expect(matchOfferToRosters({ read: offer([{ name: 'A', receives: ['Joe Burrow'] }]), rosters: ROSTERS, viewerRosterId: '1' })).toMatchObject({ ok: false })
    const three = offer([{ name: 'A', receives: ['Joe Burrow'] }, { name: 'B', receives: ['Justin Herbert'] }, { name: 'C', receives: ['Zay Flowers'] }])
    expect(matchOfferToRosters({ read: three, rosters: ROSTERS, viewerRosterId: '1' })).toMatchObject({ ok: false, reason: expect.stringMatching(/more than two teams/) })
    expect(matchOfferToRosters({ read: { kind: 'not_a_trade' }, rosters: ROSTERS, viewerRosterId: '1' })).toMatchObject({ ok: false })
  })
})
