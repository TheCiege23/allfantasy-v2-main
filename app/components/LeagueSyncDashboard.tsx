'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Plus, RefreshCw, AlertCircle, CheckCircle, Loader2, Shield, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { groupLeaguesBySport } from '@/lib/dashboard/DashboardSportGroupingService';
import { useUserTimezone } from '@/hooks/useUserTimezone';

interface League {
  id: string;
  name: string | null;
  sport?: string | null;
  platform: string;
  platformLeagueId: string;
  leagueSize: number | null;
  scoring: string | null;
  isDynasty: boolean | null;
  syncStatus: string | null;
  syncError: string | null;
  lastSyncedAt: string | null;
  navigationLeagueId?: string | null;
  unifiedLeagueId?: string | null;
  hasUnifiedRecord?: boolean;
}

/** Groups leagues by sport with section headers (emoji + label) for dashboard. */
function DashboardSportGroups({
  leagues,
  platformLabel,
  syncingId,
  openingId,
  reSync,
  openLeague,
}: {
  leagues: League[];
  platformLabel: (p: string) => string;
  syncingId: string | null;
  openingId: string | null;
  reSync: (league: League) => void;
  openLeague: (league: League) => void;
}) {
  const { formatInTimezone } = useUserTimezone();
  const groups = useMemo(() => groupLeaguesBySport(leagues), [leagues]);
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.sport}>
          <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <span>{group.emoji}</span>
            <span>{group.label}</span>
          </h2>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {group.leagues.map((lg, i) => (
              <motion.div
                key={lg.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="rounded-2xl bg-slate-900/60 border border-slate-700/50 p-5 hover:border-slate-600 transition-colors"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-base truncate">{lg.name || 'Unnamed League'}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {platformLabel(lg.platform ?? 'unknown')} &bull; {lg.leagueSize || '?'}-team &bull;{' '}
                      {lg.isDynasty ? 'Dynasty' : 'Redraft'} &bull;{' '}
                      {lg.scoring?.toUpperCase() || 'STD'}
                    </p>
                  </div>
                  {lg.syncStatus === 'success' ? (
                    <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 ml-2" />
                  ) : lg.syncStatus === 'error' ? (
                    <div className="relative group flex-shrink-0 ml-2">
                      <AlertCircle className="w-5 h-5 text-red-400" />
                      {lg.syncError && (
                        <div className="absolute right-0 top-7 w-48 p-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-red-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                          {lg.syncError}
                        </div>
                      )}
                    </div>
                  ) : (
                    <Loader2 className="w-5 h-5 text-yellow-400 animate-spin flex-shrink-0 ml-2" />
                  )}
                </div>
                <div className="text-xs text-slate-500 mb-4">
                  Last synced:{' '}
                  {lg.lastSyncedAt ? formatInTimezone(lg.lastSyncedAt) : 'Never'}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => openLeague(lg as League)}
                    disabled={openingId === lg.id}
                    className="w-full py-2.5 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-400/20 flex items-center justify-center gap-2 text-sm disabled:opacity-50 transition-colors"
                  >
                    {openingId === lg.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ExternalLink className="w-4 h-4" />
                    )}
                    {lg.hasUnifiedRecord ? 'Open League' : 'Sync & Open'}
                  </button>
                  <button
                    onClick={() => reSync(lg as League)}
                    disabled={syncingId === lg.id || openingId === lg.id}
                    className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center gap-2 text-sm disabled:opacity-50 transition-colors"
                  >
                    {syncingId === lg.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    Re-sync
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function LeagueSyncDashboard() {
  const router = useRouter();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const [yahooConnected, setYahooConnected] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(false);


  const fetchLeagues = async () => {
    try {
      const res = await fetch('/api/league/list');
      if (res.status === 401) {
        setLeagues([]);
        return;
      }
      const data = await res.json();
      setLeagues(data.leagues || []);
    } catch {
      toast.error('Failed to load leagues');
    } finally {
      setLoading(false);
    }
  };

  const checkYahooAuth = async () => {
    setCheckingAuth(true);
    try {
      const res = await fetch('/api/league/auth');
      if (!res.ok) return;
      const data = await res.json();
      const yahooAuth = (data.auths || []).find((a: any) => a.platform === 'yahoo');
      setYahooConnected(!!yahooAuth?.hasOauthToken);
    } catch {
      // ignore
    } finally {
      setCheckingAuth(false);
    }
  };

  useEffect(() => {
    fetchLeagues();
    checkYahooAuth();

    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'yahoo_connected') {
      /*
        ⚠ THE OLD COPY POINTED AT A MODAL THAT NO LONGER EXISTS. It said "now
        enter your league key to sync" and opened this page's own add-and-sync
        form; adding a league is /import's job, and Yahoo needs no league key
        there because it lists leagues from the connected account.
      */
      toast.success('Yahoo account connected. Import a Yahoo league from the Import page.');
      setYahooConnected(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (params.get('error')?.startsWith('yahoo')) {
      toast.error(`Yahoo connection failed: ${params.get('error')}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const syncLeague = async (plat: string, lgId: string) => {
    if (plat === 'sleeper') {
      const res = await fetch('/api/league/sleeper-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sleeperLeagueId: lgId }),
      });
      return res.json();
    }

    const res = await fetch('/api/league/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: plat, platformLeagueId: lgId }),
    });
    return res.json();
  };

  const reSync = async (league: League) => {
    setSyncingId(league.id);
    try {
      const data = await syncLeague(league.platform, league.platformLeagueId);

      if (data.success) {
        toast.success(`"${data.name || data.leagueName}" re-synced!`);
        await fetchLeagues();
      } else {
        toast.error(data.error || 'Re-sync failed');
      }
    } catch {
      toast.error('Network error during re-sync');
    } finally {
      setSyncingId(null);
    }
  };

  const openLeague = async (league: League) => {
    const targetLeagueId = league.unifiedLeagueId ?? league.navigationLeagueId;
    if (targetLeagueId) {
      router.push(`/league/${targetLeagueId}`);
      return;
    }

    if (league.platform !== 'sleeper') {
      toast.error('This league is not ready to open yet. Please re-sync it first.');
      return;
    }

    setOpeningId(league.id);
    try {
      const data = await syncLeague('sleeper', league.platformLeagueId);
      if (data.success && data.unifiedLeagueId) {
        toast.success(`"${data.name || 'League'}" is ready.`);
        await fetchLeagues();
        router.push(`/league/${data.unifiedLeagueId}`);
      } else {
        toast.error(data.error || 'Unable to prepare this league');
      }
    } catch {
      toast.error('Failed to prepare league');
    } finally {
      setOpeningId(null);
    }
  };

  const platformLabel = (p: string) => {
    const map: Record<string, string> = {
      sleeper: 'Sleeper',
      mfl: 'MFL',
      yahoo: 'Yahoo',
      espn: 'ESPN',
      fantrax: 'Fantrax',
    };
    return map[p] || p.toUpperCase();
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">League Sync</h1>
          <p className="text-sm text-slate-400 mt-1">Connect your fantasy leagues for AI-powered analysis</p>
        </div>
        {/*
          ⚠ ADDING A LEAGUE LIVES AT /import, AND ONLY THERE. This page used to
          carry its own add-and-sync modal running the OLDER `/api/league/*`
          pipeline, while /import runs `/api/leagues/import/*` — two ways in,
          different code, and only one of them gets the commissioner gate, the
          attestation step and the team claim. This page keeps what /import
          cannot do: connect, OAuth, and re-syncing a league already imported.
        */}
        <Link
          href="/import"
          className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 rounded-xl flex items-center gap-2 font-medium transition-colors text-sm"
        >
          <Plus className="w-4 h-4" /> Add League
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      ) : leagues.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-16 border border-dashed border-slate-700 rounded-2xl"
        >
          <Shield className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-lg mb-2">No leagues synced yet</p>
          <p className="text-slate-500 text-sm mb-6">
            Add your first league to unlock roster-aware AI features
          </p>
          <Link
            href="/import"
            className="inline-block px-6 py-3 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-medium transition-colors"
          >
            <Plus className="w-4 h-4 inline mr-2" />
            Add Your First League
          </Link>
        </motion.div>
      ) : (
        <DashboardSportGroups
          leagues={leagues}
          platformLabel={platformLabel}
          syncingId={syncingId}
          openingId={openingId}
          reSync={reSync}
          openLeague={openLeague}
        />
      )}

    </div>
  );
}
