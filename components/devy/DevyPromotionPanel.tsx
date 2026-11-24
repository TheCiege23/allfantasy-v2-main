'use client'

/**
 * Offseason promotion panel: the devy players you can promote to your pro roster this offseason.
 *
 * 2026-11-23 audit: it listed every team's eligible players with a Promote button (the route refuses anyone but the
 * rights holder or the commissioner, so those could only fail), and asked for a raw "Pro player ID" in a text box.
 * Now the route returns only what this viewer may promote, and Promote uses the stored pro match
 * (`promotedProPlayerId`, the same one the hero's Promote uses). A player with no match yet waits for the
 * commissioner, who links him under Devy commissioner tools. The deadline lives in the hero's countdown, so it is
 * not repeated here.
 */

import { useEffect, useState } from 'react'

interface EligibleItem {
  rightsId: string
  rosterId: string
  platformUserId: string
  devyPlayerId: string
  devyPlayer: { name: string; position: string; school: string; draftEligibleYear: number | null } | null
  promotedProPlayerId: string | null
  seasonYear: number | null
  /** The viewer's own team (or a team they co-own). */
  mine?: boolean
  /** The viewer may promote this player (their own, or any as commissioner). */
  canPromote?: boolean
}

interface PromotionResponse {
  eligible: EligibleItem[]
  seasonYear: number
  config: { promotionTiming: string; maxYearlyDevyPromotions: number | null } | null
  promotionWindow?: {
    timing: string
    timingLabel: string
    deadlineIso: string | null
  }
}

interface Props {
  leagueId: string
  rosterId?: string
  isCommissioner?: boolean
}

export function DevyPromotionPanel({ leagueId, rosterId, isCommissioner }: Props) {
  const [data, setData] = useState<PromotionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [promoting, setPromoting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function fetchEligible() {
      try {
        const url = new URL(`/api/leagues/${encodeURIComponent(leagueId)}/devy/promotion`, window.location.origin)
        if (rosterId) url.searchParams.set('rosterId', rosterId)
        const res = await fetch(url.toString(), { cache: 'no-store' })
        if (!active) return
        if (!res.ok) {
          setError('Promotions didn’t load. Try again in a moment.')
          setLoading(false)
          return
        }
        const json = await res.json()
        setData(json)
      } catch {
        if (active) setError('Promotions didn’t load. Try again in a moment.')
      } finally {
        if (active) setLoading(false)
      }
    }
    fetchEligible()
    return () => { active = false }
  }, [leagueId, rosterId])

  const handlePromote = async (rightsId: string, promotedProPlayerId: string) => {
    setPromoting(rightsId)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/devy/promotion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rightsId, promotedProPlayerId, addToRoster: true }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((json as { error?: string }).error ?? 'The promotion didn’t go through.')
        return
      }
      setData((prev) => (prev ? { ...prev, eligible: prev.eligible.filter((e) => e.rightsId !== rightsId) } : null))
    } catch {
      setError('The promotion didn’t go through.')
    } finally {
      setPromoting(null)
    }
  }

  if (loading) return null
  if (error && !data) {
    return <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm text-[var(--bad)]">{error}</div>
  }

  // `canPromote` is absent only from an older route; then the viewer's own roster (rosterId) is the safe reading.
  const rows = (data?.eligible ?? []).filter((e) => e.canPromote ?? (rosterId ? e.rosterId === rosterId : false))
  if (rows.length === 0) return null
  const mine = rows.filter((e) => e.mine !== false)
  const others = isCommissioner ? rows.filter((e) => e.mine === false) : []

  const Row = ({ item }: { item: EligibleItem }) => (
    <li className="flex min-h-[52px] flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-3 py-2 first:border-t-0">
      <div className="min-w-0">
        <p className="font-semibold text-[var(--text)]">{item.devyPlayer?.name ?? 'Devy player'}</p>
        {item.devyPlayer ? (
          <p className="text-xs text-[var(--muted)]">
            {item.devyPlayer.position} · {item.devyPlayer.school}
          </p>
        ) : null}
      </div>
      {item.promotedProPlayerId ? (
        <button
          type="button"
          disabled={!!promoting}
          className="min-h-[40px] rounded-lg bg-[var(--good)] px-4 text-sm font-bold text-[var(--accent-ink)] disabled:opacity-50"
          onClick={() => void handlePromote(item.rightsId, item.promotedProPlayerId!)}
        >
          {promoting === item.rightsId ? 'Promoting…' : 'Promote'}
        </button>
      ) : (
        <span className="text-xs text-[var(--muted)]">Waiting for his pro match{isCommissioner ? ' — link him in Devy commissioner tools' : ' from the commissioner'}</span>
      )}
    </li>
  )

  return (
    <section className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4" data-testid="devy-promotion-panel">
      <div>
        <h3 className="text-[15px] font-bold text-[var(--text)]">Ready to promote</h3>
        <p className="mt-0.5 text-sm text-[var(--text2)]">
          {data?.promotionWindow?.timingLabel || 'Promote before the rookie draft.'} You need an open roster spot for each.
        </p>
      </div>
      {error ? <p className="text-sm text-[var(--warn)]">{error}</p> : null}
      {mine.length ? (
        <ul className="rounded-lg border border-[var(--line)] bg-[var(--surface2)]">
          {mine.map((item) => <Row key={item.rightsId} item={item} />)}
        </ul>
      ) : null}
      {others.length ? (
        <>
          <p className="text-xs font-semibold text-[var(--muted)]">Other teams (commissioner)</p>
          <ul className="rounded-lg border border-[var(--line)] bg-[var(--surface2)]">
            {others.map((item) => <Row key={item.rightsId} item={item} />)}
          </ul>
        </>
      ) : null}
    </section>
  )
}
