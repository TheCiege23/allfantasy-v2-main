'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BookOpen, ChevronDown, Search } from 'lucide-react'
import {
  LEAGUE_GUIDE_QUESTIONS,
  LEAGUE_MODIFIER_GUIDES,
  LEAGUE_TYPE_GUIDES,
  type LeagueGuideCategory,
} from '@/lib/league/league-type-guide'

export type LeagueGuideFormat = {
  id: keyof typeof LEAGUE_TYPE_GUIDES
  label: string
  description: string
  sports: string[]
  modifiers: (keyof typeof LEAGUE_MODIFIER_GUIDES)[]
}

const CATEGORIES: LeagueGuideCategory[] = ['Seasonal', 'Long term', 'Elimination & social']
const controlClass = 'min-h-11 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500'

export default function LeagueTypesFaq({ formats, sports }: { formats: LeagueGuideFormat[]; sports: string[] }) {
  const [query, setQuery] = useState('')
  const [sport, setSport] = useState('all')
  const [category, setCategory] = useState('all')
  useEffect(() => {
    function revealLinkedRules() {
      const target = document.getElementById(window.location.hash.slice(1))
      if (target?.tagName !== 'ARTICLE') return
      const details = target.querySelector('details')
      if (details) details.open = true
      target.scrollIntoView?.({ block: 'start' })
    }
    revealLinkedRules()
    window.addEventListener('hashchange', revealLinkedRules)
    return () => window.removeEventListener('hashchange', revealLinkedRules)
  }, [])
  const search = query.trim().toLowerCase()
  const filtered = formats.filter((format) => {
    const guide = LEAGUE_TYPE_GUIDES[format.id]
    const text = [format.label, format.id, format.description, guide.bestFor, guide.commitment,
      ...guide.rules, ...guide.commissioner, guide.beforeJoining,
      ...format.modifiers.map((id) => LEAGUE_MODIFIER_GUIDES[id].title)].join(' ').toLowerCase()
    return (sport === 'all' || format.sports.includes(sport)) &&
      (category === 'all' || category === guide.category) && (!search || text.includes(search))
  })

  function resetFilters() {
    setQuery('')
    setSport('all')
    setCategory('all')
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-10 text-[var(--text)] sm:px-6">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-4">
          <Link href="/league-types" className="inline-block text-sm text-[var(--muted)] underline underline-offset-4">All league types</Link>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--accent-cyan-strong)]"><BookOpen size={16} aria-hidden="true" /> The league playbook</p>
          <h1 className="text-3xl font-black tracking-tight sm:text-5xl">Find your next league type.</h1>
          <p className="max-w-3xl text-base leading-7 text-[var(--muted)]">Explore every AllFantasy format, learn the general rules and see which special settings commissioners can configure before you try something new.</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/find-league" className="rounded-xl bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-300">Find a league</Link>
            <Link href="/create-league" className={controlClass + ' inline-flex items-center font-semibold'}>Create a league</Link>
            <a href="#modifiers" className={controlClass + ' inline-flex items-center'}>Explore add-ons</a>
          </div>
          <p className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 text-sm leading-6 text-[var(--muted)]"><strong className="text-[var(--text)]">Start here, then check your league.</strong> These are general rules. Your league’s published settings and constitution define the exact experience. Available settings vary by format and sport.</p>
        </header>

        <section aria-labelledby="browse-formats">
          <h2 id="browse-formats" className="text-xl font-bold">Compare league formats</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Search formats and rules</span>
              <span className="relative block"><Search size={17} className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted)]" aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try contracts, voting or taxi…" className={controlClass + ' w-full pl-10'} /></span>
            </label>
            <label className="space-y-1 text-sm"><span className="block font-medium">Sport</span><select value={sport} onChange={(event) => setSport(event.target.value)} className={controlClass}><option value="all">All sports</option>{sports.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="space-y-1 text-sm"><span className="block font-medium">Experience</span><select value={category} onChange={(event) => setCategory(event.target.value)} className={controlClass}><option value="all">All experiences</option>{CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          </div>
          <p className="mt-3 text-sm text-[var(--muted)]" role="status">{filtered.length} of {formats.length} formats shown</p>
          {filtered.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-[var(--border)] p-6"><p>No formats match these filters.</p><button type="button" onClick={resetFilters} className="mt-3 min-h-11 text-sm font-semibold underline underline-offset-4">Clear filters</button></div>
          ) : (
            <>
              <nav aria-label="Jump to a league format" className="my-4 flex flex-wrap gap-2">{filtered.map((format) => <a key={format.id} href={'#' + format.id} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--panel)]">{format.label}</a>)}</nav>
              <div className="grid gap-4 md:grid-cols-2">
                {filtered.map((format) => {
                  const guide = LEAGUE_TYPE_GUIDES[format.id]
                  return (
                    <article key={format.id} id={format.id} className="scroll-mt-24 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 sm:p-6">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{guide.category}</p>
                      <h3 className="mt-2 text-2xl font-bold"><a href={'#' + format.id}>{format.label}</a></h3>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{format.description}</p>
                      <dl className="mt-4 space-y-3 text-sm leading-6"><div><dt className="font-bold">Good fit for</dt><dd className="text-[var(--muted)]">{guide.bestFor}</dd></div><div><dt className="font-bold">Commitment</dt><dd className="text-[var(--muted)]">{guide.commitment}</dd></div><div><dt className="font-bold">Format sports</dt><dd className="text-[var(--muted)]">{format.sports.join(' · ')}</dd></div></dl>
                      <details className="group mt-5 border-t border-[var(--border)] pt-3">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold">Rules & commissioner settings<ChevronDown size={18} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180" /></summary>
                        <div className="space-y-4 pt-3 text-sm leading-6">
                          <div><h4 className="font-bold">How it works</h4><ul className="mt-2 list-disc space-y-2 pl-5 text-[var(--muted)]">{guide.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul></div>
                          <div><h4 className="font-bold">What the commissioner can configure</h4>{guide.commissioner.map((rule) => <p key={rule} className="mt-2 text-[var(--muted)]">{rule}</p>)}</div>
                          {format.modifiers.length > 0 && <div><h4 className="font-bold">Format add-ons & modes</h4><ul className="mt-2 flex flex-wrap gap-x-3 gap-y-2">{format.modifiers.map((id) => <li key={id}><a href={'#modifier-' + id} className="underline underline-offset-4">{LEAGUE_MODIFIER_GUIDES[id].title}</a></li>)}</ul><p className="mt-2 text-[var(--muted)]">Availability also depends on sport and the selected setup.</p></div>}
                          <div className="rounded-xl border border-[var(--border)] p-3"><h4 className="font-bold">Before you join</h4><p className="mt-1 text-[var(--muted)]">{guide.beforeJoining}</p></div>
                        </div>
                      </details>
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </section>

        <section id="modifiers" aria-labelledby="modifiers-title" className="scroll-mt-24 space-y-4">
          <h2 id="modifiers-title" className="text-2xl font-bold">Add-ons that change the experience</h2>
          <p className="text-sm leading-6 text-[var(--muted)]">A league can have a base format plus roster, scoring or lineup options. The available combinations depend on the sport and format; some modes also have a dedicated league type above.</p>
          <div className="grid gap-3 sm:grid-cols-2">{Object.entries(LEAGUE_MODIFIER_GUIDES).map(([id, modifier]) => <article key={id} id={'modifier-' + id} className="scroll-mt-24 rounded-xl border border-[var(--border)] p-4"><h3 className="font-bold">{modifier.title}</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{modifier.description}</p></article>)}</div>
        </section>

        <section aria-labelledby="hybrid-formats" className="space-y-3">
          <h2 id="hybrid-formats" className="text-2xl font-bold">Specialty combinations</h2>
          <article id="survivor-guillotine" className="scroll-mt-24 rounded-xl border border-[var(--border)] p-4">
            <h3 className="font-bold">Survivor × Guillotine</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">A specialty combination of Survivor’s tribe structure and Guillotine’s score-based elimination. Read the format’s published chop, immunity and tribe transition rules; the standard Survivor voting rules should not be assumed.</p>
            <Link href="/league-types/survivor-guillotine" className="mt-3 inline-block text-sm underline underline-offset-4">Explore Survivor × Guillotine rules</Link>
          </article>
        </section>

        <section aria-labelledby="common-questions" className="space-y-4">
          <h2 id="common-questions" className="text-2xl font-bold">Common questions</h2>
          <div className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] px-5">{LEAGUE_GUIDE_QUESTIONS.map(({ question, answer }) => <details key={question} className="group py-2"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-2 font-semibold">{question}<ChevronDown size={18} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180" /></summary><p className="pb-4 text-sm leading-7 text-[var(--muted)]">{answer}</p></details>)}</div>
        </section>
      </div>
    </main>
  )
}
