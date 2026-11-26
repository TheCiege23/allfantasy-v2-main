'use client'

/**
 * The league's group (/api/leagues/[leagueId]/league-group, lib/league-groups/leagueGroups.ts).
 * A commissioner names it; the names they already used are offered so seven leagues land in ONE group.
 * A member sees the name and a link to /league-groups. A league in no group shows nothing to a member.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'

type State = { group: { name: string } | null; canEdit: boolean; suggestions: string[] }

export function LeagueGroupForm({ state, onSave }: { state: State; onSave: (name: string) => Promise<string | null> }) {
  const [name, setName] = useState(state.group?.name ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => setName(state.group?.name ?? ''), [state.group?.name])

  if (!state.canEdit && !state.group) return null

  const save = async (value: string) => {
    setSaving(true)
    setMessage(null)
    const error = await onSave(value)
    setSaving(false)
    setMessage(error ?? (value.trim() ? 'Saved.' : 'Removed from the group.'))
  }

  return (
    <section aria-label="League group" className="space-y-3 rounded-2xl border border-white/[0.08] bg-[#0a1228]/80 p-4">
      <h4 className="text-[12px] font-bold uppercase tracking-wide text-cyan-200/80">League group</h4>
      {state.canEdit ? (
        <>
          <p className="text-[11px] text-white/50">Give every league that belongs together the same group name.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Group name"
              list="league-group-suggestions"
              value={name}
              maxLength={40}
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Road To Glory"
              className="min-w-[12rem] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white"
            />
            <datalist id="league-group-suggestions">
              {state.suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <button
              type="button"
              disabled={saving || name.trim() === (state.group?.name ?? '')}
              onClick={() => void save(name)}
              className="rounded-lg bg-cyan-500/20 px-3 py-1.5 text-sm font-semibold text-cyan-100 disabled:opacity-40"
            >
              Save group
            </button>
            {state.group ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void save('')}
                className="rounded-lg px-3 py-1.5 text-sm text-white/60 disabled:opacity-40"
              >
                Leave group
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-sm text-white/80">{state.group?.name}</p>
      )}
      {state.group ? (
        <Link href="/league-groups" className="text-[12px] text-cyan-200 underline-offset-2 hover:underline">
          See every league in {state.group.name}
        </Link>
      ) : null}
      {message ? <p role="status" className="text-[11px] text-white/60">{message}</p> : null}
    </section>
  )
}

export function LeagueGroupPanel({ leagueId }: { leagueId: string }) {
  const [state, setState] = useState<State | null>(null)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/league-group`
  useEffect(() => {
    const controller = new AbortController()
    void fetch(url, { signal: controller.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: State | null) => { if (!controller.signal.aborted && d && 'canEdit' in d) setState(d) })
      .catch(() => undefined)
    return () => controller.abort()
  }, [url])
  if (!state) return null
  const onSave = async (name: string): Promise<string | null> => {
    const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    const d = (await res.json().catch(() => null)) as { group?: { name: string } | null; error?: string } | null
    if (!res.ok) return d?.error ?? 'Could not save.'
    const group = d?.group ?? null
    setState((s) => (s ? { ...s, group, suggestions: group && !s.suggestions.includes(group.name) ? [...s.suggestions, group.name].sort() : s.suggestions } : s))
    return null
  }
  return <LeagueGroupForm state={state} onSave={onSave} />
}
