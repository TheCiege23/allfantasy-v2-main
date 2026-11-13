'use client';

import { useCallback, useMemo, useState } from 'react';
import { readPlanRefusal } from '@/lib/monetization/planRefusal'
import Link from 'next/link';
import { Loader2, GraduationCap } from 'lucide-react';
import { usePlayerComparisonUIOptional } from '@/components/player-comparison-ui';
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { CoachAdviceType, CoachExplanation, CoachRecommendation } from '@/lib/ai-coach/types';
import { ProjectionDisplay } from '@/components/weather/ProjectionDisplay';

type AdviceTypeOption = {
  id: CoachAdviceType;
  label: string;
};

const ADVICE_TYPE_OPTIONS: AdviceTypeOption[] = [
  { id: 'start_sit', label: 'Start/Sit advice' },
  { id: 'lineup_optimization', label: 'Lineup optimization' },
  { id: 'draft', label: 'Draft advice' },
  { id: 'trade', label: 'Trade advice' },
  { id: 'waiver', label: 'Waiver advice' },
];

type CoachAdviceResult = {
  type: CoachAdviceType;
  summary: string;
  bullets: string[];
  challenge: string;
  tone: 'motivational' | 'cautious' | 'celebration' | 'neutral';
  recommendation?: CoachRecommendation;
  explanation?: CoachExplanation;
};

type LineupOptimizerResult = {
  sport: string;
  totalProjectedPoints: number;
  starters: Array<{
    slotId: string;
    slotCode: string;
    slotLabel: string;
    playerId: string;
    playerName: string;
    playerTeam?: string;
    projectedPoints: number;
    selectedPosition: string;
  }>;
  bench: Array<{
    playerId: string;
    playerName: string;
    projectedPoints: number;
    positions: string[];
  }>;
  unfilledSlots: Array<{
    slotId: string;
    slotCode: string;
    slotLabel: string;
  }>;
  deterministicNotes: string[];
};

type LineupOptimizerExplanation = {
  summary: string;
  bullets: string[];
  source: 'ai' | 'deterministic';
};

type LineupDecisionExplanation = {
  summary: string;
  bullets: string[];
  source: 'ai' | 'deterministic';
};

/** Premium start/sit JSON from `POST /api/lineup/optimize` (validated server-side). */
type LineupDecisionEnginePayload = Record<string, unknown>;

type LineupOptimizationResponse = {
  ok: boolean;
  deterministic: boolean;
  result: LineupOptimizerResult;
  explanation: LineupOptimizerExplanation;
  decisionEngine?: LineupDecisionEnginePayload | null;
  decisionExplanation?: LineupDecisionExplanation | null;
};

export type CoachAdviceRequester = (input: {
  type: CoachAdviceType;
  leagueId?: string;
  leagueName?: string;
  week?: number;
  teamName?: string;
  sport?: string;
  leagueSettings?: {
    sport?: string;
    scoringFormat?: string;
    teamCount?: number;
    rosterSlots?: string[];
  };
  matchupData?: {
    opponentName?: string;
    opponentProjection?: number;
    teamProjection?: number;
    spread?: number;
    notes?: string;
  };
  roster?: {
    playerName: string;
    position?: string;
    team?: string;
    projectedPoints?: number;
    slot?: string;
  }[];
  playerStats?: {
    playerName: string;
    position?: string;
    projectedPoints?: number;
  }[];
}) => Promise<CoachAdviceResult>;

export type LineupOptimizationRequester = (input: {
  leagueId?: string;
  sport?: string;
  useAIExplanation?: boolean;
  players: Array<{
    id?: string;
    name: string;
    team?: string;
    projectedPoints?: number;
    positions?: string[];
    position?: string;
  }>;
  rosterSlots?: string[];
}) => Promise<LineupOptimizationResponse>;

interface CoachAdvicePanelProps {
  leagueId?: string;
  leagueName?: string;
  week?: number;
  teamName?: string;
  sport?: string;
  requestAdvice?: CoachAdviceRequester;
  requestLineupOptimization?: LineupOptimizationRequester;
}

async function requestCoachAdvice(input: {
  type: CoachAdviceType;
  leagueId?: string;
  leagueName?: string;
  week?: number;
  teamName?: string;
  sport?: string;
  leagueSettings?: {
    sport?: string;
    scoringFormat?: string;
    teamCount?: number;
    rosterSlots?: string[];
  };
  matchupData?: {
    opponentName?: string;
    opponentProjection?: number;
    teamProjection?: number;
    spread?: number;
    notes?: string;
  };
  roster?: {
    playerName: string;
    position?: string;
    team?: string;
    projectedPoints?: number;
    slot?: string;
  }[];
  playerStats?: {
    playerName: string;
    position?: string;
    projectedPoints?: number;
  }[];
}): Promise<CoachAdviceResult> {
  const res = await fetch('/api/coach/advice', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to get coach advice');
  }
  return data as CoachAdviceResult;
}

async function requestLineupOptimizationDefault(input: {
  leagueId?: string;
  sport?: string;
  useAIExplanation?: boolean;
  players: Array<{
    id?: string;
    name: string;
    team?: string;
    projectedPoints?: number;
    positions?: string[];
    position?: string;
  }>;
  rosterSlots?: string[];
}): Promise<LineupOptimizationResponse> {
  const res = await fetch('/api/lineup/optimize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(readPlanRefusal(res.status, data)?.message ?? (typeof data?.error === 'string' ? data.error : 'Failed to optimize lineup'));
  }
  return data as LineupOptimizationResponse;
}

function parseJsonArray<T>(value: string): T[] | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? (parsed as T[]) : undefined;
  } catch {
    return undefined;
  }
}

export function CoachAdvicePanel({
  leagueId,
  leagueName,
  week,
  teamName,
  sport,
  requestAdvice = requestCoachAdvice,
  requestLineupOptimization = requestLineupOptimizationDefault,
}: CoachAdvicePanelProps) {
  const compareUi = usePlayerComparisonUIOptional();
  const compareSport = normalizeToSupportedSport(sport) ?? DEFAULT_SPORT;
  const [type, setType] = useState<CoachAdviceType>('lineup_optimization');
  const [advice, setAdvice] = useState<CoachAdviceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scoringFormat, setScoringFormat] = useState('PPR');
  const [teamCount, setTeamCount] = useState<number>(12);
  const [opponentName, setOpponentName] = useState('');
  const [teamProjection, setTeamProjection] = useState<string>('');
  const [opponentProjection, setOpponentProjection] = useState<string>('');
  const [matchupNotes, setMatchupNotes] = useState('');
  const [rosterJson, setRosterJson] = useState('');
  const [playerStatsJson, setPlayerStatsJson] = useState('');
  const [rosterSlotsCsv, setRosterSlotsCsv] = useState('QB,RB,RB,WR,WR,TE,FLEX');
  const [optimizerUseAI, setOptimizerUseAI] = useState(false);
  const [optimizerLoading, setOptimizerLoading] = useState(false);
  const [optimizerResult, setOptimizerResult] = useState<LineupOptimizationResponse | null>(null);

  const onSelectType = useCallback((nextType: CoachAdviceType) => {
    setType(nextType);
    setAdvice(null);
    setOptimizerResult(null);
    setError(null);
  }, []);

  const onGetAdvice = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await requestAdvice({
        type,
        leagueId,
        leagueName,
        week,
        teamName,
        sport,
        leagueSettings: {
          sport,
          scoringFormat,
          teamCount,
        },
        matchupData: {
          opponentName: opponentName.trim() || undefined,
          teamProjection: teamProjection.trim() ? Number(teamProjection) : undefined,
          opponentProjection: opponentProjection.trim() ? Number(opponentProjection) : undefined,
          notes: matchupNotes.trim() || undefined,
        },
        roster: parseJsonArray(rosterJson),
        playerStats: parseJsonArray(playerStatsJson),
      });
      setAdvice(result);
    } catch (e) {
      setAdvice(null);
      setError(e instanceof Error ? e.message : 'Failed to get coach advice');
    } finally {
      setLoading(false);
    }
  }, [
    leagueId,
    leagueName,
    matchupNotes,
    opponentName,
    opponentProjection,
    playerStatsJson,
    requestAdvice,
    rosterJson,
    scoringFormat,
    sport,
    teamCount,
    teamName,
    teamProjection,
    type,
    week,
  ]);

  const onOptimizeLineup = useCallback(async () => {
    const parsedRoster = parseJsonArray<{
      playerName: string;
      position?: string;
      team?: string;
      projectedPoints?: number;
    }>(rosterJson);
    if (!parsedRoster || parsedRoster.length === 0) {
      setError('Roster JSON is required to run lineup optimization.');
      setOptimizerResult(null);
      return;
    }

    setOptimizerLoading(true);
    setError(null);
    try {
      const players = parsedRoster.map((player, index) => ({
        id: `${player.playerName}-${index}`,
        name: player.playerName,
        team: player.team,
        projectedPoints: player.projectedPoints,
        positions: player.position ? [player.position] : undefined,
        position: player.position,
      }));
      const rosterSlots = rosterSlotsCsv
        .split(',')
        .map((slot) => slot.trim())
        .filter(Boolean);

      const result = await requestLineupOptimization({
        leagueId,
        sport,
        useAIExplanation: optimizerUseAI,
        players,
        rosterSlots: rosterSlots.length > 0 ? rosterSlots : undefined,
      });
      setOptimizerResult(result);
    } catch (e) {
      setOptimizerResult(null);
      setError(e instanceof Error ? e.message : 'Failed to optimize lineup');
    } finally {
      setOptimizerLoading(false);
    }
  }, [leagueId, optimizerUseAI, requestLineupOptimization, rosterJson, rosterSlotsCsv, sport]);

  const title = useMemo(() => {
    const found = ADVICE_TYPE_OPTIONS.find((option) => option.id === advice?.type);
    return found?.label ?? 'Strategy explanation';
  }, [advice?.type]);

  return (
    <Card className="border-white/10 bg-white/5" data-audit="coach-mode-advice-card">
      <CardHeader>
        <CardTitle className="text-lg text-white">Coach Mode</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {ADVICE_TYPE_OPTIONS.map((option) => {
            const active = type === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onSelectType(option.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                  active
                    ? 'border-cyan-400/70 bg-cyan-400/20 text-cyan-200'
                    : 'border-white/15 bg-black/20 text-white/70 hover:bg-white/10'
                }`}
                data-testid={`coach-advice-type-${option.id}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 rounded-lg border border-white/10 bg-black/20 p-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.12em] text-white/55">
              Scoring format
            </label>
            <Input
              value={scoringFormat}
              onChange={(event) => setScoringFormat(event.target.value)}
              placeholder="PPR / Half-PPR / Points"
              className="border-white/10 bg-black/30 text-white placeholder:text-white/35"
              data-testid="coach-scoring-format-input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.12em] text-white/55">
              Team count
            </label>
            <Input
              type="number"
              min={2}
              max={32}
              value={teamCount}
              onChange={(event) => setTeamCount(Math.max(2, Math.min(32, Number(event.target.value || 12))))}
              className="border-white/10 bg-black/30 text-white"
              data-testid="coach-team-count-input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.12em] text-white/55">
              Opponent
            </label>
            <Input
              value={opponentName}
              onChange={(event) => setOpponentName(event.target.value)}
              placeholder="Opponent team name"
              className="border-white/10 bg-black/30 text-white placeholder:text-white/35"
              data-testid="coach-opponent-name-input"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-[0.12em] text-white/55">
                Team proj
              </label>
              <Input
                value={teamProjection}
                onChange={(event) => setTeamProjection(event.target.value)}
                placeholder="124.5"
                className="border-white/10 bg-black/30 text-white placeholder:text-white/35"
                data-testid="coach-team-projection-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-[0.12em] text-white/55">
                Opp proj
              </label>
              <Input
                value={opponentProjection}
                onChange={(event) => setOpponentProjection(event.target.value)}
                placeholder="121.2"
                className="border-white/10 bg-black/30 text-white placeholder:text-white/35"
                data-testid="coach-opponent-projection-input"
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs uppercase tracking-[0.12em] text-white/55">
              Matchup notes
            </label>
            <Input
              value={matchupNotes}
              onChange={(event) => setMatchupNotes(event.target.value)}
              placeholder="Injuries, weather, pacing, schedule edges"
              className="border-white/10 bg-black/30 text-white placeholder:text-white/35"
              data-testid="coach-matchup-notes-input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.12em] text-white/55">
              Roster JSON (optional)
            </label>
            <Textarea
              value={rosterJson}
              onChange={(event) => setRosterJson(event.target.value)}
              placeholder='[{"playerName":"A. Player","position":"WR","projectedPoints":15.2,"slot":"starter"}]'
              className="min-h-20 border-white/10 bg-black/30 text-white placeholder:text-white/35"
              data-testid="coach-roster-json-input"
            />
            <Input
              value={rosterSlotsCsv}
              onChange={(event) => setRosterSlotsCsv(event.target.value)}
              placeholder="QB,RB,RB,WR,WR,TE,FLEX"
              className="mt-2 border-white/10 bg-black/30 text-white placeholder:text-white/35"
              data-testid="coach-roster-slots-input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.12em] text-white/55">
              Player stats JSON (optional)
            </label>
            <Textarea
              value={playerStatsJson}
              onChange={(event) => setPlayerStatsJson(event.target.value)}
              placeholder='[{"playerName":"A. Player","position":"WR","projectedPoints":15.2}]'
              className="min-h-20 border-white/10 bg-black/30 text-white placeholder:text-white/35"
              data-testid="coach-player-stats-json-input"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void onGetAdvice()}
            disabled={loading}
            className="gap-2"
            data-testid="coach-mode-button"
            data-audit="coach-mode-button"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GraduationCap className="h-4 w-4" />}
            Get coach advice
          </Button>
          <Button
            variant="outline"
            onClick={() => void onOptimizeLineup()}
            disabled={optimizerLoading}
            className="gap-2 border-cyan-400/35 text-cyan-100"
            data-testid="coach-lineup-optimize-button"
            data-audit="coach-lineup-optimize-button"
          >
            {optimizerLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Optimize lineup
          </Button>
          <button
            type="button"
            onClick={() => setOptimizerUseAI((current) => !current)}
            className={`rounded-md border px-2 py-1 text-xs ${
              optimizerUseAI
                ? 'border-cyan-300/70 bg-cyan-400/15 text-cyan-100'
                : 'border-white/20 bg-black/20 text-white/70'
            }`}
            data-testid="coach-lineup-optimize-ai-toggle"
          >
            {optimizerUseAI ? 'AI explain on' : 'AI explain off'}
          </button>
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              const payload = {
                playerA: '',
                playerB: '',
                sport: compareSport,
                leagueId: leagueId ?? null,
                weekOrPeriod: week != null ? String(week) : null,
                source: 'lineup' as const,
              };
              if (compareUi) {
                compareUi.openComparison(payload);
              } else if (typeof window !== 'undefined') {
                const q = new URLSearchParams({ sport: compareSport });
                if (leagueId) q.set('leagueId', leagueId);
                window.location.href = `/player-comparison-lab?${q.toString()}`;
              }
            }}
            className="gap-2 border-white/15 text-white/85"
            data-testid="coach-open-player-compare"
            data-audit="coach-open-player-compare"
          >
            Player compare
          </Button>
          <Link
            href={`/player-comparison-lab?sport=${encodeURIComponent(compareSport)}${leagueId ? `&leagueId=${encodeURIComponent(leagueId)}` : ''}`}
            className="text-xs text-cyan-300/85 underline hover:text-cyan-100"
            data-testid="coach-player-compare-full-page"
          >
            Full page
          </Link>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {advice && (
          <section
            className="rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-4"
            data-testid="strategy-explanation-panel"
            data-audit="strategy-explanation-panel"
          >
            <p className="text-xs uppercase tracking-[0.12em] text-cyan-300/90">{title}</p>
            <p className="mt-2 text-sm font-medium text-white">{advice.summary}</p>
            <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-white/80">
              {advice.bullets.map((bullet, index) => (
                <li key={`${bullet}-${index}`}>{bullet}</li>
              ))}
            </ul>
            {advice.recommendation && (
              <div className="mt-3 rounded-lg border border-white/15 bg-black/20 px-3 py-2">
                <p className="text-xs font-medium uppercase tracking-[0.1em] text-cyan-200">
                  Deterministic recommendation
                </p>
                <p className="mt-1 text-sm text-white/90">{advice.recommendation.headline}</p>
                <p className="mt-1 text-xs text-white/60">{advice.recommendation.contextSummary}</p>
              </div>
            )}
            <div className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-[0.1em] text-amber-300">Your challenge</p>
              <p className="mt-1 text-sm text-amber-100/90">{advice.challenge}</p>
            </div>
            {advice.explanation?.source && (
              <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-white/45">
                Explanation source: {advice.explanation.source === 'ai' ? 'AI' : 'Deterministic fallback'}
              </p>
            )}
          </section>
        )}

        {optimizerResult && (
          <section
            className="rounded-xl border border-emerald-400/25 bg-emerald-500/5 p-4"
            data-testid="coach-lineup-optimizer-panel"
          >
            <p className="text-xs uppercase tracking-[0.12em] text-emerald-300/90">
              Deterministic lineup optimizer
            </p>
            <p className="mt-2 text-sm text-white">
              Projected total: {optimizerResult.result.totalProjectedPoints.toFixed(1)}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-white/85" data-testid="coach-lineup-optimizer-starters">
              {optimizerResult.result.starters.map((starter) => (
                <li
                  key={`${starter.slotId}-${starter.playerId}`}
                  className="flex flex-wrap items-center gap-x-1 gap-y-1"
                >
                  <span>
                    {starter.slotCode}: {starter.playerName} (
                  </span>
                  <ProjectionDisplay
                    projection={starter.projectedPoints}
                    suffix=""
                    pointsClassName="text-sm text-white/85"
                    afCrestProps={
                      sport
                        ? {
                            playerId: starter.playerId || `coach-${starter.playerName}`,
                            playerName: starter.playerName,
                            sport,
                            position: starter.selectedPosition || '—',
                            week: week ?? 1,
                            season: new Date().getFullYear(),
                            size: 'sm',
                          }
                        : undefined
                    }
                  />
                  <span>)</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-white/60">
              Explanation source: {optimizerResult.explanation.source === 'ai' ? 'AI' : 'Deterministic'}
            </p>
            <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-white/70">
              {optimizerResult.explanation.bullets.slice(0, 4).map((bullet, index) => (
                <li key={`${bullet}-${index}`}>{bullet}</li>
              ))}
            </ul>
            {optimizerResult.decisionEngine &&
            typeof optimizerResult.decisionEngine === 'object' &&
            optimizerResult.decisionEngine != null &&
            'lineupMode' in optimizerResult.decisionEngine ? (
              <div className="mt-4 rounded-lg border border-cyan-400/20 bg-[#0a1228]/90 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-cyan-200/90">
                  AI lineup decision engine
                </p>
                <p className="mt-1 text-xs text-white/80">
                  Mode:{' '}
                  <span className="text-white">
                    {String((optimizerResult.decisionEngine as { lineupMode?: string }).lineupMode ?? '—')}
                  </span>
                </p>
                {optimizerResult.decisionExplanation?.summary ? (
                  <p className="mt-2 text-xs text-white/75">{optimizerResult.decisionExplanation.summary}</p>
                ) : null}
                {Array.isArray((optimizerResult.decisionEngine as { alerts?: string[] }).alerts) &&
                ((optimizerResult.decisionEngine as { alerts: string[] }).alerts.length ?? 0) > 0 ? (
                  <ul className="mt-2 list-inside list-disc space-y-1 text-[11px] text-amber-100/85">
                    {(optimizerResult.decisionEngine as { alerts: string[] }).alerts.slice(0, 3).map((a, i) => (
                      <li key={`${a}-${i}`}>{a}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
