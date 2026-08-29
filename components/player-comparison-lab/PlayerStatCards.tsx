'use client';

import type {
  ResolvedPlayerStats,
  PlayerComparisonScores,
  MarketAdpSignal,
} from '@/lib/player-comparison-lab/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface PlayerStatCardsProps {
  players: ResolvedPlayerStats[];
  scores: PlayerComparisonScores[];
}

function formatVal(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * The provenance suffix beside a Market ADP.
 *
 * 🛑 IT NAMES THE SOURCES AT EVERY COUNT, NOT JUST AT ONE. Rendering a bare "(5 sources)"
 * would assert a current five-platform agreement that does not exist: four of the six sources
 * behind `adp_data` come from `data/nfl-adp-multiplatform.csv`, frozen on 2026-03-08, and only
 * `ffc` is a live fetch. Naming them lets the reader see that for themselves.
 *
 * The scoring basis is included because it is NOT the league's — the blended standard board is
 * requested on purpose (it is the only one carrying both veterans and rookies), so a PPR
 * comparison would otherwise show a standard-scoring ADP with nothing saying so.
 */
function formatAdpProvenance(m: MarketAdpSignal): string {
  const named = m.providers.length > 0 ? m.providers.join(', ') : null;
  const count =
    m.providerCount == null
      ? 'sources unknown'
      : `${m.providerCount} ${m.providerCount === 1 ? 'source' : 'sources'}`;
  return `(${named ? `${count}: ${named}` : count} · ${m.format}/${m.scoring})`;
}

export function PlayerStatCards({ players, scores }: PlayerStatCardsProps) {
  const scoreByPlayer = new Map(scores.map((s) => [s.playerName, s]));

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-audit="player-stat-cards">
      {players.map((p) => {
        const s = scoreByPlayer.get(p.name);
        const last = p.historical[0];
        return (
          <Card key={p.name} className="border-white/10 bg-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white">
                {p.name}
                {(p.position || p.team) && (
                  <span className="ml-2 font-normal text-white/60">
                    {[p.position, p.team].filter(Boolean).join(' · ')}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/60">Market value</span>
                <span className="text-white">{formatVal(p.projection?.value ?? null)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">Internal ADP</span>
                <span className="text-white">{formatVal(p.internalAdp)}</span>
              </div>
              {p.marketAdp && (
                <div className="flex justify-between">
                  <span className="text-white/60">Market ADP</span>
                  <span className="text-white">
                    {p.marketAdp.adp.toFixed(1)}
                    <span className="ml-1 text-white/50">{formatAdpProvenance(p.marketAdp)}</span>
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-white/60">Rank</span>
                <span className="text-white">{p.projection?.rank ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">VORP diff</span>
                <span className="text-white">{formatVal(s?.vorpDifference ?? null)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">Projection delta</span>
                <span className="text-white">{formatVal(s?.projectionDelta ?? null)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">Consistency</span>
                <span className="text-white">{formatVal(s?.consistencyScore ?? null)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">Volatility</span>
                <span className="text-white">{formatVal(s?.volatilityScore ?? null)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">Schedule difficulty</span>
                <span className="text-white">{formatVal(p.scheduleDifficultyScore)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">Injury risk</span>
                <span className="text-white">{formatVal(p.injury.riskScore)}</span>
              </div>
              {last && (
                <div className="flex justify-between border-t border-white/10 pt-2">
                  <span className="text-white/60">Last season FP/G</span>
                  <span className="text-white">
                    {last.fantasyPointsPerGame != null
                      ? last.fantasyPointsPerGame.toFixed(1)
                      : '—'}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
