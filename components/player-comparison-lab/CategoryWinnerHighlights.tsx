'use client';

import type { CategoryWinnerHighlight } from '@/lib/player-comparison-lab/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Trophy } from 'lucide-react';

interface CategoryWinnerHighlightsProps {
  highlights: CategoryWinnerHighlight[];
}

function formatVal(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function CategoryWinnerHighlights({ highlights }: CategoryWinnerHighlightsProps) {
  if (highlights.length === 0) return null;

  return (
    <Card className="border-white/10 bg-white/5" data-audit="category-winner-highlights">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg text-white">
          <Trophy className="h-5 w-5 text-amber-400" />
          Category winners
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-wrap gap-2">
          {highlights.map((h) => (
            <li
              key={h.dimensionId}
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm"
            >
              <span className="text-white/70">{h.label}:</span>{' '}
              <span className="font-medium text-emerald-300">{h.winnerName}</span>
              {formatVal(h.value) && (
                <span className="ml-1 text-white/60">({formatVal(h.value)})</span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
