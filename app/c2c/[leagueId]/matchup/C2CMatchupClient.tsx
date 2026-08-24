'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { C2CMatchupScore } from '@prisma/client'
import type { C2CConfigClient } from '@/lib/c2c/c2cUiLabels'
import { c2cScoreModeDescription } from '@/lib/c2c/c2cUiLabels'
import { C2CCampusPlayerCard } from '@/app/c2c/components/C2CCampusPlayerCard'
import { C2CCantonPlayerCard } from '@/app/c2c/components/C2CCantonPlayerCard'
import type { C2CPlayerRow } from '@/app/c2c/components/c2cPlayerTypes'

export function C2CMatchupClient({ leagueId, userId }: { leagueId: string; userId: string }) {
  const [tab, setTab] = useState<'campus' | 'canton' | 'all'>('all')
  const [cfg, setCfg] = useState<C2CConfigClient | null>(null)
  const [you, setYou] = useState<C2CMatchupScore | null>(null)
  const [opp, setOpp] = useState<C2CMatchupScore | null>(null)
  const [youName, setYouName] = useState('Your team')
  const [oppName, setOppName] = useState('Opponent')
  const [yourCampus, setYourCampus] = useState<C2CPlayerRow[]>([])
  const [yourCanton, setYourCanton] = useState<C2CPlayerRow[]>([])
  const [oppCampus, setOppCampus] = useState<C2CPlayerRow[]>([])
  const [oppCanton, setOppCanton] = useState<C2CPlayerRow[]>([])
  const [tick, setTick] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [scoresLoaded, setScoresLoaded] = useState(false)

  const reload = useCallback(async () => {
    setErr(null)
    try {
      const cr = await fetch(`/api/c2c?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      if (!cr.ok) throw new Error('Not a C2C league')
      const cj = (await cr.json()) as { c2c: C2CConfigClient }
      setCfg(cj.c2c)

      const sr = await fetch(`/api/redraft/season?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      if (!sr.ok) throw new Error('No season')
      const sj = (await sr.json()) as {
        season?: { id: string; currentWeek: number; rosters?: { id: string; ownerId: string | null; teamName?: string | null }[] }
      }
      const season = sj.season
      if (!season?.id) throw new Error('Season missing')
      const w = Math.max(1, season.currentWeek ?? 1)
      const roster = season.rosters?.find((r) => r.ownerId === userId)
      if (!roster) throw new Error('No roster')
      if (roster.teamName) setYouName(roster.teamName)

      const mu = await fetch(
        `/api/redraft/matchup?seasonId=${encodeURIComponent(season.id)}&week=${encodeURIComponent(String(w))}`,
        { credentials: 'include' },
      )
      if (!mu.ok) throw new Error('Matchups unavailable')
      const mj = (await mu.json()) as {
        matchups?: {
          id: string
          homeRosterId: string
          awayRosterId: string | null
          homeRoster?: { teamName?: string | null }
          awayRoster?: { teamName?: string | null }
        }[]
        c2cScores?: Record<string, { home: C2CMatchupScore | null; away: C2CMatchupScore | null }>
      }
      const m = mj.matchups?.find((x) => x.homeRosterId === roster.id || x.awayRosterId === roster.id)
      if (!m || !m.awayRosterId) throw new Error('No head-to-head matchup')
      const mine = m.homeRosterId === roster.id
      const otherId = mine ? m.awayRosterId : m.homeRosterId
      const scores = mj.c2cScores?.[m.id]
      // Absent C2CMatchupScore rows stay null — fabricating zero rows made
      // "not scored yet" indistinguishable from a real 0.0.
      setYou((mine ? scores?.home : scores?.away) ?? null)
      setOpp((mine ? scores?.away : scores?.home) ?? null)
      setScoresLoaded(true)
      if (mine ? m.awayRoster?.teamName : m.homeRoster?.teamName) {
        setOppName((mine ? m.awayRoster?.teamName : m.homeRoster?.teamName) ?? 'Opponent')
      }

      const [rYou, rOpp] = await Promise.all([
        fetch(`/api/c2c/roster?leagueId=${encodeURIComponent(leagueId)}&rosterId=${encodeURIComponent(roster.id)}`, {
          credentials: 'include',
        }).then((r) => r.json()),
        fetch(`/api/c2c/roster?leagueId=${encodeURIComponent(leagueId)}&rosterId=${encodeURIComponent(otherId)}`, {
          credentials: 'include',
        }).then((r) => r.json()),
      ])
      const bYou = rYou?.roster as {
        campusStarters: C2CPlayerRow[]
        cantonStarters: C2CPlayerRow[]
      }
      const bOpp = rOpp?.roster as { campusStarters: C2CPlayerRow[]; cantonStarters: C2CPlayerRow[] }
      setYourCampus(bYou?.campusStarters ?? [])
      setYourCanton(bYou?.cantonStarters ?? [])
      setOppCampus(bOpp?.campusStarters ?? [])
      setOppCanton(bOpp?.cantonStarters ?? [])

      setTick((t) => !t)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    }
  }, [leagueId, userId])

  useEffect(() => {
    void reload()
  }, [reload])

  if (err) {
    return <p className="px-4 py-10 text-center text-[13px] text-red-300/90">{err}</p>
  }
  if (!cfg || !scoresLoaded) {
    return <p className="px-4 py-10 text-center text-[13px] text-white/45">Loading matchup…</p>
  }

  // No college weekly stats are ingested yet, so a stored campus 0 is absent
  // data, not a score — surface it as a labeled absence instead of 0.0.
  const campusVal = (s: C2CMatchupScore | null) => (s && s.campusStarterScore > 0 ? s.campusStarterScore : null)
  const yc = campusVal(you)
  const yct = you ? you.cantonStarterScore : null
  const yt = you ? you.officialTeamScore : null
  const oc = campusVal(opp)
  const oct = opp ? opp.cantonStarterScore : null
  const ot = opp ? opp.officialTeamScore : null

  const RowBar = ({
    left,
    right,
    label,
    variant,
    missingLabel,
  }: {
    left: number | null
    right: number | null
    label: string
    variant: 'campus' | 'canton' | 'total'
    missingLabel: string
  }) => {
    const t = Math.max((left ?? 0) + (right ?? 0), 0.0001)
    const lp = (left ?? 0) / t
    const leftClass =
      variant === 'campus' ? 'bg-violet-600/85' : variant === 'canton' ? 'bg-blue-600/85' : 'bg-gradient-to-r from-violet-600/80 to-blue-600/80'
    return (
      <div className="mb-3">
        <div className="mb-1 flex justify-between text-[11px] text-white/70">
          <span>{left != null ? left.toFixed(1) : '—'}</span>
          <span className="font-bold text-white/90">{label}</span>
          <span>{right != null ? right.toFixed(1) : '—'}</span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-white/[0.06]">
          <div className={`h-full transition-all ${leftClass}`} style={{ width: `${Math.round(lp * 100)}%` }} />
          <div className="h-full flex-1 bg-white/[0.04]" />
        </div>
        {left == null && right == null ? (
          <p className="mt-1 text-center text-[10px] text-white/40">{missingLabel}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-12 pt-4">
      <div className="mb-6 text-center">
        <p className="text-[11px] uppercase tracking-wide text-white/45">This week</p>
        <div className="mt-2 flex items-center justify-between gap-2 text-[13px] font-bold text-white">
          <span className="truncate">{youName}</span>
          <span className="text-white/35">vs</span>
          <span className="truncate">{oppName}</span>
        </div>
      </div>

      <RowBar left={yc} right={oc} label="🎓 Campus" variant="campus" missingLabel="No college scoring yet" />
      <RowBar left={yct} right={oct} label="🏙 Canton" variant="canton" missingLabel="Not scored yet" />
      <RowBar left={yt} right={ot} label="Total" variant="total" missingLabel="Not scored yet" />

      {cfg.scoringMode === 'weighted_combined' ? (
        <p className="mb-4 text-center text-[11px] text-white/50">
          CAMPUS ×{cfg.campusScoreWeight.toFixed(1)} · CANTON ×{cfg.cantonScoreWeight.toFixed(1)}
        </p>
      ) : null}

      {cfg.scoringMode === 'dual_track' ? (
        <div className="mb-4 flex justify-center gap-4 text-[11px] text-white/60">
          <span>
            Campus result: {you?.campusMatchupResult ?? '—'} / {opp?.campusMatchupResult ?? '—'}
          </span>
          <span>
            Canton result: {you?.cantonMatchupResult ?? '—'} / {opp?.cantonMatchupResult ?? '—'}
          </span>
        </div>
      ) : null}

      <p className="mb-4 text-center text-[10px] text-white/40">{c2cScoreModeDescription(cfg)}</p>

      <div className="sticky top-14 z-10 mb-4 flex gap-1 rounded-xl border border-white/[0.07] bg-[#0c0c1e]/95 p-1 backdrop-blur">
        {(['all', 'campus', 'canton'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-2 py-2 text-[11px] font-bold uppercase ${
              tab === t ? 'bg-cyan-500/20 text-cyan-100' : 'text-white/45'
            }`}
            data-testid={`c2c-matchup-tab-${t}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'all' || tab === 'campus' ? (
        <section className="mb-8">
          <h3 className="mb-2 text-[11px] font-bold uppercase text-violet-300">Campus starters</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-[10px] text-violet-200/70">{youName}</p>
              <div className="space-y-2">
                {yourCampus.map((p) => (
                  <C2CCampusPlayerCard key={p.playerId} player={p} />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[10px] text-violet-200/70">{oppName}</p>
              <div className="space-y-2">
                {oppCampus.map((p) => (
                  <C2CCampusPlayerCard key={p.playerId} player={p} />
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tab === 'all' || tab === 'canton' ? (
        <section>
          <h3 className="mb-2 text-[11px] font-bold uppercase text-blue-300">Canton starters</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-[10px] text-blue-200/70">{youName}</p>
              <div className="space-y-2">
                {yourCanton.map((p) => (
                  <C2CCantonPlayerCard key={p.playerId} player={p} />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[10px] text-blue-200/70">{oppName}</p>
              <div className="space-y-2">
                {oppCanton.map((p) => (
                  <C2CCantonPlayerCard key={p.playerId} player={p} />
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <p className={`mt-6 text-center text-[10px] text-white/30 ${tick ? 'idp-score-tick-pulse' : ''}`}>Live scores sync with league engine</p>

      <Link href={`/league/${leagueId}`} className="mt-8 block text-center text-[12px] text-cyan-300/90">
        ← Back to league
      </Link>
    </div>
  )
}
