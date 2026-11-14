'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { MyLeaguesV4 } from '@/components/core-app/screens/MyLeaguesV4'
import type { MyLeaguesLeague } from '@/lib/core-app/myLeagues'
import { leagueTier } from '@/lib/core-app/myLeaguesGuide'

/**
 * Harness only (app/e2e is 404 in production). The real AfCoreShell with "My Leagues" active and no
 * league selected — what /core/leagues renders — wrapping the real MyLeaguesV4 screen. The league rows
 * are a labelled FIXTURE, not anyone's account.
 */

type Seed = {
  name: string
  platform: string
  /** The 34a chip that leads the card ("1 STARTER OUT", "2 FLAGGED", "PRE DRAFT" …). */
  reason?: string
  tone?: 'bad' | 'warn' | 'live'
  urgent?: boolean
  commish?: boolean
  dynasty?: boolean
  draft?: boolean
  over?: boolean
  format: string
  matchup?: MyLeaguesLeague['matchup']
  action?: string
}

const wk = (opponent: string, you?: number, them?: number): MyLeaguesLeague['matchup'] => ({
  week: 10, scored: you != null, yourScore: you ?? 0, opponentScore: them ?? 0, opponent, unpaired: false,
})

// A labelled FIXTURE shaped like the owner's account on 2026-11-14: a few leagues with a starter out, more
// with a questionable one, many with only bench injuries, and a block waiting on their drafts.
const SEEDS: Seed[] = [
  { name: 'Dynasty Warlords', platform: 'sleeper', reason: '2 STARTERS OUT', tone: 'bad', urgent: true, dynasty: true, commish: true, format: '2026 · 12-team · Dynasty PPR', matchup: wk('Wounded Warriors Project', 20.3, 18.1), action: 'See who is flagged' },
  { name: 'The Gauntlet', platform: 'espn', reason: '1 STARTER OUT', tone: 'bad', urgent: true, format: '2026 · 10-team · Redraft PPR', matchup: wk('Hustead'), action: 'See who is flagged' },
  { name: 'Empire League', platform: 'sleeper', reason: 'DRAFTING', tone: 'live', draft: true, dynasty: true, format: '2026 · 14-team · Dynasty', action: 'Draft HQ' },
  { name: 'Beta Zombie League', platform: 'sleeper', reason: '1 STARTER FLAGGED', tone: 'warn', format: '2026 · 20-team · Zombie', matchup: wk('Peakychu'), action: 'See who is flagged' },
  { name: 'Draft Junkies Dynasty', platform: 'sleeper', reason: '2 STARTERS FLAGGED', tone: 'warn', commish: true, dynasty: true, format: '2026 · 12-team · Dynasty', matchup: wk('ducksngoats', 4.5, 0), action: 'See who is flagged' },
  { name: 'Money League', platform: 'sleeper', reason: '3 FLAGGED', tone: 'warn', commish: true, format: '2026 · 12-team · PPR', matchup: wk('Inglorious Staffords'), action: 'See who is flagged' },
  { name: 'Old Friends', platform: 'yahoo', format: '2026 · 10-team · Standard', matchup: wk('Vault Tech', 61.2, 55.0) },
  { name: 'Hail Mary Club', platform: 'espn', reason: '1 FLAGGED', tone: 'warn', format: '2026 · 12-team · PPR', matchup: wk('Nicolodeon'), action: 'See who is flagged' },
  ...Array.from({ length: 4 }, (_, i) => ({
    name: `Startup League ${i + 1}`,
    platform: (['sleeper', 'allfantasy'] as const)[i % 2],
    reason: 'PRE DRAFT',
    tone: 'warn' as const,
    commish: i === 0,
    format: '2026 · 12-team · Redraft',
    action: 'Draft HQ',
  })),
  { name: 'Last Year Champs', platform: 'sleeper', over: true, format: '2025 · 12-team · Redraft' },
]

const LEAGUES: MyLeaguesLeague[] = SEEDS.map((s, i) => {
  const chips = [
    ...(s.reason ? [{ label: s.reason, tone: s.tone ?? null }] : []),
    ...(s.over ? [{ label: 'SEASON OVER', tone: null }] : []),
    ...(s.commish ? [{ label: 'YOU COMMISH', tone: 'good' as const }] : []),
  ] as MyLeaguesLeague['chips']
  const base = {
    id: `e2e-ml-${i}`,
    name: s.name,
    platform: s.platform,
    imageUrl: null,
    formatLabel: s.format,
    sport: 'NFL',
    usernameInLeague: null,
    chips,
    score: null,
    matchupNote: s.matchup ? null : s.over ? null : 'No scores read yet',
    matchup: s.matchup ?? null,
    projection: null,
    priority: s.urgent ? 'urgent' : s.draft ? 'draft' : null,
    href: '#',
    actionLabel: s.action ?? 'Open league',
    isDynasty: Boolean(s.dynasty),
    isCommissioner: Boolean(s.commish),
    reason: s.reason ?? null,
  } as Omit<MyLeaguesLeague, 'tier'>
  return { ...base, tier: leagueTier(base) } as MyLeaguesLeague
})

const COUNTS = {
  live: LEAGUES.length,
  history: 492,
  all: LEAGUES.length + 492,
  needs: LEAGUES.filter((l) => l.tier === 'needs').length,
  playing: LEAGUES.filter((l) => l.tier === 'playing').length,
  quiet: LEAGUES.filter((l) => l.tier === 'quiet').length,
  predraft: LEAGUES.filter((l) => l.tier === 'predraft').length,
  commissioner: LEAGUES.filter((l) => l.isCommissioner).length,
  drafting: LEAGUES.filter((l) => l.priority === 'draft' || (l.chips ?? []).some((c) => c.label === 'PRE DRAFT')).length,
  dynasty: LEAGUES.filter((l) => l.isDynasty).length,
}

export default function MyLeaguesCoreHarnessClient() {
  const rail = LEAGUES.slice(0, 8).map((l) => ({
    id: l.id,
    name: l.name,
    platform: String(l.platform),
    mark: l.name.slice(0, 2).toUpperCase(),
    sport: 'NFL',
  }))
  return (
    <AfCoreShell
      active="my-leagues"
      leagues={rail}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <MyLeaguesV4
        leagues={LEAGUES}
        history={[]}
        counts={COUNTS}
        platforms={['espn', 'sleeper', 'yahoo']}
        coverage={[{ label: 'Records and standings', reason: 'no league result has been read yet' }]}
        notice={null}
        importHref="/import"
      />
    </AfCoreShell>
  )
}
