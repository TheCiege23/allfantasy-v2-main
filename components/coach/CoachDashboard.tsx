'use client';

import { useCallback, useDeferredValue, useEffect, useState } from 'react';
import { Activity, GraduationCap, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SUPPORTED_SPORTS } from '@/lib/sport-scope';
import type { CoachEvaluationResult } from '@/lib/fantasy-coach/types';
import { ActionRecommendationCards } from './ActionRecommendationCards';
import {
  CoachAdvicePanel,
  type CoachAdviceRequester,
  type LineupOptimizationRequester,
} from './CoachAdvicePanel';
import { WeeklyAdvicePanel } from './WeeklyAdvicePanel';

type CoachEvaluationLoaderInput = {
  sport: string;
  leagueId?: string;
  leagueName?: string;
  teamName?: string;
  week?: number;
};

export type CoachEvaluationLoader = (
  input: CoachEvaluationLoaderInput
) => Promise<CoachEvaluationResult>;

interface CoachDashboardProps {
  leagueId?: string;
  leagueName?: string;
  initialSport?: string;
  initialTeamName?: string;
  initialWeek?: number;
  loadEvaluation?: CoachEvaluationLoader;
  requestAdvice?: CoachAdviceRequester;
  requestLineupOptimization?: LineupOptimizationRequester;
}

async function requestCoachEvaluation(
  input: CoachEvaluationLoaderInput
): Promise<CoachEvaluationResult> {
  const params = new URLSearchParams();
  params.set('sport', input.sport);
  if (input.leagueId) params.set('leagueId', input.leagueId);
  if (input.leagueName) params.set('leagueName', input.leagueName);
  if (input.teamName) params.set('teamName', input.teamName);
  if (input.week != null) params.set('week', String(input.week));

  const response = await fetch(`/api/coach/evaluation?${params.toString()}`, {
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to load');
  }

  return data as CoachEvaluationResult;
}

function formatLastUpdated(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function trendLabel(trend: 'up' | 'steady' | 'down'): string {
  if (trend === 'up') return 'text-emerald-300';
  if (trend === 'down') return 'text-rose-300';
  return 'text-amber-200';
}

export function CoachDashboard({
  leagueId,
  leagueName,
  initialSport,
  initialTeamName,
  initialWeek = 1,
  loadEvaluation = requestCoachEvaluation,
  requestAdvice,
  requestLineupOptimization,
}: CoachDashboardProps) {
  const [sport, setSport] = useState(initialSport ?? SUPPORTED_SPORTS[0]);
  const [teamNameInput, setTeamNameInput] = useState(initialTeamName ?? leagueName ?? 'My Team');
  const [week, setWeek] = useState(initialWeek);
  const [data, setData] = useState<CoachEvaluationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferredTeamName = useDeferredValue(teamNameInput.trim());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await loadEvaluation({
        sport,
        leagueId,
        leagueName,
        teamName: deferredTeamName || undefined,
        week,
      });
      setData(result);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [deferredTeamName, leagueId, leagueName, loadEvaluation, sport, week]);

  useEffect(() => {
    void load();
  }, [load]);

  const lastUpdated = formatLastUpdated(data?.lastEvaluatedAt ?? null);

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-6 w-6 text-amber-400" />
            <h1 className="text-2xl font-semibold text-white">Coach Mode</h1>
          </div>
          <p className="max-w-3xl text-sm text-white/65">
            Continuous team evaluation across strengths, weaknesses, waiver moves, trade targets,
            and lineup improvements for every supported sport.
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-right">
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Live coach pulse</p>
          <p className="mt-1 text-sm font-medium text-white">
            {data ? `${data.teamSnapshot.adjustedProjection.toFixed(1)} pts outlook` : 'Loading evaluation'}
          </p>
          <p className="mt-1 text-xs text-white/45">
            {lastUpdated ? `Updated ${lastUpdated}` : 'Refreshes whenever context changes'}
          </p>
        </div>
      </div>

      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white">Settings</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[160px,1fr,120px,auto]">
          <div>
            <label className="mb-1 block text-sm text-white/70">Sport</label>
            <Select value={sport} onValueChange={(value) => setSport(value as typeof sport)}>
              <SelectTrigger className="w-full border-white/10 bg-black/30 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_SPORTS.map((supportedSport) => (
                  <SelectItem key={supportedSport} value={supportedSport}>
                    {supportedSport === 'SOCCER' ? 'Soccer' : supportedSport}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-sm text-white/70">Team name</label>
            <Input
              value={teamNameInput}
              onChange={(event) => setTeamNameInput(event.target.value)}
              placeholder="My team"
              className="border-white/10 bg-black/30 text-white placeholder:text-white/30"
              data-testid="coach-team-name-input"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-white/70">Week</label>
            <Input
              type="number"
              min={1}
              max={38}
              value={week}
              onChange={(event) => setWeek(Math.min(38, Math.max(1, Number(event.target.value || 1))))}
              className="border-white/10 bg-black/30 text-white"
              data-testid="coach-week-input"
            />
          </div>

          <div className="flex items-end">
            <Button
              onClick={() => void load()}
              disabled={loading}
              className="w-full gap-2 md:w-auto"
              data-testid="coach-refresh-button"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh coach
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {data && (
        <>
          <Card className="border-cyan-500/20 bg-cyan-500/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg text-white">
                <Activity className="h-5 w-5 text-cyan-300" />
                Team pulse
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-white/85">{data.teamSummary}</p>
              <div className="grid gap-3 md:grid-cols-4">
                {data.evaluationMetrics.map((metric) => (
                  <div
                    key={metric.id}
                    className="rounded-xl border border-white/10 bg-black/20 p-4"
                    data-testid={`coach-metric-${metric.id}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-white/45">
                        {metric.label}
                      </p>
                      <span className={`text-xs font-medium uppercase ${trendLabel(metric.trend)}`}>
                        {metric.trend}
                      </span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold text-white">{metric.score}</p>
                    <p className="mt-2 text-sm text-white/60">{metric.summary}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <CoachAdvicePanel
            leagueId={leagueId}
            leagueName={leagueName}
            week={week}
            teamName={deferredTeamName || data.teamSnapshot.teamName}
            sport={sport}
            requestAdvice={requestAdvice}
            requestLineupOptimization={requestLineupOptimization}
          />

          <WeeklyAdvicePanel
            weeklyAdvice={data.weeklyAdvice}
            strategyInsight={data.strategyInsight}
            rosterMathSummary={data.rosterMathSummary}
            providerInsights={data.providerInsights}
            teamSummary={data.teamSummary}
          />

          <Card className="border-white/10 bg-white/5">
            <CardHeader>
              <CardTitle className="text-lg text-white">Roster evaluation</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-3">
              <div>
                <p className="text-xs font-medium uppercase text-emerald-400/90">Strengths</p>
                <ul className="mt-2 list-inside list-disc space-y-2 text-sm text-white/80">
                  {data.rosterStrengths.map((strength, index) => (
                    <li key={index}>{strength}</li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-xs font-medium uppercase text-rose-400/90">Weaknesses</p>
                <ul className="mt-2 list-inside list-disc space-y-2 text-sm text-white/80">
                  {data.rosterWeaknesses.map((weakness, index) => (
                    <li key={index}>{weakness}</li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-xs font-medium uppercase text-cyan-400/90">Lineup improvements</p>
                <ul className="mt-2 list-inside list-disc space-y-2 text-sm text-white/80">
                  {data.lineupImprovements.map((improvement, index) => (
                    <li key={index}>{improvement}</li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          <ActionRecommendationCards
            actionRecommendations={data.actionRecommendations}
            waiverOpportunities={data.waiverOpportunities}
            tradeSuggestions={data.tradeSuggestions}
          />
        </>
      )}
    </main>
  );
}
