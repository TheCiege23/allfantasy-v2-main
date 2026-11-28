'use client'

import { GuillotineHome } from '@/components/guillotine/GuillotineHome'
import type { SupportedSport } from '@/lib/sport-scope'
import '@/components/guillotine/guillotine-identity.css'

type GuillotineTabProps = {
  leagueId: string
  sport: SupportedSport | string
  leagueName?: string | null
}

/**
 * The Chop tab of a Guilly league hosted here. One page, no sub-tabs: the row of Hub / Waivers / History /
 * Storylines that sat here only scrolled this same page (three of the four), and Waivers is the Team tab's
 * own screen (owner's decision, 2026-11-25 — "too many tabs").
 */
export function GuillotineTab({ leagueId, sport, leagueName }: GuillotineTabProps) {
  return (
    <div className="gl flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4" data-testid="guillotine-chop-tab">
      <GuillotineHome leagueId={leagueId} sport={String(sport)} leagueName={leagueName ?? undefined} />
    </div>
  )
}
