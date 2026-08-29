'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { FlaskConical, Search, Loader2, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SUPPORTED_SPORTS, normalizeToSupportedSport } from '@/lib/sport-scope';
import type {
  MultiPlayerComparisonResult,
  ScoringFormat,
  ComparisonAIInsight,
  LeagueScoringSettings,
} from '@/lib/player-comparison-lab/types';
import { ComparisonMatrix } from './ComparisonMatrix';
import { PlayerStatCards } from './PlayerStatCards';
import { CategoryWinnerHighlights } from './CategoryWinnerHighlights';
import { AIExplanationPanel } from './AIExplanationPanel';
import { SideBySideChart } from './SideBySideChart';
import { InContextMonetizationCard } from '@/components/monetization/InContextMonetizationCard';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

const SCORING_OPTIONS: { value: ScoringFormat; label: string }[] = [
  { value: 'ppr', label: 'PPR' },
  { value: 'half_ppr', label: 'Half-PPR' },
  { value: 'non_ppr', label: 'Non-PPR' },
];

type SearchHit = { name: string; position?: string; team?: string };

type TwoPlayerEnginePayload = {
  sport: string;
  deterministic: {
    recommendedSide: 'playerA' | 'playerB' | 'tie';
    recommendedPlayerName: string | null;
    confidencePct: number;
    basedOn: Array<'stats_comparison'>;
    summary: string;
    statComparisons: Array<{
      metricId: string;
      label: string;
      playerAValue: number | null;
      playerBValue: number | null;
      higherIsBetter: boolean;
      winner: 'playerA' | 'playerB' | 'tie' | 'none';
      edgeScore: number | null;
    }>;
  };
  explanation: {
    source: 'deterministic' | 'ai';
    text: string;
  };
};

type ComparisonApiResponse = MultiPlayerComparisonResult & {
  twoPlayerEngine?: TwoPlayerEnginePayload | null;
};

export function PlayerComparisonPage() {
  const searchParams = useSearchParams();
  const [sport, setSport] = useState<string>(SUPPORTED_SPORTS[0]);
  const [scoringFormat, setScoringFormat] = useState<ScoringFormat>('ppr');
  const [playerSlots, setPlayerSlots] = useState<{ query: string; selected: SearchHit | null }[]>([
    { query: '', selected: null },
    { query: '', selected: null },
  ]);
  const [aiExplanationOnCompareEnabled, setAiExplanationOnCompareEnabled] = useState(false);
  const [searchResults, setSearchResults] = useState<Map<number, SearchHit[]>>(new Map());
  const [comparison, setComparison] = useState<MultiPlayerComparisonResult | null>(null);
  const [initialInsight, setInitialInsight] = useState<ComparisonAIInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!searchParams) return;
    const pa = searchParams.get('playerA')?.trim();
    const pb = searchParams.get('playerB')?.trim();
    const sp = searchParams.get('sport')?.trim();
    if (sp) {
      setSport(normalizeToSupportedSport(sp));
    }
    if (pa || pb) {
      setPlayerSlots((prev) => {
        const next = [...prev];
        if (pa) next[0] = { query: pa, selected: { name: pa } };
        if (pb) next[1] = { query: pb, selected: { name: pb } };
        return next;
      });
    }
  }, [searchParams]);

  const leagueScoringSettings = useMemo<LeagueScoringSettings>(() => {
    const ppr = scoringFormat === 'non_ppr' ? 0 : scoringFormat === 'half_ppr' ? 0.5 : 1;
    return {
      ppr,
      tePremium: scoringFormat === 'ppr' ? 0.25 : 0,
      superflex: false,
      passTdPoints: 4,
    };
  }, [scoringFormat]);

  const searchPlayers = useCallback(async (query: string, slotIndex: number) => {
    if (query.length < 2) {
      setSearchResults((prev) => {
        const next = new Map(prev);
        next.delete(slotIndex);
        return next;
      });
      return;
    }
    const res = await fetch(`/api/instant/player-search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return;
    const data = await res.json();
    const hits = Array.isArray(data)
      ? data.map((p: { name: string; position?: string; team?: string }) => ({
          name: p.name,
          position: p.position,
          team: p.team,
        }))
      : [];
    setSearchResults((prev) => new Map(prev).set(slotIndex, hits));
  }, []);

  const setSlot = useCallback((index: number, query: string, selected: SearchHit | null) => {
    setPlayerSlots((prev) => {
      const next = [...prev];
      next[index] = { query, selected };
      return next;
    });
    setSearchResults((prev) => {
      const next = new Map(prev);
      next.delete(index);
      return next;
    });
  }, []);

  const addPlayer = useCallback(() => {
    setPlayerSlots((prev) => (prev.length >= MAX_PLAYERS ? prev : [...prev, { query: '', selected: null }]));
    setComparison(null);
    setInitialInsight(null);
  }, []);

  const removePlayer = useCallback((index: number) => {
    setPlayerSlots((prev) => {
      if (prev.length <= MIN_PLAYERS) return prev;
      return prev.filter((_, i) => i !== index);
    });
    setSearchResults(new Map());
    setComparison(null);
    setInitialInsight(null);
  }, []);

  const moveSlot = useCallback((index: number, direction: 'up' | 'down') => {
    setPlayerSlots((prev) => {
      const next = [...prev];
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setSearchResults(new Map());
    setComparison(null);
    setInitialInsight(null);
  }, []);

  const runComparison = useCallback(async () => {
    const names = playerSlots.map((s) => s.selected?.name ?? s.query.trim()).filter(Boolean);
    if (names.length < MIN_PLAYERS) {
      setError('Add at least 2 players');
      return;
    }
    setError(null);
    setComparison(null);
    setInitialInsight(null);
    setLoading(true);
    try {
      const res = await fetch('/api/player-comparison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          players: names,
          sport,
          scoringFormat,
          leagueScoringSettings,
          includeAIExplanation: aiExplanationOnCompareEnabled,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? 'Comparison failed');
        return;
      }
      const data: ComparisonApiResponse = await res.json();
      setComparison(data);
      const immediateInsight = data.twoPlayerEngine
        ? {
            finalRecommendation:
              data.twoPlayerEngine.explanation.text || data.twoPlayerEngine.deterministic.summary,
            deepseekAnalysis: null,
            grokNarrative: null,
            openaiSummary:
              data.twoPlayerEngine.explanation.source === 'ai'
                ? data.twoPlayerEngine.explanation.text
                : null,
            finalRecommendationSource: data.twoPlayerEngine.explanation.source,
            providerStatus: {
              deepseek: false,
              grok: false,
              openai: data.twoPlayerEngine.explanation.source === 'ai',
            },
          }
        : null;
      setInitialInsight(immediateInsight);
    } catch {
      setError('Request failed');
    } finally {
      setLoading(false);
    }
  }, [playerSlots, sport, scoringFormat, leagueScoringSettings, aiExplanationOnCompareEnabled]);

  const fetchAiInsight = useCallback(async (): Promise<ComparisonAIInsight | null> => {
    if (!comparison) return null;
    const res = await fetch('/api/player-comparison/insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        players: comparison.players.map((p) => p.name),
        summaryLines: comparison.summaryLines,
        matrix: comparison.matrix,
        categoryWinners: comparison.categoryWinners,
        playerScores: comparison.playerScores,
        sport: comparison.sport,
        scoringFormat: comparison.scoringFormat,
        confirmTokenSpend: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) return null;
    return {
      finalRecommendation:
        data.finalRecommendation ??
        data.recommendation ??
        'Deterministic recommendation available in matrix.',
      deepseekAnalysis: data.providerAnalyses?.deepseek ?? null,
      grokNarrative: data.providerAnalyses?.grok ?? null,
      openaiSummary: data.providerAnalyses?.openai ?? null,
      finalRecommendationSource:
        data.providerAnalyses?.openai || data.providerAnalyses?.deepseek || data.providerAnalyses?.grok
          ? 'ai'
          : 'deterministic',
      providerStatus: {
        deepseek: Boolean(data.providerStatus?.deepseek),
        grok: Boolean(data.providerStatus?.grok),
        openai: Boolean(data.providerStatus?.openai),
      },
    };
  }, [comparison]);

  const playerNames = comparison?.players.map((p) => p.name) ?? [];
  const summaryLines = comparison?.summaryLines ?? [];

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-6 w-6 text-violet-400" />
        <h1 className="text-2xl font-semibold text-white" data-testid="player-comparison-lab-heading">Player Comparison Lab</h1>
      </div>
      <p className="text-sm text-white/60">
        Compare 2–6 players using market value, projections, consistency, and AI insights.
      </p>

      <InContextMonetizationCard
        title="Player AI recommendation access"
        featureId="player_ai_recommendations"
        tokenRuleCodes={[
          'ai_lineup_recommendation_explanation_single',
          'ai_player_comparison_quick_explanation',
        ]}
        testIdPrefix="player-comparison-monetization"
      />

      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white">Players & settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="mb-1 block text-sm text-white/70">Sport</label>
              <Select value={sport} onValueChange={(v) => { setSport(v); setComparison(null); setInitialInsight(null); }}>
                <SelectTrigger className="w-[140px] border-white/10 bg-black/30 text-white" data-testid="sport-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_SPORTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-white/70">Scoring format</label>
              <Select
                value={scoringFormat}
                onValueChange={(v) => { setScoringFormat(v as ScoringFormat); setComparison(null); setInitialInsight(null); }}
              >
                <SelectTrigger
                  className="w-[140px] border-white/10 bg-black/30 text-white"
                  data-audit="scoring-format-select"
                  data-testid="scoring-format-select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCORING_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            {playerSlots.map((slot, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2" data-testid={`player-slot-${index}`}>
                <div className="min-w-[200px] flex-1">
                  <label className="mb-1 block text-sm text-white/70">Player {index + 1}</label>
                  <input
                    type="text"
                    value={slot.query}
                    onChange={(e) => {
                      const q = e.target.value;
                      setPlayerSlots((prev) => {
                        const n = [...prev];
                        n[index] = { ...n[index], query: q };
                        return n;
                      });
                      searchPlayers(q, index);
                    }}
                    onFocus={() => searchPlayers(slot.query, index)}
                    placeholder="Search by name..."
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white placeholder:text-white/40"
                    data-testid={`player-input-${index}`}
                  />
                  {searchResults.get(index) && searchResults.get(index)!.length > 0 && (
                    <ul className="mt-1 max-h-32 overflow-auto rounded border border-white/10 bg-black/40">
                      {searchResults.get(index)!.slice(0, 6).map((p, resultIndex) => (
                        <li key={p.name}>
                          <button
                            type="button"
                            onClick={() => setSlot(index, p.name, p)}
                            className="w-full px-3 py-1.5 text-left text-sm text-white hover:bg-white/10"
                            data-testid={`player-search-result-${index}-${resultIndex}`}
                          >
                            {p.name}
                            {(p.position || p.team) && (
                              <span className="ml-2 text-white/50">
                                {p.position}
                                {p.team ? ` · ${p.team}` : ''}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="border-white/20"
                    onClick={() => moveSlot(index, 'up')}
                    disabled={index === 0}
                    data-audit="swap-order-up"
                    data-testid={`swap-player-up-${index}`}
                    aria-label="Move up"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="border-white/20"
                    onClick={() => moveSlot(index, 'down')}
                    disabled={index === playerSlots.length - 1}
                    data-audit="swap-order-down"
                    data-testid={`swap-player-down-${index}`}
                    aria-label="Move down"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="border-white/20"
                    onClick={() => removePlayer(index)}
                    disabled={playerSlots.length <= MIN_PLAYERS}
                    data-audit="remove-player-button"
                    data-testid={`remove-player-button-${index}`}
                    aria-label="Remove player"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {playerSlots.length < MAX_PLAYERS && (
            <Button
              type="button"
              variant="outline"
              onClick={addPlayer}
              className="gap-2 border-white/20"
              data-audit="add-player-button"
              data-testid="add-player-button"
            >
              <Plus className="h-4 w-4" />
              Add player
            </Button>
          )}

          <Button
            onClick={runComparison}
            disabled={loading}
            className="gap-2"
            data-audit="compare-player-button"
            data-testid="compare-player-button"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Compare players
          </Button>

          <label className="flex items-center gap-2 text-sm text-white/80" data-testid="ai-on-compare-toggle-row">
            <input
              type="checkbox"
              checked={aiExplanationOnCompareEnabled}
              onChange={(event) => setAiExplanationOnCompareEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-black/20"
              data-testid="ai-on-compare-toggle"
            />
            Include AI explanation on compare (optional)
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </CardContent>
      </Card>

      {comparison && (
        <>
          <Card className="border-white/10 bg-white/5" data-testid="comparison-source-coverage">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-white">Deterministic data sources</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-xs text-white/70 sm:grid-cols-2 lg:grid-cols-3">
              <p>FantasyCalc: {comparison.sourceCoverage.fantasyCalc ? 'yes' : 'no'}</p>
              <p>Sleeper: {comparison.sourceCoverage.sleeper ? 'yes' : 'no'}</p>
              <p>ESPN injuries: {comparison.sourceCoverage.espnInjuryFeed ? 'yes' : 'no'}</p>
              <p>Internal ADP: {comparison.sourceCoverage.internalAdp ? 'yes' : 'no'}</p>
              <p>Market ADP: {comparison.sourceCoverage.marketAdp ? 'yes' : 'no'}</p>
              <p>Internal projections: {comparison.sourceCoverage.internalProjections ? 'yes' : 'no'}</p>
              <p>League scoring settings: {comparison.sourceCoverage.leagueScoringSettings ? 'yes' : 'no'}</p>
            </CardContent>
          </Card>
          <SideBySideChart matrix={comparison.matrix} players={comparison.players} />
          <ComparisonMatrix matrix={comparison.matrix} players={comparison.players} />
          <CategoryWinnerHighlights highlights={comparison.categoryWinners} />
          <PlayerStatCards players={comparison.players} scores={comparison.playerScores} />
          <AIExplanationPanel
            playerNames={playerNames}
            summaryLines={summaryLines}
            onRetryAnalysis={fetchAiInsight}
            initialInsight={initialInsight}
          />
        </>
      )}
    </main>
  );
}
