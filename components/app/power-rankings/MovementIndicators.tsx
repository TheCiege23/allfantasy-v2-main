'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { PowerRankingTeam } from '@/lib/league-power-rankings/types';

interface MovementIndicatorsProps {
  team: PowerRankingTeam;
  className?: string;
}

export function MovementIndicators({ team, className = '' }: MovementIndicatorsProps) {
  const delta = team.rankDelta;
  if (delta == null) return null;
  const movement = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';

  if (movement === 'up') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400 ${className}`}
        data-audit="movement-indicator"
        data-testid={`movement-indicator-${team.rosterId}`}
      >
        <TrendingUp className="h-3.5 w-3.5" />
        +{delta}
      </span>
    );
  }
  if (movement === 'down') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded bg-rose-500/20 px-2 py-0.5 text-xs font-medium text-rose-400 ${className}`}
        data-audit="movement-indicator"
        data-testid={`movement-indicator-${team.rosterId}`}
      >
        <TrendingDown className="h-3.5 w-3.5" />
        {delta}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-xs text-white/60 ${className}`}
      data-audit="movement-indicator"
      data-testid={`movement-indicator-${team.rosterId}`}
    >
      <Minus className="h-3.5 w-3.5" />
      —
    </span>
  );
}
