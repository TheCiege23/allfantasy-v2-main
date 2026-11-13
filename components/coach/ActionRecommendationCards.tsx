'use client';

import Link from 'next/link';
import { ArrowLeftRight, ArrowRight, LayoutList, UserPlus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  ActionRecommendation,
  TradeSuggestion,
  WaiverOpportunity,
} from '@/lib/fantasy-coach/types';

interface ActionRecommendationCardsProps {
  actionRecommendations: ActionRecommendation[];
  waiverOpportunities: WaiverOpportunity[];
  tradeSuggestions: TradeSuggestion[];
}

function PriorityPill({ priority }: { priority?: 'high' | 'medium' }) {
  if (!priority) return null;

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
        priority === 'high'
          ? 'bg-rose-500/15 text-rose-200'
          : 'bg-white/10 text-white/60'
      }`}
    >
      {priority}
    </span>
  );
}

export function ActionRecommendationCards({
  actionRecommendations,
  waiverOpportunities,
  tradeSuggestions,
}: ActionRecommendationCardsProps) {
  return (
    <div className="space-y-4" data-audit="action-recommendation-cards">
      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white">Action recommendations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {actionRecommendations.map((action) => (
            <Link
              key={action.id}
              href={action.toolHref}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-4 transition hover:bg-white/10"
              data-audit="recommendation-opens-tool"
              data-testid={`coach-action-link-${action.id}`}
            >
              <div className="flex items-center gap-3">
                {action.type === 'waiver' && <UserPlus className="h-5 w-5 text-cyan-400" />}
                {action.type === 'trade' && <ArrowLeftRight className="h-5 w-5 text-amber-400" />}
                {action.type === 'lineup' && <LayoutList className="h-5 w-5 text-emerald-400" />}
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-white">{action.label}</p>
                    <PriorityPill priority={action.priority} />
                  </div>
                  <p className="text-sm text-white/60">{action.summary}</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-white/50" />
            </Link>
          ))}
        </CardContent>
      </Card>

      {waiverOpportunities.length > 0 && (
        <Card className="border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white">Waiver opportunities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {waiverOpportunities.map((waiverOpportunity, index) => (
              <Link
                key={`${waiverOpportunity.playerName}-${index}`}
                href={waiverOpportunity.playerHref}
                className="block rounded-lg border border-white/10 bg-black/20 px-4 py-3 transition hover:bg-white/10"
                data-audit="waiver-target-opens-player-page"
                data-testid={`coach-waiver-link-${index}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-white">
                    {waiverOpportunity.playerName}
                    {waiverOpportunity.position && (
                      <span className="ml-2 text-white/50">({waiverOpportunity.position})</span>
                    )}
                  </p>
                  <PriorityPill priority={waiverOpportunity.priority} />
                </div>
                <p className="text-sm text-white/60">{waiverOpportunity.reason}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {tradeSuggestions.length > 0 && (
        <Card className="border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-lg text-white">Trade suggestions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {tradeSuggestions.map((tradeSuggestion, index) => (
              <Link
                key={`${tradeSuggestion.summary}-${index}`}
                href={tradeSuggestion.tradeAnalyzerHref}
                className="block rounded-lg border border-white/10 bg-black/20 px-4 py-3 transition hover:bg-white/10"
                data-audit="trade-suggestion-opens-trade-analyzer"
                data-testid={`coach-trade-link-${index}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-white">{tradeSuggestion.summary}</p>
                  <PriorityPill priority={tradeSuggestion.priority} />
                </div>
                {tradeSuggestion.targetHint && (
                  <p className="text-sm text-white/60">{tradeSuggestion.targetHint}</p>
                )}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
