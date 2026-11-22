/**
 * SportStrategyResolver – sport-aware strategy labels and detection config.
 * Strategy logic adapts to each sport's roster, draft, and scoring context.
 */
import type { StrategySport, StrategyType } from './types'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'

/** Human-readable strategy label per sport (analogous concepts across sports). */
const STRATEGY_LABELS: Record<StrategyType, string> = {
  ZeroRB: 'Zero RB / Defer primary',
  HeroRB: 'Hero RB / One elite at key position',
  EarlyQB: 'Early QB / Early premium position',
  LateQB: 'Late QB / Late premium position',
  EliteTE: 'Elite TE / Early specialist',
  BalancedBuild: 'Balanced build',
  StarsAndScrubsBuild: 'Stars-and-scrubs build',
  DepthHeavyBuild: 'Depth-heavy build',
  GoaliePitcherHeavyBuild: 'Goalie/Pitcher-heavy build',
  RookieHeavyBuild: 'Rookie-heavy build',
  VeteranHeavyBuild: 'Veteran-heavy build',
  StackingStrategies: 'Stacking strategies',
}

/** Sport-specific strategy label overrides (e.g. "Zero FWD" for soccer). */
const SPORT_STRATEGY_OVERRIDES: Partial<Record<StrategySport, Partial<Record<StrategyType, string>>>> = {
  SOCCER: {
    ZeroRB: 'Zero FWD',
    HeroRB: 'Hero FWD',
    EarlyQB: 'Early MID',
    LateQB: 'Late MID',
    EliteTE: 'Early GKP',
  },
  NBA: {
    ZeroRB: 'Zero SG/SF',
    HeroRB: 'Hero wing',
    EarlyQB: 'Early PG',
    LateQB: 'Late PG',
  },
  NHL: {
    ZeroRB: 'Zero forward',
    HeroRB: 'Hero forward',
    GoaliePitcherHeavyBuild: 'Goalie-heavy build',
  },
  MLB: {
    ZeroRB: 'Zero SP/P',
    HeroRB: 'Hero ace',
    EarlyQB: 'Early ace',
    LateQB: 'Late ace',
    GoaliePitcherHeavyBuild: 'Pitcher-heavy build',
  },
  NCAAB: {
    ZeroRB: 'Zero F/C',
    HeroRB: 'Hero big',
    EarlyQB: 'Early G',
    LateQB: 'Late G',
  },
}

/**
 * Resolve display label for a strategy type in a sport context.
 */
export function getStrategyLabelForSport(strategyType: StrategyType, sport: StrategySport): string {
  const overrides = SPORT_STRATEGY_OVERRIDES[sport]
  if (overrides && overrides[strategyType]) return overrides[strategyType]!
  return STRATEGY_LABELS[strategyType] ?? String(strategyType)
}

/**
 * Normalize sport for strategy meta (falls back to the default sport).
 */
export function resolveSportForStrategy(sport: string | null | undefined): StrategySport {
  return normalizeToSupportedSport(sport ?? DEFAULT_SPORT)
}
