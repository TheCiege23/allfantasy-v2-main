'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { shortDate } from '@/components/commissioner-os/primitives/pinnedTime'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { kickoffText } from '@/lib/core-app/kickoffText'
import { cardsCopy, taskPriorityLabelText } from '@/lib/commissioner-os/i18n/cardsCopy'
import type { SeverityTier } from '@/lib/commissioner-ui/tokens/colors'

type League = { id: string; name: string; sport: string }
type Network = {
  id: string
  name: string
  members: Array<{ leagueId: string; role: string; label: string | null; league: League }>
  queue: Array<{ id: string; leagueId: string; title: string; priority: string; status: string }>
  history: Array<{ id: string; leagueId: string; summary: string; type: string; occurredAt: string }>
}
type Payload = { eligibleLeagues: League[]; networks: Network[] }

/*
 * Spanish (2026-10-06): the screen's words through `cardsCopy` ("Edit" and "Leagues" are shared Core
 * words, so through `coreUiCopy`). `error` keeps the English it was set with — the route's message or
 * the form's own fallback — and is translated when it is drawn, so switching language mid-error
 * follows. Network, league and task titles and audit summaries are the users' own and stay as written;
 * the pinned "Oct 4" date goes through `kickoffText`.
 */
export function CommissionerNetworks() {
  const { language } = useOptionalLanguage()
  const ui = (english: string) => cardsCopy(english, language)
  const core = (english: string) => coreUiCopy(english, language)
  // A queued task's priority reads the workspace badge's labels (Informativa, Saludable…), lower-cased
  // like the raw value English shows in the same parentheses. An unknown value stays as stored.
  const priority = (raw: string) => {
    const label = taskPriorityLabelText(raw as SeverityTier, raw, language)
    return language === 'es' ? label.toLocaleLowerCase('es') : label
  }
  const [data, setData] = useState<Payload | null>(null)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const response = await fetch('/api/commissioner/networks', { cache: 'no-store' })
    const payload = await response.json() as Payload & { error?: string }
    if (!response.ok) throw new Error(payload.error ?? 'Network data unavailable')
    setData(payload)
  }, [])

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : 'Network data unavailable')) }, [load])

  const save = async () => {
    setError(null)
    setBusy(true)
    try {
      const response = await fetch('/api/commissioner/networks', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ networkId: editing, name, leagueIds: selected }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Could not save network')
      setEditing(null); setName(''); setSelected([])
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save network') }
    finally { setBusy(false) }
  }

  const remove = async (networkId: string) => {
    if (!window.confirm(ui('Delete this network? Its leagues and league data remain.'))) return
    setBusy(true)
    try {
      const response = await fetch('/api/commissioner/networks', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ networkId }),
      })
      if (!response.ok) throw new Error('Could not delete network')
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete network') }
    finally { setBusy(false) }
  }

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const leagueName = (network: Network, leagueId: string) => network.members.find((member) => member.leagueId === leagueId)?.league.name ?? ui('League')

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 text-white">
      <header><h1 className="text-2xl font-semibold">{ui('Commissioner networks')}</h1><p className="mt-2 text-sm text-white/65">{ui('Unify leagues you own under one named commissioner workspace. Each item keeps its league-level drilldown.')}</p></header>
      {error && <p role="alert" className="rounded border border-red-400/50 p-3 text-red-200">{ui(error)}</p>}
      <section className="rounded-xl border border-white/15 p-4">
        <h2 className="font-semibold">{ui(editing ? 'Edit network' : 'Create network')}</h2>
        <label className="mt-3 block text-sm">{ui('Network name')}<input className="mt-1 block w-full rounded border border-white/25 bg-black/20 p-2" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></label>
        <fieldset className="mt-4 space-y-2"><legend className="text-sm">{ui('Member leagues (first selected league is the host)')}</legend>
          {data?.eligibleLeagues.map((league) => <label key={league.id} className="block text-sm"><input type="checkbox" checked={selected.includes(league.id)} onChange={() => toggle(league.id)} /> <span className="ml-2">{league.name} · {league.sport}</span></label>)}
          {data && data.eligibleLeagues.length === 0 && <p className="text-sm text-white/60">{ui('You do not own a league that can be linked yet.')}</p>}
        </fieldset>
        <div className="mt-4 flex gap-3"><button type="button" disabled={busy || !name.trim() || selected.length === 0} onClick={() => void save()} className="rounded bg-amber-500 px-3 py-2 text-sm text-black disabled:opacity-50">{ui(editing ? 'Save network' : 'Create network')}</button>
          {editing && <button type="button" onClick={() => { setEditing(null); setName(''); setSelected([]) }} className="text-sm underline">{ui('Cancel')}</button>}
        </div>
      </section>
      {!data && !error && <p>{ui('Loading networks…')}</p>}
      {data?.networks.map((network) => <section key={network.id} className="rounded-xl border border-white/15 p-4">
        <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{network.name}</h2><div className="flex gap-3 text-sm"><button type="button" onClick={() => { setEditing(network.id); setName(network.name); setSelected(network.members.map((member) => member.leagueId)) }} className="underline">{core('Edit')}</button><button type="button" disabled={busy} onClick={() => void remove(network.id)} className="text-red-300 underline">{ui('Delete')}</button></div></div>
        <h3 className="mt-4 text-sm font-semibold">{core('Leagues')}</h3><ul className="mt-2 space-y-1 text-sm">{network.members.map((member) => <li key={member.leagueId}><Link className="underline" href={`/core/commissioner?league=${encodeURIComponent(member.leagueId)}`}>{member.league.name}</Link> <span className="text-white/60">· {ui(member.role)}</span></li>)}</ul>
        <div className="mt-5 grid gap-5 md:grid-cols-2"><div><h3 className="text-sm font-semibold">{ui('Attention queue')}</h3>{network.queue.length ? <ul className="mt-2 space-y-2 text-sm">{network.queue.map((task) => <li key={task.id}><Link className="underline" href={`/core/commissioner?league=${encodeURIComponent(task.leagueId)}`}>{leagueName(network, task.leagueId)}: {task.title}</Link> <span className="text-white/55">({priority(task.priority)})</span></li>)}</ul> : <p className="mt-2 text-sm text-white/60">{ui('No open workspace tasks on file.')}</p>}</div>
          <div><h3 className="text-sm font-semibold">{ui('Recent history')}</h3>{network.history.length ? <ul className="mt-2 space-y-2 text-sm">{network.history.map((event) => <li key={event.id}><Link className="underline" href={`/core/commissioner?league=${encodeURIComponent(event.leagueId)}`}>{leagueName(network, event.leagueId)}: {event.summary || event.type}</Link> <span className="text-white/55">· {kickoffText(shortDate(event.occurredAt), language)}</span></li>)}</ul> : <p className="mt-2 text-sm text-white/60">{ui('No projected audit history on file.')}</p>}</div></div>
      </section>)}
    </main>
  )
}
