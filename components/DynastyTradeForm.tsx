'use client';

import { useState, useEffect, useMemo } from 'react';
import NextLink from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ArrowLeftRight, Plus, X, Loader2, TrendingUp, Search, Download, Share2, Link as LinkIcon, Shield, Target, MessageSquare, AlertTriangle, XCircle, Clock } from 'lucide-react';
import {
  buildTradeSummaryForAI,
  canSubmitTradeByAssets,
  getEmptyTradeState,
  getSportOptions,
  getTotalTradeAssetCount,
  getTradeAnalyzerAIChatUrl,
  removeAssetById,
  swapSides as swapAssetSides,
  DEFAULT_LEAGUE_CONTEXT,
} from '@/lib/trade-analyzer';
import { normalizeToSupportedSport } from '@/lib/sport-scope';
import { Skeleton } from '@/components/ui/legacy-ui';
import { PlayerAutocomplete } from '@/components/PlayerAutocomplete';
import { useAI } from '@/hooks/useAI';
import TradeAnalysisBadges from '@/components/TradeAnalysisBadges';
import AIFailureStateRenderer from '@/components/ai-reliability/AIFailureStateRenderer';
import StickyAIActions from '@/components/ai-interface/StickyAIActions';
import { GradeLeaguePicker, gradeLeagueOptions, type GradeLeagueListRow } from '@/components/trade-evaluator/GradeLeaguePicker';
import { DynastyLeagueGrade, NOT_GRADED_WINNER, winnerFromLeagueGrade, type DynastyTradeGrade } from '@/components/dynasty-trade/DynastyLeagueGrade';
import { shareableLeagueGrade } from '@/components/dynasty-trade/sharedTrade';
import type { DynastyAnalyzerClientSections } from '@/lib/trade-engine/dynastyAnalyzerClientView';

type Player = {
  id: string;
  name: string;
  position: string;
  team: string | null;
};

interface TradeAsset {
  id: string;
  name: string;
  type: 'player' | 'pick';
}

/*
 * 🛑 THE PAGE PRINTS THE ONE GRADE AND FACTS, NEVER THE DUAL-BRAIN VERDICT (2026-09-29). The route no
 * longer sends its winner, verdict, confidence, value delta or veto risk; this is what is left.
 */
interface TradeResult {
  factors: string[];
  agingConcerns?: string[];
  recommendations?: string[];
}

interface CanonicalContextMeta {
  contextId?: string;
  dataFreshness?: {
    compositeGrade: string;
    compositeScore: number;
    sources?: Record<string, { grade: string; age: string }>;
    warnings?: string[];
  } | null;
  dataCoverage?: {
    tier: 'FULL' | 'PARTIAL' | 'MINIMAL';
    score: number;
    badge: { label: string; description: string; color: 'green' | 'yellow' | 'red' };
    dimensions?: {
      assetCoverage?: { score: number; detail: string };
      sourceFreshness?: { score: number; detail: string };
      dataCompleteness?: { score: number; detail: string };
    };
  } | null;
}

/** The route's allowlisted sections — see lib/trade-engine/dynastyAnalyzerClientView.ts. */
type TradeSections = DynastyAnalyzerClientSections;

interface PlayerValue {
  value: number;
  tier: string;
  trend: string;
  summary: string;
  comparables: string[];
}

const SPORT_OPTIONS = getSportOptions();
const DEFAULT_DYNASTY_SPORT = SPORT_OPTIONS[0]?.value ?? 'NFL';
const EMPTY_DYNASTY_STATE = getEmptyTradeState({ leagueContext: DEFAULT_LEAGUE_CONTEXT });

export default function DynastyTradeForm() {
  const { callAI, loading } = useAI<{ analysis: TradeResult; sections: TradeSections; canonicalContext?: CanonicalContextMeta; tradeGrade?: DynastyTradeGrade }>();
  /* The league THE grade is taken in (2026-09-27). Sent as `gradeLeagueId`, used for the grade only. */
  const [gradeLeagueId, setGradeLeagueId] = useState('');
  const [leagueRows, setLeagueRows] = useState<GradeLeagueListRow[]>([]);
  const [tradeGrade, setTradeGrade] = useState<DynastyTradeGrade | null>(null);
  const [gradedInLeague, setGradedInLeague] = useState(false);
  const gradeLeagues = useMemo(() => gradeLeagueOptions(leagueRows), [leagueRows]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/league/list?summary=1');
        if (!res.ok) return;
        const data = (await res.json()) as { leagues?: GradeLeagueListRow[] };
        if (!cancelled) setLeagueRows(data.leagues ?? []);
      } catch {
        /* no picker options — the trade is still analyzed, and the grade says why it is missing */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [teamAName, setTeamAName] = useState(EMPTY_DYNASTY_STATE.teamAName);
  const [teamBName, setTeamBName] = useState(EMPTY_DYNASTY_STATE.teamBName);
  const [teamAAssets, setTeamAAssets] = useState<TradeAsset[]>([]);
  const [teamBAssets, setTeamBAssets] = useState<TradeAsset[]>([]);
  const [teamAPickInput, setTeamAPickInput] = useState('');
  const [teamBPickInput, setTeamBPickInput] = useState('');
  const [leagueContext, setLeagueContext] = useState(EMPTY_DYNASTY_STATE.leagueContext);
  const [sport, setSport] = useState<string>(DEFAULT_DYNASTY_SPORT);
  const [result, setResult] = useState<TradeResult | null>(null);
  const [sections, setSections] = useState<TradeSections | null>(null);
  const [canonicalCtx, setCanonicalCtx] = useState<CanonicalContextMeta | null>(null);
  const [reliability, setReliability] = useState<{ usedDeterministicFallback?: boolean; fallbackExplanation?: string; providerResults?: { provider: string; status: string; error?: string }[]; dataQualityWarnings?: string[] } | null>(null);
  const [playerValues, setPlayerValues] = useState<Record<string, PlayerValue>>({});
  const [valueLookupLoading, setValueLookupLoading] = useState<string | null>(null);
  const [lastAnalyzedSignature, setLastAnalyzedSignature] = useState<string | null>(null);

  const currentInputSignature = useMemo(
    () =>
      JSON.stringify({
        sport,
        leagueContext,
        gradeLeagueId,
        teamAAssets: teamAAssets.map((asset) => asset.name),
        teamBAssets: teamBAssets.map((asset) => asset.name),
      }),
    [sport, leagueContext, gradeLeagueId, teamAAssets, teamBAssets]
  );
  const analysisStale = Boolean(result) && Boolean(lastAnalyzedSignature) && lastAnalyzedSignature !== currentInputSignature;

  useEffect(() => {
    try {
      const saved = localStorage.getItem('dynastyTrade');
      if (saved) {
        const data = JSON.parse(saved);
        if (data.teamAName) setTeamAName(data.teamAName);
        if (data.teamBName) setTeamBName(data.teamBName);
        if (data.teamAAssets) setTeamAAssets(data.teamAAssets);
        if (data.teamBAssets) setTeamBAssets(data.teamBAssets);
        if (data.leagueContext) setLeagueContext(data.leagueContext);
        if (data.sport) setSport(normalizeToSupportedSport(data.sport));
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('dynastyTrade', JSON.stringify({
        teamAName, teamBName, teamAAssets, teamBAssets, leagueContext, sport,
      }));
    } catch {}
  }, [teamAName, teamBName, teamAAssets, teamBAssets, leagueContext, sport]);

  function addPlayerAsset(side: 'a' | 'b', player: Player | null) {
    if (!player) return;
    const asset: TradeAsset = { id: player.id, name: `${player.name} (${player.position})`, type: 'player' };
    if (side === 'a') {
      setTeamAAssets(prev => [...prev, asset]);
    } else {
      setTeamBAssets(prev => [...prev, asset]);
    }
  }

  async function lookupPlayerValue(assetId: string, playerName: string) {
    if (playerValues[assetId]) {
      setPlayerValues(prev => {
        const next = { ...prev };
        delete next[assetId];
        return next;
      });
      return;
    }
    setValueLookupLoading(assetId);
    try {
      const res = await fetch('/api/player-value', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName, leagueContext }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setPlayerValues(prev => ({ ...prev, [assetId]: data }));
    } catch {
      toast.error('Could not look up value');
    } finally {
      setValueLookupLoading(null);
    }
  }

  const pickFormatHint = (val: string) => {
    if (val.length > 3 && !/^\d{4}\s*(1st|2nd|3rd|4th|5th)/i.test(val)) {
      toast.warning('Format tip: "2026 1st" or "2027 2nd mid"', { id: 'pick-format' });
    }
  };

  function addPickAsset(side: 'a' | 'b', name: string) {
    if (!name.trim()) return;
    const asset: TradeAsset = { id: `${Date.now()}-${Math.random()}`, name: name.trim(), type: 'pick' };
    if (side === 'a') {
      setTeamAAssets(prev => [...prev, asset]);
      setTeamAPickInput('');
    } else {
      setTeamBAssets(prev => [...prev, asset]);
      setTeamBPickInput('');
    }
  }

  function removeAsset(side: 'a' | 'b', id: string) {
    if (side === 'a') setTeamAAssets(prev => removeAssetById(prev, id));
    else setTeamBAssets(prev => removeAssetById(prev, id));
  }

  async function handleAnalyze() {
    const teamAAssetCount = getTotalTradeAssetCount(
      teamAAssets.filter((a) => a.type === 'player').map((a) => ({ name: a.name })),
      teamAAssets.filter((a) => a.type === 'pick').map(() => ({ year: '1', round: '1' })),
      0
    );
    const teamBAssetCount = getTotalTradeAssetCount(
      teamBAssets.filter((a) => a.type === 'player').map((a) => ({ name: a.name })),
      teamBAssets.filter((a) => a.type === 'pick').map(() => ({ year: '1', round: '1' })),
      0
    );
    if (!canSubmitTradeByAssets(teamAAssetCount, teamBAssetCount, true)) {
      toast.error('Both sides need at least one asset');
      return;
    }

    const sideADesc = teamAAssets.map(a => a.name).join(' + ');
    const sideBDesc = teamBAssets.map(a => a.name).join(' + ');

    const { data } = await callAI(
      '/api/dynasty-trade-analyzer',
      {
        sideA: sideADesc,
        sideB: sideBDesc,
        leagueContext,
        sport,
        ...(gradeLeagueId ? { gradeLeagueId } : {}),
        gradeSideA: teamAAssets.map((a) => ({ name: a.name, type: a.type })),
        gradeSideB: teamBAssets.map((a) => ({ name: a.name, type: a.type })),
      },
      { successMessage: 'Trade analyzed!' }
    );

    if (data?.analysis) {
      setTradeGrade(data.tradeGrade ?? null);
      setGradedInLeague(Boolean(gradeLeagueId));
      const a = data.analysis;
      // 🛑 No winner, verdict, confidence or value delta is kept: the winner is read off THE letter.
      setResult({
        factors: Array.isArray(a.factors) ? a.factors : [],
        agingConcerns: a.agingConcerns,
        recommendations: a.recommendations,
      });
      if (data.sections) {
        setSections(data.sections);
      } else {
        setSections(null);
      }
      if (data.canonicalContext) {
        setCanonicalCtx(data.canonicalContext);
      }
      setLastAnalyzedSignature(currentInputSignature);
      const rel = (data as { reliability?: { fallbackExplanation?: string }; fallbackExplanation?: string }).reliability;
      setReliability(rel ? {
        ...rel,
        fallbackExplanation: (data as { fallbackExplanation?: string }).fallbackExplanation ?? rel.fallbackExplanation,
      } : null);
    }
  }

  function AssetList({ side, assets }: { side: 'a' | 'b'; assets: TradeAsset[] }) {
    return (
      <div className="space-y-2 min-h-[40px]">
        {assets.length === 0 && (
          <span className="text-sm text-gray-500 italic">No assets added yet</span>
        )}
        {assets.map(asset => (
          <div key={asset.id} className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={`gap-1.5 py-1.5 px-3 ${
                  asset.type === 'player'
                    ? 'border-cyan-500/40 text-cyan-300 bg-cyan-950/20'
                    : 'border-amber-500/40 text-amber-300 bg-amber-950/20'
                }`}
              >
                {asset.type === 'pick' && <span>📋 </span>}
                {asset.name}
                <button onClick={() => removeAsset(side, asset.id)} className="ml-1 hover:text-red-400">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
              {asset.type === 'player' && (
                <button
                  onClick={() => lookupPlayerValue(asset.id, asset.name)}
                  disabled={valueLookupLoading === asset.id}
                  className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 disabled:opacity-50"
                >
                  {valueLookupLoading === asset.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Search className="h-3 w-3" />
                  )}
                  {playerValues[asset.id] ? 'Hide' : 'Value'}
                </button>
              )}
            </div>
            {playerValues[asset.id] && (
              <div className="ml-2 p-2 rounded bg-gray-900/80 border border-gray-700/50 text-xs space-y-1">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-white">{playerValues[asset.id].value}/100</span>
                  <Badge variant="outline" className={`text-[11px] py-0 ${
                    playerValues[asset.id].tier === 'Elite' ? 'border-yellow-500/40 text-yellow-300' :
                    playerValues[asset.id].tier === 'Star' ? 'border-cyan-500/40 text-cyan-300' :
                    playerValues[asset.id].tier === 'Starter' ? 'border-green-500/40 text-green-300' :
                    'border-gray-500/40 text-gray-400'
                  }`}>
                    {playerValues[asset.id].tier}
                  </Badge>
                  <span className={`${
                    playerValues[asset.id].trend === 'Rising' ? 'text-green-400' :
                    playerValues[asset.id].trend === 'Declining' ? 'text-red-400' :
                    'text-gray-400'
                  }`}>
                    {playerValues[asset.id].trend === 'Rising' ? '↑' : playerValues[asset.id].trend === 'Declining' ? '↓' : '→'} {playerValues[asset.id].trend}
                  </span>
                </div>
                <p className="text-gray-300">{playerValues[asset.id].summary}</p>
                {playerValues[asset.id].comparables?.length > 0 && (
                  <p className="text-gray-500">Similar value: {playerValues[asset.id].comparables.join(', ')}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  const clearTrade = () => {
    const emptyState = getEmptyTradeState({ leagueContext: DEFAULT_LEAGUE_CONTEXT });
    setTeamAAssets([]);
    setTeamBAssets([]);
    setTeamAPickInput('');
    setTeamBPickInput('');
    setTeamAName(emptyState.teamAName);
    setTeamBName(emptyState.teamBName);
    setLeagueContext(emptyState.leagueContext);
    setSport(DEFAULT_DYNASTY_SPORT);
    setResult(null);
    setSections(null);
    setCanonicalCtx(null);
    setTradeGrade(null);
    setReliability(null);
    setLastAnalyzedSignature(null);
    setPlayerValues({});
    setValueLookupLoading(null);
    localStorage.removeItem('dynastyTrade');
    toast.info('Trade cleared');
  };

  const swapSides = () => {
    const [nextA, nextB] = swapAssetSides(teamAAssets, teamBAssets);
    setTeamAAssets(nextA);
    setTeamBAssets(nextB);
    setTeamAName((prev) => teamBName || prev);
    setTeamBName((prev) => teamAName || prev);
    setResult(null);
    setSections(null);
    setCanonicalCtx(null);
    setTradeGrade(null);
    setReliability(null);
    setLastAnalyzedSignature(null);
    toast.success('Trade sides swapped');
  };

  const [sharing, setSharing] = useState(false);

  const exportAsImage = async () => {
    const element = document.getElementById('trade-result');
    if (!element) return;
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(element, { backgroundColor: '#0a0a0f', scale: 2 });
      const link = document.createElement('a');
      link.download = 'allfantasy-trade-analysis.png';
      link.href = canvas.toDataURL();
      link.click();
      toast.success('Image downloaded!');
    } catch {
      toast.error('Failed to export image');
    }
  };

  const shareAnalysis = async () => {
    if (!result) return;
    setSharing(true);
    try {
      const res = await fetch('/api/trade/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sideA: teamAAssets,
          sideB: teamBAssets,
          // 🛑 THE grade, never the dual-brain verdict — see components/dynasty-trade/sharedTrade.ts.
          analysis: {
            leagueGrade: shareableLeagueGrade(tradeGrade),
            factors: result.factors,
            agingConcerns: result.agingConcerns ?? [],
            recommendations: result.recommendations ?? [],
            teamAName,
            teamBName,
            leagueContext,
          },
        }),
      });
      if (!res.ok) throw new Error('Failed');
      const { shareId } = await res.json();
      const url = `${window.location.origin}/trade/${shareId}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Shareable link copied to clipboard!');
      } catch {
        toast.success(url, { duration: 10000, description: 'Copy this link to share:' });
      }
    } catch {
      toast.error('Failed to create share link');
    } finally {
      setSharing(false);
    }
  };

  /* THE only winner this page names — read off the league grade's letter (2026-09-29). */
  const gradeWinner = winnerFromLeagueGrade(tradeGrade, teamAName, teamBName) ?? NOT_GRADED_WINNER;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex-1 space-y-3">
          <label className="block text-sm font-medium mb-2 text-gray-300">League Context</label>
          <Textarea
            value={leagueContext}
            onChange={(e) => setLeagueContext(e.target.value)}
            placeholder="e.g. 12-team Superflex PPR dynasty, TE-premium, 1QB"
            className="bg-gray-950 border-gray-700 min-h-[60px]"
          />
          <GradeLeaguePicker options={gradeLeagues} value={gradeLeagueId} onChange={setGradeLeagueId} />
        </div>
        <div className="flex flex-wrap items-center gap-2 md:mt-6">
          <Label htmlFor="dynasty-trade-sport" className="text-xs text-gray-400">Sport</Label>
          <select
            id="dynasty-trade-sport"
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            className="h-9 rounded-md border border-gray-700 bg-gray-950 px-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          >
            {SPORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            onClick={swapSides}
            className="text-gray-300 hover:text-white shrink-0"
          >
            <ArrowLeftRight className="h-4 w-4 mr-1" /> Swap Sides
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearTrade}
            className="text-gray-400 hover:text-gray-200 shrink-0"
          >
            <X className="h-4 w-4 mr-1" /> Clear Trade
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="glass-card border-red-900/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-red-400">
              <div className="h-3 w-3 rounded-full bg-red-400" />
              <Input
                value={teamAName}
                onChange={(e) => setTeamAName(e.target.value)}
                className="border-none bg-transparent p-0 text-lg font-bold focus:ring-0 h-auto text-red-400"
                placeholder="You Give"
              />
              <span className="text-sm text-gray-500 font-normal">(Outgoing)</span>
            </CardTitle>
            <CardDescription>
              <button
                type="button"
                onClick={() => setTeamAAssets([])}
                className="text-xs text-gray-400 hover:text-gray-200"
              >
                Clear this side
              </button>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AssetList side="a" assets={teamAAssets} />
            <PlayerAutocomplete
              value={null}
              onChange={(player) => addPlayerAsset('a', player)}
              placeholder="Search players to add..."
              sport={sport}
            />
            <div className="flex gap-2">
              <Input
                placeholder="Draft pick (e.g. 2026 1st early)"
                value={teamAPickInput}
                onChange={(e) => { setTeamAPickInput(e.target.value); pickFormatHint(e.target.value); }}
                onKeyDown={(e) => e.key === 'Enter' && addPickAsset('a', teamAPickInput)}
                className="border-amber-600/30 bg-gray-900 focus:border-amber-500"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => addPickAsset('a', teamAPickInput)}
                className="border-amber-600/40 text-amber-400 shrink-0"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-gray-500 mt-2">Examples: 2026 1st, 2027 2nd from Chiefs, 2028 late 1st</p>
          </CardContent>
        </Card>

        <Card className="glass-card border-green-900/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-green-400">
              <div className="h-3 w-3 rounded-full bg-green-400" />
              <Input
                value={teamBName}
                onChange={(e) => setTeamBName(e.target.value)}
                className="border-none bg-transparent p-0 text-lg font-bold focus:ring-0 h-auto text-green-400"
                placeholder="You Get"
              />
              <span className="text-sm text-gray-500 font-normal">(Incoming)</span>
            </CardTitle>
            <CardDescription>
              <button
                type="button"
                onClick={() => setTeamBAssets([])}
                className="text-xs text-gray-400 hover:text-gray-200"
              >
                Clear this side
              </button>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AssetList side="b" assets={teamBAssets} />
            <PlayerAutocomplete
              value={null}
              onChange={(player) => addPlayerAsset('b', player)}
              placeholder="Search players to add..."
              sport={sport}
            />
            <div className="flex gap-2">
              <Input
                placeholder="Draft pick (e.g. 2026 2nd mid)"
                value={teamBPickInput}
                onChange={(e) => { setTeamBPickInput(e.target.value); pickFormatHint(e.target.value); }}
                onKeyDown={(e) => e.key === 'Enter' && addPickAsset('b', teamBPickInput)}
                className="border-amber-600/30 bg-gray-900 focus:border-amber-500"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => addPickAsset('b', teamBPickInput)}
                className="border-amber-600/40 text-amber-400 shrink-0"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-gray-500 mt-2">Examples: 2026 1st, 2027 2nd from Chiefs, 2028 late 1st</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-center">
        <Button
          onClick={handleAnalyze}
          disabled={loading || teamAAssets.length === 0 || teamBAssets.length === 0}
          size="lg"
          className="bg-gradient-to-r from-cyan-500 via-purple-600 to-pink-600 hover:from-cyan-600 hover:via-purple-700 hover:to-pink-700 px-12"
        >
          {loading ? (
            <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Analyzing Dynasty Value...</>
          ) : (
            <><ArrowLeftRight className="mr-2 h-5 w-5" /> Analyze Trade</>
          )}
        </Button>
      </div>

      {analysisStale && (
        <div className="rounded-lg border border-amber-600/30 bg-amber-950/20 px-4 py-2 text-sm text-amber-300">
          Inputs changed since the last analysis. Re-run to refresh value, fairness, and AI recommendations.
        </div>
      )}

      {loading ? (
        <Card className="glass-card border-purple-900/30">
          <CardHeader>
            <Skeleton className="h-8 w-1/2 rounded" />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-xl border border-purple-500/20 bg-gradient-to-r from-purple-950/20 to-cyan-950/20 p-6">
              <div className="flex flex-col items-center gap-3">
                <Skeleton className="h-4 w-16 rounded" />
                <Skeleton className="h-8 w-48 rounded" />
                <Skeleton className="h-5 w-64 rounded" />
              </div>
            </div>
            <div className="rounded-lg border border-cyan-900/20 bg-gray-900/40 p-4 space-y-3">
              <Skeleton className="h-5 w-32 rounded" />
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-3/4 rounded" />
            </div>
            <div className="flex justify-between">
              <Skeleton className="h-5 w-24 rounded" />
              <Skeleton className="h-5 w-16 rounded" />
            </div>
          </CardContent>
        </Card>
      ) : result ? (
        <div id="trade-result" className="space-y-6">
          {/*
            🛑 THE ONLY LETTER ON THIS PAGE IS THE LEAGUE GRADE (2026-09-27). The verdict card and the
            AI section each printed a "Fairness" letter of their own, on private scales; both are gone.
            🛑 AND THE ONLY VERDICT IS ITS WINNER (2026-09-29): the dual-brain engine's confidence, veto
            risk, net delta, acceptance %, side totals, key drivers, partner-fit score, acceptance
            likelihood and "Ready to Send / Needs Adjustment" call are gone with it.
          */}
          <DynastyLeagueGrade
            tradeGrade={tradeGrade}
            teamAName={teamAName}
            teamBName={teamBName}
            leagueChosen={gradedInLeague}
            leagueOptionCount={gradeLeagues.length}
          />
          {reliability?.usedDeterministicFallback && (
            <AIFailureStateRenderer
              usedDeterministicFallback
              fallbackExplanation={reliability.fallbackExplanation}
              onRetry={handleAnalyze}
              retryLoading={loading}
              reliability={reliability as any}
              showDetails
            />
          )}
          <Card className="glass-card border-emerald-900/50">
            <CardContent className="p-6">
              <div className="text-center">
                <div className="text-lg font-bold text-white" data-testid="dynasty-grade-winner">{gradeWinner}</div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wider mt-1">Winner — read off the league grade</div>
              </div>
            </CardContent>
          </Card>

          {!sections && result.factors.length > 0 && (
            <Card className="glass-card border-purple-900/50">
              <CardContent className="p-4">
                <ul className="space-y-2">
                  {result.factors.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-cyan-400 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {sections && (
          <Card className="glass-card border-purple-900/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-3 text-xl">
                <Shield className="h-5 w-5 text-purple-400" />
                Analysis Details
                <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium uppercase tracking-wider bg-purple-950/40 text-purple-400 border border-purple-500/20">
                  AI-Enhanced
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <TradeAnalysisBadges
                dataFreshness={canonicalCtx?.dataFreshness}
                dataCoverage={canonicalCtx?.dataCoverage ?? sections.valueVerdict.dataCoverage}
                disagreement={sections.valueVerdict.disagreement}
                disagreementCodes={sections.valueVerdict.disagreementCodes}
              />

              {sections.valueVerdict.reasons.length > 0 && (
                <div className="rounded-lg border border-cyan-900/30 bg-gray-900/60 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="h-4 w-4 text-cyan-400" />
                    <span className="text-sm font-semibold text-cyan-400">AI Analysis</span>
                    <span className="text-[11px] text-gray-500 uppercase tracking-wider ml-auto">AI-Generated</span>
                  </div>
                  <ul className="space-y-2">
                    {sections.valueVerdict.reasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-cyan-400 shrink-0" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {sections.valueVerdict.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-900/30 bg-gray-900/60 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    <span className="text-sm font-semibold text-amber-400">Warnings</span>
                  </div>
                  <ul className="space-y-1">
                    {sections.valueVerdict.warnings.filter(w => !w.startsWith('[QualityGate]')).map((w, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {sections.valueVerdict.disagreementCodes && sections.valueVerdict.disagreementCodes.length > 0 && (() => {
                const modelCodes = (sections.valueVerdict.disagreementCodes as string[]).filter((c: string) => c !== 'data_quality_concern')
                const hasDataQuality = (sections.valueVerdict.disagreementCodes as string[]).includes('data_quality_concern')
                return (
                  <>
                    {modelCodes.length > 0 && (
                      <div className="rounded-lg border border-red-900/30 bg-red-950/20 p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <AlertTriangle className="h-4 w-4 text-red-400" />
                          <span className="text-sm font-semibold text-red-400">AI Disagreement</span>
                        </div>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {modelCodes.map((code: string, i: number) => (
                            <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-red-900/40 text-red-300 border border-red-800/50">
                              {code.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                        {sections.valueVerdict.disagreementDetails && !hasDataQuality && (
                          <p className="text-xs text-gray-400">{sections.valueVerdict.disagreementDetails}</p>
                        )}
                      </div>
                    )}
                    {hasDataQuality && (
                      <div className="rounded-lg border border-orange-900/30 bg-orange-950/20 p-3">
                        <div className="flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 text-orange-400" />
                          <span className="text-xs font-semibold text-orange-400">Data Quality Notice</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          {sections.valueVerdict.dataFreshness && sections.valueVerdict.dataFreshness.staleSources.length > 0
                            ? `${sections.valueVerdict.dataFreshness.staleSources.join(', ')} data may be outdated, which could reduce analysis accuracy.`
                            : 'Multiple data sources may be outdated, which could reduce analysis accuracy.'}
                        </p>
                      </div>
                    )}
                  </>
                )
              })()}

              {sections.valueVerdict.dataFreshness && sections.valueVerdict.dataFreshness.staleSourceCount > 0 && (
                <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 p-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-gray-500" />
                    <span className="text-[11px] text-gray-500">
                      {sections.valueVerdict.dataFreshness.staleSourceCount === 1
                        ? `${sections.valueVerdict.dataFreshness.staleSources[0]} data may be outdated`
                        : `${sections.valueVerdict.dataFreshness.staleSourceCount} data sources may be outdated: ${sections.valueVerdict.dataFreshness.staleSources.join(', ')}`}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          )}

          {sections && (
          <Card className="glass-card border-cyan-900/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-3 text-xl">
                <Target className="h-5 w-5 text-cyan-400" />
                Roster &amp; Timing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
                  <span className="text-xs text-gray-400 uppercase tracking-wider block mb-2">Roster Fit</span>
                  <p className="text-sm font-medium text-white mb-1">{sections.viabilityVerdict.partnerFit.needsAlignment}</p>
                  <p className="text-xs text-gray-400">{sections.viabilityVerdict.partnerFit.surplusMatch}</p>
                  {sections.viabilityVerdict.partnerFit.details.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {sections.viabilityVerdict.partnerFit.details.map((d, i) => (
                        <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                          <span className="mt-1 h-1 w-1 rounded-full bg-cyan-400 shrink-0" />
                          {d}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
                  <span className="text-xs text-gray-400 uppercase tracking-wider block mb-2">Timing</span>
                  <p className="text-sm font-medium text-white mb-1">{sections.viabilityVerdict.timing.timingFit}</p>
                  {sections.viabilityVerdict.timing.details.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {sections.viabilityVerdict.timing.details.map((d, i) => (
                        <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                          <span className="mt-1 h-1 w-1 rounded-full bg-cyan-400 shrink-0" />
                          {d}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {sections.viabilityVerdict.signals.length > 0 && (
                <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                  <span className="text-xs text-gray-400 uppercase tracking-wider block mb-2">Signals</span>
                  <ul className="space-y-1">
                    {sections.viabilityVerdict.signals.map((s, i) => (
                      <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                        <span className="mt-1 h-1 w-1 rounded-full bg-gray-500 shrink-0" />
                        {s}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-gray-500 mt-2">{sections.viabilityVerdict.leagueActivity}</p>
                </div>
              )}
            </CardContent>
          </Card>
          )}

          {sections && (
          <Card className="glass-card border-green-900/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-3 text-xl">
                <MessageSquare className="h-5 w-5 text-green-400" />
                Action Plan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {sections.actionPlan.counters.length > 0 && (
                <div className="space-y-3">
                  <span className="text-sm font-semibold text-green-400 block">Counter Proposals</span>
                  {sections.actionPlan.counters.map((c, i) => (
                    <div key={i} className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
                      <p className="text-sm text-white font-medium mb-1">Option {i + 1}</p>
                      <p className="text-sm text-gray-300">{c.description}</p>
                      <p className="text-xs text-gray-500 mt-1">{c.rationale}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-300">Suggested Message</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(sections.actionPlan.messageText);
                      toast.success('Message copied!');
                    }}
                    className="text-xs text-cyan-400 hover:text-cyan-300"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-sm text-gray-400 italic leading-relaxed">
                  &ldquo;{sections.actionPlan.messageText}&rdquo;
                </p>
              </div>
              <NextLink
                href={getTradeAnalyzerAIChatUrl(
                  buildTradeSummaryForAI(
                    teamAAssets.map((a) => a.name).join(', '),
                    teamBAssets.map((a) => a.name).join(', '),
                    sport
                  ),
                  { insightType: 'trade', sport }
                )}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-300 hover:bg-cyan-500/20 transition-colors"
              >
                <MessageSquare className="h-4 w-4" />
                Discuss in AI Chat
              </NextLink>
            </CardContent>
          </Card>
          )}
        </div>
      ) : (
        <div className="h-64 flex items-center justify-center border border-dashed border-gray-700 rounded-2xl text-gray-500">
          Analysis will appear here after clicking &quot;Analyze Trade&quot;
        </div>
      )}

      {result && (
        <>
          <StickyAIActions
            copyText={
              // The one grade and its winner — no confidence, no value delta (2026-09-29).
              `${gradeWinner}${tradeGrade?.grade && tradeGrade.partnerGrade ? ` — league grade ${teamAName} ${tradeGrade.grade} · ${teamBName} ${tradeGrade.partnerGrade}` : ''}. ${
                sections ? sections.actionPlan.messageText : (result.factors ?? []).slice(0, 2).join('; ')
              }`.trim()
            }
            chimmyPrompt={buildTradeSummaryForAI(
              teamAAssets.map((a) => a.name).join(', '),
              teamBAssets.map((a) => a.name).join(', '),
              sport
            )}
            onReRun={handleAnalyze}
            reRunLoading={loading}
            onCopied={() => toast.success('Copied to clipboard')}
            stickyMobileOnly={true}
          />
          <div className="flex justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={exportAsImage}
              className="border-gray-600 text-gray-300 hover:text-white"
            >
              <Download className="h-4 w-4 mr-1.5" /> Save as Image
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={shareAnalysis}
              disabled={sharing}
              className="border-cyan-600/40 text-cyan-300 hover:text-cyan-200"
            >
              {sharing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <LinkIcon className="h-4 w-4 mr-1.5" />}
              Share Link
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
