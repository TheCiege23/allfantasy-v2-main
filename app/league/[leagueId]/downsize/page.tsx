'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'

type DownsizeGet = {
  eligible: boolean
  currentSize: number
  leagueSize: number
  rosters: { rosterId: string; teamName: string; isOrphan: boolean }[]
}

export default function LeagueDownsizePage() {
  const params = useParams<{ leagueId: string }>() ?? ({} as { leagueId: string })
  const router = useRouter()
  const leagueId = params.leagueId

  const [data, setData] = useState<DownsizeGet | null>(null)
  const [newTeamCount, setNewTeamCount] = useState(4)
  const [assign, setAssign] = useState<Record<string, 'pool' | string>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/downsize`, { cache: 'no-store' })
    const json = (await res.json().catch(() => ({}))) as DownsizeGet & { error?: string }
    if (!res.ok) throw new Error(json.error ?? 'Could not load league')
    setData(json)
    const cs = json.currentSize ?? 4
    setNewTeamCount(cs > 4 ? cs - 1 : Math.max(2, cs - 1))
  }, [leagueId])

  useEffect(() => {
    void load().catch((e) => toast.error(e instanceof Error ? e.message : 'Load failed'))
  }, [load])

  const dissolvedCount = useMemo(() => {
    if (!data) return 0
    return Math.max(0, data.currentSize - newTeamCount)
  }, [data, newTeamCount])

  const activeRosters = useMemo(() => (data?.rosters ?? []).filter((r) => !r.isOrphan), [data])

  const selected = useMemo(() => Object.keys(assign), [assign])

  const previewRows = useMemo(() => {
    return selected.map((rid) => {
      const mode = assign[rid]
      const team = data?.rosters.find((r) => r.rosterId === rid)
      if (mode === 'pool') return { rid, line: `${team?.teamName ?? rid} → dispersal pool` }
      const target = data?.rosters.find((r) => r.rosterId === mode)
      return { rid, line: `${team?.teamName ?? rid} → merge into ${target?.teamName ?? mode}` }
    })
  }, [assign, data?.rosters, selected])

  const apply = async () => {
    if (!data) return
    if (selected.length !== dissolvedCount) {
      toast.error(`Select exactly ${dissolvedCount} team(s) to dissolve.`)
      return
    }
    for (const rid of selected) {
      const m = assign[rid]
      if (!m) {
        toast.error('Complete merge / pool choices for each dissolved team.')
        return
      }
    }
    setBusy(true)
    try {
      const teamReassignments = selected.map((fromRosterId) => ({
        fromRosterId,
        toRosterId: assign[fromRosterId] === 'pool' ? null : assign[fromRosterId],
      }))
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/downsize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newTeamCount, teamReassignments }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Downsize failed')
      toast.success('League downsizing applied.')
      router.push(`/league/${leagueId}/dispersal-draft/setup`)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Downsize failed')
    } finally {
      setBusy(false)
    }
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 text-sm text-white/60">
        Loading…
      </main>
    )
  }

  if (!data.eligible) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-10 text-white">
        <h1 className="text-xl font-semibold">League downsizing</h1>
        <p className="text-sm text-white/60">This tool is available for dynasty / devy / salary-style leagues only.</p>
        <Link href={`/league/${leagueId}`} className="text-cyan-300/90 hover:underline">
          Back to league
        </Link>
      </main>
    )
  }

  const sizeOptions: number[] = []
  for (let n = 4; n <= data.currentSize - 1; n++) sizeOptions.push(n)
  if (sizeOptions.length === 0) {
    for (let n = 2; n <= data.currentSize - 1; n++) sizeOptions.push(n)
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8 text-white">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">League downsizing</h1>
          <p className="text-xs text-white/50">
            Current size: {data.currentSize} teams. Shrink the league, merge rosters, or send assets to the dispersal
            pool.
          </p>
        </div>
        <Link href={`/league/${leagueId}`} className="text-xs text-cyan-300/90 hover:underline">
          Back
        </Link>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0a1328] p-4">
        <label className="text-xs text-white/55">New league size</label>
        <select
          value={newTeamCount}
          onChange={(e) => setNewTeamCount(Number(e.target.value))}
          className="mt-2 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm"
        >
          {sizeOptions.map((n) => (
            <option key={n} value={n}>
              {n} teams
            </option>
          ))}
        </select>
        <p className="mt-2 text-[11px] text-white/45">
          {dissolvedCount} manager slot(s) will be removed. Assign each below.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0a1328] p-4">
        <h2 className="text-sm font-semibold">Teams to dissolve</h2>
        <p className="mb-3 text-[11px] text-white/45">
          Choose {dissolvedCount} active team(s). For each, merge into another remaining team or add assets to the draft
          pool.
        </p>
        <ul className="space-y-3">
          {activeRosters.map((r) => {
            const checked = r.rosterId in assign
            return (
              <li key={r.rosterId} className="rounded-lg border border-white/[0.06] bg-black/20 p-3 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && selected.length >= dissolvedCount && dissolvedCount > 0}
                    onChange={() => {
                      setAssign((prev) => {
                        const next = { ...prev }
                        if (next[r.rosterId]) delete next[r.rosterId]
                        else if (selected.length < dissolvedCount) next[r.rosterId] = 'pool'
                        return next
                      })
                    }}
                  />
                  <span>{r.teamName}</span>
                </label>
                {checked ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={assign[r.rosterId] ?? 'pool'}
                      onChange={(e) => {
                        const v = e.target.value
                        setAssign((prev) => ({ ...prev, [r.rosterId]: v === 'pool' ? 'pool' : v }))
                      }}
                      className="rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px]"
                    >
                      <option value="pool">Add to draft pool</option>
                      {activeRosters
                        .filter((o) => o.rosterId !== r.rosterId && !(o.rosterId in assign))
                        .map((o) => (
                          <option key={o.rosterId} value={o.rosterId}>
                            Merge into {o.teamName}
                          </option>
                        ))}
                    </select>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>

      {previewRows.length > 0 ? (
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4 text-xs text-[var(--badge-text-cyan)]">
          <p className="font-semibold text-cyan-200/90">Preview</p>
          <ul className="mt-2 space-y-1">
            {previewRows.map((row) => (
              <li key={row.rid}>{row.line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        disabled={busy || dissolvedCount === 0 || selected.length !== dissolvedCount}
        onClick={() => void apply()}
        className="w-full rounded-xl border border-cyan-400/35 bg-cyan-500/15 py-3 text-sm font-bold text-[var(--badge-text-cyan)] disabled:opacity-40"
      >
        {busy ? 'Applying…' : 'Apply downsizing →'}
      </button>
    </main>
  )
}
