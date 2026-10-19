'use client'
/**
 * Invite landing page (TournamentJoin.png / MobileJoin.png): open, almost full,
 * full (waitlist), closed (follow) and already in. The phone layout is the same
 * component stacked — the join card moves above the facts.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { joinState, type JoinState } from '@/lib/tournament/divisions/registration'
import { side } from '@/lib/tournament/divisions/identity'
import type { JoinView } from '@/lib/tournament/divisions/lifecycle'
import { DivisionBadge, LeagueCrest } from './DivisionArt'
import { RosterLabel, ScoringLabel } from '@/components/league-labels'
import { divisionsRulesLabels } from '@/lib/tournament/divisions/blueprint'

const card = 'rounded-2xl border border-white/10 bg-[#0b0d14]'
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBA')
const initials = (s: string) => (s.match(/[A-Z0-9]/g)?.slice(0, 2).join('') || s.slice(0, 2)).toUpperCase()

export function TournamentJoin({ view, refName, previewState }: { view: JoinView; refName: string | null; previewState?: JoinState }) {
  const router = useRouter()
  const [pref, setPref] = useState<0 | 1 | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const live = joinState({ phase: view.phase, capacity: view.capacity, registered: view.registered, myStatus: view.me?.status ?? null })
  const state = previewState ?? live
  const [dA, dB] = view.identity.divisions
  const s = view.settings
  const left = Math.max(0, view.capacity - view.registered)
  const leagues = view.identity.conferences.length * 2

  async function act(action: 'join' | 'leave' | 'follow') {
    if (busy || previewState) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/tournament/divisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'join' ? { action, tournamentId: view.tournamentId, preference: pref, ref: refName } : { action, tournamentId: view.tournamentId }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Something went wrong.')
      router.refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false) }
  }

  const rules = divisionsRulesLabels(view.sport)
  const facts: Array<[string, React.ReactNode]> = [
    ['Draft window', view.myLeague?.draftAt ? fmtDate(view.myLeague.draftAt) : 'Set after placement'],
    ['Regular season', `Weeks ${view.calendar.regularSeason.start}–${view.calendar.regularSeason.end}`],
    ['Bracket', `Weeks ${view.calendar.bracketStartWeek}–${view.calendar.lastWeek}`],
    ['Entry', view.registration.entry],
    ['Scoring', <ScoringLabel key="s" id={rules.scoringId} size="sm" />],
    ['Roster', <RosterLabel key="r" id={rules.rosterId} size="sm" />],
    ['League size', `${s.teamsPerConference} teams`],
    ['Trades', 'Within your league'],
    ['Registration closes', fmtDate(view.registration.closesAt)],
  ]

  const joinCard = (
    <section className={card + ' border-[#e8b84a]/50 p-5'} aria-label="Join">
      {state === 'in' ? (
        <div className="space-y-3 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6fe0a8]">You’re in</p>
          {view.myLeague ? <>
            <div className="flex justify-center"><LeagueCrest division={view.identity.divisions[view.myLeague.division]} conference={view.identity.conferences[view.myLeague.conference]!} size={150} /></div>
            <p className="text-2xl font-black text-white">{view.myLeague.name}</p>
            <p className="text-slate-300">{view.myLeague.draftAt ? `Draft ${new Date(view.myLeague.draftAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Draft time coming soon.'}</p>
            <Link href={view.myLeague.leagueId ? `/league/${view.myLeague.leagueId}` : `/tournament-hub/${view.tournamentId}`} className="grid min-h-12 place-items-center rounded-xl bg-[#e8b84a] font-bold text-[#1a1204]">Go to my league</Link>
            {!view.me?.revealSeen && <Link href={`/tournament-hub/${view.tournamentId}/reveal`} className="grid min-h-11 place-items-center rounded-xl border border-white/15 font-bold text-white">Reveal my league</Link>}
          </> : <>
            <p className="text-2xl font-black text-white">Spot confirmed</p>
            <p className="text-slate-300">You’ll be placed in a league when registration closes on {fmtDate(view.registration.closesAt)}.</p>
            <button type="button" onClick={() => act('leave')} disabled={busy} className="min-h-11 w-full rounded-xl border border-white/15 font-bold text-white">Leave tournament</button>
          </>}
        </div>
      ) : state === 'closed' ? (
        <div className="space-y-3">
          <p className="text-2xl font-black text-white">Registration is closed</p>
          <p className="text-slate-300">The field is set. Follow along: standings, the wildcard bubble and every bracket.</p>
          {view.me?.status === 'following'
            ? <Link href={`/tournament-hub/${view.tournamentId}`} className="grid min-h-12 place-items-center rounded-xl bg-[#e8b84a] font-bold text-[#1a1204]">Open the tournament</Link>
            : <button type="button" onClick={() => act('follow')} disabled={busy} className="min-h-12 w-full rounded-xl bg-[#e8b84a] font-bold text-[#1a1204]">Follow the tournament</button>}
        </div>
      ) : (
        <div className="space-y-4">
          <p><span className="text-5xl font-bold text-white">{view.registered}</span> <span className="text-slate-400">of {view.capacity} spots filled</span></p>
          <div className="h-2.5 overflow-hidden rounded-full bg-[#1a1c26]" role="progressbar" aria-valuemin={0} aria-valuemax={view.capacity} aria-valuenow={view.registered} aria-label="Spots filled">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (view.registered / Math.max(1, view.capacity)) * 100)}%`, background: state === 'almost_full' ? '#ff8a3c' : state === 'full' || state === 'waitlisted' ? '#ff5a5a' : '#e8b84a' }} />
          </div>
          {state === 'waitlisted' ? (
            <>
              <p className="text-slate-200">You’re <b className="text-white">#{view.me?.waitlistPosition}</b> on the waitlist. Spots go strictly in join order, and you’ll get a notification the moment one opens.</p>
              <button type="button" onClick={() => act('leave')} disabled={busy} className="min-h-11 w-full rounded-xl border border-white/15 font-bold text-white">Leave the waitlist</button>
            </>
          ) : (
            <>
              <p className="text-slate-300">
                {state === 'full' ? 'Every spot is taken. Join the waitlist — spots go in join order, and we’ll notify you if one opens.'
                  : state === 'almost_full' ? <><b className="text-[#ffb27a]">Only {left} spot{left === 1 ? '' : 's'} left.</b> Registration closes {fmtDate(view.registration.closesAt)}. You’ll be placed in a league when it closes.</>
                  : `Registration closes ${fmtDate(view.registration.closesAt)} · ${left} spots left. You’ll be placed in a league when it closes.`}
              </p>
              {view.registration.allowPreference && state !== 'full' && (
                <fieldset>
                  <legend className="mb-2 text-sm text-slate-400">Division preference (not guaranteed)</legend>
                  <div role="radiogroup" aria-label="Division preference" className="inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-[#07080d] p-1">
                    {([[null, 'Any'], [0, dA.name], [1, dB.name]] as Array<[0 | 1 | null, string]>).map(([v, label]) => (
                      <button key={label} type="button" role="radio" aria-checked={pref === v} onClick={() => setPref(v)} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-300 aria-checked:bg-[#1a1c26] aria-checked:text-[#ffd98a]">{label}</button>
                    ))}
                  </div>
                </fieldset>
              )}
              <button type="button" onClick={() => act('join')} disabled={busy} className="min-h-12 w-full rounded-xl bg-[#e8b84a] font-bold text-[#1a1204] disabled:opacity-50">
                {state === 'full' ? `Join the waitlist · you’d be #${view.waitlist + 1}` : 'Join tournament'}
              </button>
              <p className="text-center text-sm text-slate-400">{view.registration.entry === 'Free' ? 'Free. ' : ''}You can leave until registration closes.</p>
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-amber-200">{error}</p>}
    </section>
  )

  return (
    <main className="mx-auto min-h-screen max-w-[1440px] space-y-6 bg-[#07080d] px-4 py-6 text-white sm:px-8">
      <header className="flex flex-col gap-5 rounded-2xl p-2 md:flex-row md:items-center" style={{ background: `linear-gradient(90deg, ${side(dA.sideId).dark}66, transparent 40%, transparent 60%, ${side(dB.sideId).dark}55)` }}>
        <div className="flex items-center gap-3">
          <DivisionBadge division={dA} size={96} /><span className="text-3xl font-black text-slate-500" aria-hidden="true">VS</span><DivisionBadge division={dB} size={96} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2 text-[13px]"><span className="rounded-md bg-[#1a1c26] px-2 py-1">{view.sport}</span><span className="rounded-md bg-[#1a1c26] px-2 py-1">Divisions &amp; conferences</span><span className="rounded-md bg-[#1a1c26] px-2 py-1">{view.registration.entry === 'Free' ? 'Free to join' : view.registration.entry}</span></div>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">{view.name}</h1>
          <p className="text-slate-300">{view.invitedBy ? <>You’re invited by <b className="text-white">{view.invitedBy}</b>. </> : null}{view.capacity} managers, {leagues} leagues, one champion.</p>
        </div>
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="order-2 min-w-0 space-y-5 lg:order-1">
          <ul className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {facts.map(([k, v]) => <li key={k} className={card + ' p-4'}><p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{k}</p><div className="mt-1 font-bold text-white">{v}</div></li>)}
          </ul>
          <section className={card + ' p-5'}>
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">How it works</h2>
            <ol className="mt-3 space-y-2 text-[15px] text-slate-200">
              {[`You’re placed in one conference league of ${s.teamsPerConference} inside the ${dA.name} or ${dB.name} division.`, 'Your league drafts once. No redrafts — the team you build is the team you ride.', `Weeks ${view.calendar.regularSeason.start}–${view.calendar.regularSeason.end}: everyone in your division is ranked by record, then points.`, `The top ${s.autoBids} get automatic bids. A wildcard bubble decided on points fills ${s.wildcardSpots} more.`, `Four regions per division, then the ${dA.name} and ${dB.name} champions meet in week ${view.calendar.lastWeek}.`].map((t, i) => (
                <li key={i} className="flex gap-3"><span className="font-bold text-[#e8b84a]">{i + 1}</span><span>{t}</span></li>
              ))}
            </ol>
          </section>
          <section className={card + ' p-5'}>
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">The leagues</h2>
            {view.identity.divisions.map((d, di) => (
              <div key={di} className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
                <div className="flex w-56 shrink-0 items-center gap-3"><DivisionBadge division={d} size={56} /><div><p className="text-xl font-black" style={{ color: di === 0 ? '#fff' : side(d.sideId).mid }}>{d.name}</p><p className="text-sm text-slate-400">{view.identity.conferences.length} leagues · {view.identity.conferences.length * s.teamsPerConference} teams</p></div></div>
                <ul className="flex gap-2 overflow-x-auto pb-1">
                  {view.identity.conferences.map((c, ci) => <li key={ci} className="flex shrink-0 flex-col items-center gap-1"><LeagueCrest division={d} conference={c} size={72} label={`${c.name} ${d.name}`} /><span className="text-sm text-slate-300">{c.name}</span></li>)}
                </ul>
              </div>
            ))}
          </section>
        </div>
        <aside className="order-1 space-y-4 lg:order-2">
          {joinCard}
          <section className={card + ' p-4'}>
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Commissioner</h2>
            <div className="mt-2 flex items-center gap-3 rounded-xl border border-white/10 bg-[#0e1018] p-3">
              <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-full bg-[#1d2233] font-black">{initials(view.commissioner.name)}</span>
              <div><p className="font-bold">{view.commissioner.name}</p><p className="text-sm text-slate-400">Runs {view.commissioner.leaguesRun} league{view.commissioner.leaguesRun === 1 ? '' : 's'} on AllFantasy</p></div>
            </div>
            <p className="mt-2 text-sm text-slate-400">Rules lock when registration closes{view.registration.closesAt ? ` on ${fmtDate(view.registration.closesAt)}` : ''}. Placement is random{view.registration.allowGrouping ? ', but friends who join through your link are kept together where possible' : ' — a personal invite link brings friends in but doesn’t change where anyone is placed'}.</p>
          </section>
        </aside>
      </div>
    </main>
  )
}
