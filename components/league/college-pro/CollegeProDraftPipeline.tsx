'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { CollegeProDraftPayload } from '@/lib/league/collegePro/loadCollegeProDraft'
import type { ChecklistStep, ManualStep } from '@/lib/league/collegePro/draftChecklist'
import type { DraftedPlayer } from '@/lib/league/collegePro/draftPipeline'

/**
 * Draft tab, for a paired college + pro league: your drafted college players moving up, the
 * commissioner's offseason checklist, who moves up across the league, and the rookie draft's pool.
 * Renders above the league's own draft screen (`children`); for an unpaired league, only `children`.
 */

type Ready = Extract<CollegeProDraftPayload, { applies: true }>

const pickLine = (p: { round: number; pick: number; proTeam: string }) => `${p.proTeam} · Rd ${p.round}, Pk ${p.pick}`

const STATE_MARK: Record<ChecklistStep['state'], { mark: string; cls: string; label: string }> = {
  done: { mark: '✓', cls: 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300', label: 'Done' },
  todo: { mark: '', cls: 'border-white/25 text-transparent', label: 'To do' },
  waiting: { mark: '…', cls: 'border-white/15 text-muted', label: 'Waiting' },
  unknown: { mark: '?', cls: 'border-white/15 text-muted', label: 'Check on the platform' },
}

function PlayerRow({ p }: { p: DraftedPlayer | { name: string; position: string; proTeam: string; round: number; pick: number } }) {
  return (
    <li className="flex items-center justify-between gap-2 py-1 text-xs">
      <span className="min-w-0 truncate">
        <span className="mr-1.5 text-[11px] font-bold text-muted">{p.position || '—'}</span>
        <span className="font-semibold text-primary">{p.name}</span>
      </span>
      <span className="shrink-0 tabular-nums text-secondary">{pickLine(p)}</span>
    </li>
  )
}

export function CollegeProDraftPipeline({ leagueId, children }: { leagueId: string; children: ReactNode }) {
  const [data, setData] = useState<Ready | null>(null)
  const [saving, setSaving] = useState<ManualStep | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/league/college-pro-draft?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CollegeProDraftPayload | null) => live && setData(d && d.applies ? d : null))
      .catch(() => live && setData(null))
    return () => {
      live = false
    }
  }, [leagueId])

  if (!data) return <>{children}</>

  const toggle = async (step: ChecklistStep) => {
    if (!data.year || !data.canEditChecklist || !step.manual) return
    const done = step.state !== 'done'
    setSaving(step.id as ManualStep)
    setError(null)
    const res = await fetch('/api/league/college-pro-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, year: data.year, step: step.id, done }),
    }).catch(() => null)
    setSaving(null)
    if (!res?.ok) {
      setError("That didn't save. Try again.")
      return
    }
    setData({ ...data, checklist: (data.checklist ?? []).map((s) => (s.id === step.id ? { ...s, state: done ? 'done' : 'todo' } : s)) })
  }

  const moving = data.movingUp.reduce((n, f) => n + f.players.length, 0)
  return (
    <div className="flex flex-col gap-3">
      <section className="mx-4 mt-3 rounded-2xl border border-subtle bg-surface-muted/40 p-3 sm:mx-5 sm:p-4" data-testid="college-pro-draft-pipeline">
        <h2 className="text-sm font-bold text-primary">{data.year ? `${data.year} draft pipeline` : 'Draft pipeline'}</h2>
        {!data.year ? (
          <p className="mt-1 text-xs text-secondary">
            The {data.proLabel} draft results aren&apos;t in yet. Once they are, your drafted college players and the rookie pool show up here, and you&apos;ll get a notification.
          </p>
        ) : (
          <>
            <div className="mt-2" data-testid="college-pro-draft-mine">
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted">Your players moving up</h3>
              {data.mine?.players.length ? (
                <ul className="divide-y divide-white/5">{data.mine.players.map((p) => <PlayerRow key={p.athleteId} p={p} />)}</ul>
              ) : (
                <p className="py-1 text-xs text-secondary">None of your college players were drafted in {data.year}.</p>
              )}
            </div>

            {data.checklist ? (
              <div className="mt-3" data-testid="college-pro-draft-checklist">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted">Commissioner checklist</h3>
                <ol className="mt-1 space-y-1.5">
                  {data.checklist.map((step) => {
                    // A to-do we detect (not tick) gets a flag rather than an empty box, so it never looks tappable.
                    const m = step.state === 'todo' && !step.manual ? { mark: '!', cls: 'border-amber-400/50 text-amber-300', label: 'To do' } : STATE_MARK[step.state]
                    const clickable = step.manual && data.canEditChecklist
                    return (
                      <li key={step.id} className="flex items-start gap-2 text-xs" data-testid={`college-pro-draft-step-${step.id}`} data-state={step.state}>
                        <button
                          type="button"
                          disabled={!clickable || saving === step.id}
                          onClick={() => toggle(step)}
                          aria-label={`${step.title}: ${m.label}${clickable ? ', tap to change' : ''}`}
                          aria-pressed={step.manual ? step.state === 'done' : undefined}
                          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[12px] font-bold ${m.cls} ${clickable ? 'cursor-pointer hover:brightness-125' : 'cursor-default'}`}
                        >
                          {m.mark}
                        </button>
                        <span className="min-w-0">
                          <span className={`block font-semibold ${step.state === 'done' ? 'text-secondary' : 'text-primary'}`}>{step.title}</span>
                          {step.detail ? <span className="block text-[11px] text-muted">{step.detail}</span> : null}
                        </span>
                      </li>
                    )
                  })}
                </ol>
                {error ? <p className="mt-1 text-[11px] text-rose-400">{error}</p> : null}
              </div>
            ) : null}

            {moving > 0 ? (
              <details className="mt-3" data-testid="college-pro-draft-league">
                <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wide text-muted">
                  Moving up across the league · {moving}
                </summary>
                <ul className="mt-1 space-y-2">
                  {data.movingUp.map((f) => (
                    <li key={f.collegeKey}>
                      <span className="text-xs font-semibold text-primary">{f.proName ?? f.collegeName}</span>
                      {f.proName ? <span className="ml-1 text-[11px] text-muted">from {f.collegeName}</span> : <span className="ml-1 text-[11px] text-muted">no {data.proLabel} team matched yet</span>}
                      <ul className="divide-y divide-white/5 pl-2">{f.players.map((p) => <PlayerRow key={p.athleteId} p={p} />)}</ul>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            <details className="mt-2" data-testid="college-pro-draft-pool">
              <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wide text-muted">
                Rookie draft pool · {data.rookiePool.length}
              </summary>
              <p className="mt-1 text-[11px] text-muted">Drafted players no college team in {data.college.name} held, in draft order.</p>
              <ul className="divide-y divide-white/5">
                {data.rookiePool.map((p) => (
                  <li key={p.athleteId} className="flex items-center justify-between gap-2 py-1 text-xs">
                    <span className="min-w-0 truncate">
                      <span className="mr-1.5 tabular-nums text-[11px] text-muted">#{p.overall}</span>
                      <span className="mr-1.5 text-[11px] font-bold text-muted">{p.position || '—'}</span>
                      <span className="font-semibold text-primary">{p.name}</span>
                      {p.college ? <span className="ml-1 text-[11px] text-muted">{p.college}</span> : null}
                    </span>
                    <span className="shrink-0 text-secondary">{p.proTeam}</span>
                  </li>
                ))}
              </ul>
            </details>
            {data.unlinked > 0 ? (
              <p className="mt-2 text-[11px] text-muted">
                {data.unlinked} {data.unlinked === 1 ? 'pick' : 'picks'} couldn&apos;t be matched to a college player, so {data.unlinked === 1 ? 'it isn’t' : 'they aren’t'} counted here.
              </p>
            ) : null}
          </>
        )}
      </section>
      {children}
    </div>
  )
}
