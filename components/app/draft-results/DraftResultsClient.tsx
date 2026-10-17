'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { GuillotinePostDraftIntro } from '@/components/guillotine/GuillotinePostDraftIntro'
import {
  Trophy,
  Award,
  TrendingDown,
  Zap,
  LayoutGrid,
  ChevronRight,
  ChevronDown,
  Loader2,
  ArrowLeft,
  Wand2,
} from 'lucide-react'
import type { DraftResultsPayload, ManagerRankingEntry, PickScoreEntry } from '@/lib/post-draft-manager-ranking'

export interface DraftResultsClientProps {
  leagueId: string
  leagueName: string
  sport: string
  isGuillotine?: boolean
}

export function DraftResultsClient({
  leagueId,
  leagueName,
  sport,
  isGuillotine,
}: DraftResultsClientProps) {
  const [data, setData] = useState<DraftResultsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aiExplainEnabled, setAiExplainEnabled] = useState(false)

  const fetchResults = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = aiExplainEnabled ? '?aiExplain=1' : ''
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft-results${query}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Error ${res.status}`)
        setData(null)
        return
      }
      const payload = (await res.json()) as DraftResultsPayload
      setData(payload)
    } catch {
      setError('Failed to load draft results')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [aiExplainEnabled, leagueId])

  useEffect(() => {
    fetchResults()
  }, [fetchResults])

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
        <Loader2 className="h-10 w-10 animate-spin text-cyan-400" aria-hidden />
        <p className="text-sm text-white/70">Computing draft grades & rankings…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
        <p className="text-center text-amber-400">{error ?? 'No draft results'}</p>
        <Link
          href={`/league/${leagueId}/draft`}
          className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to draft
        </Link>
      </div>
    )
  }

  const { managerRankings, pickLog, bestPickOfDraft, worstReachOfDraft, stealOfDraft } = data

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 pb-24">
      <header className="mb-6">
        <Link
          href={`/league/${leagueId}`}
          className="mb-3 inline-flex items-center gap-1 text-sm text-white/60 hover:text-cyan-400"
        >
          <ArrowLeft className="h-4 w-4" />
          League
        </Link>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Draft results</h1>
        <p className="mt-1 text-sm text-white/60">
          {leagueName} · {sport} · Manager rankings & grades
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAiExplainEnabled((value) => !value)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
            data-testid="draft-results-ai-explanations-toggle"
          >
            <Wand2 className="h-3.5 w-3.5" />
            {aiExplainEnabled ? 'AI explanations on' : 'AI explanations off'}
          </button>
          <span className="text-xs text-white/50">
            Rankings stay deterministic; AI only rewrites explanation text.
          </span>
        </div>
      </header>

      {/* Best / Worst / Steal */}
      <section className="mb-8 grid gap-4 sm:grid-cols-3">
        {bestPickOfDraft && (
          <HighlightCard
            title="Best pick"
            subtitle="Highest value vs ADP"
            pick={bestPickOfDraft}
            icon={<Zap className="h-5 w-5 text-amber-400" />}
            valueLabel={`+${bestPickOfDraft.valueScore} value`}
          />
        )}
        {worstReachOfDraft && (
          <HighlightCard
            title="Worst reach"
            subtitle="Largest reach vs ADP"
            pick={worstReachOfDraft}
            icon={<TrendingDown className="h-5 w-5 text-rose-400" />}
            valueLabel={`${worstReachOfDraft.valueScore} value`}
          />
        )}
        {stealOfDraft && (
          <HighlightCard
            title="Steal of the draft"
            subtitle="Best value pick"
            pick={stealOfDraft}
            icon={<Award className="h-5 w-5 text-emerald-400" />}
            valueLabel={`+${stealOfDraft.valueScore} value`}
          />
        )}
      </section>

      {/* Manager rankings */}
      <section className="mb-8">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Trophy className="h-5 w-5 text-cyan-400" />
          Manager rankings
        </h2>
        <ul className="space-y-3">
          {managerRankings.map((m) => (
            <ManagerRankCard key={m.rosterId} entry={m} />
          ))}
        </ul>
      </section>

      {/* Guillotine post-draft intro (after rankings, before recap) */}
      {isGuillotine && (
        <GuillotinePostDraftIntro leagueId={leagueId} onContinue={() => {}} />
      )}

      {/* Draft board recap */}
      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <LayoutGrid className="h-5 w-5 text-white/60" />
          Draft board recap
        </h2>
        <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="max-h-[400px] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-black/60 text-xs uppercase tracking-wider text-white/50">
                <tr>
                  <th className="p-3 font-medium">Pick</th>
                  <th className="p-3 font-medium">Player</th>
                  <th className="p-3 font-medium">Pos</th>
                  <th className="p-3 font-medium">Team</th>
                  <th className="p-3 font-medium text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {pickLog.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-white/5 hover:bg-white/5"
                  >
                    <td className="p-3 tabular-nums text-white/90">#{p.overall}</td>
                    <td className="p-3 font-medium text-white/90">{p.playerName}</td>
                    <td className="p-3 text-white/70">{p.position}</td>
                    <td className="p-3 text-white/60">{p.team ?? '—'}</td>
                    <td className="p-3 text-right tabular-nums">
                      <span
                        className={
                          (p.valueScore ?? 0) > 0
                            ? 'text-emerald-400'
                            : (p.valueScore ?? 0) < 0
                              ? 'text-rose-400'
                              : 'text-white/50'
                        }
                      >
                        {(p.valueScore ?? 0) > 0 ? '+' : ''}
                        {p.valueScore ?? 0}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <footer className="mt-8 flex flex-wrap gap-4 border-t border-white/10 pt-6">
        <Link
          href={`/league/${leagueId}/draft`}
          className="inline-flex items-center gap-2 text-sm text-cyan-400 hover:underline"
        >
          Draft room
        </Link>
        <Link
          href={`/league/${leagueId}`}
          className="inline-flex items-center gap-2 text-sm text-white/60 hover:underline"
        >
          Back to league
        </Link>
      </footer>
    </div>
  )
}

function HighlightCard({
  title,
  subtitle,
  pick,
  icon,
  valueLabel,
}: {
  title: string
  subtitle: string
  pick: PickScoreEntry
  icon: React.ReactNode
  valueLabel: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/50">
        {icon}
        {title}
      </div>
      <p className="mt-0.5 text-[11px] text-white/40">{subtitle}</p>
      <p className="mt-2 font-semibold text-white/95">{pick.playerName}</p>
      <p className="text-xs text-white/60">
        {pick.position}
        {pick.team ? ` · ${pick.team}` : ''} · Pick #{pick.overall}
      </p>
      <p className="mt-1 text-xs font-medium text-cyan-400">{valueLabel}</p>
    </div>
  )
}

function ManagerRankCard({ entry }: { entry: ManagerRankingEntry }) {
  const [open, setOpen] = useState(false)
  const gradeColor =
    entry.grade.startsWith('A')
      ? 'text-emerald-400'
      : entry.grade.startsWith('B')
        ? 'text-cyan-400'
        : entry.grade.startsWith('C')
          ? 'text-amber-400'
          : 'text-rose-400'

  return (
    <li className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left min-h-[44px] touch-manipulation"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white/90">
            {entry.rank}
          </span>
          <div>
            <p className="font-medium text-white/90">{entry.displayName}</p>
            <p className="text-xs text-white/50">
              Score {entry.score.toFixed(1)} · Value {entry.totalValueScore > 0 ? '+' : ''}
              {entry.totalValueScore}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-lg font-bold ${gradeColor}`}>{entry.grade}</span>
          {open ? (
            <ChevronDown className="h-5 w-5 text-white/50" />
          ) : (
            <ChevronRight className="h-5 w-5 text-white/50" />
          )}
        </div>
      </button>
      {open && (
        <div className="border-t border-white/10 px-4 py-3 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <span className="text-white/50">Position</span>
            <span className="text-white/80">{entry.positionalScore.toFixed(1)}</span>
            <span className="text-white/50">Depth</span>
            <span className="text-white/80">{entry.positionalDepthScore.toFixed(1)}</span>
            <span className="text-white/50">Bench</span>
            <span className="text-white/80">{entry.benchScore.toFixed(1)}</span>
            <span className="text-white/50">Balance</span>
            <span className="text-white/80">{entry.balanceScore.toFixed(1)}</span>
            <span className="text-white/50">Upside</span>
            <span className="text-white/80">{entry.upsideScore.toFixed(1)}</span>
            <span className="text-white/50">Reach ctrl</span>
            <span className="text-white/80">{entry.reachPenaltyScore.toFixed(1)}</span>
            <span className="text-white/50">Injury risk</span>
            <span className="text-white/80">{entry.injuryRiskScore.toFixed(1)}</span>
            <span className="text-white/50">Bye overlap</span>
            <span className="text-white/80">{entry.byeWeekScore.toFixed(1)}</span>
          </div>
          {entry.explanation && (
            <p className="text-xs text-white/70">
              {entry.explanation}
              {entry.explanationSource === 'ai' ? (
                <span className="ml-1 text-[11px] uppercase tracking-wide text-violet-300">AI</span>
              ) : (
                <span className="ml-1 text-[11px] uppercase tracking-wide text-cyan-300">Deterministic</span>
              )}
            </p>
          )}
          {entry.bestPick && (
            <p className="text-xs text-white/60">
              Best pick: <span className="text-emerald-400">{entry.bestPick.playerName}</span> (#{entry.bestPick.overall}, +{entry.bestPick.valueScore} value)
            </p>
          )}
          {entry.worstReach && entry.worstReach.id !== entry.bestPick?.id && (
            <p className="text-xs text-white/60">
              Worst reach: <span className="text-rose-400">{entry.worstReach.playerName}</span> (#{entry.worstReach.overall}, {entry.worstReach.valueScore} value)
            </p>
          )}
        </div>
      )}
    </li>
  )
}
