'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAI } from '@/hooks/useAI';
import { resolvesToLeagueRecord, type LeagueRecordPolicyInput } from '@/lib/dashboard/league-card-fetch-policy';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/legacy-ui';

type Suggestion = { playerName: string; position: string; team: string; reason: string; priority: number };
type League = { id: string; name: string; platform?: string; scoring?: string } & LeagueRecordPolicyInput;

export default function WaiverAISuggestions() {
  const { callAI, loading } = useAI<{ suggestions: Suggestion[] }>();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [leagueId, setLeagueId] = useState('');
  const [rosterWeakness, setRosterWeakness] = useState('auto');
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loadingLeagues, setLoadingLeagues] = useState(true);

  useEffect(() => {
    async function fetchLeagues() {
      try {
        const res = await fetch('/api/league/list');
        if (res.ok) {
          const data = await res.json();
          /*
           * ⚠ `/api/waiver-ai-suggest` resolves `leagueId` against the `leagues` table. The list
           * also carries AF Legacy rows and tournament hubs, whose ids live in other tables —
           * picking one produces a request that cannot be answered. Filtered here rather than at
           * submit, so the dropdown only offers leagues the engine can actually read.
           */
          const rows = (Array.isArray(data.leagues) ? data.leagues : []) as League[];
          setLeagues(rows.filter((l) => resolvesToLeagueRecord(l as LeagueRecordPolicyInput)));
        }
      } catch {
      } finally {
        setLoadingLeagues(false);
      }
    }
    fetchLeagues();
  }, []);

  const generateSuggestions = async () => {
    if (!leagueId) return toast.error('Select a league');

    const { data } = await callAI(
      '/api/waiver-ai-suggest',
      {
        leagueId,
        rosterWeakness: rosterWeakness === 'auto' ? undefined : rosterWeakness,
      },
      { successMessage: 'Waiver suggestions generated!' }
    );

    if (data?.suggestions) {
      setSuggestions(data.suggestions);
    }
  };

  return (
    <div className="space-y-8">
      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-300">League</label>
          <Select value={leagueId} onValueChange={setLeagueId}>
            <SelectTrigger className="bg-gray-950 border-cyan-800">
              <SelectValue placeholder={loadingLeagues ? 'Loading leagues...' : 'Select League'} />
            </SelectTrigger>
            <SelectContent>
              {leagues.map((lg) => (
                <SelectItem key={lg.id} value={lg.id}>
                  {lg.name || 'Unnamed League'}{lg.platform ? ` (${lg.platform})` : ''}
                </SelectItem>
              ))}
              {leagues.length === 0 && !loadingLeagues && (
                <SelectItem value="_none" disabled>No leagues found - import one first</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-gray-300">Focus Position</label>
          <Select value={rosterWeakness} onValueChange={setRosterWeakness}>
            <SelectTrigger className="bg-gray-950 border-purple-800">
              <SelectValue placeholder="Auto-detect weak spots" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (from roster)</SelectItem>
              <SelectItem value="QB">QB</SelectItem>
              <SelectItem value="RB">RB</SelectItem>
              <SelectItem value="WR">WR</SelectItem>
              <SelectItem value="TE">TE</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end">
          <Button
            onClick={generateSuggestions}
            disabled={loading || !leagueId}
            className="w-full h-10 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-700 hover:to-purple-700"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? 'Analyzing...' : 'Generate Suggestions'}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="border-purple-900/20 bg-black/30 backdrop-blur-sm">
              <CardHeader className="pb-2">
                <Skeleton className="h-6 w-3/4 rounded" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full rounded" />
                <Skeleton className="h-4 w-full rounded" />
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-20 rounded" />
                  <Skeleton className="h-4 w-12 rounded" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : suggestions.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[...suggestions].sort((a, b) => b.priority - a.priority).map((s, i) => (
            <Card key={i} className="border-purple-900/40 bg-black/50 backdrop-blur-sm hover:border-purple-500/60 transition-colors">
              <CardContent className="pt-5">
                <div className="flex justify-between items-start gap-3">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-white">
                      {s.playerName} <span className="text-gray-400 text-sm font-normal">({s.position} - {s.team})</span>
                    </h3>
                    <p className="text-gray-300 mt-2 text-sm">{s.reason}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-bold text-cyan-400">#{i + 1}</div>
                    <div className="text-xs text-gray-500">Priority {s.priority}/10</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-gray-500 border border-dashed border-gray-700 rounded-2xl">
          Select a league and generate suggestions to see targeted waiver wire adds based on your roster needs.
        </div>
      )}
    </div>
  );
}
