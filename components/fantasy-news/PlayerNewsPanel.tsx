'use client';

import type { EnrichedNewsItem } from '@/lib/fantasy-news-aggregator/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Share2, ExternalLink } from 'lucide-react';
import { newsPlayerHref } from '@/lib/fantasy-news-aggregator/playerLinkResolver';

export interface PlayerNewsPanelProps {
  items: EnrichedNewsItem[];
  title?: string;
  /** Callback when user clicks share on a card. */
  onShare?: (item: EnrichedNewsItem) => void;
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

async function handleShare(item: EnrichedNewsItem): Promise<void> {
  const title = item.headline || item.title;
  const url = item.sourceUrl || (typeof window !== 'undefined' ? window.location.href : '');
  const text = item.summary || item.description || title;
  if (typeof navigator !== 'undefined' && navigator.share) {
    await navigator.share({ title, url, text });
  } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url || `${title}\n${text}`);
  }
}

export function PlayerNewsPanel({ items, title = 'News', onShare, sport }: PlayerNewsPanelProps) {
  return (
    <Card className="border-white/10 bg-white/5" data-audit="player-news-panel">
      <CardHeader>
        <CardTitle className="text-lg text-white">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-white/50">No news items.</p>
        ) : (
          <ul className="space-y-4">
            {items.map((item) => (
              <li key={item.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                {item.sourceUrl ? (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block group"
                    data-audit="news-card"
                    data-testid={`fantasy-news-card-${item.id}`}
                  >
                    <h3 className="font-semibold text-white group-hover:text-cyan-400 transition">
                      {item.headline || item.title}
                    </h3>
                    {item.summary && (
                      <p className="mt-1 text-sm text-white/70 line-clamp-2">{item.summary}</p>
                    )}
                    {item.fantasyImpact && (
                      <p className="mt-2 text-xs text-cyan-300/90">Impact: {item.fantasyImpact}</p>
                    )}
                    <div className="mt-2 flex items-center gap-2 text-xs text-white/50">
                      <span>{item.source}</span>
                      {item.publishedAt && <span>{formatTime(item.publishedAt)}</span>}
                      {item.confidenceLevel && (
                        <span className="capitalize">Confidence: {item.confidenceLevel}</span>
                      )}
                    </div>
                  </a>
                ) : (
                  <div data-audit="news-card" data-testid={`fantasy-news-card-${item.id}`}>
                    <h3 className="font-semibold text-white">{item.headline || item.title}</h3>
                    {item.summary && (
                      <p className="mt-1 text-sm text-white/70 line-clamp-2">{item.summary}</p>
                    )}
                    <div className="mt-2 flex items-center gap-2 text-xs text-white/50">
                      <span>{item.source}</span>
                      {item.publishedAt && <span>{formatTime(item.publishedAt)}</span>}
                    </div>
                  </div>
                )}
                {item.playersMentioned.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.playersMentioned.map((name) => (
                      <a
                        key={name}
                        href={newsPlayerHref(item, name, sport)}
                        className="text-xs text-cyan-400 hover:underline"
                        data-audit="player-link-opens-player-page"
                        data-testid={`fantasy-news-player-link-${item.id}-${name.replace(/\s+/g, '-').toLowerCase()}`}
                      >
                        {name}
                      </a>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  {item.sourceUrl && (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-white/70 hover:text-cyan-400"
                      data-audit="source-link"
                      data-testid={`fantasy-news-source-link-${item.id}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Full article
                    </a>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    onClick={async (e) => {
                      e.preventDefault();
                      await handleShare(item).catch(() => null);
                      onShare?.(item);
                    }}
                    data-audit="share-button-works"
                    data-testid={`fantasy-news-share-button-${item.id}`}
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Share
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
