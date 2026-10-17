'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Loader2, ThumbsUp, ThumbsDown, AlertCircle, Link2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { gtagEvent } from '@/lib/gtag';

type WaiverSuggestion = {
  playerName: string;
  rank: number;
  score: number;
  reason: string[];
  projectedPoints: number;
  faabBidRecommendation: number | null;
  sensitivityNote: string | null;
  factualEvidence?: Array<{ source: 'league' | 'roster' | 'news' | 'model'; metric: string; value: string }>;
};

type RosterAlert = {
  playerName: string;
  alertType: 'bust_risk' | 'sell_high' | 'injury_concern' | 'aging_out';
  reason: string;
};

type SyncedLeague = {
  leagueId: string;
  leagueName: string;
  platform: string;
  scoring: string;
  isDynasty: boolean;
  rostersSync: number;
};

export default function WaiverAI() {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<WaiverSuggestion[]>([]);
  const [rosterAlerts, setRosterAlerts] = useState<RosterAlert[]>([]);
  const [error, setError] = useState('');
  const [waiverExplanation, setWaiverExplanation] = useState<{ leagueFit: string; rosterNeedsSummary: string; decisionBasis: string } | null>(null);

  const [showSyncModal, setShowSyncModal] = useState(false);
  const [platform, setPlatform] = useState('sleeper');
  const [platformLeagueId, setPlatformLeagueId] = useState('');
  const [sleeperUserId, setSleeperUserId] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncedLeague, setSyncedLeague] = useState<SyncedLeague | null>(null);

  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [autoRoster, setAutoRoster] = useState('');
  const [autoLoading, setAutoLoading] = useState(true);

  const [userRoster, setUserRoster] = useState('');
  const [userContention, setUserContention] = useState<'win-now' | 'contender' | 'rebuild' | 'unknown'>('unknown');
  const [userFAAB, setUserFAAB] = useState(100);
  const [useRealTimeNews, setUseRealTimeNews] = useState(true);
  const [feedbackSentForIndex, setFeedbackSentForIndex] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch('/api/user/active-league')
      .then(r => {
        if (!r.ok) throw new Error('Not logged in');
        return r.json();
      })
      .then(data => {
        if (data.activeLeagueId) {
          setActiveLeagueId(data.activeLeagueId);
          return fetch(`/api/league/roster?leagueId=${data.activeLeagueId}`)
            .then(r => r.json())
            .then(rosterData => {
              if (rosterData.league) {
                setSyncedLeague({
                  leagueId: rosterData.league.id,
                  leagueName: rosterData.league.name,
                  platform: rosterData.league.platform || 'sleeper',
                  scoring: rosterData.league.scoringType || 'ppr',
                  isDynasty: rosterData.league.isDynasty || false,
                  rostersSync: rosterData.league.totalTeams || 12,
                });
              }
              if (rosterData.faabRemaining != null) {
                setUserFAAB(rosterData.faabRemaining);
              }
              if (rosterData.players && rosterData.players.length > 0) {
                const formatted =
                  (rosterData.faabRemaining != null ? `FAAB: $${rosterData.faabRemaining}\n` : '') +
                  rosterData.players
                    .filter((p: any) => p.isStarter)
                    .map((p: any) => `${p.position}: ${p.name}`)
                    .join('\n');
                setAutoRoster(formatted);
                setUserRoster(formatted);
              } else if (rosterData.message) {
                toast.info(rosterData.message);
              }
            });
        }
      })
      .catch(() => {})
      .finally(() => setAutoLoading(false));
  }, []);

  const handleSync = async () => {
    if (!platformLeagueId.trim()) {
      toast.error('Enter your league ID');
      return;
    }
    setIsSyncing(true);
    try {
      const res = await fetch('/api/league/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, platformLeagueId: platformLeagueId.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setSyncedLeague({
          leagueId: data.leagueId,
          leagueName: data.leagueName,
          platform: data.platform,
          scoring: data.scoring,
          isDynasty: data.isDynasty,
          rostersSync: data.rostersSync,
        });
        toast.success(`${data.leagueName} synced! ${data.rostersSync} rosters loaded.`);
        setShowSyncModal(false);
        gtagEvent('league_synced', { platform, rosters: data.rostersSync });
      } else {
        toast.error(data.error || 'Sync failed');
      }
    } catch {
      toast.error('Failed to sync league');
    } finally {
      setIsSyncing(false);
    }
  };

  const generateWaiverSuggestions = async () => {
    const hasManualRoster = userRoster.trim().length > 0;
    const hasSyncedLeague = !!syncedLeague;

    if (!hasManualRoster && !hasSyncedLeague) {
      toast.error('Sync a league or paste your roster first');
      return;
    }

    setLoading(true);
    setError('');
    setSuggestions([]);
    setRosterAlerts([]);
    setWaiverExplanation(null);

    try {
      const payload: any = {
        userContention,
        userFAAB,
        useRealTimeNews,
      };

      if (hasSyncedLeague) {
        payload.leagueId = syncedLeague.leagueId;
        if (sleeperUserId.trim()) {
          payload.sleeperUserId = sleeperUserId.trim();
        }
      }

      if (hasManualRoster) {
        payload.userRoster = autoRoster || userRoster;
      }

      if (!hasSyncedLeague) {
        payload.leagueSize = 12;
        payload.scoring = 'ppr';
        payload.isDynasty = true;
      }

      const res = await fetch('/api/waiver-ai/grok', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to fetch suggestions');
      }

      const parsed = await res.json();
      setSuggestions(parsed.suggestions || []);
      setRosterAlerts(parsed.rosterAlerts || []);
      setWaiverExplanation(parsed.explanation || null);
      toast.success('Waiver gems found!');
      gtagEvent('waiver_ai_suggestions_generated', { count: parsed.suggestions?.length || 0, synced: hasSyncedLeague });
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      toast.error('Failed to load waiver suggestions');
    } finally {
      setLoading(false);
    }
  };

  const canGenerate = !loading && (userRoster.trim().length > 0 || !!syncedLeague);

  return (
    <div className="rounded-3xl bg-gradient-to-br from-slate-900 to-indigo-950 border border-indigo-500/30 p-6 shadow-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Sparkles className="w-7 h-7 text-cyan-400" />
            <h2 className="text-2xl font-bold">Waiver Wire AI</h2>
          </div>
          <p className="text-sm text-slate-400">League-aware &middot; Roster-smart &middot; Real-time</p>
        </div>
        <button
          onClick={() => setShowSyncModal(true)}
          className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 flex items-center gap-2 text-sm transition-colors"
        >
          <Link2 className="w-4 h-4" /> Sync League
        </button>
      </div>

      {syncedLeague && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
          <div>
            <p className="font-semibold text-emerald-300">{syncedLeague.leagueName}</p>
            <p className="text-xs text-slate-400">
              {syncedLeague.platform.toUpperCase()} &middot; {syncedLeague.scoring.toUpperCase()} &middot;
              {syncedLeague.isDynasty ? ' Dynasty' : ' Redraft'} &middot; {syncedLeague.rostersSync} teams
            </p>
          </div>
          <button
            onClick={() => setSyncedLeague(null)}
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            Disconnect
          </button>
        </div>
      )}

      <div className="space-y-6 mb-8">
        {syncedLeague && (
          <div>
            <label className="block text-sm font-medium mb-2">Your Sleeper User ID (to find your roster)</label>
            <input
              type="text"
              value={sleeperUserId}
              onChange={(e) => setSleeperUserId(e.target.value)}
              placeholder="e.g. 123456789012345678"
              className="w-full rounded-2xl bg-slate-800 border border-slate-700 p-4 text-sm focus:border-cyan-400 outline-none"
            />
          </div>
        )}

        {!syncedLeague && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">Your Roster (paste key players)</label>
              {autoRoster && (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <Zap className="w-3 h-3" /> Auto-loaded from active league
                </span>
              )}
            </div>
            <textarea
              value={userRoster}
              onChange={(e) => setUserRoster(e.target.value)}
              placeholder="QB: Josh Allen&#10;RB: Bijan Robinson, Breece Hall...&#10;WR: Ja'Marr Chase, CeeDee Lamb..."
              className="w-full h-32 rounded-2xl bg-slate-800 border border-slate-700 p-4 text-sm resize-y focus:border-cyan-400 outline-none"
            />
          </div>
        )}

        {syncedLeague && (
          <div>
            <label className="block text-sm font-medium mb-2">Additional Context (optional)</label>
            <textarea
              value={userRoster}
              onChange={(e) => setUserRoster(e.target.value)}
              placeholder="Any extra context... e.g. 'Looking to trade my RB depth for a WR1'"
              className="w-full h-20 rounded-2xl bg-slate-800 border border-slate-700 p-4 text-sm resize-y focus:border-cyan-400 outline-none"
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Contention Window</label>
            <select
              value={userContention}
              onChange={(e) => setUserContention(e.target.value as any)}
              className="w-full rounded-2xl bg-slate-800 border border-slate-700 p-4 text-sm focus:border-cyan-400 outline-none"
            >
              <option value="unknown">Not sure</option>
              <option value="win-now">Win-Now</option>
              <option value="contender">Building Contender</option>
              <option value="rebuild">Rebuild</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">FAAB Remaining (%)</label>
            <input
              type="number"
              value={userFAAB}
              onChange={(e) => setUserFAAB(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
              className="w-full rounded-2xl bg-slate-800 border border-slate-700 p-4 text-sm focus:border-cyan-400 outline-none"
            />
          </div>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={useRealTimeNews}
            onChange={(e) => setUseRealTimeNews(e.target.checked)}
            className="w-5 h-5 accent-cyan-400"
          />
          <span className="text-sm">Include latest injuries, news & rookie buzz (uses real-time search)</span>
        </label>
      </div>

      <button
        onClick={generateWaiverSuggestions}
        disabled={!canGenerate}
        className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-600 hover:to-indigo-700 text-white font-bold shadow-lg disabled:opacity-50 transition-all"
      >
        {loading ? 'Scanning Waivers...' : syncedLeague ? 'Analyze My League' : 'Find Hidden Gems'}
      </button>

      {loading && (
        <div className="mt-8 space-y-4">
          <div className="flex items-center gap-3 text-cyan-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Dual-brain analysis running...</span>
          </div>
          <div className="space-y-2 text-sm text-slate-300">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0 }}>
              Grok scanning roster needs & league context
            </motion.div>
            {useRealTimeNews && (
              <>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }}>
                  Searching web for injury/transaction news
                </motion.div>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3 }}>
                  Checking X for rookie hype & real-time buzz
                </motion.div>
              </>
            )}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: useRealTimeNews ? 4.5 : 1.5 }}>
              GPT-4o synthesizing final recommendations
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: useRealTimeNews ? 6 : 3 }}>
              Ranking waiver targets for your build...
            </motion.div>
          </div>
        </div>
      )}

      {rosterAlerts.length > 0 && (
        <div className="mt-8 space-y-3">
          <h3 className="text-lg font-bold text-amber-400">Roster Alerts</h3>
          {rosterAlerts.map((alert, i) => {
            const alertConfig: Record<string, { label: string; color: string; bg: string }> = {
              bust_risk: { label: 'Bust Risk', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' },
              sell_high: { label: 'Sell High', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
              injury_concern: { label: 'Injury', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30' },
              aging_out: { label: 'Aging Out', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30' },
            };
            const cfg = alertConfig[alert.alertType] || alertConfig.bust_risk;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
                className={`p-4 rounded-xl border ${cfg.bg} flex items-start gap-3`}
              >
                <AlertCircle className={`w-5 h-5 mt-0.5 ${cfg.color} shrink-0`} />
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold">{alert.playerName}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                  </div>
                  <p className="text-sm text-slate-300">{alert.reason}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="mt-8 space-y-6">
          <h3 className="text-lg font-bold">Top Waiver Targets</h3>
          {waiverExplanation && (
            <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
              <p className="text-sm text-cyan-200 font-semibold">AI Decision Basis: Facts + League Context</p>
              <p className="text-xs text-slate-300 mt-1">{waiverExplanation.leagueFit}</p>
              <p className="text-xs text-slate-300 mt-1">{waiverExplanation.rosterNeedsSummary}</p>
            </div>
          )}
          {suggestions.map((sug, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="p-5 rounded-2xl bg-slate-800/50 border border-slate-700"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="font-bold text-lg">{sug.playerName}</h4>
                  <p className="text-sm text-cyan-400">Rank #{sug.rank} &middot; Score: {sug.score}</p>
                </div>
                {sug.faabBidRecommendation != null && (
                  <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-sm">
                    FAAB: {sug.faabBidRecommendation}%
                  </span>
                )}
              </div>

              <ul className="space-y-2 text-sm">
                {sug.reason.map((r: string, j: number) => (
                  <li key={j} className="flex gap-2">
                    <span className="text-cyan-400">&bull;</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>

              {sug.factualEvidence && sug.factualEvidence.length > 0 && (
                <div className="mt-4 p-3 rounded-lg bg-slate-900/60 border border-slate-700">
                  <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Fact Evidence</p>
                  <div className="space-y-1.5">
                    {sug.factualEvidence.slice(0, 4).map((ev, k) => (
                      <div key={k} className="text-xs text-slate-300 flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-200">{ev.source}</span>
                        <span className="text-cyan-300">{ev.metric}:</span>
                        <span>{ev.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sug.sensitivityNote && (
                <p className="mt-4 text-sm italic text-purple-300">
                  Note: {sug.sensitivityNote}
                </p>
              )}

              <div className="flex gap-4 mt-5 pt-4 border-t border-slate-700">
                {feedbackSentForIndex.has(i) ? (
                  <span className="text-sm text-slate-400">Thanks for your feedback!</span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setFeedbackSentForIndex((prev) => new Set(prev).add(i));
                        toast.success('Thanks for your feedback!');
                      }}
                      className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                      <ThumbsUp className="w-5 h-5" /> Helpful
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFeedbackSentForIndex((prev) => new Set(prev).add(i));
                        toast.success('Thanks for your feedback!');
                      }}
                      className="flex items-center gap-2 text-red-400 hover:text-red-300 transition-colors"
                    >
                      <ThumbsDown className="w-5 h-5" /> Not helpful
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-6 p-4 rounded-xl bg-red-900/30 border border-red-500/30 text-red-300 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-1" />
          <div>{error}</div>
        </div>
      )}

      <AnimatePresence>
        {showSyncModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowSyncModal(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 rounded-3xl p-8 w-full max-w-md border border-slate-700"
            >
              <h3 className="text-xl font-bold mb-6">Sync Your League</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Platform</label>
                  <select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    className="w-full p-4 rounded-2xl bg-slate-800 border border-slate-700 text-sm focus:border-cyan-400 outline-none"
                  >
                    <option value="sleeper">Sleeper</option>
                    <option value="mfl">MyFantasyLeague (MFL)</option>
                    <option value="yahoo">Yahoo</option>
                    <option value="espn">ESPN</option>
                    <option value="fantrax">Fantrax</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">League ID</label>
                  <input
                    type="text"
                    placeholder={platform === 'sleeper' ? 'e.g. 1048889471730257920' : 'Your league ID'}
                    value={platformLeagueId}
                    onChange={(e) => setPlatformLeagueId(e.target.value)}
                    className="w-full p-4 rounded-2xl bg-slate-800 border border-slate-700 text-sm focus:border-cyan-400 outline-none"
                  />
                </div>
                {platform !== 'sleeper' && (
                  <p className="text-xs text-amber-400" data-hide-in-ios-app="">
                    Only Sleeper is fully supported right now. Other platforms are coming soon.
                  </p>
                )}
              </div>
              <button
                onClick={handleSync}
                disabled={isSyncing || !platformLeagueId.trim()}
                className="w-full mt-6 py-4 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 rounded-2xl font-bold transition-colors"
              >
                {isSyncing ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Syncing...
                  </span>
                ) : (
                  'Sync League Now'
                )}
              </button>
              <button
                onClick={() => setShowSyncModal(false)}
                className="w-full mt-3 py-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
