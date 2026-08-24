/**
 * Handoff 21a — dev-only preview of the My Leagues view.
 *
 * /leagues renders the same component against the signed-in reader's real
 * portfolio, so the layout at scale (three tiers, overflow tiles, the history
 * toggle) can only be seen by an account that actually has ~60 leagues and ~540
 * imported seasons. This route mounts it with synthetic rows so the handoff can
 * be checked against the mock in one look — the same purpose and the same guard
 * as /dev/states-preview.
 *
 * ⚠ THE FIXTURE BELOW IS SYNTHETIC AND SAYS SO ON SCREEN. It exists to exercise
 * the layout, not to demonstrate data the product has: the tiers here are filled
 * because a preview of an empty screen shows nothing. /leagues itself invents
 * nothing — see the loader header in lib/core-app/myLeagues.ts for what is
 * withheld there and why.
 *
 * ⚠ PRODUCTION-SAFE: 404s outside development, and nothing links to it.
 */

import { notFound } from 'next/navigation'
import { MyLeaguesV4 } from '@/components/core-app/screens/MyLeaguesV4'
import type { MyLeaguesLeague, MyLeaguesTier } from '@/lib/core-app/myLeagues'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'My Leagues preview (21a)',
  robots: { index: false, follow: false },
}

type Seed = {
  name: string
  platform: string
  tier: MyLeaguesTier
  reason?: string | null
  tone?: 'bad' | 'warn' | null
  commish?: boolean
  dynasty?: boolean
  draft?: boolean
  format?: string
  note?: string
}

const SEEDS: Seed[] = [
  // ── Needs you ──────────────────────────────────────────────────────────
  { name: 'Dynasty Warlords', platform: 'sleeper', tier: 'needs', reason: '2 STARTERS OUT', tone: 'bad', dynasty: true, commish: true, format: '2026 12-Team Dynasty PPR' },
  { name: 'The Gauntlet', platform: 'espn', tier: 'needs', reason: '1 STARTER OUT', tone: 'bad', format: '2026 10-Team Redraft PPR' },
  { name: 'Sunday Scaries', platform: 'yahoo', tier: 'needs', reason: '3 STARTERS FLAGGED', tone: 'warn', format: '2026 12-Team Half-PPR' },
  { name: 'Empire League', platform: 'sleeper', tier: 'needs', reason: 'DRAFTING', tone: 'warn', draft: true, dynasty: true, commish: true, format: '2026 14-Team Dynasty' },
  { name: 'Beer & Bad Takes', platform: 'sleeper', tier: 'needs', reason: 'PRE DRAFT', tone: 'warn', draft: true, format: '2026 10-Team Redraft' },
  { name: 'Office Rivals', platform: 'espn', tier: 'needs', reason: '1 FLAGGED', tone: 'warn', format: '2026 8-Team Standard' },
  { name: 'The Syndicate', platform: 'sleeper', tier: 'needs', reason: '2 STARTERS FLAGGED', tone: 'warn', dynasty: true, format: '2026 12-Team Dynasty SF' },

  // ── In season ──────────────────────────────────────────────────────────
  { name: 'Money League', platform: 'sleeper', tier: 'playing', commish: true, format: '2026 12-Team PPR' },
  { name: 'Old Friends', platform: 'yahoo', tier: 'playing', format: '2026 10-Team Standard' },
  { name: 'Hail Mary Club', platform: 'espn', tier: 'playing', format: '2026 12-Team PPR' },
  { name: 'Basement Dwellers', platform: 'sleeper', tier: 'playing', dynasty: true, format: '2026 12-Team Dynasty' },
  { name: 'Fourth & Long', platform: 'sleeper', tier: 'playing', commish: true, format: '2026 14-Team PPR' },
  { name: 'Gridiron Guild', platform: 'espn', tier: 'playing', format: '2026 10-Team Half-PPR' },
  { name: 'Red Zone Regulars', platform: 'yahoo', tier: 'playing', dynasty: true, format: '2026 12-Team Dynasty' },
  { name: 'The Commissioners', platform: 'sleeper', tier: 'playing', commish: true, format: '2026 12-Team PPR' },
  { name: 'Waiver Wire Wolves', platform: 'sleeper', tier: 'playing', format: '2026 10-Team PPR' },
  { name: 'Overtime Owls', platform: 'espn', tier: 'playing', format: '2026 12-Team Standard' },

  // ── Quiet ──────────────────────────────────────────────────────────────
  ...Array.from({ length: 15 }, (_, i) => ({
    name: `Quiet League ${i + 1}`,
    platform: (['sleeper', 'espn', 'yahoo'] as const)[i % 3],
    tier: 'quiet' as MyLeaguesTier,
    dynasty: i % 4 === 0,
    commish: i % 5 === 0,
    format: '2026 12-Team Redraft',
  })),
]

const LEAGUES: MyLeaguesLeague[] = SEEDS.map((s, i) => ({
  id: `preview-${i}`,
  name: s.name,
  platform: s.platform,
  imageUrl: null,
  formatLabel: s.format ?? null,
  sport: 'NFL',
  usernameInLeague: null,
  chips: [
    ...(s.reason ? [{ label: s.reason, tone: s.tone ?? null }] : []),
    ...(s.commish ? [{ label: 'YOU COMMISH', tone: 'good' as const }] : []),
  ],
  score: null,
  matchupNote: s.note ?? (s.tier === 'quiet' ? null : 'No scores read yet'),
  projection: null,
  priority: s.tone === 'bad' ? 'urgent' : s.draft ? 'draft' : null,
  href: '/leagues',
  actionLabel: s.tier === 'needs' ? 'Open league' : 'Open league',
  tier: s.tier,
  isDynasty: Boolean(s.dynasty),
  isCommissioner: Boolean(s.commish),
  reason: s.reason ?? null,
}))

const HISTORY = Array.from({ length: 24 }, (_, i) => ({
  id: `hist-${i}`,
  name: `${2012 + (i % 13)} ${['Dynasty Warlords', 'Old Friends', 'Money League', 'The Gauntlet'][i % 4]}`,
  platform: (['sleeper', 'espn', 'yahoo'] as const)[i % 3],
  season: String(2012 + (i % 13)),
}))

export default function LeaguesPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  const counts = {
    live: LEAGUES.length,
    history: HISTORY.length,
    all: LEAGUES.length + HISTORY.length,
    needs: LEAGUES.filter((l) => l.tier === 'needs').length,
    playing: LEAGUES.filter((l) => l.tier === 'playing').length,
    quiet: LEAGUES.filter((l) => l.tier === 'quiet').length,
    commissioner: LEAGUES.filter((l) => l.isCommissioner).length,
    drafting: LEAGUES.filter((l) => l.priority === 'draft').length,
    dynasty: LEAGUES.filter((l) => l.isDynasty).length,
  }

  return (
    <>
      <p
        style={{
          margin: 0,
          padding: '10px 16px',
          background: '#3a2a12',
          color: '#f6c445',
          font: '700 12px Archivo, system-ui, sans-serif',
        }}
      >
        Handoff 21a preview — synthetic rows, development only. /leagues renders this same
        component against your real portfolio.
      </p>
      <MyLeaguesV4
        leagues={LEAGUES}
        history={HISTORY}
        counts={counts}
        platforms={['espn', 'sleeper', 'yahoo']}
        coverage={[
          { label: 'Live scores', reason: 'no weekly scoring is ingested for imported leagues' },
          { label: 'Records and standings', reason: 'no league result has been read yet' },
          { label: 'Win probability', reason: 'there is no win model behind a league list' },
        ]}
        notice={null}
        importHref="/import"
        syncHref="/leagues/sync"
      />
    </>
  )
}
