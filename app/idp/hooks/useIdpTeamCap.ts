'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'

export type IdpCapSummaryJson = {
  season?: number
  totalCap: number
  activeSalary: number
  deadMoney: number
  totalCapUsed: number
  availableCap: number
  capFloorRequired?: number
  isCapCompliant: boolean
  holdbackReserved: number
  effectiveSpendableCap: number
}

export type IdpSalaryRecordJson = {
  id: string
  leagueId: string
  rosterId: string
  playerId: string
  playerName: string
  position: string
  isDefensive: boolean
  salary: number
  contractYears: number
  yearsRemaining: number
  contractStartYear: number
  status: string
  acquisitionMethod: string
  isFranchiseTagged: boolean
  cutPenaltyCurrent: number | null
  extensionBoostPct?: number
}

export function useRedraftRosterId(leagueId: string) {
  const { data: session, status } = useSession()
  const userId = session?.user?.id
  const [rosterId, setRosterId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === 'loading') return
    if (!userId || !leagueId) {
      setRosterId(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/redraft/season?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { season?: { rosters?: { id: string; ownerId: string | null }[] } } | null) => {
        const r = data?.season?.rosters?.find((x) => x.ownerId === userId)
        if (!cancelled) setRosterId(r?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setRosterId(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, userId, status])

  return { rosterId, loading, userId }
}

export function useIdpCapSummary(leagueId: string, rosterId: string | null, season?: number) {
  const [summary, setSummary] = useState<IdpCapSummaryJson | null>(null)
  const [error, setError] = useState<'none' | 'nocap' | 'auth'>('none')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!leagueId || !rosterId) {
      setSummary(null)
      setError('none')
      return
    }
    let cancelled = false
    setLoading(true)
    const q = new URLSearchParams({ leagueId, rosterId, type: 'summary' })
    if (season != null) q.set('season', String(season))
    fetch(`/api/idp/cap?${q}`, { credentials: 'include' })
      .then((r) => {
        if (r.status === 404) return null
        if (r.status === 401) {
          setError('auth')
          return null
        }
        return r.ok ? r.json() : null
      })
      .then((d: IdpCapSummaryJson | null) => {
        if (cancelled) return
        if (!d) {
          setSummary(null)
          setError('nocap')
          return
        }
        setSummary(d)
        setError('none')
      })
      .catch(() => {
        if (!cancelled) {
          setSummary(null)
          setError('nocap')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, rosterId, season])

  return { summary, loading, noCapConfig: error === 'nocap' }
}

export function useIdpContractsMap(leagueId: string, rosterId: string | null) {
  const [byPlayerId, setByPlayerId] = useState<Record<string, IdpSalaryRecordJson>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!leagueId || !rosterId) {
      setByPlayerId({})
      return
    }
    let cancelled = false
    setLoading(true)
    const q = new URLSearchParams({ leagueId, rosterId, type: 'contracts' })
    fetch(`/api/idp/cap?${q}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { contracts?: IdpSalaryRecordJson[] } | null) => {
        if (cancelled || !d?.contracts) {
          if (!cancelled) setByPlayerId({})
          return
        }
        const m: Record<string, IdpSalaryRecordJson> = {}
        for (const c of d.contracts) {
          m[c.playerId] = c
        }
        setByPlayerId(m)
      })
      .catch(() => {
        if (!cancelled) setByPlayerId({})
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, rosterId])

  return { byPlayerId, loading }
}

/*
 * ⚠ `mockContractUi` WAS HERE AND IS DELETED. IT HASHED THE PLAYER ID INTO A SALARY.
 *
 * Its docstring called it a fallback "when cap API has no row", which sounded like an edge case.
 * It was the only path: IDPSalaryRecord, IDPCapConfig, IDPDeadMoney, IDPCapTransaction,
 * IDPCapProjection and IdpLeagueConfig all hold 0 rows in production, so `useIdpContractsMap`
 * always resolves to {} and every salary, years-remaining and dead-money figure any IDP surface
 * has ever shown was invented from the id.
 *
 * Callers now render an absence instead. Do not reintroduce a fallback here — a contract is a
 * number a league agreed to, and there is no defensible way to guess one.
 */
