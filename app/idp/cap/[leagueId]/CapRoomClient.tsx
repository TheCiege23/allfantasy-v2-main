'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAfSubGate } from '@/hooks/useAfSubGate'
import { useSession } from 'next-auth/react'
import type { CapAdvice } from '@/lib/idp/ai/idpCapChimmy'
import { CapOverviewBar } from '@/app/idp/components/cap/CapOverviewBar'
import { CapPieChart } from '@/app/idp/components/cap/CapPieChart'
import { ContractsTable } from '@/app/idp/components/cap/ContractsTable'
import { ExtensionSimulator } from '@/app/idp/components/cap/ExtensionSimulator'
import type { IdpCapSummaryJson, IdpSalaryRecordJson } from '@/app/idp/hooks/useIdpTeamCap'
import { useRedraftRosterId } from '@/app/idp/hooks/useIdpTeamCap'

export function CapRoomClient({ leagueId }: { leagueId: string }) {
  const router = useRouter()
  const { data: session } = useSession()
  const userId = session?.user?.id
  const searchParams = useSearchParams()
  const qpRoster = searchParams?.get('rosterId')
  const { rosterId: fetchedRoster } = useRedraftRosterId(leagueId)
  const rosterId = qpRoster ?? fetchedRoster

  const [year, setYear] = useState<number | null>(null)
  const [summary, setSummary] = useState<IdpCapSummaryJson | null>(null)
  const [contracts, setContracts] = useState<IdpSalaryRecordJson[]>([])
  const [projections, setProjections] = useState<
    { projectionYear: number; committedSalary: number; deadCapHits: number; availableCap: number }[]
  >([])
  const [err, setErr] = useState<string | null>(null)
  const [hasSub, setHasSub] = useState(false)
  const [capAdvice, setCapAdvice] = useState<CapAdvice | null>(null)
  const [capAdviceLoading, setCapAdviceLoading] = useState(false)
  const { handleApiResponse } = useAfSubGate('commissioner_cap_advice')

  useEffect(() => {
    if (!rosterId || !userId) return
    let cancelled = false
    const q = (type: string, season?: number) => {
      const p = new URLSearchParams({ leagueId, rosterId, type })
      if (season != null) p.set('season', String(season))
      return p
    }
    fetch(`/api/idp/cap?${q('summary')}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: IdpCapSummaryJson) => {
        if (cancelled) return
        setSummary(d)
        setYear(d.season ?? new Date().getFullYear())
      })
      .catch(() => {
        if (!cancelled) setErr('Cap not configured or unavailable.')
      })
    fetch(`/api/idp/cap?${q('contracts')}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { contracts: [] }))
      .then((d: { contracts?: IdpSalaryRecordJson[] }) => {
        if (!cancelled) setContracts(d.contracts ?? [])
      })
    fetch(`/api/idp/cap?${q('projections')}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { projections: [] }))
      .then(
        (d: {
          projections?: {
            projectionYear: number
            committedSalary: number
            deadCapHits: number
            availableCap: number
          }[]
        }) => {
          if (!cancelled) setProjections(d.projections ?? [])
        },
      )
    fetch(`/api/league/settings?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { hasAfCommissionerSub?: boolean } | null) => {
        if (!cancelled) setHasSub(Boolean(d?.hasAfCommissionerSub))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [leagueId, rosterId, userId])

  useEffect(() => {
    if (year == null || !rosterId || !userId) return
    let cancelled = false
    const p = new URLSearchParams({ leagueId, rosterId, type: 'summary', season: String(year) })
    fetch(`/api/idp/cap?${p}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: IdpCapSummaryJson | null) => {
        if (!cancelled && d) setSummary(d)
      })
    return () => {
      cancelled = true
    }
  }, [year, leagueId, rosterId, userId])

  useEffect(() => {
    if (!hasSub || !rosterId || !userId) {
      setCapAdvice(null)
      return
    }
    let cancelled = false
    setCapAdviceLoading(true)
    ;(async () => {
      try {
        const r = await fetch('/api/idp/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ leagueId, rosterId, action: 'cap_advice' }),
        })
        if (cancelled) return
        if (!(await handleApiResponse(r))) {
          setCapAdvice(null)
          return
        }
        if (!r.ok) {
          setCapAdvice(null)
          return
        }
        const d = (await r.json()) as CapAdvice | null
        if (!cancelled && d?.recommendations) setCapAdvice(d)
      } catch {
        if (!cancelled) setCapAdvice(null)
      } finally {
        if (!cancelled) setCapAdviceLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [handleApiResponse, hasSub, rosterId, userId, leagueId])

  const projForYear =
    year != null ? projections.find((p) => p.projectionYear === year) : projections[0]

  const activeSal = projForYear?.committedSalary ?? summary?.activeSalary ?? 0
  const deadM = projForYear?.deadCapHits ?? summary?.deadMoney ?? 0
  const avail = projForYear?.availableCap ?? summary?.availableCap ?? 0
  const total = summary?.totalCap ?? 200

  return (
    <div className="min-h-screen bg-[#040915] px-4 py-6 text-white">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-2">
          <Link href={`/league/${leagueId}`} className="text-[12px] text-cyan-300/90 hover:underline">
            ← League
          </Link>
          <h1 className="text-lg font-bold text-white">Cap Room</h1>
        </div>
        {err ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
            {err}
          </p>
        ) : null}

        {summary && year != null ? (
          <>
            <CapOverviewBar
              activeSalary={activeSal}
              deadMoney={deadM}
              availableCap={avail}
              totalCap={total}
              year={year}
              onYearChange={setYear}
              yearOptions={[year, year + 1, year + 2, year + 3]}
              capAdvice={hasSub ? capAdvice : null}
              capAdviceLoading={hasSub && capAdviceLoading}
              onOpenFullCapAnalysis={
                hasSub ? () => router.push(`/league/${leagueId}?view=league`) : undefined
              }
            />
            <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
              <CapPieChart activeSalary={activeSal} deadMoney={deadM} availableCap={avail} size={160} />
              <div className="min-w-0 flex-1 space-y-2">
                <h2 className="text-[12px] font-bold uppercase tracking-wide text-white/45">Future years</h2>
                {projections.slice(0, 5).map((p) => (
                  <div key={p.projectionYear} className="space-y-1 rounded-lg border border-white/[0.06] p-2">
                    <p className="text-[11px] font-semibold text-white/80">{p.projectionYear}</p>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full bg-[color:var(--cap-contract)]"
                        style={{
                          width: `${Math.min(100, (p.committedSalary / Math.max(total, 0.001)) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-white/45">
                      Committed ${p.committedSalary.toFixed(1)}M · Dead ${p.deadCapHits.toFixed(1)}M · Open $
                      {p.availableCap.toFixed(1)}M
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <ContractsTable contracts={contracts} />

            {rosterId ? (
              <ExtensionSimulator leagueId={leagueId} rosterId={rosterId} contracts={contracts} />
            ) : null}

            {!hasSub ? (
              <p className="text-[11px] text-white/40">AfSub: enable commissioner subscription for AI cap recommendations.</p>
            ) : null}
          </>
        ) : !err ? (
          <p className="text-sm text-white/45">Loading cap data…</p>
        ) : null}
      </div>
    </div>
  )
}
