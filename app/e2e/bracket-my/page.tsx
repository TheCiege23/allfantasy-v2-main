import { notFound } from 'next/navigation'
import MyBracketsList from '@/components/brackets/MyBracketsList'
import BracketQuickNav from '@/components/brackets/BracketQuickNav'
import type { MyBracketLeague } from '@/lib/playoffs/myBrackets'

/**
 * DB-free render of My Brackets (/brackets/my) — the REAL `MyBracketsList` under the quick nav, exactly as
 * app/brackets/my/page.tsx composes them — over a fixture in place of `listMyBrackets`. Production is refused by
 * app/e2e/layout.tsx; the check below is the redundant second guard.
 *
 *   /e2e/bracket-my            ← five pools across sports and seasons, drafts and finalized brackets
 *   /e2e/bracket-my?state=empty
 *   /e2e/bracket-my?state=failed
 */
const LEAGUES: MyBracketLeague[] = [
  {
    id: 'pool-nba', name: 'Sunday League Playoff Pool', sport: 'nba', seasonYear: 2027,
    entries: [
      { id: 'e1', name: 'Ciege’s Big Board', finalizedAt: new Date('2027-04-19T22:00:00Z'), _count: { picks: 15 } },
      { id: 'e2', name: 'Chalk only', finalizedAt: null, _count: { picks: 9 } },
    ],
  },
  { id: 'pool-cup', name: 'Office NBA Cup Knockout — Third Floor and Friends of the Third Floor', sport: 'nba_cup', seasonYear: 2026, entries: [{ id: 'e3', name: 'Bracket 1', finalizedAt: null, _count: { picks: 0 } }] },
  { id: 'pool-cfp', name: 'CFP Pick’em', sport: 'ncaaf', seasonYear: 2026, entries: [{ id: 'e4', name: 'Roll Tide', finalizedAt: new Date('2026-12-18T22:00:00Z'), _count: { picks: 11 } }] },
  { id: 'pool-nhl', name: 'Hockey Night', sport: 'nhl', seasonYear: 2026, entries: [] },
  { id: 'pool-mlb', name: 'October Baseball', sport: 'mlb', seasonYear: 2025, entries: [{ id: 'e5', name: 'Dodgers in 6', finalizedAt: new Date('2025-09-30T22:00:00Z'), _count: { picks: 15 } }] },
]

export default async function BracketMyHarnessPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { state } = await searchParams
  return (
    <>
      <BracketQuickNav current="my" language="en" />
      <MyBracketsList leagues={state === 'empty' || state === 'failed' ? [] : LEAGUES} language="en" failed={state === 'failed'} />
    </>
  )
}
