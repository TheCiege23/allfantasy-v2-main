import 'server-only'

import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'

import type { MatchupPeriodContext } from '@/lib/league-context-engine/types'

const SLEEPER_STATE = 'https://api.sleeper.app/v1/state'

export async function resolveMatchupPeriod(args: {
  sport: SupportedSport | string
  leagueSeason: number
}): Promise<MatchupPeriodContext> {
  const sport = normalizeToSupportedSport(String(args.sport))

  if (sport === 'NFL') {
    try {
      const st = await fetch(`${SLEEPER_STATE}/nfl`, { next: { revalidate: 60 } })
      if (st.ok) {
        const j = (await st.json()) as { week?: number; season?: string; season_type?: string }
        if (typeof j.week === 'number' && Number.isInteger(j.week) && j.week >= 1 && j.week <= 18 &&
          j.season === String(args.leagueSeason) && j.season_type === 'regular') {
          return {
            season: args.leagueSeason,
            currentPeriod: j.week,
            periodLabel: `NFL week ${j.week}`,
            source: 'sleeper_state_nfl',
          }
        }
      }
    } catch {
      /* fall through */
    }
  }

  return {
    season: args.leagueSeason,
    currentPeriod: 1,
    periodLabel: `${sport} period 1`,
    source: 'league_season_default',
  }
}
