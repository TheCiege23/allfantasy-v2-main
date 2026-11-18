'use client'

import { useSearchParams } from 'next/navigation'
import type { UserLeague } from '@/app/dashboard/types'
import { MatchupHeaderCard } from '@/components/matchup-center/MatchupHeaderCard'
import { MatchupStarterRow } from '@/components/matchup-center/MatchupStarterRow'
import { TeamTabMatchupBanner } from '@/app/league/[leagueId]/tabs/team-tab-matchup-banner'
import { RosterRow } from '@/app/league/[leagueId]/tabs/TeamTab'
import { TradesTab } from '@/app/league/[leagueId]/tabs/TradesTab'
import { LegacyHome } from '@/components/decide/LegacyHome'
import type { DisplayPlayerMap } from '@/lib/player-data/adapters/redraftDisplayPlayers'
import type { MatchupPlayerSlot, MatchupSidePayload } from '@/lib/matchup-center/types'
import { LEAGUE_SKINS, type LeagueSkin } from '@/lib/league/leagueTypeSkin'
import '@/components/core-app/af-core.css'
import '@/components/league/league-workspace.css'
import '@/components/league/league-type-skin.css'
import { LeagueActivityTab } from '@/components/league/LeagueActivityTab'
import { LeaguePlayerNewsTab } from '@/components/league/LeaguePlayerNewsTab'
import { TeamFuturePicks } from '@/components/league/TeamFuturePicks'
import { LeagueStandings } from '@/components/standings/LeagueStandings'
import { MemberLineupSettings } from '@/components/league/MemberLineupSettings'
import { AutoSwitchOwnerCard } from '@/components/league/AutoSwitchOwnerCard'
import { ScheduleToolsCard } from '@/components/league-settings/ScheduleToolsCard'
import { DivisionSettingsCommissionerPanel } from '@/components/league-settings/DivisionSettingsCommissionerPanel'
import { CopyLeaguePanel } from '@/components/league-settings/CopyLeaguePanel'
import { copyLeagueTeams } from '@/lib/league/copyLeague'
import { SAMPLE_FUTURE_PICKS, SAMPLE_HISTORY, SAMPLE_MATCHUP, SAMPLE_MOVES, SAMPLE_NEWS, SAMPLE_PLAYER_MAP, SAMPLE_ROSTER, SAMPLE_STANDINGS, SAMPLE_TRADE_ROSTERS, SAMPLE_TRADES_PANEL } from './sampleData'

/*
 * Dev-only harness: answer the three reads these surfaces make with SAMPLE DATA, so the page renders
 * without a database. Everything else passes through untouched.
 */
const harnessMembers = {
  native: true,
  teams: [
    { rosterId: 'r1', teamName: 'Kern Dynasty', managerName: '@Anthonyfkern1223', managed: { since: '2026-11-10T00:00:00Z' } as { since: string } | null, emptySeat: false },
    { rosterId: 'r2', teamName: 'Stars & Stripes', managerName: '@Captainameri', managed: null as { since: string } | null, emptySeat: false },
    { rosterId: 'r3', teamName: 'Satterfield FC', managerName: '@Ksatterfield', managed: null as { since: string } | null, emptySeat: false },
    { rosterId: 'r4', teamName: 'Coffey Break', managerName: '@jcoffey1257', managed: null as { since: string } | null, emptySeat: false },
    { rosterId: 'r5', teamName: 'Bricktop', managerName: '@BricktopBill', managed: null as { since: string } | null, emptySeat: false },
    { rosterId: 'r6', teamName: 'Ciege Works', managerName: '@TheCiege24', managed: null as { since: string } | null, emptySeat: false },
  ],
}
const harnessAuto = {
  available: true,
  teams: [
    { rosterId: 'r1', setting: { level: 'doubtful', timing: 'pregame_90' } as { level: string; timing: string } | null, ownerHasPro: true },
    { rosterId: 'r2', setting: null as { level: string; timing: string } | null, ownerHasPro: false },
    { rosterId: 'r3', setting: { level: 'out', timing: 'night_before' } as { level: string; timing: string } | null, ownerHasPro: true },
    { rosterId: 'r4', setting: null as { level: string; timing: string } | null, ownerHasPro: true },
    { rosterId: 'r5', setting: null as { level: string; timing: string } | null, ownerHasPro: true },
    { rosterId: 'r6', setting: null as { level: string; timing: string } | null, ownerHasPro: true },
  ],
}
const harnessInterest: Record<string, number> = { '5003': 4, '5002': 2, '6794': 1, '7002': 11, '7564': 3, '6001': 1 }
// Phase C3 schedule tools: 12 teams, weeks 1–4 played, a circle-method schedule for the rest.
const harnessTeams = ['Blitz Brigade', 'Gridiron Ghosts', 'Taco Tuesday', 'Kingdom North', 'Fourth & Long', 'Red Zone Ray', 'Hail Mary', 'Taxi Squad', 'Bench Mob', 'Waiver Wire', 'Sunday Scaries', 'Dynasty Duke']
const harnessSchedule = {
  playoffStartWeek: 15,
  weeks: Array.from({ length: 14 }, (_, w) => {
    const ids = harnessTeams.map((_, i) => i)
    const rot = [ids[0]!, ...ids.slice(1).map((_, i) => ids[1 + ((i + w) % 11)]!)]
    return {
      week: w + 1,
      locked: w < 4,
      matchups: Array.from({ length: 6 }, (_, i) => ({
        id: `m${w}-${i}`, homeRosterId: `r${rot[i]}`, awayRosterId: `r${rot[11 - i]}`,
        homeName: harnessTeams[rot[i]!]!, awayName: harnessTeams[rot[11 - i]!]!, bye: false,
      })),
    }
  }),
}
// Copy leagues (docs/league-page/COPY_LEAGUES_DESIGN.md): 12 teams, 4 already holding a real NFL team.
let harnessCopy = {
  available: true, enabled: true, locked: false, canManage: true, myLeagueTeamId: 'c3',
  teams: harnessTeams.map((name, i) => ({ leagueTeamId: `c${i}`, teamName: name, ownerName: name, code: ['BUF', 'KC', null, 'PHI', null, 'DET', null, null, null, null, null, null][i] ?? null })),
  catalog: copyLeagueTeams('NFL'),
}
const harnessDivisions = {
  config: { count: 4, names: ['East', 'North', 'South', 'West'], teamAssignments: Object.fromEntries(harnessTeams.map((_, i) => [`t${i}`, i % 4])), aiNamingEnabled: false, rivalsTwice: false, lastUpdatedAt: null, lastUpdatedBy: null },
  isCommissioner: true, isSurvivor: false, sport: 'NFL', leagueVariant: null,
  teams: harnessTeams.map((name, i) => ({ id: `t${i}`, teamName: name, ownerName: name, avatarUrl: null, wins: 2, losses: 2, platformUserId: `p${i}`, isCommissioner: i === 0, isCoCommissioner: false, isOrphan: false, role: 'member' })),
}
if (typeof window !== 'undefined' && !(window as unknown as { __afPhaseAFetch?: boolean }).__afPhaseAFetch) {
  ;(window as unknown as { __afPhaseAFetch?: boolean }).__afPhaseAFetch = true
  const real = window.fetch.bind(window)
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/api/leagues/harness-league/matchup-center')) return json({ payload: SAMPLE_MATCHUP })
    if (url.includes('/api/league/trades-panel')) return json(SAMPLE_TRADES_PANEL)
    if (url.includes('/api/league/history')) return json(SAMPLE_HISTORY)
    if (url.includes('/api/app/leagues/harness-league/chat/moves')) return json(SAMPLE_MOVES)
    if (url.includes('/api/league/roster')) return json(SAMPLE_ROSTER)
    if (url.includes('/api/sleeper/players')) return json(SAMPLE_PLAYER_MAP)
    if (url.includes('/api/leagues/harness-league/player-news')) return json(SAMPLE_NEWS)
    if (url.includes('/api/leagues/harness-league/future-picks')) return json(SAMPLE_FUTURE_PICKS)
    if (url.includes('/api/leagues/harness-league/scoring/standings')) return json(SAMPLE_STANDINGS)
    // Member Settings (#18): Chimmy lineup (inactive manager mode) and auto-switch injured starters.
    if (url.includes('/api/leagues/harness-league/inactive-managers')) {
      if (init?.method === 'POST') {
        const b = JSON.parse(String(init.body ?? '{}')) as { rosterId?: string; on?: boolean }
        const t = harnessMembers.teams.find((x) => x.rosterId === b.rosterId)
        if (t) t.managed = b.on ? { since: new Date().toISOString() } : null
        return json({ managed: Boolean(b.on) })
      }
      return json(harnessMembers)
    }
    if (url.includes('/api/leagues/harness-league/auto-switch-injured')) {
      if (init?.method === 'POST') {
        const b = JSON.parse(String(init.body ?? '{}')) as { rosterId?: string; on?: boolean; level?: string; timing?: string }
        const t = harnessAuto.teams.find((x) => x.rosterId === b.rosterId)
        if (t) t.setting = b.on ? { level: b.level ?? 'out', timing: b.timing ?? 'pregame_90' } : null
        return json({ setting: t?.setting ?? null })
      }
      if (url.includes('scope=league')) return json(harnessAuto)
      return json({ rosterId: 'r1', setting: harnessAuto.teams[0]!.setting, ownerHasPro: true })
    }
    if (url.includes('/api/leagues/harness-league/trades/rosters')) return json(SAMPLE_TRADE_ROSTERS)
    // Trade interest (the AF crest): anonymous counts per player, plus the viewer's own marks.
    if (url.includes('/api/leagues/harness-league/trade-interest')) {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { playerId?: string; interested?: boolean }
        const id = String(body.playerId ?? '')
        harnessInterest[id] = Math.max(0, (harnessInterest[id] ?? 0) + (body.interested ? 1 : -1))
        return json({ ok: true, count: harnessInterest[id] })
      }
      return json({ available: true, counts: harnessInterest, mine: ['5003'] })
    }
    // The trade window's grade preview needs a database; answer "not graded" so the window renders.
    if (url.includes('/api/leagues/harness-league/trades/grade-preview')) return json({ grade: null })
    if (url.includes('/api/redraft/schedule')) {
      if ((init?.method ?? 'GET') === 'GET') {
        // Copy league (part 2): week 5's first pairing is a real game.
        const w5 = harnessSchedule.weeks[4]!.matchups[0]!
        return json({ schedule: harnessSchedule, customWeeks: [8], copyLeague: true, realGames: { '5': [[w5.homeRosterId, w5.awayRosterId]] } })
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string; times?: number }
      if (body.action === 'real_schedule_preview' || body.action === 'real_schedule_apply') {
        return json({ ok: true, weeks: Array.from({ length: 10 }, (_, i) => ({ week: i + 5, loaded: i < 8, real: i < 8 ? 2 + (i % 3) : 0, total: i < 8 ? 6 : 0 })) })
      }
      if (body.action === 'randomize') return json({ ok: true, posted: body.times ?? 1, regeneratedFromWeek: 5 })
      return json({ ok: true })
    }
    if (url.includes('/api/commissioner/leagues/harness-league/division-settings')) return json(harnessDivisions)
    if (url.includes('/api/leagues/harness-league/copy-league')) {
      if ((init?.method ?? 'GET') === 'GET') return json(harnessCopy)
      const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string; code?: string | null; leagueTeamId?: string }
      const id = body.action === 'pick' ? harnessCopy.myLeagueTeamId : body.leagueTeamId
      if (body.action === 'pick' || body.action === 'assign') {
        harnessCopy = { ...harnessCopy, teams: harnessCopy.teams.map((t) => (t.leagueTeamId === id ? { ...t, code: body.code ?? null } : t)) }
      }
      if (body.action === 'enable' || body.action === 'disable') harnessCopy = { ...harnessCopy, enabled: body.action === 'enable' }
      return json({ ok: true, view: harnessCopy })
    }
    return real(input, init)
  }
}

/** SAMPLE DATA — this harness only. */
const slot = (p: Partial<MatchupPlayerSlot> & { playerId: string; name: string; position: string }): MatchupPlayerSlot => ({
  team: null, opponent: null, headshotUrl: null, currentPoints: 0, projectedPoints: 0, hasRealProjection: true,
  afProjectedPoints: null, injuryStatus: null, newsBlurb: null, weatherSummary: null, gameStatus: 'upcoming',
  gameLabel: 'Scheduled', aiInsight: null, ...p,
})

const PLAYERS: DisplayPlayerMap = {
  p1: { id: 'p1', name: 'Brock Purdy', position: 'QB', team: 'SF', projectedPoints: 17.66 },
  p2: { id: 'p2', name: 'Kimani Vidal', position: 'RB', team: 'LAC', projectedPoints: 6.9, injuryStatus: 'Questionable' },
  p3: { id: 'p3', name: 'Matthew Golden', position: 'WR', team: 'GB', projectedPoints: 15.39, byeWeek: 11 },
  p4: { id: 'p4', name: 'Trevin Wallace', position: 'LB', team: 'NYJ', projectedPoints: 1.98, injuryStatus: 'Out' },
  p5: { id: 'p5', name: 'Chris Brazzell II', position: 'WR', team: 'CAR', projectedPoints: 0, injuryStatus: 'Injured Reserve' },
}

/** SAMPLE DATA — an NBA roster for the NG view. */
const NBA_PLAYERS: DisplayPlayerMap = {
  b1: { id: 'b1', name: 'Jalen Brunson', position: 'PG', team: 'NYK', projectedPoints: 44.1 },
  b2: { id: 'b2', name: 'Anthony Edwards', position: 'SG', team: 'MIN', projectedPoints: 46.2 },
  b3: { id: 'b3', name: 'Jayson Tatum', position: 'SF', team: 'BOS', projectedPoints: 47.8, injuryStatus: 'Questionable' },
  b4: { id: 'b4', name: 'Victor Wembanyama', position: 'C', team: 'SAS', projectedPoints: 52.0 },
}

export function LeaguePhaseAHarnessClient() {
  const params = useSearchParams()
  const requested = String(params?.get('skin') ?? 'dynasty')
  const skin: LeagueSkin = (LEAGUE_SKINS as readonly string[]).includes(requested) ? (requested as LeagueSkin) : 'dynasty'
  const view = String(params?.get('view') ?? 'matchup')
  const league = {
    id: 'harness-league', name: 'Defense IDP For Life', sport: 'NFL', season: 2026, teamCount: 16,
    leagueType: skin === 'redraft' ? 'redraft' : 'dynasty', isDynasty: skin !== 'redraft', platform: 'sleeper',
    status: 'in_season', settings: {},
  } as unknown as UserLeague
  const left = SAMPLE_MATCHUP.left as MatchupSidePayload
  const right = SAMPLE_MATCHUP.right as MatchupSidePayload

  return (
    <div data-league-skin={skin} data-league-sport={skin === 'redraft' ? 'nfl' : undefined} data-testid="league-phase-a-harness">
      <div className="af-core af-league-workspace min-h-[100dvh]">
        <main className="af-lsk-main min-h-[100dvh]" data-testid="league-command-center-surface">
          <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-5">
            {view === 'matchup' ? (
              <>
                <MatchupHeaderCard left={left} right={right} matchupStatus="live" winProbabilityLeft={0.46} conceptOverlay={null} />
                <div>
                  {[
                    ['QB', slot({ playerId: 'a1', name: 'Brock Purdy', position: 'QB', team: 'SF', opponent: 'DAL', currentPoints: 31.66, projectedPoints: 22.57, afProjectedPoints: 24.1, gameStatus: 'final', gameLabel: 'W 46-40' }),
                      slot({ playerId: 'b1', name: 'Michael Penix Jr.', position: 'QB', team: 'ATL', opponent: 'KC', currentPoints: 13.34, projectedPoints: 14.92, afProjectedPoints: 13.8, gameStatus: 'final', gameLabel: 'L 13-35' })],
                    ['RB', slot({ playerId: 'a2', name: 'Kimani Vidal', position: 'RB', team: 'LAC', opponent: 'BAL', currentPoints: 3.4, projectedPoints: 6.85, afProjectedPoints: 5.2, injuryStatus: 'Questionable', gameStatus: 'final', gameLabel: 'W 23-20' }),
                      slot({ playerId: 'b2', name: 'Ashton Jeanty', position: 'RB', team: 'LV', opponent: 'SEA', currentPoints: 10.4, projectedPoints: 12, afProjectedPoints: 11.3, gameStatus: 'live', gameLabel: 'Q4 2:03' })],
                    ['WR', slot({ playerId: 'a3', name: 'Matthew Golden', position: 'WR', team: 'GB', opponent: 'MIN', currentPoints: 12, projectedPoints: 15.39, afProjectedPoints: 14, gameStatus: 'final', gameLabel: 'L 10-30' }),
                      slot({ playerId: 'b3', name: 'CeeDee Lamb', position: 'WR', team: 'DAL', opponent: 'SF', currentPoints: 20.2, projectedPoints: 19.98, afProjectedPoints: 21.4, gameStatus: 'final', gameLabel: 'L 40-46' })],
                    ['LB', slot({ playerId: 'a4', name: 'Dorian Williams', position: 'LB', team: 'BUF', opponent: 'NYJ', currentPoints: 27, projectedPoints: 11.07, afProjectedPoints: null, injuryStatus: 'Doubtful', gameStatus: 'final', gameLabel: 'W 31-12' }),
                      slot({ playerId: 'b4', name: 'Mack Wilson Sr.', position: 'LB', team: 'ARI', opponent: 'LAR', currentPoints: 18, projectedPoints: 0, hasRealProjection: false, injuryStatus: 'Out', gameStatus: 'final', gameLabel: 'L 6-34' })],
                  ].map(([pos, l, r]) => (
                    <MatchupStarterRow key={String(pos) + (l as MatchupPlayerSlot).playerId} position={String(pos)} left={l as MatchupPlayerSlot} right={r as MatchupPlayerSlot} />
                  ))}
                </div>
              </>
            ) : null}
            {view === 'team' ? (
              <>
                <TeamTabMatchupBanner leagueId="harness-league" />
                <div className="flex flex-col gap-1">
                  {(['p1', 'p2', 'p3', 'p4', 'p5'] as const).map((id, i) => (
                    <RosterRow
                      key={id}
                      playerId={id}
                      sport="NFL"
                      players={PLAYERS}
                      playersLoading={false}
                      onPlayerClick={() => {}}
                      slotLabel={i === 4 ? 'IR' : i === 3 ? 'BN' : PLAYERS[id].position}
                      week={11}
                      season={2026}
                      byeTeams={new Set<string>()}
                      liveScore={i === 0 ? 0 : null}
                    />
                  ))}
                </div>
              </>
            ) : null}
            {view === 'trades' ? <TradesTab league={league} teams={[]} /> : null}
            {view === 'history' ? <LegacyHome league={league} leagueId="harness-league" /> : null}
            {view === 'activity' ? <LeagueActivityTab leagueId="harness-league" /> : null}
            {view === 'picks' ? <TeamFuturePicks leagueId="harness-league" /> : null}
            {view === 'standings' ? <LeagueStandings leagueId="harness-league" /> : null}
            {view === 'members' ? <MemberLineupSettings leagueId="harness-league" /> : null}
            {view === 'autoswitch' ? <AutoSwitchOwnerCard leagueId="harness-league" /> : null}
            {view === 'schedule' ? <ScheduleToolsCard leagueId="harness-league" /> : null}
            {view === 'divisions' ? <DivisionSettingsCommissionerPanel leagueId="harness-league" /> : null}
            {view === 'copyleague' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <CopyLeaguePanel leagueId="harness-league" mode="mine" />
                <CopyLeaguePanel leagueId="harness-league" mode="commissioner" />
              </div>
            ) : null}
            {view === 'news' ? <LeaguePlayerNewsTab leagueId="harness-league" sport="NFL" /> : null}
            {view === 'ng' ? (
              // NBA roster on a day two clubs have no game: NG in AF blue in the points column.
              <div className="flex flex-col gap-1">
                {(['b1', 'b2', 'b3', 'b4'] as const).map((id, i) => (
                  <RosterRow
                    key={id}
                    playerId={id}
                    sport="NBA"
                    players={NBA_PLAYERS}
                    playersLoading={false}
                    onPlayerClick={() => {}}
                    slotLabel={NBA_PLAYERS[id].position}
                    week={5}
                    season={2026}
                    noGameTeams={new Set(['MIN', 'SAS'])}
                    liveScore={i === 0 ? 31.5 : null}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  )
}
