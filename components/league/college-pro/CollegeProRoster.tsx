'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { RosterRow } from '@/app/league/[leagueId]/tabs/TeamTab'
import type { DisplayPlayerMap } from '@/lib/player-data/adapters/redraftDisplayPlayers'
import type { CollegeProRosterPayload, CollegeProSide } from '@/lib/league/collegePro/loadCollegeProRoster'

/**
 * The roster tab for a college + pro league (C2C / Devy): the pro lineup and the college lineup on
 * one page, each with its own bench, drawn with the same row the standard roster page uses.
 *
 * Whichever half has games today leads (see lib/league/collegePro/leadSide.ts). The manager can flip
 * the order by hand. A league this does not apply to renders `fallback`, which is the page's
 * standard roster view.
 */

const REFRESH_MS = 60_000

type State = { status: 'loading' } | { status: 'ready'; data: CollegeProRosterPayload } | { status: 'error' }

export function CollegeProRoster({
  leagueId,
  onPlayerClick,
  fallback,
}: {
  leagueId: string
  onPlayerClick: (playerId: string) => void
  fallback: ReactNode
}) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [manualLead, setManualLead] = useState<'pro' | 'college' | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/league/college-pro-roster?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' })
      const data = (await res.json()) as CollegeProRosterPayload
      setState({ status: 'ready', data })
    } catch {
      setState((prev) => (prev.status === 'ready' ? prev : { status: 'error' }))
    }
  }, [leagueId])

  useEffect(() => {
    void load()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  if (state.status === 'loading') {
    return (
      <div className="px-4 py-6 text-xs text-muted lg:px-6" data-testid="college-pro-roster-loading">
        Loading your lineups…
      </div>
    )
  }
  if (state.status === 'error' || !state.data.applies) return <>{fallback}</>

  const data = state.data
  const lead = manualLead ?? data.lead
  const sides = [...data.sides].sort((a, b) => (a.role === lead ? -1 : b.role === lead ? 1 : 0))
  const leadLabel = sideTitle(sides[0]!)

  return (
    <div className="flex flex-col gap-4 px-4 py-4 lg:px-6" data-testid="college-pro-roster" data-lead={lead}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-secondary">
          <span className="mr-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-cyan-200">
            {data.format === 'c2c' ? 'C2C' : 'Devy'}
          </span>
          {manualLead ? `${leadLabel} on top.` : leadMessage(data.leadReason, leadLabel)}
        </p>
        <div className="flex gap-1" role="group" aria-label="Which lineup is on top">
          {(['pro', 'college'] as const)
            .map((role) => data.sides.find((s) => s.role === role))
            .filter((side): side is CollegeProSide => side != null)
            .map((side) => (
              <button
                key={side.role}
                type="button"
                onClick={() => setManualLead(side.role === data.lead ? null : side.role)}
                aria-pressed={lead === side.role}
                className={[
                  'rounded-full border px-3 py-1 text-[11px] font-semibold transition',
                  lead === side.role
                    ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-100'
                    : 'border-subtle text-secondary hover:bg-white/[0.04]',
                ].join(' ')}
              >
                {sideTitle(side)} first
              </button>
            ))}
        </div>
      </div>

      {sides.map((side) => (
        <HalfLineup key={side.role} side={side} format={data.format} onPlayerClick={onPlayerClick} />
      ))}
    </div>
  )
}

/** "NFL" / "NBA" for the pro half, "College" for the other. */
function sideTitle(side: Pick<CollegeProSide, 'role' | 'sport'>): string {
  return side.role === 'pro' ? side.sport || 'Pro' : 'College'
}

function leadMessage(reason: string, label: string): string {
  // "NFL" stays capitalised mid-sentence; "College" does not.
  const inline = label === 'College' ? 'college' : label
  if (reason === 'live') return `${label} games are live, so your ${inline} lineup is on top.`
  if (reason === 'today' || reason === 'next') return `${label} games are on today, so your ${inline} lineup is on top.`
  return `${label} lineup on top.`
}

function HalfLineup({
  side,
  format,
  onPlayerClick,
}: {
  side: CollegeProSide
  format: 'c2c' | 'devy'
  onPlayerClick: (playerId: string) => void
}) {
  const title = sideTitle(side)
  const players: DisplayPlayerMap = useMemo(
    () =>
      Object.fromEntries(
        Object.values(side.players).map((p) => [
          p.id,
          {
            id: p.id,
            name: p.name,
            position: p.position ?? '',
            team: p.team ?? 'FA',
            headshotUrl: p.imageUrl,
            imageUrl: p.imageUrl,
            teamLogoUrl: p.logoUrl,
          },
        ]),
      ),
    [side.players],
  )
  const season = new Date().getFullYear()
  const row = (id: string, slotLabel?: string, key?: string) => (
    <RosterRow
      key={key ?? id}
      playerId={id}
      sport={side.sport}
      players={players}
      playersLoading={false}
      onPlayerClick={(pid) => onPlayerClick(pid)}
      slotLabel={slotLabel}
      week={0}
      season={season}
    />
  )
  // Taxi is a pro-side spot. Devy leagues always have one; a C2C league only shows it when the
  // provider roster actually holds taxi players, so nobody on the real roster disappears.
  const showTaxi = side.role === 'pro' && (format === 'devy' || side.taxi.length > 0)

  return (
    <section
      className="rounded-2xl border border-subtle bg-surface-muted/40 p-3 sm:p-4"
      data-testid={`college-pro-half-${side.role}`}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-primary">{title} lineup</h2>
          <p className="truncate text-[11px] text-muted">
            {side.leagueName}
            {side.teamLabel ? ` · ${side.teamLabel}` : ''}
            {` · set on ${side.platform === 'fantrax' ? 'Fantrax' : 'Sleeper'}`}
          </p>
        </div>
        {side.role === 'college' && side.leagueHref ? (
          <Link href={side.leagueHref} className="text-[11px] font-semibold text-cyan-300 hover:underline">
            Open college league
          </Link>
        ) : null}
      </div>

      {side.unavailable ? (
        <p className="mb-3 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {side.unavailable}
        </p>
      ) : null}

      {side.starters.length > 0 ? (
        <div className="mb-3">
          <div className="mb-1.5 flex items-end justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Starters</p>
            <div className="flex gap-2 text-[11px] font-semibold uppercase tracking-wide text-white/35">
              <span className="w-[4.5rem] text-right">Proj</span>
              <span className="w-10 text-right">Pts</span>
            </div>
          </div>
          <div className="space-y-1">
            {side.starters.map((s, i) =>
              s.playerId ? (
                row(s.playerId, s.slot, `${s.slot}-${i}`)
              ) : (
                <RosterRow
                  key={`${s.slot}-${i}`}
                  playerId=""
                  sport={side.sport}
                  players={players}
                  playersLoading={false}
                  onPlayerClick={() => {}}
                  slotLabel={s.slot}
                  week={0}
                  season={season}
                  emptyLabel="Empty"
                />
              ),
            )}
          </div>
        </div>
      ) : null}

      <ListSection label={`Bench · ${title}`} ids={side.bench} render={(id) => row(id)} testId={`bench-${side.role}`} />
      {showTaxi ? (
        <ListSection label={`Taxi · ${title}`} ids={side.taxi} render={(id) => row(id)} testId={`taxi-${side.role}`} emptyText="No taxi players." />
      ) : null}
      {side.ir.length > 0 ? (
        <ListSection label={`IR · ${title}`} ids={side.ir} render={(id) => row(id)} testId={`ir-${side.role}`} />
      ) : null}
    </section>
  )
}

function ListSection({
  label,
  ids,
  render,
  testId,
  emptyText,
}: {
  label: string
  ids: string[]
  render: (id: string) => ReactNode
  testId: string
  emptyText?: string
}) {
  if (ids.length === 0 && !emptyText) return null
  return (
    <div className="mb-3 last:mb-0" data-testid={testId}>
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-secondary">{label}</p>
        <div className="h-px flex-1 bg-subtle" />
      </div>
      {ids.length === 0 ? <p className="px-2 text-xs text-muted">{emptyText}</p> : <div className="space-y-1">{ids.map(render)}</div>}
    </div>
  )
}
