'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Settings,
  ChevronDown,
  MessageSquare,
  Zap,
} from 'lucide-react'
import type { SalaryCapSummary, SalaryCapView } from './types'
import { CapDashboard } from './CapDashboard'
import { ContractsPage } from './ContractsPage'
import { TeamBuilderView } from './TeamBuilderView'
import { StartupAuctionView } from './StartupAuctionView'
import { SalaryCapAIPanel } from './SalaryCapAIPanel'
import { SalaryCapRulesView } from './SalaryCapRulesView'
import { SpecialtyShell } from '@/components/league/specialty/SpecialtyShell'
import { SalaryCapSpecialtyHome } from '@/components/league/specialty/salary/SalaryCapSpecialtyHome'
import { SalaryCapBidCheck } from '@/components/league/specialty/salary/SalaryCapBidCheck'

export interface SalaryCapHomeProps {
  leagueId: string
}

const VIEW_LABELS: Record<SalaryCapView, string> = {
  home: 'Home',
  'cap-dashboard': 'Cap Dashboard',
  contracts: 'Contracts',
  'team-builder': 'Team Builder',
  draft: 'Draft & Contracts',
  ai: 'AI Tools',
  rules: 'Rules & Settings',
}

export function SalaryCapHome({ leagueId }: SalaryCapHomeProps) {
  const [summary, setSummary] = useState<SalaryCapSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<SalaryCapView>('home')
  /** The free-agent bid check (specialty handoff SalaryCapBid) — a full-screen view over the home. */
  const [bidOpen, setBidOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/salary-cap/summary`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Error ${res.status}`)
        setSummary(null)
        return
      }
      const data = await res.json()
      setSummary(data)
    } catch {
      setError('Failed to load salary cap summary')
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    load()
  }, [load])

  if (loading && !summary) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] p-8">
        <p className="text-sm text-white/60">Loading Salary Cap League…</p>
      </div>
    )
  }

  if (error && !summary) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
        <p className="text-sm text-amber-200">{error}</p>
        <button
          type="button"
          onClick={() => load()}
          className="mt-2 text-xs text-cyan-400 hover:underline"
        >
          Retry
        </button>
      </div>
    )
  }

  if (bidOpen && summary) {
    return (
      <SpecialtyShell format="salary" testId="salary-specialty">
        <SalaryCapBidCheck summary={summary} onBack={() => setBidOpen(false)} waiversHref={`/league/${leagueId}?tab=Waivers`} />
      </SpecialtyShell>
    )
  }

  return (
    <SpecialtyShell format="salary" testId="salary-specialty">
    <div className="space-y-6">
      {view === 'home' && summary && (
        <SalaryCapSpecialtyHome
          summary={summary}
          onOpenContracts={() => setView('contracts')}
          onOpenBid={() => setBidOpen(true)}
          tradesHref={`/league/${leagueId}?tab=Trades`}
        />
      )}

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/league/${leagueId}?tab=Chat`}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
        >
          <MessageSquare className="h-4 w-4" /> Chat
        </Link>
        <Link
          href={`/league/${leagueId}?tab=Waivers`}
          className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-2 text-sm text-amber-200 hover:bg-amber-950/50"
        >
          <Zap className="h-4 w-4" /> Waivers
        </Link>
        <Link
          href={`/league/${leagueId}?tab=Trades`}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
        >
          Trades
        </Link>
        <Link
          href={`/league/${leagueId}?tab=Settings`}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
        >
          <Settings className="h-4 w-4" /> Settings
        </Link>
      </div>

      {/* View switcher (mobile dropdown, desktop tabs) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-white/50 sm:hidden">View:</span>
        <div className="relative sm:hidden">
          <select
            value={view}
            onChange={(e) => setView(e.target.value as SalaryCapView)}
            className="rounded-xl border border-white/20 bg-white/5 py-2 pl-3 pr-8 text-sm text-white appearance-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          >
            {(Object.keys(VIEW_LABELS) as SalaryCapView[]).map((v) => (
              <option key={v} value={v}>
                {VIEW_LABELS[v]}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
        </div>
        <div className="hidden flex-wrap gap-1 sm:flex">
          {(Object.keys(VIEW_LABELS) as SalaryCapView[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                view === v
                  ? 'bg-cyan-500/20 text-cyan-200'
                  : 'bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      {view === 'cap-dashboard' && summary && (
        <CapDashboard summary={summary} leagueId={leagueId} onBack={() => setView('home')} />
      )}
      {view === 'contracts' && summary && (
        <ContractsPage summary={summary} leagueId={leagueId} onBack={() => setView('home')} />
      )}
      {view === 'team-builder' && summary && (
        <TeamBuilderView summary={summary} leagueId={leagueId} onBack={() => setView('home')} />
      )}
      {view === 'draft' && summary && (
        <StartupAuctionView summary={summary} leagueId={leagueId} onBack={() => setView('home')} />
      )}
      {view === 'ai' && summary && (
        <SalaryCapAIPanel summary={summary} leagueId={leagueId} onBack={() => setView('home')} />
      )}
      {view === 'rules' && summary && (
        <SalaryCapRulesView summary={summary} leagueId={leagueId} onBack={() => setView('home')} />
      )}
    </div>
    </SpecialtyShell>
  )
}
