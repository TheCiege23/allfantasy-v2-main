'use client';

import { useMemo, useState } from 'react';
import type { ChartMode, ComparisonMatrixRow, ResolvedPlayerStats } from '@/lib/player-comparison-lab/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const HISTORICAL_DIMENSIONS = new Set(['fantasy_production', 'consistency']);
const PROJECTION_DIMENSIONS = new Set(['market_value', 'projection', 'trend_momentum', 'volatility']);
const BAR_COLORS = ['#a78bfa', '#22d3ee', '#34d399', '#f59e0b', '#f472b6', '#60a5fa'];

interface SideBySideChartProps {
  matrix: ComparisonMatrixRow[];
  players: ResolvedPlayerStats[];
}

function isValidNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function shouldIncludeRow(row: ComparisonMatrixRow, mode: ChartMode): boolean {
  if (mode === 'both') {
    return HISTORICAL_DIMENSIONS.has(row.dimensionId) || PROJECTION_DIMENSIONS.has(row.dimensionId);
  }
  if (mode === 'historical') return HISTORICAL_DIMENSIONS.has(row.dimensionId);
  return PROJECTION_DIMENSIONS.has(row.dimensionId);
}

export function SideBySideChart({ matrix, players }: SideBySideChartProps) {
  const [mode, setMode] = useState<ChartMode>('both');
  const playerNames = players.map((p) => p.name);

  const chartRows = useMemo(() => {
    const selected = matrix.filter((row) => shouldIncludeRow(row, mode));
    return selected.filter((row) => playerNames.some((name) => isValidNumber(row.valuesByPlayer[name])));
  }, [matrix, mode, playerNames]);

  const data = useMemo(
    () =>
      chartRows.map((row) => {
        const point: Record<string, string | number | null> = { metric: row.label };
        playerNames.forEach((name) => {
          point[name] = row.valuesByPlayer[name] ?? null;
        });
        return point;
      }),
    [chartRows, playerNames]
  );

  return (
    <Card
      className="border-white/10 bg-white/5"
      data-audit="side-by-side-chart"
      data-testid="player-comparison-side-by-side-chart"
      data-mode={mode}
    >
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg text-white">Side-by-side charts</CardTitle>
          <span
            className="text-xs text-white/60"
            data-testid="player-comparison-chart-series-count"
          >
            Metrics: {chartRows.length}
          </span>
        </div>
        <div className="flex flex-wrap gap-2" data-audit="chart-toggles">
          <Button
            size="sm"
            variant={mode === 'historical' ? 'default' : 'outline'}
            className={mode === 'historical' ? '' : 'border-white/20'}
            onClick={() => setMode('historical')}
            data-testid="player-comparison-chart-toggle-historical"
          >
            Historical
          </Button>
          <Button
            size="sm"
            variant={mode === 'projections' ? 'default' : 'outline'}
            className={mode === 'projections' ? '' : 'border-white/20'}
            onClick={() => setMode('projections')}
            data-testid="player-comparison-chart-toggle-projections"
          >
            Projections
          </Button>
          <Button
            size="sm"
            variant={mode === 'both' ? 'default' : 'outline'}
            className={mode === 'both' ? '' : 'border-white/20'}
            onClick={() => setMode('both')}
            data-testid="player-comparison-chart-toggle-both"
          >
            Both
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-white/60">No chart data available for this toggle.</p>
        ) : (
          <div className="space-y-4">
            {data.map((row) => {
              const numericValues = playerNames
                .map((name) => row[name])
                .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
              const maxValue = numericValues.length > 0 ? Math.max(...numericValues.map((v) => Math.abs(v))) : 0;

              return (
                <div key={String(row.metric)} className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="mb-2 text-sm font-medium text-white">{row.metric}</p>
                  <div className="space-y-2">
                    {playerNames.map((name, index) => {
                      const raw = row[name];
                      const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
                      const widthPct = value != null && maxValue > 0 ? Math.max(4, (Math.abs(value) / maxValue) * 100) : 0;
                      return (
                        <div key={name} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-white/70">{name}</span>
                            <span className="text-white">
                              {value == null ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(1)}
                            </span>
                          </div>
                          <div className="h-2 rounded bg-white/10">
                            <div
                              className="h-2 rounded"
                              style={{
                                width: `${widthPct}%`,
                                backgroundColor: BAR_COLORS[index % BAR_COLORS.length],
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
