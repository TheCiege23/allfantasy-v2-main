'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { RosterRow } from '@/app/league/[leagueId]/tabs/TeamTab'
import type { DisplayPlayerMap } from '@/lib/player-data/adapters/redraftDisplayPlayers'
import type { CollegeProLink, CollegeProRosterPayload, CollegeProSide } from '@/lib/league/collegePro/loadCollegeProRoster'
import type { CollegeProDraft } from '@/lib/league/collegePro/drafts'
import type { CollegeProPipeline } from '@/lib/league/collegePro/pipeline'
import type { HeadToHead, TeamMapEditor } from '@/lib/league/collegePro/headToHead'

type CollegeProRosterPayloadDrafts = CollegeProDraft[]

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
  if (state.status === 'error') return <>{fallback}</>
  if (!state.data.applies) {
    // An unlinked C2C / Devy league: offer the link above its standard page.
    return (
      <>
        {state.data.link ? (
          <div className="px-4 pt-4 lg:px-6">
            <LinkHalfCard leagueId={leagueId} link={state.data.link} onLinked={load} />
          </div>
        ) : null}
        {fallback}
      </>
    )
  }

  const data = state.data
  const lead = manualLead ?? data.lead
  const sides = [...data.sides].sort((a, b) => (a.role === lead ? -1 : b.role === lead ? 1 : 0))
  const leadLabel = sideTitle(sides[0]!)

  return (
    <div className="flex flex-col gap-4 px-4 py-4 lg:px-6" data-testid="college-pro-roster" data-lead={lead}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-secondary">
          <span className="mr-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[var(--badge-text-cyan)]">
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
                    ? 'border-cyan-400/50 bg-cyan-400/15 text-[var(--badge-text-cyan)]'
                    : 'border-subtle text-secondary hover:bg-white/[0.04]',
                ].join(' ')}
              >
                {sideTitle(side)} first
              </button>
            ))}
        </div>
      </div>

      {data.link ? <LinkHalfCard leagueId={leagueId} link={data.link} onLinked={load} /> : null}

      <ScoringBar
        leagueId={data.proLeagueId}
        headToHead={data.headToHead}
        teamMap={data.teamMap}
        scoring={data.scoring}
        canEdit={data.canEditScoring}
        total={data.combinedTotal}
        sides={data.sides}
        onSaved={load}
      />

      {sides.map((side) => (
        <HalfLineup key={side.role} side={side} format={data.format} onPlayerClick={onPlayerClick} />
      ))}

      <DraftsCard drafts={data.drafts} pipeline={data.pipeline} proSport={data.sides.find((s) => s.role === 'pro')?.sport ?? 'NFL'} />
    </div>
  )
}

/** The year's two drafts on one card: the pro rookie draft and the college draft. */
function DraftsCard({ drafts, pipeline, proSport }: { drafts: CollegeProRosterPayloadDrafts; pipeline: CollegeProPipeline | null; proSport: string }) {
  if (drafts.length === 0 && !pipeline) return null
  const phaseClass: Record<string, string> = {
    live: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-500',
    upcoming: 'border-cyan-400/40 bg-cyan-400/10 text-[var(--badge-text-cyan)]',
    done: 'border-subtle bg-surface text-muted',
    unknown: 'border-subtle bg-surface text-muted',
  }
  return (
    <section className="rounded-2xl border border-subtle bg-surface-muted/40 p-3 sm:p-4" data-testid="college-pro-drafts">
      <h2 className="mb-2 text-sm font-bold text-primary">Drafts</h2>
      <ul className="space-y-1.5">
        {drafts.map((d, i) => (
          <li key={`${d.role}-${d.season}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-primary">
                {d.season ?? ''} {d.role === 'pro' ? `${proSport} draft` : 'College draft'}
                <span className="ml-1.5 font-normal text-muted">{d.platform === 'sleeper' ? 'on Sleeper' : 'on Fantrax'}</span>
              </p>
              {d.detail || d.startsAt ? (
                <p className="text-[11px] text-muted">
                  {[d.detail, d.startsAt ? `starts ${new Date(d.startsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
            </div>
            <span className={['rounded-full border px-2 py-0.5 text-[11px] font-semibold', phaseClass[d.phase] ?? phaseClass.unknown].join(' ')}>
              {d.status}
            </span>
          </li>
        ))}
      </ul>
      {pipeline ? <PipelineSection pipeline={pipeline} proSport={proSport} /> : null}
    </section>
  )
}

/** Who moves up from your college team, and how big the shortened rookie draft is. */
function PipelineSection({ pipeline, proSport }: { pipeline: CollegeProPipeline; proSport: string }) {
  const { year, movingUp, rookiePool } = pipeline
  return (
    <div className="mt-3 border-t border-subtle pt-3" data-testid="college-pro-pipeline">
      <p className="text-[11px] font-bold uppercase tracking-wide text-secondary">Moving up · {year} {proSport} draft</p>
      {movingUp.length === 0 ? (
        <p className="mt-1 px-2 text-xs text-muted">None of your college players were drafted in {year}.</p>
      ) : (
        <>
          <ul className="mt-1 space-y-1">
            {movingUp.map((p) => (
              <li key={p.playerId} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg px-2 py-1">
                <span className="text-xs font-semibold text-primary">
                  {p.name} <span className="font-normal text-muted">{p.position}</span>
                </span>
                <span className="text-[11px] tabular-nums text-secondary">
                  Rd {p.round}, pick {p.pick}{p.nflTeam ? ` · ${p.nflTeam}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 px-2 text-[11px] text-muted">Add {movingUp.length === 1 ? 'him' : 'them'} to your Sleeper roster as {movingUp.length === 1 ? 'a rookie' : 'rookies'}.</p>
        </>
      )}
      <p className="mt-2 px-2 text-xs text-secondary" data-testid="college-pro-rookie-pool">
        <span className="font-semibold text-primary">{year} rookie draft pool:</span> {rookiePool.unheld} of {rookiePool.drafted} drafted players
        were not on any college roster in this league.
      </p>
    </div>
  )
}

/**
 * Separate (two matchups, the default) or combined (one weekly total). The commissioner can switch
 * it; everyone else sees which one the league plays.
 */
function ScoringBar({
  leagueId,
  headToHead,
  teamMap,
  scoring,
  canEdit,
  total,
  sides,
  onSaved,
}: {
  /** The PRO league: the setting lives there even when the page was opened from the college league. */
  leagueId: string
  headToHead: HeadToHead | null
  teamMap: TeamMapEditor | null
  scoring: 'separate' | 'combined'
  canEdit: boolean
  total: number | null
  sides: CollegeProSide[]
  onSaved: () => Promise<void>
}) {
  const [saving, setSaving] = useState<'separate' | 'combined' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [matching, setMatching] = useState(false)
  const pro = sides.find((s) => s.role === 'pro')
  const opp = headToHead?.opponent ?? null
  const winning = opp && total != null && opp.total != null ? total >= opp.total : null
  const college = sides.find((s) => s.role === 'college')

  const save = async (next: 'separate' | 'combined') => {
    if (next === scoring || saving) return
    setSaving(next)
    setError(null)
    try {
      const res = await fetch('/api/league/college-pro-roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, scoring: next }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'Could not change scoring. Try again.')
      } else {
        await onSaved()
      }
    } catch {
      setError('Could not change scoring. Try again.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <section className="rounded-2xl border border-subtle bg-surface-muted/40 px-3 py-2.5 sm:px-4" data-testid="college-pro-scoring" data-scoring={scoring}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {scoring === 'combined' ? (
          <p className="text-xs text-secondary" data-testid="college-pro-combined-total">
            <span className="mr-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">This week</span>
            <span className={['text-base font-bold tabular-nums', winning === true ? 'text-emerald-500' : winning === false ? 'text-rose-500' : 'text-primary'].join(' ')}>
              {total == null ? '—' : total.toFixed(2)}
            </span>
            {opp ? (
              <span data-testid="college-pro-h2h">
                <span className="mx-1.5 text-muted">vs</span>
                <span className="text-secondary">{opp.name ?? 'Opponent'}</span>
                <span className="ml-1.5 text-base font-bold tabular-nums text-primary">{opp.total == null ? '—' : opp.total.toFixed(2)}</span>
              </span>
            ) : null}
            <span className="ml-2 tabular-nums text-muted">
              {pro ? sideTitle(pro) : 'Pro'} {fmt(pro?.score.total ?? null)} + College {fmt(college?.score.total ?? null)}
            </span>
          </p>
        ) : (
          <p className="text-xs text-secondary">College and {pro ? sideTitle(pro) : 'pro'} are scored as separate matchups.</p>
        )}
        {canEdit ? (
          <div className="flex items-center gap-1.5" role="group" aria-label="How college points count">
            <span className="text-[11px] text-muted">Scoring</span>
            {(['separate', 'combined'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => void save(mode)}
                aria-pressed={scoring === mode}
                disabled={saving != null}
                className={[
                  'rounded-full border px-3 py-1 text-[11px] font-semibold capitalize transition disabled:opacity-60',
                  scoring === mode
                    ? 'border-cyan-400/50 bg-cyan-400/15 text-[var(--badge-text-cyan)]'
                    : 'border-subtle text-secondary hover:bg-white/[0.04]',
                ].join(' ')}
              >
                {saving === mode ? 'Saving…' : mode}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-muted">{scoring === 'combined' ? 'Combined scoring' : 'Separate scoring'}</span>
        )}
      </div>
      {scoring === 'combined' && headToHead?.missing ? (
        <p className="mt-1.5 text-[11px] text-muted" data-testid="college-pro-h2h-missing">
          {headToHead.missing}
          {teamMap ? (
            <button type="button" onClick={() => setMatching((v) => !v)} className="ml-2 font-semibold text-[var(--badge-text-cyan)] hover:underline">
              {matching ? 'Close' : 'Match teams'}
            </button>
          ) : null}
        </p>
      ) : scoring === 'combined' && teamMap ? (
        <button type="button" onClick={() => setMatching((v) => !v)} className="mt-1.5 text-[11px] font-semibold text-[var(--badge-text-cyan)] hover:underline">
          {matching ? 'Close team matching' : 'Edit team matching'}
        </button>
      ) : null}
      {matching && teamMap ? <TeamMatchPanel leagueId={leagueId} editor={teamMap} onSaved={async () => { setMatching(false); await onSaved() }} /> : null}
      {error ? <p className="mt-1.5 text-[11px] text-rose-500">{error}</p> : null}
    </section>
  )
}

/**
 * The commissioner confirms which Fantrax team is whose. Name matches arrive pre-filled and marked
 * "suggested"; nothing counts until it is saved.
 */
function TeamMatchPanel({ leagueId, editor, onSaved }: { leagueId: string; editor: TeamMapEditor; onSaved: () => Promise<void> }) {
  const [choice, setChoice] = useState<Record<string, string>>(() => ({ ...editor.suggested, ...editor.saved }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const taken = (teamId: string, rosterId: string) => Object.entries(choice).some(([r, t]) => t === teamId && r !== rosterId)
  const matched = editor.sleeperTeams.filter((t) => choice[t.rosterId]).length

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const teamMap = Object.fromEntries(Object.entries(choice).filter(([, t]) => t))
      const res = await fetch('/api/league/college-pro-roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, teamMap }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'Could not save. Try again.')
      } else {
        await onSaved()
      }
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 border-t border-subtle pt-3" data-testid="college-pro-team-match">
      <p className="mb-2 text-xs text-secondary">
        Match each pro team to its college team. {matched} of {editor.sleeperTeams.length} matched.
      </p>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {editor.sleeperTeams.map((t) => {
          const value = choice[t.rosterId] ?? ''
          const suggested = !editor.saved[t.rosterId] && value && editor.suggested[t.rosterId] === value
          return (
            <li key={t.rosterId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-primary" title={t.ownerName ?? undefined}>
                {t.teamName ?? t.ownerName ?? `Team ${t.rosterId}`}
              </span>
              <select
                value={value}
                onChange={(e) => setChoice((c) => ({ ...c, [t.rosterId]: e.target.value }))}
                aria-label={`Fantrax team for ${t.teamName ?? t.rosterId}`}
                className="w-40 rounded-md border border-subtle bg-surface px-2 py-1 text-xs text-primary"
              >
                <option value="">Not matched</option>
                {editor.fantraxTeams.map((f) => (
                  <option key={f.teamId} value={f.teamId} disabled={taken(f.teamId, t.rosterId)}>
                    {f.name}
                  </option>
                ))}
              </select>
              <span className="w-16 text-[11px] text-muted">{suggested ? 'suggested' : ''}</span>
            </li>
          )
        })}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-full border border-cyan-400/50 bg-cyan-400/15 px-3 py-1 text-[11px] font-semibold text-[var(--badge-text-cyan)] disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save matches'}
        </button>
        {error ? <span className="text-[11px] text-rose-500">{error}</span> : null}
      </div>
    </div>
  )
}

/**
 * Link this league to its other half: the viewer picks it from their own leagues in the paired sport.
 * Nothing is linked on a guess.
 */
function LinkHalfCard({ leagueId, link, onLinked }: { leagueId: string; link: CollegeProLink; onLinked: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const half = link.needRole === 'college' ? 'college' : 'pro'
  const linkTo = async (otherLeagueId: string) => {
    setBusy(otherLeagueId)
    setError(null)
    try {
      const res = await fetch('/api/league/college-pro-roster/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, otherLeagueId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'Could not link these leagues. Try again.')
      } else {
        await onLinked()
      }
    } catch {
      setError('Could not link these leagues. Try again.')
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="rounded-2xl border border-cyan-400/30 bg-cyan-400/[0.06] p-3 sm:p-4" data-testid="college-pro-link">
      <h2 className="text-sm font-bold text-primary">Link your {half} league</h2>
      <p className="mt-0.5 text-xs text-secondary">See both lineups on one page, and score them together if your league does.</p>
      {link.candidates.length === 0 ? (
        <p className="mt-2 text-xs text-muted">Import your {half} league first, then link it here.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {link.candidates.map((c) => (
            <li key={c.leagueId} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-primary">
                {c.name} <span className="text-muted">· {c.sport} · {c.platform === 'fantrax' ? 'Fantrax' : c.platform === 'sleeper' ? 'Sleeper' : c.platform}</span>
              </span>
              <button
                type="button"
                onClick={() => void linkTo(c.leagueId)}
                disabled={busy != null}
                className="rounded-full border border-cyan-400/50 bg-cyan-400/15 px-3 py-1 text-[11px] font-semibold text-[var(--badge-text-cyan)] disabled:opacity-60"
              >
                {busy === c.leagueId ? 'Linking…' : 'Link'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="mt-1.5 text-[11px] text-rose-500">{error}</p> : null}
    </section>
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
            projectedPoints: side.weeklyProjections?.[p.id] ?? null,
          },
        ]),
      ),
    [side.players, side.weeklyProjections],
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
      week={side.score.week ?? 0}
      season={season}
      liveScore={side.points[id] ?? null}
      projectionPrecision={side.weeklyProjections ? 2 : undefined}
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
        <div className="flex items-center gap-3">
          <ScoreLine score={side.score} />
          {side.role === 'college' && side.leagueHref ? (
            <Link href={side.leagueHref} className="text-[11px] font-semibold text-[var(--badge-text-cyan)] hover:underline">
              Open college league
            </Link>
          ) : null}
        </div>
      </div>
      {side.score.note ? <p className="-mt-2 mb-3 text-[11px] text-muted">{side.score.note}</p> : null}

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

const fmt = (n: number | null) => (n == null ? '—' : n.toFixed(2))

/** "Wk 11 · 98.40 vs Connor0488 101.20", or just the total when there is no head-to-head opponent. */
function ScoreLine({ score }: { score: CollegeProSide['score'] }) {
  if (score.total == null && !score.opponent) return null
  const winning = score.opponent && score.total != null && score.opponent.total != null ? score.total >= score.opponent.total : null
  return (
    <p className="text-right text-xs tabular-nums text-secondary" data-testid="college-pro-score">
      {score.week ? <span className="mr-1.5 text-[11px] uppercase tracking-wide text-muted">Wk {score.week}</span> : null}
      <span className={['font-bold', winning === true ? 'text-emerald-300' : winning === false ? 'text-rose-300' : 'text-primary'].join(' ')}>
        {fmt(score.total)}
      </span>
      {score.opponent ? (
        <>
          <span className="mx-1.5 text-muted">vs</span>
          <span className="text-secondary">{score.opponent.name ?? 'Opponent'}</span>
          <span className="ml-1.5 font-semibold text-primary">{fmt(score.opponent.total)}</span>
        </>
      ) : null}
    </p>
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
