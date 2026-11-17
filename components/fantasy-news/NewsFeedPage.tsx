'use client';

import { useState, useCallback } from 'react';
import { Newspaper, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SUPPORTED_SPORTS } from '@/lib/sport-scope';
import type { EnrichedNewsItem } from '@/lib/fantasy-news-aggregator/types';
import { BreakingNewsBanner } from './BreakingNewsBanner';
import { PlayerNewsPanel } from './PlayerNewsPanel';

const BREAKING_TOP_N = 3;
type FeedType = 'player' | 'team';

export function NewsFeedPage() {
  const [sport, setSport] = useState<string>(SUPPORTED_SPORTS[0]);
  const [feedType, setFeedType] = useState<FeedType>('player');
  const [query, setQuery] = useState('');
  const [useAiSummaries, setUseAiSummaries] = useState(true);
  const [lastSharedHeadline, setLastSharedHeadline] = useState<string | null>(null);
  const [items, setItems] = useState<EnrichedNewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNews = useCallback(async (refresh = false) => {
    const cleanQuery = query.trim();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        sport,
        limit: '25',
        enrich: String(useAiSummaries),
      });
      if (cleanQuery) {
        params.set('type', feedType);
        params.set('query', cleanQuery);
      }
      if (refresh) params.set('refresh', 'true');
      const res = await fetch(`/api/fantasy-news/feed?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load news');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [feedType, query, sport, useAiSummaries]);

  const handleRefresh = useCallback(() => {
    fetchNews(true);
  }, [fetchNews]);

  const breaking = items
    .filter((i) => (i.importanceScore ?? 0) >= 60)
    .slice(0, BREAKING_TOP_N);
  const rest = items.filter((i) => !breaking.includes(i));

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="flex items-center gap-2">
        <Newspaper className="h-6 w-6 text-cyan-400" />
        <h1 className="text-2xl font-semibold text-white">Fantasy News</h1>
      </div>
      <p className="text-sm text-white/60">
        Aggregated player/team feeds with AI-summarized headlines and direct article links.
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <span className="block text-sm text-white/70">Feed type</span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={feedType === 'player' ? 'default' : 'outline'}
              className={feedType === 'player' ? '' : 'border-white/20'}
              onClick={() => {
                setFeedType('player');
                setItems([]);
                setError(null);
              }}
              data-testid="fantasy-news-feed-type-player"
            >
              Player news feed
            </Button>
            <Button
              type="button"
              variant={feedType === 'team' ? 'default' : 'outline'}
              className={feedType === 'team' ? '' : 'border-white/20'}
              onClick={() => {
                setFeedType('team');
                setItems([]);
                setError(null);
              }}
              data-testid="fantasy-news-feed-type-team"
            >
              Team news feed
            </Button>
          </div>
        </div>
        <div className="min-w-[260px] flex-1">
          <label className="mb-1 block text-sm text-white/70">
            {feedType === 'team' ? 'Team abbreviation' : 'Player name'}
          </label>
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setError(null);
            }}
            placeholder={feedType === 'team' ? 'e.g. KC' : 'e.g. Josh Allen'}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white placeholder:text-white/40"
            data-testid="fantasy-news-query-input"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-white/70">Sport</label>
          <Select value={sport} onValueChange={(v) => { setSport(v); setItems([]); setError(null); }}>
            <SelectTrigger className="w-[160px] border-white/10 bg-black/30 text-white" data-testid="fantasy-news-sport-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_SPORTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={useAiSummaries}
            onChange={(e) => setUseAiSummaries(e.target.checked)}
            data-testid="fantasy-news-summarize-toggle"
          />
          AI summarized headlines
        </label>
        <div className="flex items-center gap-2 pb-1">
          <Button
            onClick={() => fetchNews(false)}
            disabled={loading}
            className="gap-2"
            data-testid="fantasy-news-load-button"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Newspaper className="h-4 w-4" />}
            {feedType === 'team' ? 'Load team news' : 'Load player news'}
          </Button>
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={loading}
            className="gap-2 border-white/20"
            data-audit="refresh-news-button-works"
            data-testid="fantasy-news-refresh-button"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {lastSharedHeadline && (
        <p className="text-xs text-cyan-300" data-testid="fantasy-news-last-shared">
          Shared: {lastSharedHeadline}
        </p>
      )}

      {items.length > 0 && (
        <>
          <BreakingNewsBanner items={breaking} sport={sport} />
          <PlayerNewsPanel
            items={rest.length > 0 ? rest : items}
            title={feedType === 'team' ? 'Team feed' : 'Player feed'}
            sport={sport}
            onShare={(item) => {
              setLastSharedHeadline(item.headline || item.title);
            }}
          />
        </>
      )}
    </main>
  );
}
