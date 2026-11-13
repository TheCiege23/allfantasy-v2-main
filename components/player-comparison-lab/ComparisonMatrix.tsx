'use client';

import type { ComparisonMatrixRow, ResolvedPlayerStats } from '@/lib/player-comparison-lab/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ComparisonMatrixProps {
  matrix: ComparisonMatrixRow[];
  players: ResolvedPlayerStats[];
}

function formatValue(v: number | null, higherIsBetter: boolean): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function ComparisonMatrix({ matrix, players }: ComparisonMatrixProps) {
  const names = players.map((p) => p.name);

  return (
    <Card className="border-white/10 bg-white/5" data-audit="comparison-matrix" data-testid="comparison-matrix">
      <CardHeader>
        <CardTitle className="text-lg text-white">Comparison matrix</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10">
              <TableHead className="text-white/70">Dimension</TableHead>
              {names.map((name) => (
                <TableHead key={name} className="text-white/70">
                  {name}
                </TableHead>
              ))}
              <TableHead className="text-white/70 w-28">Winner</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matrix.map((row) => {
              const winner = row.winnerName;
              return (
                <TableRow key={row.dimensionId} className="border-white/10">
                  <TableCell className="font-medium text-white/90">{row.label}</TableCell>
                  {names.map((name) => {
                    const val = row.valuesByPlayer[name] ?? null;
                    const isWinner = winner === name;
                    return (
                      <TableCell
                        key={name}
                        className={
                          isWinner
                            ? 'bg-emerald-500/15 font-semibold text-emerald-300'
                            : 'text-white/80'
                        }
                      >
                        {formatValue(val, row.higherIsBetter)}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-white/80">
                    {winner ?? '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
