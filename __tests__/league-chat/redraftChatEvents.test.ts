/**
 * Redraft League chat (batch A4): which messages become league-event cards, and from what data.
 * lib/league-chat/redraftChatEvents.ts. The G42 rows below carry exactly the metadata
 * lib/league-notifications/nflRedraftCommunicationRuntime.ts writes; the Chimmy rows, what
 * chimmyTradeMoment.ts / nativeWeeklyRecap.ts write.
 */
import { describe, expect, it } from 'vitest'
import { readPinnedScore, readRedraftChatEvent, redraftChatEventKind } from '@/lib/league-chat/redraftChatEvents'
import { fixtureMessages } from '@/app/e2e/redraft-league/chat/redraftChatFixture'

const g42 = (messageType: string, eventType: string | null, payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  messageType,
  body: 'Something happened.',
  metadata: {
    isSystem: true,
    g42Communication: true,
    notificationTitle: 'League update',
    ...(eventType ? { relatedRuntimeEventType: eventType, relatedRuntimeEvent: { type: eventType, payload } } : {}),
    ...extra,
  },
})
const chimmy = (messageType: string, extra: Record<string, unknown>) => ({
  messageType,
  body: 'Chimmy says.',
  metadata: { chimmy: true, chimmyMoment: { v: 1, kind: 'trade' }, ...extra },
})

describe('readRedraftChatEvent — authorless league notices become cards', () => {
  it('a trade accepted notice is a trade card labelled from its runtime event', () => {
    const e = readRedraftChatEvent(g42('trade_accepted', 'trade.accepted'))
    expect(e).toMatchObject({ kind: 'trade', presentation: 'card', label: 'Trade accepted', body: 'Something happened.', faab: null, score: null })
  })

  it('labels follow the runtime event, then the stored title, then the type', () => {
    expect(readRedraftChatEvent(g42('trade_notice', 'trade.vetoed'))?.label).toBe('Trade vetoed')
    expect(readRedraftChatEvent(g42('trade_notice', null))?.label).toBe('League update')
    expect(readRedraftChatEvent({ messageType: 'trade_notice', body: 'x', metadata: null })?.label).toBe('Trade')
  })

  it('a won claim shows FAAB only when the payload carries a spend', () => {
    expect(readRedraftChatEvent(g42('waiver_notice', 'waiver.claim.won', { faabSpent: 14 }))).toMatchObject({ kind: 'claim', label: 'Claim won', faab: 14 })
    expect(readRedraftChatEvent(g42('waiver_notice', 'waiver.claim.won', { bidAmount: 7.4 }))?.faab).toBe(7)
    // What canonicalNflRedraftWaiverRuntime.ts actually sends today: no spend, so no FAAB.
    expect(readRedraftChatEvent(g42('waiver_notice', 'waiver.claim.won', { claimId: 'c1', rosterId: 'r1', addPlayerId: 'p1' }))?.faab).toBeNull()
    expect(readRedraftChatEvent(g42('waiver_notice', 'waiver.claim.won', { faabSpent: 0 }))?.faab).toBeNull()
    expect(readRedraftChatEvent(g42('waiver_notice', 'waiver.claim.won', { faabSpent: '14' }))?.faab).toBeNull()
  })

  it('a free-agent add is a claim card and never shows a FAAB spend', () => {
    expect(readRedraftChatEvent(g42('waiver_notice', 'waiver.free_agent.added', { faabSpent: 14 }))).toMatchObject({ kind: 'claim', label: 'Free agent added', faab: null })
  })

  it('a final reads its score line from the payload, names only when the payload has them', () => {
    const named = readRedraftChatEvent(g42('matchup_notice', 'matchup.finalized', { homeScore: 98.6, awayScore: 87.2, homeTeamName: 'A', awayTeamName: 'B' }))
    expect(named).toMatchObject({ kind: 'score', label: 'Final', score: { homeName: 'A', homeScore: 98.6, awayName: 'B', awayScore: 87.2 } })
    const unnamed = readRedraftChatEvent(g42('matchup_notice', 'matchup.finalized', { homeScore: 98.6, awayScore: 87.2 }))
    expect(unnamed?.score).toEqual({ homeName: null, homeScore: 98.6, awayName: null, awayScore: 87.2 })
    expect(readRedraftChatEvent(g42('scoring_notice', 'scoring.updated', { homeScore: 98.6 }))).toMatchObject({ kind: 'score', label: 'Score update', score: null })
    expect(readRedraftChatEvent(g42('scoring_notice', 'scoring.updated', { homeScore: 'NaN', awayScore: 3 }))?.score).toBeNull()
  })

  it('a Chimmy row is never an authorless notice, whatever its type', () => {
    expect(readRedraftChatEvent(chimmy('waiver_notice', {}))).toBeNull()
  })
})

describe('readRedraftChatEvent — Chimmy events stay messages', () => {
  it("Chimmy's trade take with a trade card is a framed bubble", () => {
    const e = readRedraftChatEvent(chimmy('trade', { tradeCard: { manager: 'A' } }))
    expect(e).toMatchObject({ kind: 'trade', presentation: 'bubble' })
  })
  it('a trade row without the card, or not from Chimmy, is an ordinary message', () => {
    expect(readRedraftChatEvent(chimmy('trade', {}))).toBeNull()
    expect(readRedraftChatEvent({ messageType: 'trade', body: 'x', metadata: { tradeCard: { manager: 'A' } } })).toBeNull()
  })
  it('the weekly recap is a framed bubble labelled with its week', () => {
    const recap = { messageType: 'system', body: 'Week 8', metadata: { chimmy: true, chimmyMoment: { v: 1, kind: 'weekly_awards' }, weeklyRecap: true, week: 8 } }
    expect(readRedraftChatEvent(recap)).toMatchObject({ kind: 'recap', presentation: 'bubble', label: 'Week 8 recap' })
    expect(readRedraftChatEvent({ ...recap, metadata: { ...recap.metadata, week: '8' } })?.label).toBe('Week 8 recap')
    expect(readRedraftChatEvent({ ...recap, metadata: { ...recap.metadata, week: undefined } })?.label).toBe('Weekly recap')
  })
})

describe('readRedraftChatEvent — everything else is untouched', () => {
  it('ordinary messages, client types and deleted rows are not events', () => {
    expect(readRedraftChatEvent({ messageType: 'text', body: 'hi', metadata: null })).toBeNull()
    expect(readRedraftChatEvent({ messageType: 'text', body: 'fake', metadata: { notificationTitle: 'Trade accepted', relatedRuntimeEventType: 'trade.accepted' } })).toBeNull()
    expect(readRedraftChatEvent({ messageType: 'gif', body: 'https://x', metadata: null })).toBeNull()
    expect(readRedraftChatEvent({ ...g42('trade_accepted', 'trade.accepted'), metadata: { ...g42('trade_accepted', 'trade.accepted').metadata, deletedAt: '2026-10-31T00:00:00Z' } })).toBeNull()
    expect(readRedraftChatEvent({ messageType: 'broadcast', body: 'hello league', metadata: null })).toBeNull()
  })
  it('redraftChatEventKind is the kind for either presentation', () => {
    expect(redraftChatEventKind(g42('waiver_notice', 'waiver.claim.won'))).toBe('claim')
    expect(redraftChatEventKind(chimmy('trade', { tradeCard: { manager: 'A' } }))).toBe('trade')
    expect(redraftChatEventKind({ messageType: 'text', body: 'hi' })).toBeNull()
  })
})

describe('the harness fixture covers every event kind (it is what the screenshots show)', () => {
  it.each(['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'])('%s', sport => {
    const events = fixtureMessages(sport).map(m => readRedraftChatEvent({ messageType: m.messageType as string, body: m.text as string, metadata: m.metadata as Record<string, unknown> | null }))
    const seen = new Set(events.filter(Boolean).map(e => `${e!.kind}:${e!.presentation}`))
    expect([...seen].sort()).toEqual(['claim:card', 'recap:bubble', 'score:card', 'trade:bubble', 'trade:card'])
    expect(events.some(e => e?.faab === 14)).toBe(true)
    expect(events.filter(e => e === null).length).toBe(4) // the four people talking
  })
})

describe('readPinnedScore — the rail snapshot, never invented', () => {
  const NOW = Date.parse('2026-10-31T20:00:00Z')
  const base = { week: 9, yourTeam: 'Fourth & Long', yourScore: 98.6, opponentTeam: 'Gridiron Ghosts', opponentScore: 87.2, scored: true }
  it('shows both sides and who leads', () => {
    expect(readPinnedScore(base, NOW)).toEqual({
      live: false, week: 9, you: { name: 'Fourth & Long', score: 98.6 }, them: { name: 'Gridiron Ghosts', score: 87.2 }, leader: 'you',
    })
  })
  it('is live only for a live-cache row inside the rail\'s 15-minute window', () => {
    const fresh = new Date(NOW - 5 * 60_000).toISOString()
    const stale = new Date(NOW - 16 * 60_000).toISOString()
    expect(readPinnedScore({ ...base, source: 'live_cache', freshAt: fresh }, NOW)?.live).toBe(true)
    expect(readPinnedScore({ ...base, source: 'live_cache', freshAt: stale }, NOW)?.live).toBe(false)
    expect(readPinnedScore({ ...base, source: 'history_fallback', freshAt: fresh }, NOW)?.live).toBe(false)
    expect(readPinnedScore({ ...base, source: 'live_cache', freshAt: fresh, scored: false }, NOW)?.live).toBe(false)
  })
  it('an unplayed week shows no numbers and no leader', () => {
    expect(readPinnedScore({ ...base, scored: false, yourScore: 0, opponentScore: 0 }, NOW)).toMatchObject({ you: { score: null }, them: { score: null }, leader: null })
  })
  it('a tie has no leader', () => {
    expect(readPinnedScore({ ...base, opponentScore: 98.6 }, NOW)?.leader).toBeNull()
  })
  it('no snapshot, an unpaired week, or a missing name → nothing pinned', () => {
    expect(readPinnedScore(null, NOW)).toBeNull()
    expect(readPinnedScore({ ...base, unpaired: true }, NOW)).toBeNull()
    expect(readPinnedScore({ ...base, opponentTeam: null }, NOW)).toBeNull()
    expect(readPinnedScore({ ...base, yourTeam: '  ' }, NOW)).toBeNull()
  })
})
