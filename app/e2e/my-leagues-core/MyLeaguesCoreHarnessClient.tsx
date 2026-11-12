'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { MyLeaguesV4 } from '@/components/core-app/screens/MyLeaguesV4'
import type { MyLeaguesLeague, MyLeaguesTier } from '@/lib/core-app/myLeagues'

/**
 * Harness only (app/e2e is 404 in production). The real AfCoreShell with "My Leagues" active and no
 * league selected — what /core/leagues renders — wrapping the real MyLeaguesV4 screen. The league rows
 * are a labelled FIXTURE, not anyone's account.
 */

type Seed = { name: string; platform: string; tier: MyLeaguesTier; reason?: string; tone?: 'bad' | 'warn'; commish?: boolean; dynasty?: boolean; draft?: boolean; format: string }

const SEEDS: Seed[] = [
  { name: 'Dynasty Warlords', platform: 'sleeper', tier: 'needs', reason: '2 STARTERS OUT', tone: 'bad', dynasty: true, commish: true, format: '2026 12-Team Dynasty PPR' },
  { name: 'The Gauntlet', platform: 'espn', tier: 'needs', reason: '1 STARTER OUT', tone: 'bad', format: '2026 10-Team Redraft PPR' },
  { name: 'Empire League', platform: 'sleeper', tier: 'needs', reason: 'DRAFTING', tone: 'warn', draft: true, dynasty: true, format: '2026 14-Team Dynasty' },
  { name: 'Money League', platform: 'sleeper', tier: 'playing', commish: true, format: '2026 12-Team PPR' },
  { name: 'Old Friends', platform: 'yahoo', tier: 'playing', format: '2026 10-Team Standard' },
  { name: 'Hail Mary Club', platform: 'espn', tier: 'playing', format: '2026 12-Team PPR' },
  { name: 'Basement Dwellers', platform: 'sleeper', tier: 'playing', dynasty: true, format: '2026 12-Team Dynasty' },
  ...Array.from({ length: 6 }, (_, i) => ({
    name: `Quiet League ${i + 1}`,
    platform: (['sleeper', 'espn', 'yahoo'] as const)[i % 3],
    tier: 'quiet' as MyLeaguesTier,
    format: '2026 12-Team Redraft',
  })),
]

const LEAGUES: MyLeaguesLeague[] = SEEDS.map((s, i) => ({
  id: `e2e-ml-${i}`,
  name: s.name,
  platform: s.platform,
  imageUrl: null,
  formatLabel: s.format,
  sport: 'NFL',
  usernameInLeague: null,
  chips: [
    ...(s.reason ? [{ label: s.reason, tone: s.tone ?? null }] : []),
    ...(s.commish ? [{ label: 'YOU COMMISH', tone: 'good' as const }] : []),
  ],
  score: null,
  matchupNote: s.tier === 'quiet' ? null : 'No scores read yet',
  projection: null,
  priority: s.tone === 'bad' ? 'urgent' : s.draft ? 'draft' : null,
  href: '#',
  actionLabel: 'Open league',
  tier: s.tier,
  isDynasty: Boolean(s.dynasty),
  isCommissioner: Boolean(s.commish),
  reason: s.reason ?? null,
}))

const COUNTS = {
  live: LEAGUES.length,
  history: 0,
  all: LEAGUES.length,
  needs: LEAGUES.filter((l) => l.tier === 'needs').length,
  playing: LEAGUES.filter((l) => l.tier === 'playing').length,
  quiet: LEAGUES.filter((l) => l.tier === 'quiet').length,
  commissioner: LEAGUES.filter((l) => l.isCommissioner).length,
  drafting: LEAGUES.filter((l) => l.priority === 'draft').length,
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
        coverage={[]}
        notice={null}
        importHref="/import"
      />
    </AfCoreShell>
  )
}
