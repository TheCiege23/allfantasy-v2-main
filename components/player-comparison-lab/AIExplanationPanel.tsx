'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Sparkles, ExternalLink, RefreshCw } from 'lucide-react';
import { getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver';
import type { ComparisonAIInsight } from '@/lib/player-comparison-lab/types';
import { FeatureGate } from '@/components/subscription/FeatureGate';

export interface AIExplanationPanelProps {
  playerNames: string[];
  summaryLines: string[];
  /** Callback to trigger AI analysis (e.g. POST /api/player-comparison/insight). */
  onRetryAnalysis: () => Promise<ComparisonAIInsight | null>;
  /** Initial recommendation if already loaded. */
  initialInsight?: ComparisonAIInsight | null;
}

export function AIExplanationPanel({
  playerNames,
  summaryLines,
  onRetryAnalysis,
  initialInsight = null,
}: AIExplanationPanelProps) {
  const [insight, setInsight] = useState<ComparisonAIInsight | null>(initialInsight ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setInsight(initialInsight ?? null);
  }, [initialInsight]);

  const handleRetry = async () => {
    setError(null);
    setLoading(true);
    try {
      const nextInsight = await onRetryAnalysis();
      setInsight(nextInsight);
    } catch {
      setError("Chimmy's analysis could not load");
    } finally {
      setLoading(false);
    }
  };

  const chimmyPrompt = `Compare these players and give a recommendation: ${playerNames.join(', ')}. Summary: ${summaryLines.slice(0, 3).join(' ')}`;
  const chimmyHref = getChimmyChatHrefWithPrompt(chimmyPrompt);
  const recommendationLabel =
    insight?.finalRecommendationSource === 'deterministic'
      ? 'Final recommendation (deterministic)'
      : insight?.finalRecommendationSource === 'ai'
        ? 'Final recommendation (Chimmy)'
        : 'Final recommendation (OpenAI)';

  return (
    <Card className="border-white/10 bg-white/5" data-audit="ai-explanation-panel">
      <CardHeader>
        <CardTitle className="text-lg text-white">Chimmy&apos;s explanation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FeatureGate
          featureId="player_comparison_explanations"
          featureNameOverride="Chimmy's comparison explanations"
          className="mb-2"
        >
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleRetry}
                disabled={loading}
                className="gap-2 border-white/20"
                data-audit="retry-analysis-button"
                data-testid="retry-analysis-button"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Retry analysis
              </Button>
              <Button variant="outline" className="gap-2 border-white/20" asChild>
                <a href={chimmyHref} data-audit="open-in-chimmy-link" data-testid="open-in-chimmy-link">
                  <ExternalLink className="h-4 w-4" />
                  Open in Chimmy
                </a>
              </Button>
            </div>
            {!insight?.finalRecommendation && !loading && (
              <Button
                onClick={handleRetry}
                disabled={loading}
                className="gap-2"
                data-audit="ai-insight-button"
                data-testid="ai-insight-button"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Get Chimmy&apos;s insight
              </Button>
            )}
          </>
        </FeatureGate>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {insight?.finalRecommendation && (
          <div className="space-y-3" data-testid="comparison-ai-insight-output">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white/90">
              <p className="mb-1 text-xs uppercase tracking-wide text-cyan-300">{recommendationLabel}</p>
              <p data-testid="comparison-ai-final-recommendation">{insight.finalRecommendation}</p>
            </div>
            {insight.deepseekAnalysis && (
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white/80">
                <p className="mb-1 text-xs uppercase tracking-wide text-emerald-300">DeepSeek math edge</p>
                <p data-testid="comparison-ai-deepseek-analysis">{insight.deepseekAnalysis}</p>
              </div>
            )}
            {insight.grokNarrative && (
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white/80">
                <p className="mb-1 text-xs uppercase tracking-wide text-amber-300">Grok narrative context</p>
                <p data-testid="comparison-ai-grok-narrative">{insight.grokNarrative}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
