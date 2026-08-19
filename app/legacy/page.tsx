'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import RosterLegacyReport from '@/app/components/RosterLegacyReport';
import SyncedRosters from '@/app/components/SyncedRosters';
import WaiverAI from '@/app/components/WaiverAI';
import ChimmyChat from '@/app/components/ChimmyChat';
import MockDraftSimulatorClient from '@/components/MockDraftSimulatorClient';
import Link from 'next/link';
import LegacyLeagueIdeaForm from '@/app/components/LegacyLeagueIdeaForm';

type LeagueOption = {
  id: string
  name: string
  platform: string
  leagueSize: number
  isDynasty: boolean
  scoring: string | null
}

const TAB_IDS = ['overview', 'trade', 'waiver', 'chat', 'mock-draft', 'ideas', 'transfer'] as const;
type TabId = (typeof TAB_IDS)[number];

export default function LegacyOverview() {
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams?.get('tab');
  const initialTab: TabId = tabFromUrl && TAB_IDS.includes(tabFromUrl as TabId) ? (tabFromUrl as TabId) : 'overview';

  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [mockLeagues, setMockLeagues] = useState<LeagueOption[]>([]);
  const [mockLoading, setMockLoading] = useState(false);
  const { data: session, status } = useSession();
  const isAuthenticated = status === 'authenticated';
  const protectedTabs: Array<'trade' | 'waiver' | 'chat' | 'mock-draft' | 'ideas' | 'transfer'> = ['trade', 'waiver', 'chat', 'mock-draft', 'ideas', 'transfer'];

  useEffect(() => {
    const t = searchParams?.get('tab');
    if (t && TAB_IDS.includes(t as TabId)) setActiveTab(t as TabId);
  }, [searchParams]);

  useEffect(() => {
    let mounted = true;
    const loadLeagues = async () => {
      setMockLoading(true);
      try {
        const res = await fetch('/api/league/list', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const leagues = Array.isArray(data?.leagues) ? data.leagues : [];
        const mapped = leagues.map((l: any) => ({
          id: String(l.id),
          name: String(l.name || 'League'),
          platform: String(l.platform || 'sleeper'),
          leagueSize: Number(l.leagueSize || 12),
          isDynasty: Boolean(l.isDynasty),
          scoring: l.scoring ?? null,
        }));
        if (mounted) setMockLeagues(mapped);
      } finally {
        if (mounted) setMockLoading(false);
      }
    };

    loadLeagues();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">      <div className="border-b border-white/10 bg-black/70 backdrop-blur-2xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 bg-gradient-to-br from-purple-600 via-cyan-400 to-indigo-500 rounded-2xl flex items-center justify-center text-3xl shadow-xl">
              👑
            </div>
            <div>
              <div className="font-bold text-2xl tracking-tight">
                {session?.user?.name ?? session?.user?.email ?? 'Manager'}
              </div>
            </div>
          </div>

          {!isAuthenticated ? (
            <div className="flex items-center gap-3">
              <Link href="/login?next=/legacy" className="px-4 py-2 rounded-lg border border-white/20 text-sm hover:bg-white/10 transition-colors">Sign In</Link>
              <Link href="/signup?next=/legacy" className="px-4 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-slate-200 transition-colors">Sign Up</Link>
            </div>
          ) : (
            <div className="flex items-center gap-8 text-sm">
              <div className="text-center">
                <div className="text-3xl font-bold text-cyan-400">{mockLoading ? '—' : mockLeagues.length}</div>
                <div className="text-xs text-slate-400">Leagues synced</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-slate-500">—</div>
                <div className="text-xs text-slate-400">Career record unavailable</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-b border-white/10 bg-black/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-3 overflow-x-auto">
          {['Sleeper', 'Yahoo', 'MFL', 'Fantrax'].map(p => {
            const count = mockLeagues.filter((l) => l.platform.toLowerCase() === p.toLowerCase()).length
            return (
              <div key={p} className="px-5 py-2 bg-white/5 rounded-full text-sm font-medium flex items-center gap-2 whitespace-nowrap">
                {p} <span className="text-xs text-emerald-400">{count}</span>
              </div>
            )
          })}
          <button className="px-5 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm font-medium flex items-center gap-2 transition-colors">
            + Add
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 flex gap-2 border-b border-white/10 overflow-x-auto">
        {[
          { id: 'overview', label: 'Overview', icon: '🏠' },
          { id: 'trade', label: 'AI Trade Hub', icon: '⚖️' },
          { id: 'waiver', label: 'Waiver AI', icon: '📈' },
          { id: 'chat', label: 'AI Chat', icon: '💬' },
          { id: 'mock-draft', label: 'Mock Draft AI', icon: '🧠' },
          { id: 'ideas', label: 'Submit Ideas', icon: '💡' },
          { id: 'transfer', label: 'Transfer', icon: '🔄' },
        ].map(tab => {
          const isProtected = protectedTabs.includes(tab.id as any);
          const isDisabled = isProtected && !isAuthenticated;
          return (
            <button
              key={tab.id}
              onClick={() => {
                if (!isDisabled) setActiveTab(tab.id as any);
              }}
              disabled={isDisabled}
              title={isDisabled ? 'Sign in to use this tab' : undefined}
              className={`px-6 py-3 rounded-2xl flex items-center gap-3 text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white text-black shadow-lg'
                  : 'bg-white/5 hover:bg-white/10'
              } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="max-w-7xl mx-auto px-6 pt-10 pb-20">
        {!isAuthenticated && protectedTabs.includes(activeTab as any) ? (
          <LegacyAuthGate />
        ) : (
          <>
        {activeTab === 'overview' && (
          <>
            <div className="mb-16 rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center" data-testid="legacy-score-unavailable">
              <div className="text-4xl mb-3" aria-hidden>🏆</div>
              <h3 className="text-xl font-semibold">Legacy Score isn&apos;t available yet</h3>
              <p className="mx-auto mt-3 max-w-lg text-slate-300">
                A career-wide Legacy Score across your synced leagues is not calculated yet. This section will show real
                win rate, playoff, and format-breakdown numbers once that scoring is available — never a placeholder.
              </p>
            </div>

            <RosterLegacyReport />

            <div className="mt-12">
              <SyncedRosters />
            </div>
          </>
        )}

        {activeTab === 'trade' && (
          <div className="py-16 text-center">
            <div className="text-6xl mb-4">⚖️</div>
            <h2 className="text-2xl font-bold mb-2">AI Trade Hub</h2>
            <p className="text-slate-400">Evaluate trades, get counter-offer suggestions, and analyze trade history.</p>
            <p className="text-sm text-slate-500 mt-4">Navigate to the Trade Analyzer from the dashboard for full functionality.</p>
          </div>
        )}

        {activeTab === 'waiver' && <WaiverAI />}

        {activeTab === 'chat' && <ChimmyChat />}

        {activeTab === 'mock-draft' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <h2 className="text-xl font-bold text-white">Legacy Mock Draft with AI</h2>
              <p className="text-sm text-slate-300 mt-1">Run AI-powered mock drafts using your synced leagues and settings.</p>
            </div>

            {mockLoading ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-300">Loading your leagues...</div>
            ) : mockLeagues.length > 0 ? (
              <MockDraftSimulatorClient leagues={mockLeagues} />
            ) : (
              <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-6 text-center space-y-3">
                <p className="text-sm text-slate-300">No synced leagues found yet. Sync a league to unlock league-aware AI mock drafts.</p>
                <div className="flex items-center justify-center gap-3">
                  <Link href="/import" className="rounded-lg bg-white text-black px-4 py-2 text-sm font-medium hover:bg-slate-200">Sync League</Link>
                  <Link href="/af-legacy" className="rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/10">Open Full Legacy</Link>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'ideas' && <LegacyLeagueIdeaForm />}

        {activeTab === 'transfer' && (
          <div className="py-16 text-center">
            <div className="text-6xl mb-4">🔄</div>
            <h2 className="text-2xl font-bold mb-2">Transfer Portal</h2>
            <p className="text-slate-400">Import and export league data across platforms.</p>
            <p className="text-sm text-slate-500 mt-4">Coming soon — seamless cross-platform league transfers.</p>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}







function LegacyAuthGate() {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/5 p-8 text-center space-y-4">
      <h2 className="text-2xl font-bold">Sign in to unlock Legacy AI tools</h2>
      <p className="text-sm text-slate-300 max-w-xl mx-auto">
        Trade AI, Waiver AI, Mock Draft AI, and league-transfer actions require an account so your results, imports, and AI context stay synced.
      </p>
      <div className="flex items-center justify-center gap-3">
        <Link href="/login?next=/legacy" className="rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/10">Sign In</Link>
        <Link href="/signup?next=/legacy" className="rounded-lg bg-white text-black px-4 py-2 text-sm font-semibold hover:bg-slate-200">Create Account</Link>
      </div>
    </div>
  );
}




