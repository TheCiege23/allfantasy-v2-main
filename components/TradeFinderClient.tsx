'use client';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Trophy, Hammer, Scale, ExternalLink, ChevronDown, Target, Layers, ArrowDownToLine } from 'lucide-react';
import { useAI } from '@/hooks/useAI';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import PartnerMatchView from '@/components/PartnerMatchView';
import { isWeatherSensitiveSport } from '@/lib/weather/outdoorSportMetadata';
import { resolveSourceLink } from '@/lib/league-links/sourceLinkResolver';

type League = { id: string; name: string; sport: string; season: number; platformLeagueId: string; platform: string; isDynasty: boolean };

function computeTradeGrade(finderScore: number, valueDeltaPct: number, confidence: number | null): { letter: string; color: string; bg: string; border: string } {
  const absDelta = Math.abs(valueDeltaPct);
  const fairnessScore = absDelta <= 5 ? 100 : absDelta <= 10 ? 85 : absDelta <= 15 ? 70 : absDelta <= 25 ? 50 : Math.max(0, 100 - absDelta * 2);
  const confNorm = confidence != null ? confidence : 50;
  const composite = Math.round(finderScore * 0.50 + fairnessScore * 0.25 + confNorm * 0.25);

  const gradeMap: { min: number; letter: string; color: string; bg: string; border: string }[] = [
    { min: 90, letter: 'A+', color: 'text-emerald-300', bg: 'bg-emerald-500/20', border: 'border-emerald-500/50' },
    { min: 80, letter: 'A',  color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/40' },
    { min: 70, letter: 'B+', color: 'text-green-400',   bg: 'bg-green-500/15',   border: 'border-green-500/40' },
    { min: 60, letter: 'B',  color: 'text-lime-400',    bg: 'bg-lime-500/15',     border: 'border-lime-500/40' },
    { min: 50, letter: 'C+', color: 'text-yellow-400',  bg: 'bg-yellow-500/15',   border: 'border-yellow-500/40' },
    { min: 40, letter: 'C',  color: 'text-amber-400',   bg: 'bg-amber-500/15',    border: 'border-amber-500/40' },
    { min: 30, letter: 'D',  color: 'text-orange-400',  bg: 'bg-orange-500/15',   border: 'border-orange-500/40' },
    { min: 0,  letter: 'F',  color: 'text-red-400',     bg: 'bg-red-500/15',      border: 'border-red-500/40' },
  ];

  return gradeMap.find(g => composite >= g.min) || gradeMap[gradeMap.length - 1];
}

export default function TradeFinderClient({ initialLeagues, sleeperUserId }: { initialLeagues: League[]; sleeperUserId?: string | null }) {
  const searchParams = useSearchParams();
  const requestedLeagueId = searchParams?.get('leagueId');
  const requestedStrategy = searchParams?.get('strategy');
  const dynastyContext = searchParams?.get('context') === 'dynasty';
  const dynastyTeamId = searchParams?.get('dynastyTeamId') || '';
  const initialLeagueId = useMemo(
    () => (requestedLeagueId && initialLeagues.some((l) => l.id === requestedLeagueId) ? requestedLeagueId : (initialLeagues[0]?.id || '')),
    [initialLeagues, requestedLeagueId]
  );
  const initialStrategy: 'win-now' | 'rebuild' | 'balanced' =
    requestedStrategy === 'win-now' || requestedStrategy === 'rebuild' || requestedStrategy === 'balanced'
      ? requestedStrategy
      : 'balanced';
  const { callAI, loading, error } = useAI<{ recommendations?: any[]; suggestions?: any[]; candidates?: any[]; success?: boolean; meta?: any }>();
  const [leagueId, setLeagueId] = useState(initialLeagueId);
  const [strategy, setStrategy] = useState<'win-now' | 'rebuild' | 'balanced'>(initialStrategy);
  const [preset, setPreset] = useState<'NONE' | 'TARGET_POSITION' | 'ACQUIRE_PICKS' | 'CONSOLIDATE'>('NONE');
  const [targetPosition, setTargetPosition] = useState<'QB' | 'RB' | 'WR' | 'TE'>('RB');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [tab, setTab] = useState<'find' | 'partner'>('find');
  const [counterLoading, setCounterLoading] = useState<number | null>(null);
  const [expandedDeepWhy, setExpandedDeepWhy] = useState<Record<string, boolean>>({});
  const [dismissDynastyContext, setDismissDynastyContext] = useState(false);

  const selectedLeague = initialLeagues.find(l => l.id === leagueId);

  const NFL_TEAM_CITIES: Record<string, string> = {
    ARI: 'Glendale', ATL: 'Atlanta', BAL: 'Baltimore', BUF: 'Buffalo',
    CAR: 'Charlotte', CHI: 'Chicago', CIN: 'Cincinnati', CLE: 'Cleveland',
    DAL: 'Arlington', DEN: 'Denver', DET: 'Detroit', GB: 'Green Bay',
    HOU: 'Houston', IND: 'Indianapolis', JAX: 'Jacksonville', KC: 'Kansas City',
    LAC: 'Inglewood', LAR: 'Inglewood', LV: 'Las Vegas', MIA: 'Miami',
    MIN: 'Minneapolis', NE: 'Foxborough', NO: 'New Orleans', NYG: 'East Rutherford',
    NYJ: 'East Rutherford', PHI: 'Philadelphia', PIT: 'Pittsburgh', SEA: 'Seattle',
    SF: 'Santa Clara', TB: 'Tampa', TEN: 'Nashville', WAS: 'Landover',
  };

  const DOME_TEAMS = new Set(['ARI', 'ATL', 'DAL', 'DET', 'HOU', 'IND', 'LAC', 'LAR', 'LV', 'MIN', 'NO']);

  const enrichWithWeather = async (suggestion: any): Promise<any> => {
    const youGet = suggestion.youGet || '';
    const hasWeatherSensitive = /\bK\b|\bDEF\b|\bDST\b/i.test(youGet);
    if (!hasWeatherSensitive) return suggestion;

    const teamMatch = youGet.match(/\b([A-Z]{2,3})\b/);
    const teamAbbr = teamMatch?.[1];
    if (!teamAbbr || DOME_TEAMS.has(teamAbbr)) return suggestion;

    const city = NFL_TEAM_CITIES[teamAbbr];
    if (!city) return suggestion;

    const nextSunday = new Date();
    nextSunday.setDate(nextSunday.getDate() + ((7 - nextSunday.getDay()) % 7 || 7));
    const dateStr = nextSunday.toISOString().split('T')[0];

    try {
      const res = await fetch(`/api/weather/game?city=${encodeURIComponent(city)}&date=${dateStr}`);
      if (!res.ok) return suggestion;
      const weather = await res.json();
      if (weather.rain > 5 || weather.windSpeed > 20) {
        return {
          ...suggestion,
          reason: suggestion.reason + ` (Weather warning: ${city} forecast shows ${weather.description} — wind ${Math.round(weather.windSpeed)} mph, rain ${weather.rain}. Consider avoiding outdoor K/DEF.)`,
        };
      }
    } catch {}
    return suggestion;
  };

  const objectiveMap: Record<string, string> = {
    'win-now': 'WIN_NOW',
    'rebuild': 'REBUILD',
    'balanced': 'BALANCED',
  };

  const findTrades = async () => {
    if (!leagueId || !selectedLeague) return toast.error('Select a league first');
    setHasSearched(true);
    setExpandedDeepWhy({});

    const result = await callAI('/api/trade-finder', {
      league_id: selectedLeague.platformLeagueId,
      ...(sleeperUserId ? { sleeper_user_id: sleeperUserId } : { user_roster_id: 1 }),
      objective: objectiveMap[strategy] || 'BALANCED',
      mode: 'FAST',
      preset,
      ...(preset === 'TARGET_POSITION' ? { target_position: targetPosition } : {}),
    });

    if (result.data?.recommendations?.length) {
      const candidates = result.data.candidates || [];
      const mapped = result.data.recommendations.map((rec: any, i: number) => {
        const candidate = candidates.find((c: any) => c.tradeId === rec.tradeId);
        const conf = typeof rec.confidence === 'number' ? rec.confidence : rec.confidenceScore ?? null;
        const fScore = candidate?.finderScore ?? 50;
        const vDelta = candidate?.valueDeltaPct ?? 0;
        return {
          tradeId: rec.tradeId || `trade-${i}`,
          partner: `Team ${rec.tradeId?.split('-')[1] || '?'}`,
          partnerRosterId: candidate?.teamB?.teamId ? Number(candidate.teamB.teamId) : null,
          youGive: rec.teamA?.gives?.map((a: any) => a.name).join(' + ') || rec.summary || '',
          youGet: rec.teamA?.receives?.map((a: any) => a.name).join(' + ') || '',
          givesIds: rec.teamA?.gives?.map((a: any) => a.assetId) || [],
          receivesIds: rec.teamA?.receives?.map((a: any) => a.assetId) || [],
          reason: rec.whyItHelpsYou || rec.summary || rec.negotiationTip || '',
          confidence: conf,
          winProbDelta: rec.winProbDelta || null,
          negotiation: rec.negotiation,
          grade: computeTradeGrade(fScore, vDelta, conf),
          finderScore: fScore,
          whyItHelpsYou: rec.whyItHelpsYou || null,
          whyTheyAccept: rec.whyTheyAccept || null,
          negotiationTip: rec.negotiationTip || null,
          riskFlags: rec.riskFlags || [],
          fallbackAsset: rec.fallbackAsset || null,
          whyThisExists: candidate?.whyThisExists || [],
          archetype: candidate?.archetype || null,
          scoreBreakdown: candidate?.scoreBreakdown || null,
        };
      });
      const enriched = await Promise.all(mapped.map(enrichWithWeather));
      setSuggestions(enriched);
      toast.success(`Found ${enriched.length} trade ideas!`);
    } else if (result.data?.suggestions?.length) {
      const enriched = await Promise.all(result.data.suggestions.map(enrichWithWeather));
      setSuggestions(enriched);
      toast.success(`Found ${enriched.length} trade ideas!`);
    } else {
      setSuggestions([]);
      toast.info(result.data?.meta?.message || 'No trade opportunities found right now.');
    }
  };

  const handlePropose = (trade: any) => {
    if (!selectedLeague) return toast.error('League not selected');

    // Centralized, allowlisted source-platform link (no ad-hoc URL building); opens safely in a new tab.
    const link = resolveSourceLink({
      platform: selectedLeague.platform,
      sourceLeagueId: selectedLeague.platformLeagueId,
      leagueName: selectedLeague.name,
      season: selectedLeague.season,
      action: 'trade',
    });
    if (!link) return toast.info('This league is managed on its original platform.');
    const openSource = () => window.open(link.href, '_blank', 'noopener,noreferrer');

    toast.success(`Opening ${link.providerLabel}\n\nSuggested partner: ${trade.partner}\nYou give: ${trade.youGive}\nYou get: ${trade.youGet}`, {
      duration: 6000,
      action: { label: link.label, onClick: openSource },
    });

    openSource();
  };

  const simulateAccept = (trade: any, index: number) => {
    const newSuggestions = [...suggestions];
    newSuggestions[index] = {
      ...trade,
      status: 'accepted',
      outcome: `Trade accepted! ${trade.partner} loved the deal. Your win probability ${trade.winProbDelta || '+12%'}`,
    };
    setSuggestions(newSuggestions);
    toast.success(`Trade with ${trade.partner} accepted in simulation!`, { description: 'Win probability improved' });
  };

  const simulateReject = (trade: any, index: number) => {
    const newSuggestions = [...suggestions];
    newSuggestions[index] = {
      ...trade,
      status: 'rejected',
      outcome: `${trade.partner} rejected — they said your offer was too light on future value.`,
    };
    setSuggestions(newSuggestions);
    toast.error(`Offer rejected by ${trade.partner}`);
  };

  const simulateCounter = async (trade: any, index: number) => {
    setCounterLoading(index);
    try {
      const { data } = await callAI('/api/dynasty-trade-analyzer', {
        sideA: trade.youGive,
        sideB: trade.youGet,
        leagueContext: 'Counter-offer simulation from partner perspective',
        counterFromPartner: true,
      });

      if (data) {
        const analysis = (data as any);
        const newSuggestions = [...suggestions];
        newSuggestions[index] = {
          ...trade,
          status: 'countered',
          counterOffer: analysis,
          outcome: analysis.youGiveAdjusted
            ? `Counter from ${trade.partner}: "${analysis.reason || 'I need a bit more.'}" They'd give ${analysis.youGiveAdjusted} and want you to add ${analysis.youWantAdded || 'a future pick'}.`
            : `Counter from ${trade.partner}: ${analysis.valueDelta || 'They want more value'}. ${analysis.recommendations?.[0] || ''}`,
        };
        setSuggestions(newSuggestions);
        toast.info(`Counter received from ${trade.partner}`, {
          description: analysis.dynastyVerdict || 'They adjusted the deal slightly.',
          duration: 8000,
        });
      } else {
        const newSuggestions = [...suggestions];
        newSuggestions[index] = {
          ...trade,
          status: 'countered',
          outcome: `${trade.partner} is interested but wants more. They counter-offered: swap ${trade.youGive || 'your piece'} + a future pick for ${trade.youGet || 'their piece'} + a prospect.`,
        };
        setSuggestions(newSuggestions);
        toast.info(`${trade.partner} sent a counter offer!`, { description: 'Review the updated terms' });
      }
    } catch {
      const newSuggestions = [...suggestions];
      newSuggestions[index] = {
        ...trade,
        status: 'countered',
        outcome: `${trade.partner} is interested but wants more. They counter-offered: swap ${trade.youGive || 'your piece'} + a future pick for ${trade.youGet || 'their piece'} + a prospect.`,
      };
      setSuggestions(newSuggestions);
      toast.info(`${trade.partner} sent a counter offer!`, { description: 'Review the updated terms' });
    } finally {
      setCounterLoading(null);
    }
  };

  return (
    <div className="space-y-10">
      <div className="flex rounded-xl overflow-hidden border border-purple-900/50 mb-2">
        <button
          onClick={() => setTab('find')}
          className={cn(
            'flex-1 py-4 px-6 text-center font-medium transition-all',
            tab === 'find' ? 'bg-gradient-to-r from-teal-600 to-purple-600 text-white' : 'bg-black/40 text-gray-400 hover:text-gray-200'
          )}
        >
          Find Trades
        </button>
        <button
          onClick={() => setTab('partner')}
          className={cn(
            'flex-1 py-4 px-6 text-center font-medium transition-all',
            tab === 'partner' ? 'bg-gradient-to-r from-teal-600 to-purple-600 text-white' : 'bg-black/40 text-gray-400 hover:text-gray-200'
          )}
        >
          Partner Match
        </button>
      </div>

      {dynastyContext && !dismissDynastyContext && (
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-sm text-violet-100">
          <div className="flex items-start justify-between gap-2">
            <p>
              Dynasty context enabled
              {dynastyTeamId ? ` for team ${dynastyTeamId}` : ''}. Suggestions should prioritize
              long-term roster direction, aging risk, and pick-value leverage.
            </p>
            <button
              type="button"
              onClick={() => setDismissDynastyContext(true)}
              className="shrink-0 rounded border border-violet-400/30 px-2 py-0.5 text-xs text-violet-200 hover:bg-violet-500/20"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {tab === 'partner' ? (
        <PartnerMatchView leagueId={selectedLeague?.id || leagueId || ''} />
      ) : (<>
      <div className="flex flex-col md:flex-row gap-4 items-stretch bg-gradient-to-r from-purple-950/80 to-black/80 p-4 rounded-xl border border-purple-500/30 backdrop-blur-md">
        <Select value={leagueId} onValueChange={setLeagueId}>
          <SelectTrigger className="flex-1 bg-gray-950 border-cyan-800">
            <SelectValue placeholder="Select League" />
          </SelectTrigger>
          <SelectContent>
            {initialLeagues.map(l => (
              <SelectItem key={l.id} value={l.id}>
                {l.name} ({l.sport} {l.season})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-3 flex-wrap">
          <Button
            variant={strategy === 'win-now' ? 'default' : 'outline'}
            onClick={() => setStrategy('win-now')}
            className="flex-1 gap-2 border-cyan-800"
          >
            <Trophy className="h-4 w-4" /> Win Now
          </Button>
          <Button
            variant={strategy === 'rebuild' ? 'default' : 'outline'}
            onClick={() => setStrategy('rebuild')}
            className="flex-1 gap-2 border-purple-800"
          >
            <Hammer className="h-4 w-4" /> Rebuild
          </Button>
          <Button
            variant={strategy === 'balanced' ? 'default' : 'outline'}
            onClick={() => setStrategy('balanced')}
            className="flex-1 gap-2 border-pink-800"
          >
            <Scale className="h-4 w-4" /> Balanced
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 bg-black/40 p-3 rounded-xl border border-gray-800">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Focus Preset</p>
        <div className="flex gap-2 flex-wrap">
          {([
            { key: 'NONE' as const, label: 'Any', icon: null },
            { key: 'TARGET_POSITION' as const, label: 'Target Position', icon: Target },
            { key: 'ACQUIRE_PICKS' as const, label: 'Acquire Picks', icon: ArrowDownToLine },
            { key: 'CONSOLIDATE' as const, label: 'Consolidate', icon: Layers },
          ] as const).map(({ key, label, icon: Icon }) => (
            <Button
              key={key}
              variant={preset === key ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPreset(key)}
              className={cn(
                'gap-1.5 text-xs',
                preset === key
                  ? 'bg-gradient-to-r from-cyan-700 to-purple-700'
                  : 'border-gray-700 text-gray-400 hover:text-gray-200'
              )}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {label}
            </Button>
          ))}
        </div>
        {preset === 'TARGET_POSITION' && (
          <div className="flex gap-2">
            {(['QB', 'RB', 'WR', 'TE'] as const).map(pos => (
              <Button
                key={pos}
                variant={targetPosition === pos ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTargetPosition(pos)}
                className={cn(
                  'flex-1 text-xs font-bold',
                  targetPosition === pos
                    ? 'bg-cyan-700 hover:bg-cyan-600'
                    : 'border-gray-700 text-gray-400 hover:text-gray-200'
                )}
              >
                {pos}
              </Button>
            ))}
          </div>
        )}
      </div>

      <Button
        onClick={findTrades}
        disabled={loading || !leagueId}
        className="w-full h-12 text-lg bg-gradient-to-r from-cyan-600 via-purple-600 to-pink-600 hover:opacity-90"
      >
        {loading ? 'Searching for trades...' : preset === 'NONE' ? 'Find Trades' : `Find ${preset === 'TARGET_POSITION' ? targetPosition : preset === 'ACQUIRE_PICKS' ? 'Pick' : 'Consolidation'} Trades`}
      </Button>

      {selectedLeague && isWeatherSensitiveSport(selectedLeague.sport) ? (
        <p className="rounded-lg border border-cyan-500/25 bg-cyan-500/5 px-3 py-2 text-center text-[11px] text-cyan-100/85">
          🌤 Where player projections are shown elsewhere in AllFantasy, the <span className="font-bold">AF</span> crest opens
          weather-adjusted scoring — trade cards here still summarize AI; cross-check outdoor starts in roster / matchup views.
        </p>
      ) : null}

      {loading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="border-purple-900/20 bg-black/30 backdrop-blur-sm">
              <CardHeader className="pb-2">
                <div className="h-6 w-3/4 bg-gray-700 rounded animate-pulse" />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <div className="space-y-2">
                    <div className="h-5 w-32 bg-gray-700 rounded animate-pulse" />
                    <div className="h-4 w-48 bg-gray-700 rounded animate-pulse" />
                  </div>
                  <div className="h-5 w-20 bg-gray-700 rounded animate-pulse" />
                </div>
                <div className="h-4 w-full bg-gray-700 rounded animate-pulse" />
                <div className="flex gap-3 justify-end">
                  <div className="h-9 w-20 bg-gray-700 rounded animate-pulse" />
                  <div className="h-9 w-24 bg-gray-700 rounded animate-pulse" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-16 text-red-400 border border-red-900/40 rounded-2xl bg-red-950/30">
          <p>{error}</p>
          <Button variant="outline" className="mt-6 border-red-800 text-red-300 hover:bg-red-950/50" onClick={findTrades}>
            Try Again
          </Button>
        </div>
      ) : suggestions.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {suggestions.map((trade, i) => (
            <Card key={i} className={cn(
              'backdrop-blur-sm transition-all',
              trade.status === 'accepted' ? 'border-green-500/60 bg-green-950/20' :
              trade.status === 'rejected' ? 'border-red-500/40 bg-red-950/10 opacity-60' :
              trade.status === 'countered' ? 'border-yellow-500/50 bg-yellow-950/15' :
              'border-purple-900/40 bg-black/50 hover:border-purple-500/60'
            )}>
              <CardHeader className="relative">
                <CardTitle className="flex justify-between text-lg pr-14">
                  <span>Trade Idea #{i + 1}</span>
                  <span className="text-cyan-400 text-sm font-normal">{trade.partner}</span>
                </CardTitle>
                {trade.grade && (
                  <div className={cn(
                    'absolute top-3 right-4 flex items-center justify-center w-11 h-11 rounded-lg border text-lg font-black',
                    trade.grade.color, trade.grade.bg, trade.grade.border
                  )}>
                    {trade.grade.letter}
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between text-sm">
                  <div>
                    <p className="font-medium text-cyan-300">You give</p>
                    <p>{trade.youGive}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-purple-300">You get</p>
                    <p>{trade.youGet}</p>
                  </div>
                </div>
                {(trade.confidence != null || trade.winProbDelta || trade.finderScore != null) && (
                  <div className="flex justify-between text-sm mt-3 pt-3 border-t border-gray-800">
                    {trade.finderScore != null && (
                      <div>
                        <span className="text-gray-400">Score:</span>
                        <span className={cn(
                          'ml-1 font-bold',
                          trade.finderScore >= 70 ? 'text-green-400' :
                          trade.finderScore >= 50 ? 'text-yellow-400' :
                          trade.finderScore >= 30 ? 'text-orange-400' : 'text-gray-400'
                        )}>
                          {trade.finderScore}
                        </span>
                      </div>
                    )}
                    {trade.confidence != null && (
                      <div>
                        <span className="text-gray-400">Confidence:</span>
                        <span className={cn(
                          'ml-1 font-bold',
                          trade.confidence >= 75 ? 'text-green-400' :
                          trade.confidence >= 50 ? 'text-yellow-400' :
                          trade.confidence >= 25 ? 'text-orange-400' : 'text-gray-400'
                        )}>
                          {trade.confidence}%
                        </span>
                      </div>
                    )}
                    {trade.winProbDelta && (
                      <div>
                        <span className="text-gray-400">Win &#916;:</span>
                        <span className={cn(
                          'ml-1 font-bold',
                          trade.winProbDelta.startsWith('+') ? 'text-green-400' :
                          trade.winProbDelta.startsWith('-') ? 'text-red-400' : 'text-gray-300'
                        )}>
                          {trade.winProbDelta}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                <div className="text-xs text-gray-400 border-t border-gray-800 pt-3">
                  {trade.reason}
                </div>
                {(trade.whyItHelpsYou || trade.whyTheyAccept || trade.riskFlags?.length > 0 || trade.scoreBreakdown || trade.whyThisExists?.length > 0) && (() => {
                  const tradeKey = trade.tradeId || `trade-${i}`;
                  return (
                  <div className="border border-gray-800 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpandedDeepWhy(prev => ({ ...prev, [tradeKey]: !prev[tradeKey] }))}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-300 hover:bg-gray-800/50 transition-colors"
                    >
                      <span>Deep Why</span>
                      <ChevronDown className={cn('h-3.5 w-3.5 text-gray-500 transition-transform', expandedDeepWhy[tradeKey] && 'rotate-180')} />
                    </button>
                    {expandedDeepWhy[tradeKey] && (
                      <div className="px-3 pb-3 space-y-3 border-t border-gray-800">
                        {trade.whyItHelpsYou && (
                          <div className="pt-3">
                            <p className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider mb-1">Value Angle</p>
                            <p className="text-xs text-gray-300">{trade.whyItHelpsYou}</p>
                            {trade.whyThisExists?.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {trade.whyThisExists.map((tag: string, ti: number) => (
                                  <span key={ti} className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/50 text-cyan-400/80 border border-cyan-800/30">{tag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {trade.scoreBreakdown && (
                          <div>
                            <p className="text-[11px] font-semibold text-purple-400 uppercase tracking-wider mb-1.5">Roster Fit</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                              {[
                                { label: 'Starter Upgrade', value: trade.scoreBreakdown.starterUpgrade },
                                { label: 'Objective Fit', value: trade.scoreBreakdown.objectiveAlignment },
                                { label: 'Value Fairness', value: trade.scoreBreakdown.valueFairness },
                                { label: 'Roster Fit', value: trade.scoreBreakdown.rosterFit },
                              ].map(({ label, value }) => (
                                <div key={label} className="flex items-center justify-between">
                                  <span className="text-[10px] text-gray-500">{label}</span>
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-12 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                                      <div
                                        className={cn('h-full rounded-full', value >= 70 ? 'bg-green-500' : value >= 40 ? 'bg-yellow-500' : 'bg-orange-500')}
                                        style={{ width: `${Math.min(100, value)}%` }}
                                      />
                                    </div>
                                    <span className="text-[10px] text-gray-400 w-5 text-right">{value}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {trade.whyTheyAccept && (
                          <div>
                            <p className="text-[11px] font-semibold text-green-400 uppercase tracking-wider mb-1">Partner Acceptance</p>
                            <p className="text-xs text-gray-300">{trade.whyTheyAccept}</p>
                            {trade.negotiationTip && (
                              <p className="text-[11px] text-gray-500 mt-1 italic">Tip: {trade.negotiationTip}</p>
                            )}
                          </div>
                        )}
                        {trade.riskFlags?.length > 0 && (
                          <div>
                            <p className="text-[11px] font-semibold text-orange-400 uppercase tracking-wider mb-1">Risk Flags</p>
                            <ul className="space-y-1">
                              {trade.riskFlags.map((flag: string, fi: number) => (
                                <li key={fi} className="text-xs text-orange-300/80 flex items-start gap-1.5">
                                  <span className="text-orange-500 mt-0.5 shrink-0">!</span>
                                  {flag}
                                </li>
                              ))}
                            </ul>
                            {trade.fallbackAsset && (
                              <p className="text-[11px] text-gray-500 mt-1.5">Plan B: Target <span className="text-gray-300">{trade.fallbackAsset}</span> instead</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })()}
                {trade.negotiation?.dmMessages?.[0] && (
                  <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
                    <p className="text-xs text-gray-500 mb-1">Suggested DM:</p>
                    <p className="text-xs text-gray-300 italic">&ldquo;{trade.negotiation.dmMessages[0].message}&rdquo;</p>
                  </div>
                )}
                {trade.status === 'countered' && trade.counterOffer && (
                  <div className="mt-4 p-4 rounded-lg bg-yellow-950/40 border border-yellow-700/50">
                    <p className="font-medium text-yellow-300 mb-2">Counter from {trade.partner}:</p>
                    {trade.counterOffer.youGiveAdjusted && (
                      <p className="text-sm text-gray-200">They want: <span className="text-yellow-200 font-medium">{trade.counterOffer.youGiveAdjusted}</span></p>
                    )}
                    {trade.counterOffer.youWantAdded && (
                      <p className="text-sm text-gray-300 mt-1">Plus they ask for: <span className="text-yellow-200/80">{trade.counterOffer.youWantAdded}</span></p>
                    )}
                    {trade.counterOffer.reason && (
                      <p className="text-xs text-gray-400 mt-2 italic">&ldquo;{trade.counterOffer.reason}&rdquo;</p>
                    )}
                    {trade.counterOffer.factors?.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {trade.counterOffer.factors.slice(0, 3).map((f: string, fi: number) => (
                          <li key={fi} className="text-xs text-gray-400 flex gap-1.5">
                            <span className="text-yellow-500/70">&#8226;</span>
                            {f}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {trade.status === 'accepted' || trade.status === 'rejected' || (trade.status === 'countered' && !trade.counterOffer) ? (
                  <div className={cn(
                    'mt-4 p-3 rounded-lg text-sm font-medium',
                    trade.status === 'accepted' ? 'bg-green-950/50 text-green-300' :
                    trade.status === 'countered' ? 'bg-yellow-950/50 text-yellow-300' :
                    'bg-red-950/50 text-red-300'
                  )}>
                    {trade.outcome}
                  </div>
                ) : trade.status !== 'countered' && (
                  <>
                    <div className="flex justify-end gap-3 mt-4">
                      <Button
                        size="sm"
                        onClick={() => handlePropose(trade)}
                        className="bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-600 hover:to-purple-700 gap-1.5"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Propose in Sleeper
                      </Button>
                      <Button size="sm" variant="outline" className="border-gray-700">Details</Button>
                    </div>
                    <div className="flex gap-3 mt-5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => simulateReject(trade, i)}
                        className="flex-1 border-red-500/50 text-red-400 hover:bg-red-950/40"
                      >
                        Reject
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => simulateCounter(trade, i)}
                        disabled={counterLoading === i}
                        className="flex-1 border-yellow-500/50 text-yellow-400 hover:bg-yellow-950/40 disabled:opacity-50"
                      >
                        {counterLoading === i ? 'Analyzing...' : 'Counter Offer'}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => simulateAccept(trade, i)}
                        className="flex-1 bg-green-600 hover:bg-green-700"
                      >
                        Accept
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 text-gray-500 border border-dashed border-gray-700 rounded-2xl">
          {hasSearched
            ? 'No trade opportunities found. Try a different strategy.'
            : 'Select a league & strategy, then click "Find Trades" to see AI-powered suggestions'}
        </div>
      )}
      </>)}
    </div>
  );
}
