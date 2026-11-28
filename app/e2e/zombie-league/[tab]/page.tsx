import { notFound } from 'next/navigation'
import ZombieLeagueHarnessClient from '../ZombieLeagueHarnessClient'
import {
  ZOMBIE_LEAGUE_HARNESS_MOODS,
  ZOMBIE_LEAGUE_HARNESS_TABS,
  type ZombieLeagueHarnessMood,
  type ZombieLeagueHarnessTab,
} from '../fixtures'

/**
 * DB-free render of a native Zombie league's in-league tab for visual review: the real workspace with its
 * zombie banner, and the real ZombieHome / ZombieWarRoomShortcuts, fed by ./fixtures.ts in the browser.
 * Production is refused by app/e2e/layout.tsx (and here, per page). Mode comes from the `af_mode` cookie.
 *
 *   /e2e/zombie-league/zombie?mood=survivor
 *   tab: zombie | war_room      mood: survivor | zombie | turn | whisperer | preseason
 *
 * `turn` is `zombie` plus the once-only "You turned" overlay, which covers the page until dismissed (its
 * seen-key lives in localStorage, so a fresh browser context always shows it).
 */
export default async function ZombieLeagueHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { tab } = await params
  if (!(ZOMBIE_LEAGUE_HARNESS_TABS as readonly string[]).includes(tab)) notFound()
  const sp = await searchParams
  const mood = (ZOMBIE_LEAGUE_HARNESS_MOODS as readonly string[]).includes(sp.mood ?? '') ? (sp.mood as ZombieLeagueHarnessMood) : 'survivor'
  return <ZombieLeagueHarnessClient tab={tab as ZombieLeagueHarnessTab} mood={mood} />
}
