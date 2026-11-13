'use client'

import { useMemo, useState } from 'react'
import type { DemoTeam } from '@/lib/demo-league/types'

type RosterNames = { slot: number; players: Array<{ name: string; position: string | null }> }

type Verdict = {
  sideA: { slot: number; total: number; players: Array<{ name: string; value: number }> }
  sideB: { slot: number; total: number; players: Array<{ name: string; value: number }> }
  percentDiff: number
  winnerSlot: number | null
  summary: string
}

function PlayerPicker({ roster, chosen, onToggle }: { roster: RosterNames | undefined; chosen: string[]; onToggle: (name: string) => void }) {
  if (!roster) return <p className="text-sm af-muted">Pick a team.</p>
  return (
    <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
      {roster.players.map((p) => {
        const on = chosen.includes(p.name)
        return (
          <li key={p.name}>
            <button
              type="button"
              onClick={() => onToggle(p.name)}
              aria-pressed={on}
              className="flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm"
              style={{ background: on ? 'var(--color-primary-soft)' : 'var(--surface-card-soft)', border: '1px solid var(--border-subtle)' }}
            >
              <span className="truncate font-semibold">{p.name}</span>
              <span className="text-xs af-muted">{p.position ?? ''}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function DemoTradeEvaluator({ teams, rosters }: { teams: DemoTeam[]; rosters: RosterNames[] }) {
  const [slotA, setSlotA] = useState(teams[0]?.slot ?? 1)
  const [slotB, setSlotB] = useState(teams[1]?.slot ?? 2)
  const [giveA, setGiveA] = useState<string[]>([])
  const [giveB, setGiveB] = useState<string[]>([])
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const rosterOf = useMemo(() => new Map(rosters.map((r) => [r.slot, r])), [rosters])
  const name = (slot: number) => teams.find((t) => t.slot === slot)?.teamName ?? `Team ${slot}`
  const toggle = (list: string[], set: (v: string[]) => void, n: string) => set(list.includes(n) ? list.filter((x) => x !== n) : [...list, n].slice(0, 6))

  const evaluate = async () => {
    setBusy(true)
    setError(null)
    setVerdict(null)
    try {
      const res = await fetch('/api/demo/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotA, slotB, giveA, giveB }),
      })
      const json = (await res.json().catch(() => ({}))) as Verdict & { error?: string }
      if (!res.ok) setError(json.error ?? 'Could not evaluate that trade.')
      else setVerdict(json)
    } finally {
      setBusy(false)
    }
  }

  const select = (value: number, onChange: (v: number) => void, label: string) => (
    <label className="block text-sm font-semibold">
      {label}
      <select
        value={value}
        onChange={(e) => {
          onChange(Number(e.target.value))
          setVerdict(null)
        }}
        className="af-control mt-1 w-full px-3 text-sm"
      >
        {teams.map((t) => <option key={t.slot} value={t.slot}>{t.teamName}</option>)}
      </select>
    </label>
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="af-card p-4">
          {select(slotA, (v) => { setSlotA(v); setGiveA([]) }, 'Team A gives')}
          <PlayerPicker roster={rosterOf.get(slotA)} chosen={giveA} onToggle={(n) => toggle(giveA, setGiveA, n)} />
        </section>
        <section className="af-card p-4">
          {select(slotB, (v) => { setSlotB(v); setGiveB([]) }, 'Team B gives')}
          <PlayerPicker roster={rosterOf.get(slotB)} chosen={giveB} onToggle={(n) => toggle(giveB, setGiveB, n)} />
        </section>
      </div>
      <button
        type="button"
        onClick={() => void evaluate()}
        disabled={busy || slotA === slotB || giveA.length === 0 || giveB.length === 0}
        className="af-button-primary min-h-11 w-full rounded-xl px-5 text-sm font-semibold disabled:opacity-50 sm:w-auto"
      >
        {busy ? 'Evaluating…' : 'Evaluate trade'}
      </button>
      {slotA === slotB ? <p className="text-sm af-muted">Pick two different teams.</p> : null}
      {error ? <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p> : null}
      {verdict ? (
        <section className="af-card p-4" data-testid="demo-trade-verdict">
          <p className="text-lg font-black">{verdict.summary}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {[verdict.sideA, verdict.sideB].map((side) => (
              <div key={side.slot}>
                <p className="text-sm font-semibold">{name(side.slot)} receives · {side.total.toLocaleString()}</p>
                <ul className="mt-1 text-sm af-muted">{side.players.map((p) => <li key={p.name}>{p.name} — {p.value.toLocaleString()}</li>)}</ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs af-tertiary">Hypothetical only. Nothing is proposed or saved in the demo.</p>
        </section>
      ) : null}
    </div>
  )
}
