'use client';

import { TrendingUp, TrendingDown } from 'lucide-react';
import type { ScenarioScore } from '@/lib/simulation-engine/types';

interface UpsideDownsideCardsProps {
  upsideScenario: ScenarioScore | null | undefined;
  downsideScenario: ScenarioScore | null | undefined;
  teamAName: string;
  teamBName: string;
  className?: string;
}

export function UpsideDownsideCards({
  upsideScenario,
  downsideScenario,
  teamAName,
  teamBName,
  className = '',
}: UpsideDownsideCardsProps) {
  if (!upsideScenario && !downsideScenario) return null;

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${className}`} data-audit="upside-downside-cards">
      {upsideScenario && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm mb-2">
            <TrendingUp className="h-4 w-4" />
            Upside scenario (90th %)
          </div>
          <div className="flex justify-between text-lg">
            <span className="text-white">{teamAName}: {upsideScenario.teamA.toFixed(1)}</span>
            <span className="text-white">{teamBName}: {upsideScenario.teamB.toFixed(1)}</span>
          </div>
        </div>
      )}
      {downsideScenario && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
          <div className="flex items-center gap-2 text-rose-400 font-medium text-sm mb-2">
            <TrendingDown className="h-4 w-4" />
            Downside scenario (10th %)
          </div>
          <div className="flex justify-between text-lg">
            <span className="text-white">{teamAName}: {downsideScenario.teamA.toFixed(1)}</span>
            <span className="text-white">{teamBName}: {downsideScenario.teamB.toFixed(1)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
