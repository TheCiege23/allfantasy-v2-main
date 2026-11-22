'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { CapOverviewBar } from '@/app/idp/components/cap/CapOverviewBar'
import { ContractsTable } from '@/app/idp/components/cap/ContractsTable'
import type { IdpCapSummaryJson, IdpSalaryRecordJson } from '@/app/idp/hooks/useIdpTeamCap'
import { useRedraftRosterId } from '@/app/idp/hooks/useIdpTeamCap'

export function ContractCenterClient({ leagueId }: { leagueId: string }) {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const searchParams = useSearchParams()
  const qp = searchParams?.get('rosterId')
  const { rosterId: fetched } = useRedraftRosterId(leagueId)
  const rosterId = qp ?? fetched

  const [teamName, setTeamName] = useState('Your team')
  const [summary, setSummary] = useState<IdpCapSummaryJson | null>(null)
  const [contracts, setContracts] = useState<IdpSalaryRecordJson[]>([])
  const [deadRows, setDeadRows] = useState<
    { playerName: string; position: string; currentYearDead: number; reason: string; season: number }[]
  >([])
  const [year, setYear] = useState(new Date().getFullYear())

  useEffect(() => {
    if (!rosterId || !userId) return
    let c = false
    fetch(`/api/redraft/season?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { season?: { rosters?: { id: string; teamName: string | null }[] } } | null) => {
        const t = d?.season?.rosters?.find((x) => x.id === rosterId)
        if (t?.teamName && !c) setTeamName(t.teamName)
      })
      .catch(() => {})
    const q = (type: string) =>
      new URLSearchParams({ leagueId, rosterId, type }).toString()
    fetch(`/api/idp/cap?${q('summary')}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: IdpCapSummaryJson | null) => {
        if (!c && d) {
          setSummary(d)
          if (d.season) setYear(d.season)
        }
      })
    fetch(`/api/idp/cap?${q('contracts')}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { contracts: [] }))
      .then((d: { contracts?: IdpSalaryRecordJson[] }) => {
        if (!c) setContracts(d.contracts ?? [])
      })
    fetch(`/api/idp/cap?${new URLSearchParams({ leagueId, rosterId, type: 'dead_money' })}`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : { deadMoney: [] }))
      .then(
        (d: {
          deadMoney?: {
            playerName: string
            position?: string
            currentYearDead: number
            reason: string
            season: number
          }[]
        }) => {
          if (!c)
            setDeadRows(
              (d.deadMoney ?? []).map((r) => ({
                ...r,
                position: r.position ?? '—',
              })),
            )
        },
      )
    return () => {
      c = true
    }
  }, [leagueId, rosterId, userId])

  const expiring = contracts.filter((c) => c.yearsRemaining <= 1 && c.status === 'active')

  return (
    <div className="min-h-screen bg-[#040915] px-4 py-6 text-white">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href={`/league/${leagueId}`} className="text-[12px] text-cyan-300/90 hover:underline">
            ← League
          </Link>
          <h1 className="text-lg font-bold">Contract Center — {teamName}</h1>
        </div>

        {summary ? (
          <CapOverviewBar
            activeSalary={summary.activeSalary}
            deadMoney={summary.deadMoney}
            availableCap={summary.availableCap}
            totalCap={summary.totalCap}
            year={year}
            onYearChange={setYear}
          />
        ) : (
          <p className="text-sm text-white/45">Loading cap…</p>
        )}

        <section>
          <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-white/45">Contract timeline</h2>
          <p className="mb-3 text-[11px] text-white/40">
            Each bar is the length of the contract. Green: under contract · amber: expiring this season · violet: franchise tag.
          </p>
          <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-[#0c101a] p-3">
            <div className="min-w-[600px] space-y-2">
              {contracts
                .filter((c) => c.status === 'active' || c.status === 'franchise_tagged')
                .slice(0, 12)
                .map((c) => {
                  const span = Math.max(1, c.contractYears)
                  const tagged = c.isFranchiseTagged || c.status === 'franchise_tagged'
                  const exp = c.yearsRemaining <= 1
                  const bg = tagged ? 'bg-violet-500/45' : exp ? 'bg-cap-amber/40' : 'bg-cap-green/40'
                  return (
                    <div key={c.id} className="flex h-10 items-center gap-2">
                      <div className="w-36 shrink-0 truncate text-[11px] text-white/80">{c.playerName}</div>
                      <div className="relative h-8 flex-1 rounded bg-white/[0.06]">
                        <div
                          className={`absolute left-0 top-0 h-full rounded ${bg}`}
                          style={{ width: `${Math.min(100, span * 18)}%` }}
                          title={`${c.contractYears} yr`}
                        />
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-white/45">Dead money log</h2>
          <div className="space-y-2 rounded-xl border border-white/[0.07] bg-[#0c101a] p-3">
            {deadRows.length === 0 ? (
              <p className="text-[12px] text-white/45">No dead money entries.</p>
            ) : (
              deadRows.map((r, i) => (
                <div key={i} className="flex flex-wrap justify-between gap-2 border-b border-white/[0.05] py-2 text-[11px] last:border-0">
                  <span>{r.playerName}</span>
                  <span className="text-white/50">{r.position ?? '—'}</span>
                  <span>${r.currentYearDead.toFixed(1)}M</span>
                  <span className="text-white/45">{r.reason}</span>
                  <span className="text-white/35">{r.season}</span>
                </div>
              ))
            )}
            <p className="pt-2 text-[11px] font-semibold text-white/60">
              Total dead (displayed): ${deadRows.reduce((s, r) => s + r.currentYearDead, 0).toFixed(1)}M
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-amber-200/90">Expiring contracts</h2>
          {expiring.length === 0 ? (
            <p className="text-[12px] text-white/45">No expiring contracts this pass.</p>
          ) : (
            <ul className="space-y-2">
              {expiring.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/25 bg-amber-950/15 px-3 py-2 text-[11px]"
                >
                  <span className="font-semibold">{c.playerName}</span>
                  <div className="flex gap-1">
                    <span className="rounded border border-white/15 px-2 py-0.5">Extend</span>
                    <span className="rounded border border-white/15 px-2 py-0.5">Tag</span>
                    <span className="rounded border border-white/15 px-2 py-0.5">Let expire</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ContractsTable contracts={contracts} />
      </div>
    </div>
  )
}
