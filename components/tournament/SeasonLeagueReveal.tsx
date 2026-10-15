'use client'
import { useState } from 'react'
import type { SeasonEntryView } from '@/lib/tournament/seasonRegistration'
import { SeasonCrest } from './SeasonIdentity'
import Link from 'next/link'

export function SeasonLeagueReveal({ assignment, timezone }: { assignment: NonNullable<SeasonEntryView['assignment']>; timezone: string }) {
  const [revealed, setRevealed] = useState(false)
  return <section className="space-y-4 rounded-2xl border border-amber-300/40 bg-[#0b0c12] p-5 text-center" aria-label="Your opening league assignment">
    <h2 className="text-xl font-semibold">Your opening league is ready to reveal</h2>
    {revealed ? <div role="status" className="space-y-3"><SeasonCrest art={assignment.art} name={assignment.name} division={assignment.division ?? ''} className="mx-auto max-w-44" /><p>{assignment.teams} teams · Draft slot {assignment.draftSlot}</p><p className="text-sm text-slate-300">Draft scheduled {new Intl.DateTimeFormat('en', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(assignment.startsAt))} ({timezone}).</p>{assignment.draftId ? <Link className="flex min-h-12 items-center justify-center rounded-xl bg-cyan-300 px-4 font-bold text-slate-950" href={`/drafts/${encodeURIComponent(assignment.draftId)}`}>Open my draft room</Link> : <p className="text-sm text-amber-200">The commissioner will open the draft room after the league and player pool pass readiness checks.</p>}</div> : <p className="py-6 text-5xl text-amber-300" aria-hidden="true">?</p>}
    <button type="button" className="min-h-12 w-full rounded-xl border border-amber-300/40 bg-amber-300 px-4 font-bold text-slate-950" onClick={() => setRevealed(value => !value)}>{revealed ? 'Hide league reveal' : 'Reveal my league'}</button>
    <p className="text-sm text-slate-300">The reveal shows your saved assignment. It never changes your league or draft slot.</p>
  </section>
}
