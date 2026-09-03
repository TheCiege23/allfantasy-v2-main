'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Search } from 'lucide-react'
import { ProjectionRow } from '@/components/sports/ProjectionCard'
import { useProjectionsList } from '@/hooks/useProjections'
import { AfProjectionRow, type AfProjectionView } from '@/components/projections/AfProjectionRow'

type SportFilter = 'NFL' | 'NBA' | 'MLB' | 'NHL'
const SPORTS: SportFilter[] = ['NFL', 'NBA', 'MLB', 'NHL']
const POSITIONS: Record<SportFilter, string[]> = {
  NFL: ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
  NBA: ['All', 'PG', 'SG', 'SF', 'PF', 'C'],
  MLB: ['All', 'SP', 'RP', 'C', '1B', '2B', 'SS', '3B', 'OF', 'DH'],
  NHL: ['All', 'C', 'LW', 'RW', 'D', 'G'],
}

/**
 * ⚠ TWO GENUINELY DIFFERENT SOURCES, AND THE TOGGLE IS NOT A PREFERENCE.
 *
 * `af` is `AFProjectionSnapshot` — our own engine, carrying a baseline, a weather adjustment, a
 * confidence and a reason, and covering the sports the compute cron runs for. `market` is the
 * existing `/api/player-valuations` list, which reaches every sport but is a single number with no
 * derivation.
 *
 * They are NOT interchangeable and must never be merged into one list: the AF number is per game
 * with a separate rest-of-season total, and the market number is neither. Interleaving them would
 * put two units in one column, which is the error this whole phase exists to stop.
 */
type Source = 'af' | 'market'

export function ProjectionsClient() {
  const [sport, setSport] = useState<SportFilter>('NFL')
  const [position, setPosition] = useState('All')
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<Source>('af')

  const posFilter = position === 'All' ? undefined : position
  const { data, loading } = useProjectionsList(sport, { position: posFilter, limit: 100 })

  /* ── The AllFantasy engine's own rows ──────────────────────────────────────────────────── */
  const [afRows, setAfRows] = useState<AfProjectionView[] | null>(null)
  const [afSeason, setAfSeason] = useState<number | null>(null)
  const [afLoading, setAfLoading] = useState(false)
  const [afFailed, setAfFailed] = useState(false)

  useEffect(() => {
    if (source !== 'af') return
    const ac = new AbortController()
    setAfLoading(true)
    setAfFailed(false)
    const params = new URLSearchParams({ sport, limit: '100' })
    if (posFilter) params.set('position', posFilter)

    fetch(`/api/projections/af?${params.toString()}`, { signal: ac.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (ac.signal.aborted) return
        setAfRows(Array.isArray(j?.rows) ? j.rows : [])
        setAfSeason(typeof j?.season === 'number' ? j.season : null)
      })
      .catch(() => {
        if (ac.signal.aborted) return
        /*
         * ⚠ A FAILED FETCH IS NOT AN EMPTY LIST. Setting `[]` here would render "no players
         * projected", which is a claim about the data rather than about the request.
         */
        setAfRows(null)
        setAfFailed(true)
      })
      .finally(() => { if (!ac.signal.aborted) setAfLoading(false) })

    return () => ac.abort()
  }, [source, sport, posFilter])

  const afFiltered = useMemo(() => {
    if (!afRows) return null
    if (!search.trim()) return afRows
    const q = search.toLowerCase()
    return afRows.filter(
      (p) => p.playerName.toLowerCase().includes(q) || (p.position ?? '').toLowerCase().includes(q),
    )
  }, [afRows, search])

  const filtered = useMemo(() => {
    if (!search.trim()) return data
    const q = search.toLowerCase()
    return data.filter(
      (p) =>
        p.playerName.toLowerCase().includes(q) ||
        (p.team ?? '').toLowerCase().includes(q) ||
        (p.position ?? '').toLowerCase().includes(q)
    )
  }, [data, search])

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#080c18] via-[#0a0e1a] to-[#0f0f1a]">
      {/* Header */}
      <div className="border-b border-white/[0.06] bg-[#080c18]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <Link href="/dashboard" className="text-white/40 hover:text-white/60">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-black text-white">Player Projections</h1>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-6">
        {/* Filters */}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          {/* Sport */}
          <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.03]">
            {SPORTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setSport(s); setPosition('All') }}
                className={`px-3 py-1.5 text-[11px] font-semibold transition ${
                  sport === s ? 'bg-cyan-500/15 text-cyan-300' : 'text-white/40 hover:text-white/60'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Position */}
          <div className="flex flex-wrap gap-1">
            {POSITIONS[sport].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPosition(p)}
                className={`rounded-lg px-2 py-1 text-[10px] font-semibold transition ${
                  position === p ? 'bg-purple-500/15 text-purple-300' : 'text-white/30 hover:text-white/50'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Source — see the Source type: these are different data, not a display preference. */}
          <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.03]" data-testid="proj-source">
            {([['af', 'AF engine'], ['market', 'Market']] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSource(id)}
                className={`px-3 py-1.5 text-[11px] font-semibold transition ${
                  source === id ? 'bg-emerald-500/15 text-emerald-300' : 'text-white/40 hover:text-white/60'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/25" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search player..."
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] py-1.5 pl-8 pr-3 text-[12px] text-white placeholder:text-white/25 focus:border-cyan-500/30 focus:outline-none"
            />
          </div>
        </div>

        {/* ── AF engine ─────────────────────────────────────────────────────────────────── */}
        {source === 'af' ? (
          <>
            <div className="mb-2 flex items-center gap-2 px-1 text-[9px] font-bold uppercase tracking-wide text-white/20">
              <span className="flex-1">
                Player{afSeason != null ? <span className="ml-1.5 normal-case text-white/25">{afSeason} season</span> : null}
              </span>
              {/* The units are in the header as well as the row — one column each, never merged. */}
              <span className="w-16 text-right">Per game</span>
              <span className="w-20 text-right">Rest of season</span>
            </div>

            {afLoading && afRows === null ? (
              <div className="space-y-1">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-white/[0.03]" />
                ))}
              </div>
            ) : afFailed ? (
              /*
               * ⚠ THREE DIFFERENT EMPTY STATES, AND COLLAPSING THEM WOULD BE THE BUG. "We could
               * not read", "we hold nothing for this sport" and "this filter matched nobody" are
               * different facts, and only the middle one is a statement about our data coverage.
               */
              <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 py-10 text-center" data-testid="af-error">
                <p className="text-sm text-amber-200/80">Could not read the AllFantasy projections.</p>
                <p className="mt-1 text-xs text-white/30">This is a problem loading them, not a finding that none exist.</p>
              </div>
            ) : afSeason === null ? (
              <div className="py-14 text-center" data-testid="af-no-season">
                <p className="text-sm text-white/40">The AllFantasy engine has no {sport} projections stored.</p>
                <p className="mt-1 text-xs text-white/25">
                  It computes them for the sports the projection cron runs. Try the Market source for this one.
                </p>
              </div>
            ) : (afFiltered?.length ?? 0) === 0 ? (
              <div className="py-14 text-center" data-testid="af-no-match">
                <p className="text-sm text-white/40">
                  No {sport} players match{position !== 'All' ? ` ${position}` : ''}
                  {search.trim() ? ` “${search.trim()}”` : ''}.
                </p>
                <p className="mt-1 text-xs text-white/25">We hold {afSeason} projections for this sport — just none matching.</p>
              </div>
            ) : (
              <ul className="space-y-1" data-testid="af-list">
                {afFiltered!.map((p) => (
                  <AfProjectionRow key={p.playerId} p={p} />
                ))}
              </ul>
            )}
          </>
        ) : (
        <>
        {/* Column header */}
        <div className="mb-2 flex items-center gap-2 px-1 text-[9px] font-bold uppercase tracking-wide text-white/20">
          <span className="flex-1">Player</span>
          <span className="w-14 text-right">Proj</span>
          <span className="w-14 text-right">Delta</span>
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-1">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded-lg bg-white/[0.03]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-white/40">No projection data available.</p>
            <p className="mt-1 text-xs text-white/20">Projections are populated by the import-projections cron and player analytics engine.</p>
          </div>
        ) : (
          <div className="space-y-0.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            {filtered.map((p, i) => (
              <Link
                key={`${p.playerName}-${i}`}
                href={`/player/${encodeURIComponent(p.playerName.toLowerCase().replace(/\s+/g, '-'))}`}
                className="block rounded-lg px-1 py-0.5 transition hover:bg-white/[0.04]"
              >
                <ProjectionRow
                  playerName={p.playerName}
                  position={p.position}
                  team={p.team}
                  projected={p.projectedPoints}
                  delta={p.delta}
                />
              </Link>
            ))}
          </div>
        )}
        </>
        )}
      </div>
    </div>
  )
}
