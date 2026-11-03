/**
 * Fixture chat for /e2e/redraft-league/chat — harness only (app/e2e is 404 in production).
 *
 * Every row is the WIRE shape `/api/league/chat` returns (toClientMessage: flat `authorName` / `text`)
 * and every event row carries exactly the fields its real producer writes:
 *   - trade_accepted / waiver_notice / matchup_notice: lib/league-notifications/nflRedraftCommunicationRuntime.ts
 *     (metadata.isSystem, notificationTitle, relatedRuntimeEventType, relatedRuntimeEvent.payload),
 *     authored by the league owner because `LeagueChatMessage.userId` is a required FK;
 *   - the Chimmy trade take: lib/league-chat/chimmyTradeMoment.ts (`tradeCard`, messageType 'trade');
 *   - the weekly recap: lib/league-chat/nativeWeeklyRecap.ts (`weeklyRecap`, season, week).
 * ⚠ ONE EXCEPTION, LABELLED: the first claim's payload carries `faabSpent`. The waiver runtime's
 * `waiver.claim.won` event does not send it today (canonicalNflRedraftWaiverRuntime.ts), so a real
 * claim card shows no FAAB; this row exists to show the slot a producer would fill.
 */

type Copy = { tradeIn: string; tradeOut: string; claim: string; fa: string; your: number; their: number; lead: string; top: string }

const COPY: Record<string, Copy> = {
  NFL: { tradeIn: 'Amon-Ra St. Brown', tradeOut: 'Derrick Henry + Jaylen Waddle', claim: 'Tyjae Spears', fa: 'Tucker Kraft', your: 98.6, their: 87.2, lead: '11.4', top: '154.8' },
  NBA: { tradeIn: 'Tyrese Haliburton', tradeOut: 'Derrick White + Jalen Suggs', claim: 'Cam Whitmore', fa: 'Ausar Thompson', your: 612.5, their: 588, lead: '24.5', top: '1,288' },
  NHL: { tradeIn: 'Jack Hughes', tradeOut: 'Igor Shesterkin + Adam Fox', claim: 'Pyotr Kochetkov', fa: 'Logan Cooley', your: 41.7, their: 38.9, lead: '2.8', top: '86.3' },
  MLB: { tradeIn: 'Tarik Skubal', tradeOut: 'Kyle Tucker + Jarren Duran', claim: 'Mason Miller', fa: 'Jackson Merrill', your: 214, their: 201.5, lead: '12.5', top: '402.5' },
  NCAAF: { tradeIn: 'Arch Manning', tradeOut: 'Ollie Gordon + Tre Harris', claim: 'Makhi Hughes', fa: 'Kaidon Salter', your: 104.2, their: 96.7, lead: '7.5', top: '148.9' },
  NCAAB: { tradeIn: 'Cooper Flagg', tradeOut: 'Mark Sears + RJ Luis', claim: 'Tre Johnson', fa: 'Kasparas Jakucionis', your: 388.5, their: 371, lead: '17.5', top: '702' },
  SOCCER: { tradeIn: 'Bukayo Saka', tradeOut: 'Cole Palmer + Alexander Isak', claim: 'Morgan Rogers', fa: 'Antoine Semenyo', your: 64, their: 58, lead: '6', top: '112' },
}

export const FIXTURE_LEAGUE_ID = 'e2e-redraft-chat'
export const FIXTURE_VIEWER_ID = 'u-me'
const OWNER = { authorId: 'u-owner', authorName: 'TheCiege', authorAvatarUrl: null }

export function fixtureCopy(sport: string): Copy {
  return COPY[sport.toUpperCase()] ?? COPY.NFL
}

/** The user's matchup as the rail snapshot carries it (RailMatchupSummary), for the pinned score. */
export function fixtureMatchup(sport: string) {
  const c = fixtureCopy(sport)
  return {
    season: 2026,
    week: 9,
    yourTeam: 'Fourth & Long',
    yourAvatarUrl: null,
    yourScore: c.your,
    opponentTeam: 'Gridiron Ghosts',
    opponentAvatarUrl: null,
    opponentScore: c.their,
    scored: true,
    native: true,
    source: 'live_cache' as const,
    freshAt: new Date().toISOString(),
  }
}

export function fixtureMessages(sport: string): Array<Record<string, unknown>> {
  const c = fixtureCopy(sport)
  const base = Date.now() - 3 * 60 * 60 * 1000
  const at = (min: number) => new Date(base + min * 60_000).toISOString()
  const g42 = (eventType: string, title: string, category: string, payload: Record<string, unknown>) => ({
    isSystem: true,
    g42Communication: true,
    notificationTitle: title,
    category,
    priority: 'medium',
    relatedRuntimeEventType: eventType,
    relatedRuntimeEvent: { type: eventType, leagueId: FIXTURE_LEAGUE_ID, payload },
    discordAuthorName: 'AllFantasy',
  })
  return [
    {
      id: 'fx-trade-accepted', ...OWNER, createdAt: at(0), messageType: 'trade_accepted', source: null, parentMessageId: null,
      text: `Gridiron Ghosts get ${c.tradeIn} · Bench Mob get ${c.tradeOut}`,
      metadata: g42('trade.accepted', 'Trade accepted', 'trades', { summary: `Gridiron Ghosts get ${c.tradeIn} · Bench Mob get ${c.tradeOut}` }),
    },
    {
      id: 'fx-bench', authorId: 'u-bench', authorName: 'Bench Mob', authorAvatarUrl: null, createdAt: at(2), messageType: 'text', source: null, parentMessageId: null,
      text: 'fleeced. absolutely fleeced. see you in the playoffs 😤', metadata: null,
    },
    {
      id: 'fx-chimmy-trade', authorId: null, authorName: 'Chimmy', authorAvatarUrl: null, createdAt: at(4), messageType: 'trade', source: null, parentMessageId: null,
      text: `Gridiron Ghosts consolidated: two starters out, ${c.tradeIn} in. Bench Mob bought depth for the stretch run.`,
      metadata: {
        chimmy: true,
        chimmyMoment: { v: 1, kind: 'trade' },
        tradeCard: {
          transactionId: 'fx-tx-1', manager: 'Gridiron Ghosts', partner: 'Bench Mob', season: 2026, week: 9,
          got: [{ id: 'p1', name: c.tradeIn }], gave: c.tradeOut.split(' + ').map((name, i) => ({ id: `p${i + 2}`, name })),
          picksGave: 0, picksGot: 0,
        },
      },
    },
    {
      id: 'fx-claim-won', ...OWNER, createdAt: at(30), messageType: 'waiver_notice', source: null, parentMessageId: null,
      text: `Taco Tuesday won ${c.claim} on waivers.`,
      metadata: g42('waiver.claim.won', 'Waiver claim won', 'waivers', { teamName: 'Taco Tuesday', addPlayerName: c.claim, week: 9, faabSpent: 14 }),
    },
    {
      id: 'fx-fa-added', ...OWNER, createdAt: at(41), messageType: 'waiver_notice', source: null, parentMessageId: null,
      text: `Waiver Wire Wizards added ${c.fa}.`,
      metadata: g42('waiver.free_agent.added', 'Free agent added', 'waivers', { teamName: 'Waiver Wire Wizards', addPlayerName: c.fa }),
    },
    {
      id: 'fx-own', authorId: FIXTURE_VIEWER_ID, authorName: 'Fourth & Long', authorAvatarUrl: null, createdAt: at(60), messageType: 'text', source: null, parentMessageId: null,
      text: `still up ${c.lead} with 3 to play. relax 🏆`, metadata: null,
    },
    {
      id: 'fx-own-2', authorId: FIXTURE_VIEWER_ID, authorName: 'Fourth & Long', authorAvatarUrl: null, createdAt: at(61), messageType: 'text', source: null, parentMessageId: null,
      text: '@Bench Mob you can have the trophy next year', metadata: null,
    },
    {
      id: 'fx-final', ...OWNER, createdAt: at(120), messageType: 'matchup_notice', source: null, parentMessageId: null,
      text: `Final score: ${c.your}-${c.their}.`,
      metadata: g42('matchup.finalized', 'Matchup finalized', 'matchups', { week: 8, homeScore: c.your, awayScore: c.their, homeTeamName: 'Fourth & Long', awayTeamName: 'Gridiron Ghosts' }),
    },
    {
      id: 'fx-recap', authorId: null, authorName: 'Chimmy', authorAvatarUrl: null, createdAt: at(150), messageType: 'system', source: null, parentMessageId: null,
      text: `Week 8 in Sunday Night Redraft\n\nTop score: Waiver Wire Wizards ${c.top}.\nWorst beat: Bench Mob lost by 0.4.\n\nEvery number here comes from your real matchups.`,
      metadata: { chimmy: true, chimmyMoment: { v: 1, kind: 'weekly_awards' }, weeklyRecap: true, season: '2026', week: 8 },
    },
    {
      id: 'fx-taco', authorId: 'u-taco', authorName: 'Taco Tuesday', authorAvatarUrl: null, createdAt: at(170), messageType: 'text', source: null, parentMessageId: null,
      text: 'fourteen bucks well spent', metadata: null,
    },
  ]
}
