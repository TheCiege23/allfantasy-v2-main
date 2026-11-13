'use client';

import type { EnrichedNewsItem } from '@/lib/fantasy-news-aggregator/types';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { newsPlayerHref } from '@/lib/fantasy-news-aggregator/playerLinkResolver';

export interface BreakingNewsBannerProps {
  /** Top 1–3 items to highlight as breaking (e.g. by importanceScore or recency). */
  items: EnrichedNewsItem[];
  /** The feed's sport — player links resolve the name in it when an item carries none. */
  sport?: string | null;
}

function formatTime(publishedAt: string | null): string {
  if (!publishedAt) return '';
  const d = new Date(publishedAt);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffM = Math.floor(diffMs / 60000);
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString();
}

export function BreakingNewsBanner({ items, sport }: BreakingNewsBannerProps) {
  if (items.length === 0) return null;

  const top = items.slice(0, 3);

  return (
    <Card className="border-amber-500/40 bg-amber-500/10" data-audit="breaking-news-banner">
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 text-amber-400 font-semibold mb-3">
          <AlertCircle className="h-5 w-5" />
          Breaking news
        </div>
        <ul className="space-y-2">
          {top.map((item) => (
            <li key={item.id}>
              <a
                href={item.sourceUrl || '#'}
                target={item.sourceUrl ? '_blank' : undefined}
                rel={item.sourceUrl ? 'noopener noreferrer' : undefined}
                className="block rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white hover:bg-white/10 transition"
                data-audit="news-card-opens-full-article"
                data-testid={`fantasy-news-breaking-card-${item.id}`}
              >
                <span className="font-medium">{item.headline || item.title}</span>
                {item.publishedAt && (
                  <span className="ml-2 text-white/50 text-xs">{formatTime(item.publishedAt)}</span>
                )}
              </a>
              {item.playersMentioned.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.playersMentioned.map((name) => (
                    <a
                      key={name}
                      href={newsPlayerHref(item, name, sport)}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-cyan-400 hover:underline"
                      data-audit="player-link-opens-player-page"
                      data-testid={`fantasy-news-breaking-player-link-${item.id}-${name.replace(/\s+/g, '-').toLowerCase()}`}
                    >
                      {name}
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
