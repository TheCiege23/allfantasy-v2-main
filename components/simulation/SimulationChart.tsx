'use client';

export interface SimulationChartProps {
  /** Expected scores for labels */
  expectedScoreA: number;
  expectedScoreB: number;
  /** Optional distribution samples for histogram (e.g. up to 50 bins) */
  scoreDistributionA?: number[] | null;
  scoreDistributionB?: number[] | null;
  teamAName: string;
  teamBName: string;
  className?: string;
}

function binSamples(samples: number[], min: number, max: number, bins: number): number[] {
  if (samples.length === 0) return new Array(bins).fill(0);
  const range = max - min || 1;
  const counts = new Array(bins).fill(0);
  for (const v of samples) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(((v - min) / range) * bins)));
    counts[idx]++;
  }
  return counts;
}

export function SimulationChart({
  expectedScoreA,
  expectedScoreB,
  scoreDistributionA,
  scoreDistributionB,
  teamAName,
  teamBName,
  className = '',
}: SimulationChartProps) {
  const hasDist = (scoreDistributionA?.length ?? 0) > 0 && (scoreDistributionB?.length ?? 0) > 0;
  const bins = 16;
  const allSamples = hasDist ? [...(scoreDistributionA ?? []), ...(scoreDistributionB ?? [])] : [];
  const min = allSamples.length ? Math.min(...allSamples) : 0;
  const max = allSamples.length ? Math.max(...allSamples) : 100;
  const histA = hasDist ? binSamples(scoreDistributionA!, min, max, bins) : [];
  const histB = hasDist ? binSamples(scoreDistributionB!, min, max, bins) : [];
  const maxCount = Math.max(1, ...histA, ...histB);

  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.03] p-4 ${className}`} data-audit="simulation-chart">
      <div className="flex justify-between text-xs text-white/70 mb-3">
        <span>{teamAName}: {expectedScoreA.toFixed(1)} pts</span>
        <span>{teamBName}: {expectedScoreB.toFixed(1)} pts</span>
      </div>
      {hasDist ? (
        <div className="flex gap-0.5 h-24 items-end">
          {Array.from({ length: bins }, (_, i) => (
            <div key={i} className="flex-1 flex gap-0.5 items-end min-w-0">
              <div
                className="flex-1 bg-cyan-500/60 rounded-t"
                style={{ height: `${(histA[i]! / maxCount) * 100}%` }}
                title={`${histA[i]} sims`}
              />
              <div
                className="flex-1 bg-amber-500/60 rounded-t"
                style={{ height: `${(histB[i]! / maxCount) * 100}%` }}
                title={`${histB[i]} sims`}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="h-20 flex items-center justify-center text-white/40 text-sm">
          Score distribution (run simulation)
        </div>
      )}
      <div className="flex gap-4 mt-2 text-[11px] text-white/50">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-cyan-500/80" /> {teamAName}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-amber-500/80" /> {teamBName}</span>
      </div>
    </div>
  );
}
