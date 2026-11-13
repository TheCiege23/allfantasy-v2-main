'use client';

interface WinProbabilityMeterProps {
  winProbabilityA: number;
  winProbabilityB: number;
  teamAName: string;
  teamBName: string;
  className?: string;
}

export function WinProbabilityMeter({
  winProbabilityA,
  winProbabilityB,
  teamAName,
  teamBName,
  className = '',
}: WinProbabilityMeterProps) {
  const pctA = Math.min(100, Math.max(0, winProbabilityA * 100));
  const pctB = Math.min(100, Math.max(0, winProbabilityB * 100));

  return (
    <div className={`space-y-2 ${className}`} data-audit="win-probability-meter">
      <div className="flex justify-between text-xs text-white/60">
        <span title={teamAName}>{teamAName}</span>
        <span title={teamBName}>{teamBName}</span>
      </div>
      <div className="h-4 rounded-full bg-white/10 overflow-hidden flex">
        <div
          className="bg-cyan-500/80 transition-all duration-300"
          style={{ width: `${pctA}%` }}
        />
        <div
          className="bg-amber-500/80 transition-all duration-300"
          style={{ width: `${pctB}%` }}
        />
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-cyan-400 font-medium">
          {pctA >= 99 ? '99+' : pctA.toFixed(1)}%
        </span>
        <span className="text-amber-400 font-medium">
          {pctB >= 99 ? '99+' : pctB.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
