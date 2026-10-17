'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, HeartPulse } from 'lucide-react'
import { buildLeagueHealth, type ClaimLite, type DuesPayload, type HealthItem, type SetupStepLite, type TradeLite } from '@/lib/league/league-health'

async function getJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, { cache: 'no-store', credentials: 'include' })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

/** Four existing read-only GETs, in parallel; a failed one simply contributes nothing. */
export async function loadLeagueHealth(input: { leagueId: string; claimedSeats: number; teamCount: number; now?: () => string }): Promise<{ items: HealthItem[]; loadedAny: boolean }> {
  const id = encodeURIComponent(input.leagueId)
  const [checklist, dues, trades, waivers] = await Promise.all([
    getJson(`/api/leagues/${id}/setup/checklist`),
    getJson(`/api/commissioner/leagues/${id}/dues`),
    getJson(`/api/leagues/${id}/trades`),
    getJson(`/api/commissioner/leagues/${id}/waivers?type=pending`),
  ])
  return {
    loadedAny: [checklist, dues, trades, waivers].some((x) => x != null),
    items: buildLeagueHealth({
      steps: (checklist as { steps?: SetupStepLite[] } | null)?.steps ?? null,
      claimedSeats: input.claimedSeats,
      teamCount: input.teamCount,
      dues: dues as DuesPayload | null,
      trades: (trades as { trades?: TradeLite[] } | null)?.trades ?? null,
      waiverClaims: (waivers as { claims?: ClaimLite[] } | null)?.claims ?? null,
      now: (input.now ?? (() => new Date().toISOString()))(),
    }),
  }
}

/**
 * League health for the commissioner after the draft: unfinished settings, open seats, unpaid
 * dues, trades waiting on review or a vote, and waiver claims stuck past the overdue line. Before
 * the draft the setup checklist does this job; this panel takes over once it would disappear.
 */
export function LeagueHealthPanel({
  leagueId,
  claimedSeats,
  teamCount,
  onOpenSettings,
  onSelectTab,
}: {
  leagueId: string
  claimedSeats: number
  teamCount: number
  onOpenSettings: (panel?: string | null) => void
  onSelectTab: (tab: string) => void
}) {
  const [state, setState] = useState<{ items: HealthItem[]; loadedAny: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    loadLeagueHealth({ leagueId, claimedSeats, teamCount }).then((result) => {
      if (!cancelled) setState(result)
    })
    return () => {
      cancelled = true
    }
  }, [leagueId, claimedSeats, teamCount])

  // Nothing loaded at all (signed out, not the commissioner, offline): say nothing rather than "all clear".
  if (!state || !state.loadedAny) return null

  return (
    <section className="nl-card nl-health" aria-label="League health" data-testid="league-health">
      <div className="nl-card-label">
        <span>League health</span>
        <HeartPulse size={16} aria-hidden />
      </div>
      {state.items.length === 0 ? (
        <p className="nl-health-clear" data-testid="league-health-clear">
          <CheckCircle2 size={16} aria-hidden /> Nothing needs you right now.
        </p>
      ) : (
        <>
          <h2 data-testid="league-health-count">{state.items.length === 1 ? '1 thing needs you' : `${state.items.length} things need you`}</h2>
          <ul className="nl-health-list" data-testid="league-health-list">
            {state.items.map((item) => (
              <li key={item.id} data-tone={item.tone} data-item={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </div>
                <button
                  type="button"
                  className="nl-button"
                  onClick={() => (item.action.kind === 'settings' ? onOpenSettings(item.action.panel) : onSelectTab(item.action.tab))}
                  data-testid={`league-health-${item.id}`}
                >
                  {item.cta} <ArrowRight size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <a className="nl-text-link" href={`/core/commissioner?league=${encodeURIComponent(leagueId)}`} data-testid="league-health-full">
        Full commissioner view <ArrowRight size={14} aria-hidden />
      </a>
    </section>
  )
}
