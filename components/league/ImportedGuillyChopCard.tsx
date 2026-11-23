'use client'

import { useEffect, useState } from 'react'
import { Axe } from 'lucide-react'
import type { ImportedGuillyTabData } from '@/lib/guillotine/importedGuillyHealthLoad'
import { chopCardSummary, type ChopCardState } from '@/lib/guillotine/importedGuillyChopCard'
import { DEFAULT_DANGER_MARGIN_POINTS } from '@/lib/guillotine/constants'
import { sourcePlatformLabel } from '@/lib/league/write-authority'
import '@/components/guillotine/guillotine-identity.css'

/**
 * League home's Chopping block card for an IMPORTED Guilly league (2026-11-09 redesign): where you stand
 * against this week's chop line, the lowest score right now, and how many teams are left — read from the
 * same endpoint and view as the Guilly tab (ImportedGuillyTab), from the provider's own weekly scores.
 *
 * The provider runs the chops; this card only reads them, and says so. Before any score it says the line
 * has not formed rather than drawing one, and when the reliability check doubts the picture it says that
 * too. A failed read hides the card: League home must not grow an error box for an optional summary.
 *
 * Colours are the Guilly `gl-*` tokens (guillotine-identity.css), so the card follows light mode on League home.
 */
const TITLES: Record<ChopCardState, string> = {
  not_started: 'The chop line forms once games are played',
  chop_zone: 'You’re on the chop line',
  danger: 'You’re close to the chop line',
  safe: 'You’re clear of the chop line',
  chopped: 'Your team has been chopped',
  unknown: 'This week’s chop line',
}

const TONE: Record<ChopCardState, string> = {
  not_started: 'gl-card',
  chop_zone: 'gl-card-accent',
  danger: 'gl-card-warn',
  safe: 'gl-card',
  chopped: 'gl-card',
  unknown: 'gl-card',
}

const points = (n: number) => n.toFixed(2)

export function ImportedGuillyChopCard({
  leagueId,
  platform,
  yourRosterId,
  onOpenGuilly,
}: {
  leagueId: string
  platform: string | null | undefined
  /** The viewer's provider roster id (`LeagueTeam.externalId`), or null when they have no team here. */
  yourRosterId: string | null
  onOpenGuilly: () => void
}) {
  const [data, setData] = useState<ImportedGuillyTabData | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/imported`, { credentials: 'include', cache: 'no-store' })
      .then(async (res) => (res.ok ? ((await res.json()) as ImportedGuillyTabData) : null))
      .then((d) => {
        if (!cancelled && d?.view) setData(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [leagueId])

  if (!data) return null
  const host = sourcePlatformLabel(platform ?? data.platform) ?? 'your platform'
  const s = chopCardSummary(data.view, yourRosterId)
  const lowestNames = s.lowest
    ? s.lowest.names.length > 2
      ? `${s.lowest.names.slice(0, 2).join(', ')} +${s.lowest.names.length - 2}`
      : s.lowest.names.join(' & ')
    : null

  return (
    <section
      className={`gl gl-text mb-4 rounded-2xl border p-4 sm:p-5 ${TONE[s.state]}`}
      aria-labelledby="imported-guilly-chop-card-title"
      data-testid="imported-guilly-chop-card"
      data-state={s.state}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="gl-accent-text text-[11px] font-semibold uppercase tracking-[0.14em]">
            Chopping block{s.week != null ? ` · week ${s.week}` : ''}
          </p>
          <h2 id="imported-guilly-chop-card-title" className="gl-text mt-1 text-lg font-bold sm:text-xl">
            {TITLES[s.state]}
          </h2>
        </div>
        <Axe className="gl-accent-text mt-1 h-5 w-5 shrink-0" aria-hidden />
      </div>

      <dl className="mt-3 divide-y text-[13px] [&>div]:border-[color:var(--gl-line)]">
        {s.state === 'chopped' ? (
          <div className="flex justify-between gap-3 py-2">
            <dt className="gl-muted">Chopped</dt>
            <dd className="gl-text font-semibold">week {s.choppedWeek}</dd>
          </div>
        ) : s.yourPoints != null ? (
          <div className="flex justify-between gap-3 py-2">
            <dt className="gl-muted">Your score so far</dt>
            <dd className="gl-text font-semibold tabular-nums" data-testid="imported-guilly-chop-card-yours">{points(s.yourPoints)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3 py-2">
          <dt className="gl-muted">Lowest score right now</dt>
          <dd className="gl-bad min-w-0 truncate text-right font-semibold" data-testid="imported-guilly-chop-card-lowest">
            {s.lowest ? `${lowestNames} · ${points(s.lowest.points)}` : 'No scores yet'}
          </dd>
        </div>
        <div className="flex justify-between gap-3 py-2">
          <dt className="gl-muted">Teams still alive</dt>
          <dd className="gl-text font-semibold tabular-nums" data-testid="imported-guilly-chop-card-alive">
            {s.teamsAlive} of {s.teamsTotal}
          </dd>
        </div>
      </dl>

      <p className="gl-muted mt-2 text-[12px]">
        {s.state === 'danger'
          ? `Within ${DEFAULT_DANGER_MARGIN_POINTS} points of the line on ${host}’s scores so far. `
          : ''}
        {host} runs the chops; these are its scores so far this week.
        {data.check.status === 'attention' ? ' Some of this may be out of step with ' + host + '; the Guilly tab says what.' : ''}
      </p>

      <button
        type="button"
        onClick={onOpenGuilly}
        className="gl-chip mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--gl-ember)]"
        data-tone="accent"
      >
        Open the chopping block →
      </button>
    </section>
  )
}
