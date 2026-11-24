'use client'

import { useCallback, useEffect, useState } from 'react'
import type { C2CMatchupScore } from '@prisma/client'
import type { C2CConfigClient } from '@/lib/c2c/c2cUiLabels'
import { c2cScoreModeDescription } from '@/lib/c2c/c2cUiLabels'
import { NBA_CBB_DEFAULTS, NFL_CFB_DEFAULTS } from '@/lib/c2c/sportDefaults'
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
  /** This week's stored points by playerId, both teams. */
  const [points, setPoints] = useState<Record<string, number>>({})
  const [week, setWeek] = useState(1)
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
        season?: { id: string; season: number; currentWeek: number; rosters?: { id: string; ownerId: string | null; teamName?: string | null }[] }
      }
      const season = sj.season
      if (!season?.id) throw new Error('Season missing')
      const w = Math.max(1, season.currentWeek ?? 1)
      setWeek(w)
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
        fetch(`/api/c2c/roster?leagueId=${encodeURIComponent(leagueId)}&rosterId=${encodeURIComponent(roster.id)}&week=${w}&season=${season.season}`, {
          credentials: 'include',
        }).then((r) => r.json()),
        fetch(`/api/c2c/roster?leagueId=${encodeURIComponent(leagueId)}&rosterId=${encodeURIComponent(otherId)}&week=${w}&season=${season.season}`, {
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
      setPoints({ ...(rYou?.points ?? {}), ...(rOpp?.points ?? {}) })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    }
  }, [leagueId, userId])

  useEffect(() => {
    void reload()
  }, [reload])

  if (err) {
    return <p className="px-4 py-10 text-center text-[13px] text-[var(--bad)]">{err}</p>
  }
  if (!cfg || !scoresLoaded) {
    return <p className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">Loading matchup…</p>
  }

  const nba = cfg.sportPair === 'NBA_CBB' || String(cfg.sportPair).includes('NBA')
  const slots = nba
    ? { campus: NBA_CBB_DEFAULTS.campusStarterSlots, canton: NBA_CBB_DEFAULTS.cantonStarterSlots }
    : { campus: NFL_CFB_DEFAULTS.campusStarterSlots, canton: NFL_CFB_DEFAULTS.cantonStarterSlots }

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
        <div className="mb-1 flex justify-between text-[12px] tabular-nums text-[var(--text2)]">
          <span>{left != null ? left.toFixed(1) : '—'}</span>
          <span className="font-bold text-[var(--text)]">{label}</span>
          <span>{right != null ? right.toFixed(1) : '—'}</span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-[var(--chip)]">
          <div className={`h-full transition-all ${leftClass}`} style={{ width: `${Math.round(lp * 100)}%` }} />
          <div className="h-full flex-1 bg-[var(--chip)]" />
        </div>
        {left == null && right == null ? (
          <p className="mt-1 text-center text-[12px] text-[var(--muted)]">{missingLabel}</p>
        ) : null}
      </div>
    )
  }

  /** One row per lineup slot: your player, the slot, theirs — side by side at every width (2026-11-23). */
  const Line = ({ side, slot, mine, theirs }: { side: 'campus' | 'canton'; slot: string; mine: C2CPlayerRow | null; theirs: C2CPlayerRow | null }) => {
    const tone = side === 'campus' ? 'text-[var(--campus)]' : 'text-[var(--canton)]'
    const cell = (p: C2CPlayerRow | null, align: 'left' | 'right') => {
      const pts = p ? points[p.playerId] : undefined
      const meta = p ? [p.position, side === 'campus' ? p.school : p.nflNbaTeam].filter(Boolean).join(' · ') : ''
      return (
        <div className={`flex min-w-0 flex-1 items-center gap-2 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 break-words text-[13px] font-semibold leading-snug text-[var(--text)]">{p ? p.playerName : 'Empty'}</p>
            {meta ? <p className="truncate text-[11px] text-[var(--muted)]">{meta}</p> : null}
          </div>
          <span className={`w-11 shrink-0 font-mono text-[14px] font-bold tabular-nums ${pts != null ? tone : 'text-[var(--faint)]'} ${align === 'right' ? 'text-left' : 'text-right'}`}>
            {pts != null ? pts.toFixed(1) : '—'}
          </span>
        </div>
      )
    }
    return (
      <li className="flex items-center gap-2 border-t border-[var(--line)] py-2 first:border-t-0" data-testid={`c2c-matchup-line-${side}-${slot}`}>
        {cell(mine, 'left')}
        <span className={`w-10 shrink-0 text-center text-[11px] font-bold ${tone}`}>{slot}</span>
        {cell(theirs, 'right')}
      </li>
    )
  }
  const slotLabel = (slot: string) => slot.replace(/^[^_]+_/, '')
  const block = (side: 'campus' | 'canton') => {
    const defs = side === 'campus' ? slots.campus : slots.canton
    const mine = side === 'campus' ? yourCampus : yourCanton
    const theirs = side === 'campus' ? oppCampus : oppCanton
    return (
      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2" data-testid={`c2c-matchup-${side}`}>
        <div className="border-b border-[var(--line)] pb-2 text-[12px] font-bold">
          <p className={`text-center text-[13px] ${side === 'campus' ? 'text-[var(--campus)]' : 'text-[var(--canton)]'}`}>{side === 'campus' ? '🎓 Campus' : '🏙 Canton'}</p>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-[var(--text)]">{youName}</span>
            <span className="min-w-0 truncate text-right text-[var(--text)]">{oppName}</span>
          </div>
        </div>
        <ul>
          {defs.map((d, i) => (
            <Line key={d.slot} side={side} slot={slotLabel(d.slot)} mine={mine[i] ?? null} theirs={theirs[i] ?? null} />
          ))}
        </ul>
      </section>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-4">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 text-center">
          <p className="text-[12px] text-[var(--muted)]">Week {week}</p>
          <div className="mt-2 flex items-center justify-between gap-2 text-[14px] font-bold text-[var(--text)]">
            <span className="truncate">{youName}</span>
            <span className="text-[var(--faint)]">vs</span>
            <span className="truncate">{oppName}</span>
          </div>
        </div>

        <RowBar left={yc} right={oc} label="🎓 Campus" variant="campus" missingLabel="No college scoring yet" />
        <RowBar left={yct} right={oct} label="🏙 Canton" variant="canton" missingLabel="Not scored yet" />
        <RowBar left={yt} right={ot} label="Total" variant="total" missingLabel="Not scored yet" />

        {cfg.scoringMode === 'weighted_combined' ? (
          <p className="mb-4 text-center text-[12px] text-[var(--muted)]">
            Campus ×{cfg.campusScoreWeight.toFixed(1)} · Canton ×{cfg.cantonScoreWeight.toFixed(1)}
          </p>
        ) : null}

        {cfg.scoringMode === 'dual_track' ? (
          <div className="mb-4 flex justify-center gap-4 text-[12px] text-[var(--text2)]">
            <span>
              Campus result: {you?.campusMatchupResult ?? '—'} / {opp?.campusMatchupResult ?? '—'}
            </span>
            <span>
              Canton result: {you?.cantonMatchupResult ?? '—'} / {opp?.cantonMatchupResult ?? '—'}
            </span>
          </div>
        ) : null}

        <p className="mb-4 text-center text-[12px] text-[var(--muted)]">{c2cScoreModeDescription(cfg)}</p>
      </div>

      <div className="sticky top-14 z-10 mx-auto mb-4 flex max-w-3xl gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1 backdrop-blur md:top-0">
        {(['all', 'campus', 'canton'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`min-h-[40px] flex-1 rounded-lg px-2 text-[12px] font-bold ${
              tab === t ? 'bg-[var(--accent-soft)] text-[var(--text)]' : 'text-[var(--muted)]'
            }`}
            data-testid={`c2c-matchup-tab-${t}`}
          >
            {t === 'all' ? 'Both sides' : t === 'campus' ? 'Campus' : 'Canton'}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {tab === 'all' || tab === 'campus' ? block('campus') : null}
        {tab === 'all' || tab === 'canton' ? block('canton') : null}
      </div>
    </div>
  )
}
