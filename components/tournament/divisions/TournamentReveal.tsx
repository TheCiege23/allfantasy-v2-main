'use client'
/**
 * League reveal (TournamentReveal.png, MobileReveal.png). Plays once per user:
 * the first reveal stores `revealSeenAt`; afterwards the page opens on the end
 * state, with Replay to watch it again.
 */
import { useState } from 'react'
import Link from 'next/link'
import { side } from '@/lib/tournament/divisions/identity'
import type { RevealView } from '@/lib/tournament/divisions/lifecycle'
import { DivisionBadge, LeagueCrest } from './DivisionArt'
import './divisions-reveal.css'

const initials = (s: string) => (s.match(/[A-Z0-9]/g)?.slice(0, 2).join('') || s.slice(0, 2)).toUpperCase()
const TINTS = ['#2a1d2b', '#1c2a2a', '#25223a', '#2c2a17', '#16291e', '#2a1a22', '#1c2440', '#22291a', '#2e2216', '#1d2440', '#33202a', '#1a2a2a', '#2a2433', '#232a1a']

export function TournamentReveal({ view, preview = false }: { view: RevealView; preview?: boolean }) {
  const [phase, setPhase] = useState<'before' | 'revealed'>(view.seen ? 'revealed' : 'before')
  const [run, setRun] = useState(0)
  const division = view.identity.divisions[view.division]
  const conference = view.identity.conferences[view.conference]!
  const accent = side(division.sideId).mid

  function reveal() {
    setPhase('revealed'); setRun(r => r + 1)
    if (!view.seen && !preview) void fetch('/api/tournament/divisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reveal_seen', tournamentId: view.tournamentId }) }).catch(() => undefined)
  }
  const draft = view.league.draftAt ? new Date(view.league.draftAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : null

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#2a2a2e,#07080d_60%)] px-4 py-6 text-white sm:px-8">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">{view.tournament} · League reveal</p>
      {phase === 'before' ? (
        <section className="mx-auto mt-16 flex max-w-md flex-col items-center gap-6 text-center">
          <div className="dvr-pulse grid aspect-[300/340] w-52 place-items-center rounded-[28px] border-2 border-dashed border-[#e8b84a]/60 bg-[#0e1018] text-7xl font-black text-[#e8b84a]" aria-hidden="true">?</div>
          <h1 className="text-3xl font-black">Your league is ready</h1>
          <p className="text-slate-300">Registration closed and every entrant has a league. Tap to see where you landed.</p>
          <button type="button" onClick={reveal} className="min-h-12 w-full rounded-xl bg-[#e8b84a] font-bold text-[#1a1204]">Reveal my league</button>
        </section>
      ) : (
        <div key={run} className="mx-auto mt-8 max-w-6xl space-y-8">
          <section className="flex flex-col items-center gap-6 md:flex-row md:justify-center md:gap-10">
            <div className="dvr-rise hidden md:block"><DivisionBadge division={division} size={150} /></div>
            <div className="dvr-pop"><LeagueCrest division={division} conference={conference} size={260} label={view.league.name} /></div>
            <div className="dvr-fade max-w-xl space-y-3 text-center md:text-left">
              <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: '#ffd98a' }}>{division.name} division · Conference {view.conference + 1} of {view.conferences}</p>
              <h1 className="text-4xl font-black tracking-tight sm:text-6xl">{view.league.name}</h1>
              <p className="text-lg text-slate-300">{view.league.teams} teams. Win your games to climb the {division.name} standings — the top {view.settings.autoBids} get automatic bids.</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href={view.league.leagueId ? `/league/${view.league.leagueId}` : `/tournament-hub/${view.tournamentId}`} className="grid min-h-12 place-items-center rounded-xl bg-[#e8b84a] px-6 font-bold text-[#1a1204]">Go to my league</Link>
                {view.league.leagueId && <Link href={`/league/${view.league.leagueId}`} className="grid min-h-12 place-items-center rounded-xl border border-white/15 bg-[#0e1018] px-6 font-bold">Prep my draft</Link>}
              </div>
            </div>
          </section>
          <section className="rounded-2xl border border-white/10 bg-[#0b0d14] p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Your league mates · {view.mates.length}</h2>
              <span className="rounded-lg border border-white/15 px-3 py-1 text-sm">{draft ? <>Draft <b>{draft}</b></> : 'Draft time coming soon'}</span>
            </div>
            <ul className="flex flex-wrap justify-center gap-4">
              {view.mates.map((m, i) => (
                <li key={m.id} className="dvr-mate flex w-24 flex-col items-center gap-1 text-center" style={{ animationDelay: `${1400 + i * 120}ms` }}>
                  <span className="grid h-16 w-16 place-items-center rounded-full text-lg font-black" style={{ background: TINTS[i % TINTS.length], boxShadow: m.isMe ? `0 0 0 3px ${accent}` : undefined }} aria-hidden="true">{initials(m.name)}</span>
                  <span className="w-full truncate text-sm text-slate-300">{m.isMe ? 'You' : m.name}</span>
                </li>
              ))}
            </ul>
          </section>
          <div className="text-center"><button type="button" onClick={() => setRun(r => r + 1)} className="min-h-11 rounded-xl border border-white/15 bg-[#0e1018] px-6 font-bold">Replay</button></div>
        </div>
      )}
    </main>
  )
}
