'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { signupUrlWithIntent } from '@/lib/auth/auth-intent-resolver'
import { trackLandingCtaClick } from '@/lib/landing-analytics'
import { normalizeSleeperUsername } from '@/lib/sleeper-check/username'
import type { CheckPlayer, CheckSlot } from '@/lib/sleeper-check/aggregate'
// Type-only: erased at build, so the server-only module never reaches the client bundle.
import type { SleeperCheckResult } from '@/lib/sleeper-check/sleeperCheck'

import '@/components/core-app/af-core.css'
import '@/components/core-app/af-landing.css'
import './af-check.css'

type OkResult = Extract<SleeperCheckResult, { status: 'ok' }>
type Filter = 'all' | 'hurt' | 'starting'
type Phase =
  | { kind: 'idle' }
  | { kind: 'loading'; username: string }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; data: OkResult }

const SLOT_LABEL: Record<CheckSlot, string> = { starter: 'Starting', bench: 'Bench', ir: 'IR', taxi: 'Taxi' }

/*
 * Measured on a real 54-league account: dozens of Questionable starters. Listing every one pushes
 * the ruled-out players — the ones that cost points — and the sign-up below a wall of maybes. The
 * list is sorted ruled-out first, so the preview always leads with them.
 */
const ALERT_PREVIEW = 8

/**
 * Signing up is what it takes to act (Guap, 2026-09-27). The destination is the canonical Sleeper
 * import with this username prefilled — the same `/import?provider=&username=` contract the home
 * page's import form uses — so the account they create already knows which leagues to bring in.
 */
function signupHref(username: string): string {
  const params = new URLSearchParams({ provider: 'sleeper', username })
  return signupUrlWithIntent(`/import?${params.toString()}`)
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function StatusChip({ player }: { player: CheckPlayer }) {
  if (!player.injuryStatus || !player.severity) return null
  return (
    <span className="af-ck-status af-num" data-severity={player.severity === 'out' ? 'bad' : 'warn'}>
      {player.injuryStatus}
    </span>
  )
}

function PlayerName({ player }: { player: CheckPlayer }) {
  return (
    <span className="af-ck-player">
      {player.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="af-ck-headshot" src={player.imageUrl} alt="" width={32} height={32} loading="lazy" />
      ) : (
        <span className="af-ck-headshot af-ck-headshot--blank" aria-hidden />
      )}
      <span className="af-ck-player-text">
        <span className="af-ck-player-name">{player.name ?? 'Unlisted player'}</span>
        <span className="af-ck-player-meta af-num">
          {[player.position, player.team].filter(Boolean).join(' · ') || '—'}
        </span>
      </span>
    </span>
  )
}

export function SleeperCheck({ initialUsername }: { initialUsername: string }) {
  const [username, setUsername] = useState(initialUsername)
  const [website, setWebsite] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [allAlerts, setAllAlerts] = useState(false)
  const renderedAt = useRef<number>(Date.now())
  /*
   * 🛑 THE SHARED-LINK AUTO-RUN IS ONCE PER MOUNT, FROM THE USERNAME THE PAGE LOADED WITH — never
   * from the prop afterwards. Writing `?u=` into the URL makes Next 14 refetch this page's server
   * component, which hands us a NEW `initialUsername`; an effect keyed on the prop then ran the
   * lookup a second time. Measured in dev: one search, two POSTs — twice the Sleeper reads and
   * twice the visitor's rate limit for nothing.
   */
  const initialOnMount = useRef(initialUsername)
  const ranInitial = useRef(false)

  const run = useCallback(async (raw: string, fromForm: boolean) => {
    ranInitial.current = true
    const clean = normalizeSleeperUsername(raw)
    if (!clean) {
      setPhase({ kind: 'error', message: 'Type your Sleeper username — the one you sign in with, not your team name.' })
      return
    }
    setPhase({ kind: 'loading', username: clean })
    setOpen(null)
    setAllAlerts(false)
    try {
      window.history.replaceState(null, '', `/check?u=${encodeURIComponent(clean)}`)
    } catch {
      /* a sandboxed frame can refuse history writes; the lookup still runs */
    }
    try {
      const res = await fetch('/api/sleeper-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: clean,
          website,
          ...(fromForm ? { form_rendered_at: renderedAt.current } : {}),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) {
        setPhase({ kind: 'error', message: body?.message ?? 'Something went wrong. Try again in a minute.' })
        return
      }
      setPhase({ kind: 'ok', data: body as OkResult })
    } catch {
      setPhase({ kind: 'error', message: 'Could not reach AllFantasy. Check your connection and try again.' })
    }
  }, [website])

  // A shared `?u=` link runs the check for whoever opens it.
  useEffect(() => {
    if (ranInitial.current || !initialOnMount.current) return
    void run(initialOnMount.current, false)
  }, [run])

  const data = phase.kind === 'ok' ? phase.data : null
  const leagueName = useMemo(() => new Map((data?.leagues ?? []).map((l) => [l.leagueId, l])), [data])
  const shown = useMemo(() => {
    const players = data?.players ?? []
    if (filter === 'hurt') return players.filter((p) => p.severity)
    if (filter === 'starting') return players.filter((p) => p.starting > 0)
    return players
  }, [data, filter])

  const cta = data ? signupHref(data.username) : null
  const onCta = (label: string) => () =>
    cta && trackLandingCtaClick({ cta_label: label, cta_destination: cta, cta_type: 'primary', source: 'sleeper-check' })

  return (
    <div className="af-core af-lp af-ck">
      <nav className="af-lp-nav af-ck-nav" aria-label="Main">
        <Link href="/" className="af-lp-brand">
          <span className="af-lp-wordmark">AllFantasy</span>
        </Link>
        <div className="af-ck-nav-right">
          <Link href="/login" className="af-lp-signin">
            Sign in
          </Link>
          <Link href="/signup" className="af-btn af-lp-cta">
            Get started
          </Link>
        </div>
      </nav>

      <header className="af-ck-hero">
        <span className="af-lp-eyebrow af-lp-eyebrow--accent">Free · No account</span>
        <h1 className="af-ck-h1">Who is hurt in your Sleeper lineups?</h1>
        <p className="af-lp-sub">
          Type your Sleeper username. See every player you roster, every injury designation, and every league he is
          starting in — all at once.
        </p>
        <form
          className="af-ck-form"
          onSubmit={(e) => {
            e.preventDefault()
            void run(username, true)
          }}
        >
          <label className="af-ck-visually-hidden" htmlFor="af-ck-username">
            Sleeper username
          </label>
          <span className="af-ck-at af-num" aria-hidden>
            @
          </span>
          <input
            id="af-ck-username"
            className="af-ck-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="your Sleeper username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={41}
            inputMode="text"
          />
          {/* Honeypot: hidden from people, tempting to bots. */}
          <input
            className="af-ck-hp"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            name="website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
          <button className="af-btn af-ck-submit" type="submit" disabled={phase.kind === 'loading'}>
            {phase.kind === 'loading' ? 'Checking…' : 'Check my leagues'}
          </button>
        </form>
        {phase.kind === 'error' ? (
          <p className="af-ck-error" role="alert">
            {phase.message}
          </p>
        ) : null}
      </header>

      {phase.kind === 'loading' ? (
        <p className="af-ck-loading" aria-live="polite">
          Reading @{phase.username}&apos;s leagues…
        </p>
      ) : null}

      {data ? (
        <main className="af-ck-results" aria-live="polite">
          <section className="af-card af-ck-summary">
            {data.avatarId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="af-ck-avatar"
                src={`https://sleepercdn.com/avatars/thumbs/${encodeURIComponent(data.avatarId)}`}
                alt=""
                width={40}
                height={40}
              />
            ) : null}
            <div className="af-ck-summary-text">
              <strong className="af-ck-summary-name">{data.displayName ?? data.username}</strong>
              <span className="af-ck-summary-meta af-num">
                {data.leagues.length} NFL {data.leagues.length === 1 ? 'league' : 'leagues'} · {data.players.length} players ·{' '}
                {data.season} · as of {timeLabel(data.asOf)}
              </span>
            </div>
          </section>

          {data.leaguesNotShown + data.leaguesDeferred + data.leaguesUnavailable > 0 ? (
            <ul className="af-ck-notes">
              {data.leaguesNotShown > 0 ? <li>{data.leaguesNotShown} more leagues are not shown here. Sign up to see them all.</li> : null}
              {data.leaguesDeferred > 0 ? <li>{data.leaguesDeferred} leagues were skipped because we are busy. Check again in a minute.</li> : null}
              {data.leaguesUnavailable > 0 ? <li>Sleeper did not answer for {data.leaguesUnavailable} leagues.</li> : null}
            </ul>
          ) : null}

          <section className="af-ck-section" aria-labelledby="af-ck-alerts-h">
            <h2 id="af-ck-alerts-h" className="af-label">
              In a lineup, and hurt
            </h2>
            {data.alerts.length === 0 ? (
              <p className="af-issue af-ck-alert-empty" data-severity="good">
                No player with an injury designation is in a lineup you set. Best-ball leagues pick their own lineup and
                are left out.
              </p>
            ) : (
              <ul className="af-ck-alerts">
                {(allAlerts ? data.alerts : data.alerts.slice(0, ALERT_PREVIEW)).map((p) => (
                  <li key={p.sleeperId} className="af-issue af-ck-alert" data-severity={p.severity === 'out' ? 'bad' : 'warn'}>
                    <PlayerName player={p} />
                    <StatusChip player={p} />
                    <span className="af-ck-alert-where">
                      Starting in {p.startingSetLineup} {p.startingSetLineup === 1 ? 'lineup' : 'lineups'}:{' '}
                      {p.leagues
                        .filter((l) => l.slot === 'starter' && !leagueName.get(l.leagueId)?.bestBall)
                        .map((l) => leagueName.get(l.leagueId)?.name ?? 'a league')
                        .join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {!allAlerts && data.alerts.length > ALERT_PREVIEW ? (
              <button type="button" className="af-btn af-btn--ghost af-ck-more" onClick={() => setAllAlerts(true)}>
                Show all {data.alerts.length}
              </button>
            ) : null}
            {cta ? (
              <div className="af-ck-cta">
                <p>
                  <strong>Fix these before kickoff.</strong> Sign up free to get one-tap links to each lineup, injury alerts on
                  game day, and the full player card.
                </p>
                <a className="af-btn af-lp-cta-lg" href={cta} onClick={onCta('Sign up to fix lineups')}>
                  Sign up to fix lineups
                </a>
              </div>
            ) : null}
          </section>

          <section className="af-ck-section" aria-labelledby="af-ck-players-h">
            <div className="af-ck-section-head">
              <h2 id="af-ck-players-h" className="af-label">
                Every player you roster
              </h2>
              <div className="af-ck-filters" role="group" aria-label="Filter players">
                {(['all', 'hurt', 'starting'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className="af-chip af-ck-filter"
                    aria-pressed={filter === f}
                    onClick={() => setFilter(f)}
                  >
                    {f === 'all' ? 'All' : f === 'hurt' ? 'Injured' : 'Starting'}
                  </button>
                ))}
              </div>
            </div>
            <ul className="af-ck-players">
              {shown.map((p) => {
                const isOpen = open === p.sleeperId
                return (
                  <li key={p.sleeperId} className="af-ck-row-wrap">
                    <button
                      type="button"
                      className="af-row af-ck-row"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : p.sleeperId)}
                    >
                      <PlayerName player={p} />
                      <StatusChip player={p} />
                      <span className="af-ck-count af-num">
                        {p.leagues.length} {p.leagues.length === 1 ? 'league' : 'leagues'}
                        {p.starting > 0 ? ` · ${p.starting} starting` : ''}
                      </span>
                    </button>
                    {isOpen ? (
                      <ul className="af-ck-leagues">
                        {p.leagues.map((l) => {
                          const league = leagueName.get(l.leagueId)
                          return (
                            <li key={l.leagueId} className="af-ck-league">
                              <span className="af-ck-league-name">{league?.name ?? 'Sleeper league'}</span>
                              {league?.bestBall ? <span className="af-chip af-ck-bb">Best ball</span> : null}
                              <span className="af-ck-slot af-num" data-slot={l.slot}>
                                {SLOT_LABEL[l.slot]}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    ) : null}
                  </li>
                )
              })}
              {shown.length === 0 ? <li className="af-ck-empty">Nobody here.</li> : null}
            </ul>
          </section>

          <p className="af-lp-reassure af-ck-foot">
            Read-only. We never change anything on Sleeper. Rosters refresh every few minutes; injury designations come from
            the same feed as the AllFantasy app.
          </p>
        </main>
      ) : null}
    </div>
  )
}

export default SleeperCheck
