'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'

/**
 * A switching league (lib/league/switching): an imported league AllFantasy takes over mid-season.
 *
 * `variant="commissioner"` — the head commissioner's "Make it official" (in season only), then the league's invite
 * link and the teams still on the old platform, with a message to send them.
 * `variant="team"` — a manager's "Switch to AllFantasy" invite on their own team.
 *
 * Reads GET /api/leagues/[leagueId]/switching. Renders nothing for a native league, or where nothing applies.
 */

export type SwitchingState = {
  applies: boolean
  official?: boolean
  seasonInProgress?: boolean
  platformLabel?: string | null
  isHeadCommissioner?: boolean
  myTeam?: { name: string; switched: boolean } | null
  teams?: Array<{ name: string; manager: string | null; switched: boolean }> | null
  invitePath?: string | null
  /** The switching period is over (step 5): every team runs here and nothing is copied any more. */
  ended?: boolean
  /** The teams that had not switched when it ended (head commissioner only). */
  leftBehind?: Array<{ name: string; manager: string | null }> | null
}

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; state: SwitchingState }

export function useSwitchingState(leagueId: string): { load: Load; reload: () => void } {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const reload = useCallback(() => {
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/switching`, { cache: 'no-store' })
      .then(async (res) => (res.ok ? setLoad({ kind: 'ok', state: (await res.json()) as SwitchingState }) : setLoad({ kind: 'error' })))
      .catch(() => setLoad({ kind: 'error' }))
  }, [leagueId])
  useEffect(() => reload(), [reload])
  return { load, reload }
}

const cardClass = 'af-readiness scroll-mt-4 rounded-2xl border border-white/[0.08] p-4'
// The same themed classes as the in-place switch card (NativeReadinessCard), so both read alike in every theme.
const buttonClass = 'af-readiness-primary min-h-[44px] rounded-lg px-4 text-xs font-extrabold disabled:opacity-55'
const quietButtonClass = 'min-h-[44px] rounded-lg border border-white/10 bg-white/[0.04] px-4 text-xs font-extrabold text-white/80 disabled:opacity-55'

/**
 * The Team tab sits outside the Commissioner tab's themed wrapper, so its card takes the league page's theme variables
 * directly, the way the auto-switch card beside it does (components/league/AutoSwitchOwnerCard.tsx).
 */
const teamText = { color: 'var(--lsk-text, var(--text))' }
const teamMuted = { color: 'var(--lsk-muted, var(--muted))' }
const teamPrimary = { border: '1px solid var(--accent, #3b82f6)', color: 'var(--accent, #3b82f6)', background: 'var(--accent-soft, rgba(59,130,246,.12))' }

/** This site's origin, filled in after the first render so the server and browser render the same text. */
function useOrigin(): string {
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])
  return origin
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={quietButtonClass}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

/** The head commissioner's card. Only rendered in season, or once the league is official. */
export function SwitchingLeagueCommissionerView({ leagueId, state, onChanged }: { leagueId: string; state: SwitchingState; onChanged: () => void }) {
  const platform = state.platformLabel ?? 'your old platform'
  const origin = useOrigin()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const post = async (path: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/switching${path}`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setError(body.error ?? 'That did not work. Try again.')
      else onChanged()
    } catch {
      setError('That did not work. Try again.')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }
  const makeOfficial = () => post('')
  const endSwitching = () => post('/end')

  if (!state.official) {
    return (
      <section className={cardClass} data-testid="switching-league-card" data-status="not-official">
        <p className="af-admin-eyebrow text-[11px] font-black uppercase tracking-[0.18em]">Switch to AllFantasy</p>
        <h3 className="mt-1 text-base font-black text-white">Make AllFantasy your official league</h3>
        <p className="mt-1 text-xs leading-5 text-white/60">
          Your league moves here now, mid-season. Managers who haven&apos;t switched keep playing on {platform} until they do.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-white/70">
          <li>AllFantasy scores every game from this week on. Weeks already played keep {platform}&apos;s scores.</li>
          <li>Your team switches now, and you get an invite link to send your league.</li>
          <li>Teams still on {platform} set their lineups and adds there. A trade needs both teams switched.</li>
        </ul>
        {error ? <p className="mt-3 text-xs font-bold text-rose-300" role="alert">{error}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {confirming ? (
            <>
              <button type="button" className={buttonClass} disabled={busy} onClick={makeOfficial}>
                {busy ? 'Making it official…' : 'Yes, make it official'}
              </button>
              <button type="button" className={quietButtonClass} disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
              <p className="w-full text-xs text-white/50">This can&apos;t be undone.</p>
            </>
          ) : (
            <button type="button" className={buttonClass} onClick={() => setConfirming(true)}>Make it official</button>
          )}
        </div>
      </section>
    )
  }

  const still = (state.teams ?? []).filter((t) => !t.switched)
  const leftBehind = state.leftBehind ?? []
  const link = state.invitePath ? `${origin}${state.invitePath}` : null
  const message = link ? `Our league now runs on AllFantasy. Switch your team here: ${link}` : null
  const teamList = (teams: Array<{ name: string; manager: string | null }>, testId: string) => (
    <ul className="mt-1 space-y-1 text-xs leading-5 text-white/70" data-testid={testId}>
      {teams.map((t, i) => (
        <li key={`${t.name}-${i}`}>{t.name}{t.manager ? <span className="text-white/45"> · {t.manager}</span> : null}</li>
      ))}
    </ul>
  )
  return (
    <section className={cardClass} data-testid="switching-league-card" data-status={state.ended ? 'ended' : 'official'}>
      <p className="af-admin-eyebrow text-[11px] font-black uppercase tracking-[0.18em]">Switch to AllFantasy</p>
      <h3 className="mt-1 text-base font-black text-white">
        {state.ended ? 'Your league runs fully on AllFantasy' : 'AllFantasy is your official league'}
      </h3>
      {link ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-black/30 px-3 py-2 text-xs text-white/80">{link}</code>
          <CopyButton text={link} label="Copy link" />
        </div>
      ) : null}
      {state.ended ? (
        leftBehind.length === 0 ? (
          <p className="mt-3 text-xs leading-5 text-white/70">Every team switched. Nothing is copied from {platform} any more.</p>
        ) : (
          <>
            <p className="mt-3 text-xs leading-5 text-white/70">
              Nothing is copied from {platform} any more. These teams hadn&apos;t switched, so AllFantasy runs them as they stood:
            </p>
            {teamList(leftBehind, 'switching-left-behind')}
            {message ? <div className="mt-3"><CopyButton text={message} label="Copy a message to send them" /></div> : null}
          </>
        )
      ) : still.length === 0 ? (
        <p className="mt-3 text-xs leading-5 text-white/70">Every team has switched.</p>
      ) : (
        <>
          <p className="mt-3 text-xs font-bold text-white">Still on {platform}</p>
          {teamList(still, 'switching-still-copying')}
          {message ? <div className="mt-3"><CopyButton text={message} label="Copy a message to send them" /></div> : null}
          {error ? <p className="mt-3 text-xs font-bold text-rose-300" role="alert">{error}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {confirming ? (
              <>
                <p className="w-full text-xs leading-5 text-white/60">
                  {still.length === 1 ? 'This team stops' : `These ${still.length} teams stop`} copying from {platform}. AllFantasy runs
                  {still.length === 1 ? ' it' : ' them'} from the roster {still.length === 1 ? 'it has' : 'they have'} now, and nothing is copied again.
                  This can&apos;t be undone.
                </p>
                <button type="button" className={buttonClass} disabled={busy} onClick={endSwitching}>
                  {busy ? 'Ending…' : 'Yes, stop copying'}
                </button>
                <button type="button" className={quietButtonClass} disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
              </>
            ) : (
              <button type="button" className={quietButtonClass} onClick={() => setConfirming(true)}>Everyone&apos;s here</button>
            )}
          </div>
        </>
      )}
    </section>
  )
}

/** A manager's invite on their own team. Nothing once the team has switched and the league is official. */
export function SwitchingLeagueTeamView({ leagueId, state, onChanged }: { leagueId: string; state: SwitchingState; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const team = state.myTeam
  if (!team) return null
  const platform = state.platformLabel ?? 'your old platform'

  if (team.switched) {
    if (state.official) return null
    return (
      <p className="rounded-xl px-3 py-2 text-[13px]" style={{ ...teamMuted, border: '1px solid var(--lsk-line, var(--line2))' }} data-testid="switching-team-practice">
        {team.name} runs on AllFantasy. Until your commissioner makes it official, {platform} still counts, so moves here are practice.
      </p>
    )
  }

  const switchTeam = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/switching/team`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setError(body.error ?? 'That did not work. Try again.')
      else onChanged()
    } catch {
      setError('That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="flex flex-col gap-2 rounded-xl px-4 py-3"
      style={{ border: '1px solid rgba(59,130,246,.45)', background: 'rgba(59,130,246,.08)' }}
      data-testid="switching-team-card"
    >
      <h3 className="m-0 text-[15px] font-bold" style={teamText}>Run {team.name} on AllFantasy</h3>
      <p className="m-0 text-[13px] leading-relaxed" style={teamMuted}>
        {state.official
          ? `Your league now counts on AllFantasy. Switch to set your lineup, make adds and trade here. Until you do, your team keeps copying from ${platform}.`
          : `Try your team here. Until your commissioner makes it official, ${platform} still counts, so moves here are practice.`}
      </p>
      {error ? <p className="m-0 text-[13px] font-semibold" style={{ color: '#ff6b81' }} role="alert">{error}</p> : null}
      <button type="button" className="min-h-[40px] self-start rounded-full px-4 text-[13px] font-bold disabled:opacity-60" style={teamPrimary} disabled={busy} onClick={switchTeam}>
        {busy ? 'Switching…' : 'Switch to AllFantasy'}
      </button>
    </section>
  )
}

export function SwitchingLeagueTeamCard({ leagueId }: { leagueId: string }) {
  const { load, reload } = useSwitchingState(leagueId)
  if (load.kind !== 'ok' || !load.state.applies) return null
  return <SwitchingLeagueTeamView leagueId={leagueId} state={load.state} onChanged={reload} />
}

/**
 * The Commissioner tab's switch card for an imported league. ONE at a time (owner, 2026-11-27): in season, the
 * switching card; in the offseason the in-place "Switch to AllFantasy" card it is given, which also finishes a
 * league made official mid-season.
 */
export function ImportedLeagueSwitchCard({ leagueId, offseasonCard }: { leagueId: string; offseasonCard: ReactNode }) {
  const { load, reload } = useSwitchingState(leagueId)
  if (load.kind === 'loading') return null
  // In the offseason the in-place switch finishes a league, official or not (owner, 2026-11-27).
  if (load.kind === 'ok' && load.state.applies && load.state.isHeadCommissioner && load.state.seasonInProgress) {
    return <SwitchingLeagueCommissionerView leagueId={leagueId} state={load.state} onChanged={reload} />
  }
  return <>{offseasonCard}</>
}
