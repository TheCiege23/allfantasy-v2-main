import type { RecentPerformanceMetrics, TrajectoryDirection } from './types'

export function inferTrajectoryDirection(
  recent: RecentPerformanceMetrics,
  nextYearStrength: number,
  threeYearStrength: number,
): TrajectoryDirection {
  const strengthDelta = threeYearStrength - nextYearStrength
  if (strengthDelta >= 8 && recent.recentWinPct >= 0.5) return 'rising'
  if (strengthDelta <= -8 && recent.recentWinPct <= 0.5) return 'falling'
  return 'flat'
}

