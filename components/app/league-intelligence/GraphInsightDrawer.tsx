"use client";

import { useState, useEffect, useCallback } from "react";
import { useUserTimezone } from "@/hooks/useUserTimezone";

type InsightResponse = {
  metricsInterpretation: string | null;
  momentumStoryline: string | null;
  readableSummary: string | null;
  generatedAt?: string;
};

export function GraphInsightDrawer({
  open,
  onClose,
  leagueId,
  season,
  sport,
}: {
  open: boolean;
  onClose: () => void;
  leagueId: string;
  season: number | null;
  sport?: string | null;
}) {
  const { formatInTimezone } = useUserTimezone();
  const [insight, setInsight] = useState<InsightResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInsight = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/graph-insight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "summary", season, sport }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load insight");
        return r.json();
      })
      .then(setInsight)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Error");
        setInsight(null);
      })
      .finally(() => setLoading(false));
  }, [leagueId, season, sport]);

  useEffect(() => {
    setInsight(null);
  }, [leagueId, season, sport]);

  useEffect(() => {
    if (open && !insight && !loading) void fetchInsight();
  }, [open, insight, loading, fetchInsight]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50"
        aria-hidden
        onClick={onClose}
      />
      <div
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-black/95 shadow-xl sm:max-w-lg"
        role="dialog"
        aria-label="Chimmy's graph insight"
      >
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <h3 className="text-lg font-semibold text-white">Chimmy&apos;s Graph Insight</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && <p className="text-sm text-white/60">Generating insight...</p>}
          {error && <p className="text-sm text-red-300">{error}</p>}
          {!loading && !error && insight && (
            <>
              {insight.readableSummary && (
                <div>
                  <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-white/50">Summary (OpenAI)</h4>
                  <p className="text-sm text-white/90">{insight.readableSummary}</p>
                </div>
              )}
              {insight.metricsInterpretation && (
                <div>
                  <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-white/50">Metrics (DeepSeek)</h4>
                  <p className="text-sm text-white/80">{insight.metricsInterpretation}</p>
                </div>
              )}
              {insight.momentumStoryline && (
                <div>
                  <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-white/50">Momentum (Grok)</h4>
                  <p className="text-sm text-white/80">{insight.momentumStoryline}</p>
                </div>
              )}
              {!insight.readableSummary && !insight.metricsInterpretation && !insight.momentumStoryline && (
                <p className="text-sm text-white/50">Chimmy has no insight for this graph yet. Try regenerating in a moment.</p>
              )}
              {insight.generatedAt && (
                <p className="text-xs text-white/40">Generated {formatInTimezone(insight.generatedAt)}</p>
              )}
            </>
          )}
        </div>
        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={() => void fetchInsight()}
            disabled={loading}
            className="w-full rounded-lg border border-white/20 bg-white/5 py-2 text-sm text-white/90 hover:bg-white/10 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Regenerate"}
          </button>
        </div>
      </div>
    </>
  );
}
