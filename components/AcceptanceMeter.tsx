"use client";

import React, { useState } from "react";

export interface AcceptanceFactor {
  label: string;
  delta: number;
  rationale: string;
}

export interface OptimizationSuggestion {
  type: string;
  description: string;
  expectedImpact: number;
  targetFactor: string;
}

export interface AcceptanceModelData {
  score: number;
  factors: AcceptanceFactor[];
  summary: string;
  optimizations?: OptimizationSuggestion[];
}

function getMeterColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 55) return "text-amber-400";
  if (score >= 35) return "text-orange-400";
  return "text-red-400";
}

function getMeterBg(score: number): string {
  if (score >= 75) return "bg-emerald-500";
  if (score >= 55) return "bg-amber-500";
  if (score >= 35) return "bg-orange-500";
  return "bg-red-500";
}

function getMeterLabel(score: number): string {
  if (score >= 75) return "Likely Accept";
  if (score >= 55) return "Possible";
  if (score >= 35) return "Unlikely";
  return "Very Unlikely";
}

function getFactorColor(delta: number): string {
  if (delta > 0) return "text-emerald-400";
  if (delta < 0) return "text-red-400";
  return "text-white/50";
}

function getFactorSign(delta: number): string {
  if (delta > 0) return "+";
  return "";
}

export default function AcceptanceMeter({
  data,
  compact = false,
  showOptimizations = true,
}: {
  data: AcceptanceModelData;
  compact?: boolean;
  showOptimizations?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showTips, setShowTips] = useState(false);

  const activeFacs = data.factors.filter((f) => f.delta !== 0);
  const sortedFactors = [...activeFacs].sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta)
  );

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <div className="relative w-8 h-8">
            <svg viewBox="0 0 36 36" className="w-8 h-8 -rotate-90">
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="text-white/10"
              />
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeDasharray={`${(data.score / 100) * 97.4} 97.4`}
                strokeLinecap="round"
                className={getMeterColor(data.score)}
              />
            </svg>
            <span
              className={`absolute inset-0 flex items-center justify-center text-[11px] font-bold ${getMeterColor(data.score)}`}
            >
              {data.score}
            </span>
          </div>
          <span className="text-[11px] text-white/60">Accept %</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative w-14 h-14">
            <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="text-white/10"
              />
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeDasharray={`${(data.score / 100) * 97.4} 97.4`}
                strokeLinecap="round"
                className={getMeterColor(data.score)}
              />
            </svg>
            <span
              className={`absolute inset-0 flex items-center justify-center text-lg font-bold ${getMeterColor(data.score)}`}
            >
              {data.score}%
            </span>
          </div>
          <div>
            <div className="text-sm font-medium text-white/90">
              Acceptance Probability
            </div>
            <div
              className={`text-xs font-medium ${getMeterColor(data.score)}`}
            >
              {getMeterLabel(data.score)}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-white/50 hover:text-white/80 transition px-2 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10"
        >
          {expanded ? "Hide" : "Details"}
        </button>
      </div>

      <div className="mt-3">
        <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${getMeterBg(data.score)}`}
            style={{ width: `${data.score}%` }}
          />
        </div>
      </div>

      {!expanded && sortedFactors.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {sortedFactors.slice(0, 4).map((f) => (
            <span
              key={f.label}
              className={`text-[11px] px-2 py-0.5 rounded-full border border-white/10 ${getFactorColor(f.delta)}`}
            >
              {f.label}: {getFactorSign(f.delta)}
              {f.delta}
            </span>
          ))}
        </div>
      )}

      {expanded && (
        <div className="mt-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-white/50 mb-2">
            Factor Breakdown
          </div>
          {sortedFactors.map((f) => (
            <div
              key={f.label}
              className="flex items-start justify-between gap-3 py-1.5 border-b border-white/5 last:border-0"
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-white/80">
                  {f.label}
                </div>
                <div className="text-[11px] text-white/50 mt-0.5">
                  {f.rationale}
                </div>
              </div>
              <span
                className={`text-sm font-semibold whitespace-nowrap ${getFactorColor(f.delta)}`}
              >
                {getFactorSign(f.delta)}
                {f.delta}
              </span>
            </div>
          ))}

          {data.factors.filter((f) => f.delta === 0).length > 0 && (
            <div className="text-[11px] text-white/40 mt-2">
              {data.factors
                .filter((f) => f.delta === 0)
                .map((f) => f.label)
                .join(", ")}{" "}
              — neutral / no data
            </div>
          )}

          <div className="mt-3 text-xs text-white/60 leading-relaxed">
            {data.summary}
          </div>
        </div>
      )}

      {showOptimizations &&
        data.optimizations &&
        data.optimizations.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowTips(!showTips)}
              className="text-xs text-purple-300/80 hover:text-purple-300 transition flex items-center gap-1"
            >
              <span>
                {showTips ? "▾" : "▸"} Improve Acceptance
              </span>
            </button>

            {showTips && (
              <div className="mt-2 space-y-2">
                {data.optimizations.map((opt, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-purple-400/15 bg-purple-500/5 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs text-white/80">
                        {opt.description}
                      </div>
                      <span className="text-[11px] text-emerald-400 whitespace-nowrap font-medium">
                        +{Math.round(opt.expectedImpact)}
                      </span>
                    </div>
                    <div className="text-[11px] text-white/40 mt-1">
                      Targets: {opt.targetFactor}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
    </div>
  );
}
