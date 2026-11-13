'use client'

import { useMemo, useState } from 'react'
import {
  buildAllTimeStandings,
  buildDraftGroups,
  buildGeneralGroups,
  buildNotificationGroups,
  buildRosterItems,
  buildTypeRuleGroups,
  buildWaiverGroups,
  groupScoringRules,
  HUB_KIND_META,
  type HubKind,
  type HubSettingsPayload,
} from '@/lib/league-settings-hub/hubModel'
import { LeagueSettingsHubView, type HubTabId, type HubViewData } from '@/components/league-settings/hub/LeagueSettingsHubView'

const KINDS: HubKind[] = ['redraft', 'dynasty', 'keeper', 'best_ball', 'guillotine', 'devy', 'c2c', 'salary_cap', 'survivor', 'big_brother', 'zombie', 'tournament']
const MANAGERS = ['BlitzKing22', 'LateRoundQB', 'WaiverWizard', 'GridironGhost', 'DynastyDon', 'TacoTuesdayFF', 'RedZoneRita', 'NightOwlGM', 'FourthAndLong', 'CommishCarl', 'HailMaryHank', 'BenchMob']
const TEAMS = ['Blitz Brigade', 'Late Round Legends', 'Wizards of Waivers', 'Ghost Protocol', "Don's Dynasty", 'Taco Tuesday', 'Red Zone Royalty', 'Night Owls', 'Fourth & Long', "Carl's Kingdom", 'Hail Mary Heroes', 'Bench Mob']

function fixturePayload(kind: HubKind): HubSettingsPayload {
  const carry = HUB_KIND_META[kind].carriesOver
  return {
    canEdit: true,
    settingsSnapshot: {
      trade_review_mode: kind === 'redraft' ? 'commissioner' : 'league_vote',
      commissioner_notes: kind === 'redraft' ? '' : 'Trade deadline is firm. Lineups lock at kickoff of each game.',
      conceptSetup: kind === 'survivor' ? { tribeCount: 4, playersPerTribe: 4, idolCount: 2, tribeShuffle: false } : kind === 'guillotine' ? { teamsPerChop: 1, chopTiming: 'after_stat_corrections', dangerMargin: 10 } : kind === 'big_brother' ? { nominees: 2, vetoPlayers: 6, juryAfterEvictions: 3 } : kind === 'zombie' ? { serumsToRevive: 2, ambushesPerWeek: 1, whisperer: 'random' } : kind === 'salary_cap' ? { salaryCap: 250, capGrowthPct: 5, maxContractYears: 4, deadMoneyPct: 25 } : undefined,
    },
    league: {
      id: 'kn-2026', name: 'Kingdom North', sport: 'NFL', season: 2026, timezone: 'America/New_York',
      teamCount: kind === 'zombie' ? 20 : kind === 'guillotine' ? 18 : 12, scoring: kind === 'best_ball' ? 'Half PPR' : 'PPR',
      tradeDeadlineWeek: 11, tradeReviewHours: 24, draftPickTrading: carry || kind === 'keeper', preventBenchDrops: false,
      irSlots: kind === 'best_ball' ? 0 : 2, irAllowOut: true, irAllowDoubtful: kind !== 'best_ball', allowPreDraftMoves: true, lockAllMoves: false,
      playoffTeams: 6, playoffStartWeek: 15, playoffWeeksPerRound: 1, playoffSeedingRule: 'record_then_points', playoffLowerBracket: 'consolation',
      medianGame: kind === 'redraft' ? false : undefined,
      waiverType: kind === 'zombie' ? 'none' : 'faab', waiverBudget: kind === 'guillotine' ? 1000 : 100, waiverMinBid: 0, waiverClearAfterGames: true, waiverHours: 24,
      customDailyWaivers: kind !== 'zombie', waiverProcessTime: '3:00 AM',
      waiverSchedule: { mon: 'waivers_to_fa', tue: 'waivers', wed: 'waivers', thu: 'waivers_to_fa', fri: 'waivers', sat: 'waivers', sun: 'waivers_to_fa' },
      taxiSlots: carry ? (kind === 'devy' || kind === 'c2c' ? 6 : 4) : undefined, taxiAllowNonRookies: false, taxiYearsLimit: 1, taxiDeadlineWeek: 8,
      keeperCount: kind === 'keeper' ? 3 : undefined, keeperMaxYears: 3, keeperCostSystem: 'round_based', keeperRoundPenalty: 1, keeperWaiverAllowed: true, keeperConflictRule: 'player_chooses', keeperMissedDeadlineRule: 'auto_no_keepers', keeperSelectionDeadline: '2027-08-30T23:00:00Z',
      teams: [],
    },
    settings: { draftType: kind === 'salary_cap' ? 'auction' : kind === 'dynasty' ? 'linear' : 'snake', rounds: kind === 'dynasty' ? 4 : 15, pickTimerPreset: '60s', draftDateUtc: '2026-11-19T01:00:00Z', autostart: true, cpuAutoPick: true, alphabeticalSort: false, playerPool: kind === 'dynasty' ? 'rookies_only' : 'all' },
    scoringConfig: {
      formatType: 'ppr',
      rules: [
        { statKey: 'pass_yd', pointsValue: 0.04, enabled: true }, { statKey: 'pass_td', pointsValue: 4, enabled: true }, { statKey: 'pass_int', pointsValue: -1, enabled: true }, { statKey: 'pass_2pt', pointsValue: 2, enabled: true }, { statKey: 'pass_cmp', pointsValue: 0.1, enabled: true },
        { statKey: 'rush_yd', pointsValue: 0.1, enabled: true }, { statKey: 'rush_td', pointsValue: 6, enabled: true }, { statKey: 'rush_2pt', pointsValue: 2, enabled: true },
        { statKey: 'rec', pointsValue: kind === 'best_ball' ? 0.5 : 1, enabled: true }, { statKey: 'rec_yd', pointsValue: 0.1, enabled: true }, { statKey: 'rec_td', pointsValue: 6, enabled: true },
        { statKey: 'fgm_0_19', pointsValue: 3, enabled: true }, { statKey: 'fgm_50p', pointsValue: 5, enabled: true }, { statKey: 'xpm', pointsValue: 1, enabled: true },
        { statKey: 'def_int', pointsValue: 2, enabled: true }, { statKey: 'def_td', pointsValue: 6, enabled: true }, { statKey: 'sack', pointsValue: 1, enabled: true },
        { statKey: 'fum_lost', pointsValue: -2, enabled: true },
      ],
    },
  }
}

function fixtureRoster(kind: HubKind) {
  const pro: Record<string, number> = { QB: 1, RB: 2, WR: kind === 'dynasty' || kind === 'best_ball' ? 3 : 2, TE: 1, FLEX: kind === 'guillotine' ? 2 : 1 }
  if (HUB_KIND_META[kind].carriesOver) pro.SUPER_FLEX = 1
  if (!HUB_KIND_META[kind].carriesOver && kind !== 'best_ball') { pro.K = 1; pro.DEF = 1 }
  pro.BN = kind === 'dynasty' || kind === 'devy' ? 15 : kind === 'best_ball' ? 10 : 6
  if (kind !== 'best_ball') pro.IR = 2
  if (HUB_KIND_META[kind].carriesOver) pro.TAXI = kind === 'dynasty' ? 4 : 6
  if (kind === 'devy') pro.DEVY = 6
  const sections = [{ key: 'pro', label: 'Pro roster', slots: pro }]
  if (kind === 'c2c') sections.push({ key: 'college', label: 'College roster', slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BN: 13 } })
  return { rosterConfig: { sections } }
}

export function HubPreviewClient({ type, role, tab }: { type: string; role: 'commish' | 'manager'; tab: string }) {
  const [kind, setKind] = useState<HubKind>((KINDS as string[]).includes(type) ? (type as HubKind) : 'redraft')
  const [commish, setCommish] = useState(role === 'commish')
  const [muted, setMuted] = useState<string[]>([])
  const [leagueOn, setLeagueOn] = useState(true)
  const [co, setCo] = useState<Record<string, boolean>>({ t10: true })
  const [note, setNote] = useState<string | null>(null)

  const data: HubViewData = useMemo(() => {
    const p = fixturePayload(kind)
    p.canEdit = commish
    const groups = buildNotificationGroups(kind, commish)
    const on: Record<string, boolean> = {}
    for (const g of groups) for (const r of g.rows) on[r.id] = !muted.includes(r.id) && r.id !== 'league_drama'
    return {
      leagueId: 'kn-2026', kind, leagueName: 'Kingdom North', leagueAvatarUrl: null, sport: 'NFL', season: 2026,
      teamCount: Number(p.league?.teamCount), leagueArt: null, canEdit: commish, isHeadCommissioner: commish, importedFrom: null,
      myTeam: { name: 'Ghost Protocol', avatarUrl: null },
      notifications: { groups, on, leagueEnabled: leagueOn },
      general: buildGeneralGroups(p, kind), waivers: buildWaiverGroups(p, kind), typeRules: buildTypeRuleGroups(p, kind),
      commissionerNote: note ?? (p.settingsSnapshot?.commissioner_notes as string) ?? null,
      roster: buildRosterItems(fixtureRoster(kind), []),
      scoring: { preset: kind === 'best_ball' ? 'Half PPR' : 'PPR', categories: groupScoringRules(p.scoringConfig?.rules) },
      draft: buildDraftGroups(p),
      draftOrder: MANAGERS.map((m, i) => ({ slot: i + 1, name: MANAGERS[(i * 5 + 3) % 12] })),
      members: MANAGERS.map((m, i) => ({ id: `t${i + 1}`, name: m, teamName: TEAMS[i], avatarUrl: null, isCommissioner: i === 3, isCoCommissioner: Boolean(co[`t${i + 1}`]), isYou: i === 3 })),
      coOwners: { rosterId: 'r4', invitations: [{ id: 'c1', name: 'SundayScaries', accepted: true }, { id: 'c2', name: 'FlexFiend', accepted: false }] },
      invite: { link: commish ? 'https://allfantasy.ai/join/7Q2K9X41' : null, filled: 12, capacity: 12 },
      draftHistory: { title: kind === 'dynasty' ? '2026 Rookie Draft' : '2026 Season Draft', status: 'pre draft · snake · 15 rounds' },
      seasons: [2025, 2024, 2023, 2022].map((y, i) => ({ year: y, champion: MANAGERS[i * 2], runnerUp: MANAGERS[i * 2 + 1] })),
      standings: buildAllTimeStandings(MANAGERS.map((m, i) => ({ managerName: m, managerAvatar: null, totalWins: 46 - i * 2, totalLosses: 24 + i * 2, totalTies: 0, winPct: (46 - i * 2) / 70, totalPoints: 6412.3 - i * 61.4, seasonsPlayed: 5, championships: i < 4 ? 1 : 0 }))),
      highScores: MANAGERS.slice(0, 8).map((m, i) => ({ rank: i + 1, holder: m, season: 2025 - (i % 4), value: (212.68 - i * 3.4).toFixed(2) })),
    }
  }, [kind, commish, muted, leagueOn, co, note])

  return (
    <div style={{ minHeight: '100vh', background: '#050814', fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 14px', borderBottom: '1px dashed #262c6a', background: '#070c1e' }} data-testid="hub-preview-controls">
        {KINDS.map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={k === kind} style={{ minHeight: 32, padding: '0 10px', borderRadius: 16, border: `1px solid ${k === kind ? '#ff3d81' : '#262c6a'}`, background: k === kind ? 'rgba(255,61,129,.15)' : 'transparent', color: '#e6edf7', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{HUB_KIND_META[k].label}</button>
        ))}
        <button type="button" onClick={() => setCommish((c) => !c)} style={{ marginLeft: 'auto', minHeight: 32, padding: '0 12px', borderRadius: 16, border: '1px solid #262c6a', background: '#12163e', color: '#e6edf7', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{commish ? 'Viewing as commissioner' : 'Viewing as manager'}</button>
      </div>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '16px 14px 48px' }}>
        <LeagueSettingsHubView
          key={kind + String(commish)}
          data={data}
          initialTab={(['my', 'setup', 'members', 'record'].includes(tab) ? tab : 'setup') as HubTabId}
          advanced={commish ? { label: 'Advanced settings', onOpen: () => {} } : undefined}
          cb={{
            onToggleSetting: () => {},
            onSaveTeamName: async () => null,
            onSaveNote: async (t) => { setNote(t); return null },
            onToggleNotification: (id, isOn) => setMuted((m) => (isOn ? m.filter((x) => x !== id) : [...m, id])),
            onToggleLeagueNotifications: setLeagueOn,
            onToggleCoCommissioner: (id, next) => setCo((c) => ({ ...c, [id]: next })),
            onInviteCoOwner: async () => null,
            onOpenEditor: () => {},
            onLeaveLeague: () => {},
            onCopy: () => {},
          }}
        />
      </div>
    </div>
  )
}
