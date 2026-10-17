'use client'

import { useMemo, useState, useCallback } from 'react'
import { Share2, Copy, Check, Loader2 } from 'lucide-react'
import Link from 'next/link'
import type { MockDraftPick } from '@/lib/mock-draft/types'
import type { MockDraftConfig } from '@/lib/mock-draft/types'

const POSITION_COLORS: Record<string, string> = {
  QB: 'text-red-400 bg-red-500/15 border-red-500/30',
  RB: 'text-cyan-400 bg-cyan-500/15 border-cyan-500/30',
  WR: 'text-green-400 bg-green-500/15 border-green-500/30',
  TE: 'text-purple-400 bg-purple-500/15 border-purple-500/30',
  K: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
  DEF: 'text-slate-400 bg-slate-500/15 border-slate-500/30',
}

function getTeamGrade(picks: MockDraftPick[], manager: string) {
  const drafted = picks.filter((p) => p.manager === manager)
  if (drafted.length === 0) {
    return { letter: 'N/A', color: '#6b7280', title: 'No picks', strengths: [] as string[], weaknesses: [] as string[], valueAdded: '+$0' }
  }

  const qb = drafted.filter((p) => p.position === 'QB').length
  const rb = drafted.filter((p) => p.position === 'RB').length
  const wr = drafted.filter((p) => p.position === 'WR').length
  const te = drafted.filter((p) => p.position === 'TE').length

  let score = 75
  if (qb >= 2) score += 15
  if (rb >= 4) score += 10
  if (wr >= 5) score += 8
  if (te >= 2) score += 5
  if (qb === 0) score -= 10
  if (rb < 3) score -= 8
  if (wr < 3) score -= 6
  if (te === 0) score -= 4
  for (const p of drafted) {
    score += Math.min((p.value || 0) / 20, 5)
  }
  score = Math.max(40, Math.min(100, score))

  const strengths: string[] = []
  const weaknesses: string[] = []
  if (qb >= 2) strengths.push('Solid QB depth')
  if (rb >= 4) strengths.push('Deep RB room')
  if (wr >= 5) strengths.push('Loaded at WR')
  if (te >= 2) strengths.push('TE advantage')
  if (rb < 3) weaknesses.push('Thin RB room')
  if (wr < 3) weaknesses.push('WR depth concern')
  if (qb === 0) weaknesses.push('No QB drafted')
  if (te === 0) weaknesses.push('No TE rostered')

  let letter: string
  let color: string
  let title: string
  if (score >= 95) { letter = 'A+'; color = '#00ff88'; title = 'Elite Draft' }
  else if (score >= 90) { letter = 'A'; color = '#22c55e'; title = 'Excellent Draft' }
  else if (score >= 85) { letter = 'A-'; color = '#4ade80'; title = 'Great Draft' }
  else if (score >= 80) { letter = 'B+'; color = '#84cc16'; title = 'Strong Class' }
  else if (score >= 75) { letter = 'B'; color = '#eab308'; title = 'Above Average' }
  else if (score >= 70) { letter = 'B-'; color = '#f59e0b'; title = 'Solid Foundation' }
  else if (score >= 65) { letter = 'C+'; color = '#f97316'; title = 'Average Draft' }
  else if (score >= 55) { letter = 'C'; color = '#ef4444'; title = 'Below Average' }
  else { letter = 'D'; color = '#dc2626'; title = 'Needs Work' }

  const totalValue = drafted.reduce((sum, p) => sum + (p.value || 0), 0)
  return {
    letter,
    color,
    title,
    strengths: strengths.slice(0, 3),
    weaknesses: weaknesses.slice(0, 3),
    valueAdded: `+$${totalValue.toLocaleString()}`,
  }
}

export interface MockDraftRecapProps {
  /** All picks in order */
  results: MockDraftPick[]
  /** Optional config for header */
  config?: MockDraftConfig | null
  /** Optional: user's manager name to highlight */
  userManagerName?: string | null
  /** League id for sharing (required for Share results) */
  leagueId?: string | null
  /** Session/saved draft id for replay route */
  draftId?: string | null
  onBack?: () => void
}

export function MockDraftRecap({
  results,
  config,
  userManagerName,
  leagueId,
  draftId,
  onBack,
}: MockDraftRecapProps) {
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [copied, setCopied] = useState(false)

  const shareResults = useCallback(async () => {
    if (!leagueId || results.length === 0) return
    setSharing(true)
    setShareUrl(null)
    try {
      const res = await fetch('/api/mock-draft/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          results: results.map((p) => ({
            round: p.round,
            pick: p.pick,
            overall: p.overall,
            playerName: p.playerName,
            position: p.position,
            team: p.team,
            manager: p.manager,
            managerAvatar: p.managerAvatar,
            confidence: p.confidence,
            isUser: p.isUser,
            value: p.value,
            notes: p.notes,
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.shareId) {
        const base = typeof window !== 'undefined' ? window.location.origin : ''
        setShareUrl(`${base}/mock-draft/share/${data.shareId}`)
      }
    } finally {
      setSharing(false)
    }
  }, [leagueId, results])

  const copyShareUrl = useCallback(() => {
    if (!shareUrl) return
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [shareUrl])

  const managers = useMemo(
    () => Array.from(new Set(results.map((p) => p.manager))).filter(Boolean).sort(),
    [results],
  )

  const byRound = useMemo(() => {
    const maxRound = Math.max(0, ...results.map((p) => p.round))
    const map: Record<number, MockDraftPick[]> = {}
    for (let r = 1; r <= maxRound; r++) {
      map[r] = results.filter((p) => p.round === r).sort((a, b) => a.pick - b.pick)
    }
    return map
  }, [results])

  const teamGrades = useMemo(() => {
    const grades: Record<string, ReturnType<typeof getTeamGrade>> = {}
    for (const mgr of managers) {
      grades[mgr] = getTeamGrade(results, mgr)
    }
    return grades
  }, [results, managers])

  const userRoster = useMemo(() => {
    if (!userManagerName) return []
    return results.filter((p) => p.manager === userManagerName)
  }, [results, userManagerName])

  return (
    <div className="space-y-6 rounded-2xl border border-white/12 bg-black/20 p-6 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">Mock Draft Recap</h2>
        <div className="flex flex-wrap items-center gap-2">
          {draftId && (
            <Link
              href={`/mock-draft/${encodeURIComponent(draftId)}/replay`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/20 px-3 py-1.5 text-xs font-medium text-purple-100 hover:bg-purple-500/30"
              data-testid="mock-draft-recap-replay"
            >
              Open replay
            </Link>
          )}
          {leagueId && (
            <>
              {!shareUrl ? (
                <button
                  type="button"
                  onClick={shareResults}
                  disabled={sharing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
                >
                  {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                  {sharing ? 'Creating link…' : 'Share results'}
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    className="w-48 rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white"
                  />
                  <button
                    type="button"
                    onClick={copyShareUrl}
                    className="inline-flex items-center gap-1 rounded border border-white/20 px-2 py-1 text-[11px] text-white/90 hover:bg-white/10"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              )}
            </>
          )}
          {config && (
            <p className="text-white/60">
              {config.sport} · {config.leagueType} · {config.draftType} · {config.numTeams} teams
            </p>
          )}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
            >
              Back to draft
            </button>
          )}
        </div>
      </div>

      {/* Full draft board */}
      <section>
        <h3 className="mb-3 text-sm font-medium text-white/90">Full draft board</h3>
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/30">
          <table className="w-full min-w-[600px] text-left text-[11px]">
            <thead>
              <tr className="border-b border-white/10 text-white/70">
                <th className="p-2">Overall</th>
                <th className="p-2">Round</th>
                <th className="p-2">Pick</th>
                <th className="p-2">Manager</th>
                <th className="p-2">Player</th>
                <th className="p-2">Pos</th>
                <th className="p-2">Team</th>
              </tr>
            </thead>
            <tbody>
              {results.map((p) => (
                <tr
                  key={`${p.overall}-${p.playerName}`}
                  className={`border-b border-white/5 ${p.manager === userManagerName ? 'bg-cyan-500/10' : ''}`}
                >
                  <td className="p-2 font-mono text-white/80">{p.overall}</td>
                  <td className="p-2 text-white/70">{p.round}</td>
                  <td className="p-2 text-white/70">{p.pick}</td>
                  <td className="p-2 font-medium text-white">
                    {p.manager}
                    {p.isUser && ' (you)'}
                  </td>
                  <td className="p-2 text-white">{p.playerName}</td>
                  <td className="p-2">
                    <span
                      className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] ${POSITION_COLORS[p.position] || 'text-white/70 bg-white/10'}`}
                    >
                      {p.position}
                    </span>
                  </td>
                  <td className="p-2 text-white/60">{p.team}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Team summary & grades */}
      <section>
        <h3 className="mb-3 text-sm font-medium text-white/90">Team summary</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {managers.map((mgr) => {
            const grade = teamGrades[mgr]
            const roster = results.filter((p) => p.manager === mgr)
            const posCounts: Record<string, number> = {}
            for (const p of roster) {
              posCounts[p.position] = (posCounts[p.position] || 0) + 1
            }
            return (
              <div
                key={mgr}
                className={`rounded-xl border p-4 ${
                  mgr === userManagerName ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-white/10 bg-black/30'
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold text-white">{mgr}</span>
                  <span
                    className="rounded border px-2 py-0.5 text-lg font-bold"
                    style={{ color: grade.color, borderColor: grade.color }}
                  >
                    {grade.letter}
                  </span>
                </div>
                <p className="text-[11px] text-white/55">{grade.title}</p>
                <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                  {Object.entries(posCounts).map(([pos, n]) => (
                    <span key={pos} className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">
                      {pos}:{n}
                    </span>
                  ))}
                </div>
                <ul className="mt-2 space-y-0.5 text-[11px] text-white/65">
                  {grade.strengths.map((s) => (
                    <li key={s}>+ {s}</li>
                  ))}
                  {grade.weaknesses.map((w) => (
                    <li key={w}>− {w}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-white/50">{grade.valueAdded}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Roster strengths / positional grades for user */}
      {userManagerName && userRoster.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-medium text-white/90">Your roster · Positional breakdown</h3>
          <div className="flex flex-wrap gap-3">
            {['QB', 'RB', 'WR', 'TE'].map((pos) => {
              const count = userRoster.filter((p) => p.position === pos).length
              const players = userRoster.filter((p) => p.position === pos)
              return (
                <div
                  key={pos}
                  className="rounded-lg border border-white/10 bg-black/30 px-4 py-2 text-[11px]"
                >
                  <span className="font-medium text-white/80">{pos}</span>
                  <span className="ml-2 text-white/55">({count})</span>
                  <ul className="mt-1 text-white/70">
                    {players.map((p) => (
                      <li key={p.overall}>{p.playerName}</li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* AI recap summary placeholder */}
      <section className="rounded-xl border border-dashed border-white/20 bg-white/[0.02] p-6 text-center">
        <p className="text-sm font-medium text-white/70">AI recap summary</p>
        <p className="mt-2 text-[12px] text-white/50">
          Post-draft AI analysis will appear here (e.g. best value picks, risks, and lineup outlook).
          This is a placeholder for a future model-generated recap.
        </p>
      </section>
    </div>
  )
}
