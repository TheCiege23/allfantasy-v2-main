'use client';

import { GraduationCap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CoachProviderInsights } from '@/lib/fantasy-coach/types';

interface WeeklyAdvicePanelProps {
  weeklyAdvice: string | null;
  strategyInsight: string | null;
  rosterMathSummary: string | null;
  providerInsights?: CoachProviderInsights | null;
  teamSummary?: string | null;
}

export function WeeklyAdvicePanel({
  weeklyAdvice,
  strategyInsight,
  rosterMathSummary,
  providerInsights,
  teamSummary,
}: WeeklyAdvicePanelProps) {
  const resolvedInsights = providerInsights ?? {
    deepseek: rosterMathSummary ?? '',
    grok: strategyInsight ?? '',
    openai: weeklyAdvice ?? '',
  };

  const hasAny =
    teamSummary ||
    resolvedInsights.deepseek ||
    resolvedInsights.grok ||
    resolvedInsights.openai;

  if (!hasAny) return null;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5" data-audit="weekly-advice-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg text-white">
          <GraduationCap className="h-5 w-5 text-amber-400" />
          Weekly advice
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {teamSummary && (
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-amber-300/90">
              Team pulse
            </p>
            <p className="mt-2 text-sm text-white/85">{teamSummary}</p>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-cyan-200">
              DeepSeek roster math
            </p>
            <p className="mt-2 text-sm text-cyan-50/90">{resolvedInsights.deepseek}</p>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-amber-200">
              Grok strategy framing
            </p>
            <p className="mt-2 text-sm text-amber-50/90">{resolvedInsights.grok}</p>
          </div>

          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-200">
              OpenAI coach recommendation
            </p>
            <p className="mt-2 text-sm text-emerald-50/90">{resolvedInsights.openai}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
