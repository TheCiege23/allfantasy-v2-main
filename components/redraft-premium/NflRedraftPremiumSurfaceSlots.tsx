'use client'

import type {
  NflRedraftPremiumServiceId,
  NflRedraftPremiumServiceVariant,
  NflRedraftPremiumTier,
} from '@/lib/redraft-premium'
import { NflRedraftPremiumServiceShell } from '@/components/redraft-premium/NflRedraftPremiumServiceShell'

export type NflRedraftPremiumSurfaceSlot =
  | 'league_dashboard'
  | 'team_page'
  | 'matchup_page'
  | 'waiver_area'
  | 'trade_center'
  | 'draft_room'
  | 'player_card'

export type NflRedraftPremiumSurfaceService = {
  serviceType: NflRedraftPremiumServiceId
  serviceVariant?: NflRedraftPremiumServiceVariant
  title: string
}

export const NFL_REDRAFT_PREMIUM_SURFACE_SERVICES: Record<
  NflRedraftPremiumSurfaceSlot,
  readonly NflRedraftPremiumSurfaceService[]
> = {
  league_dashboard: [
    { serviceType: 'basic_runtime_facts', title: 'Basic Runtime Facts' },
    { serviceType: 'commissioner_digest', title: 'AF Commissioner Digest' },
  ],
  team_page: [
    { serviceType: 'manager_brief', title: 'AF Manager Brief' },
    { serviceType: 'basic_runtime_facts', title: 'Basic Runtime Facts' },
    { serviceType: 'war_room', title: 'AF Legacy' },
  ],
  matchup_page: [
    { serviceType: 'matchup_prep', title: 'Matchup Prep' },
    { serviceType: 'war_room', title: 'AF Legacy' },
  ],
  waiver_area: [{ serviceType: 'waiver_report', title: 'Waiver Report' }],
  trade_center: [
    { serviceType: 'trade_review', title: 'Trade Review' },
    { serviceType: 'trade_review', serviceVariant: 'commissioner', title: 'Commissioner Trade Review' },
  ],
  draft_room: [
    { serviceType: 'draft_prep', title: 'Draft Prep' },
    { serviceType: 'draft_prep', serviceVariant: 'advanced', title: 'Advanced Draft Prep' },
  ],
  player_card: [
    { serviceType: 'basic_runtime_facts', title: 'Basic Runtime Facts' },
    { serviceType: 'manager_brief', title: 'AF Manager Brief' },
  ],
}

export type NflRedraftPremiumSurfaceRailProps = {
  surface: NflRedraftPremiumSurfaceSlot
  leagueId: string
  teamId?: string | null
  managerId?: string | null
  matchupId?: string | null
  playerId?: string | null
  week?: number | null
  season?: number | null
  requestedTier?: NflRedraftPremiumTier | null
  compact?: boolean
  className?: string
}

function surfaceLabel(surface: NflRedraftPremiumSurfaceSlot): string {
  return surface.replace(/_/g, ' ')
}

export function NflRedraftPremiumSurfaceRail({
  surface,
  leagueId,
  teamId,
  managerId,
  matchupId,
  playerId,
  week,
  season,
  requestedTier,
  compact,
  className,
}: NflRedraftPremiumSurfaceRailProps) {
  const services = NFL_REDRAFT_PREMIUM_SURFACE_SERVICES[surface]

  return (
    <div className={className} data-testid="premium-service-surface-rail" data-surface={surface}>
      <div className="grid gap-3">
        {services.map((service) => (
          <NflRedraftPremiumServiceShell
            key={`${service.serviceType}:${service.serviceVariant ?? 'basic'}`}
            serviceType={service.serviceType}
            serviceVariant={service.serviceVariant}
            leagueId={leagueId}
            teamId={teamId}
            managerId={managerId}
            matchupId={matchupId}
            playerId={playerId}
            week={week}
            season={season}
            requestedTier={requestedTier}
            title={service.title}
            surfaceLabel={surfaceLabel(surface)}
            compact={compact}
          />
        ))}
      </div>
    </div>
  )
}

export function LeagueDashboardPremiumShells(props: Omit<NflRedraftPremiumSurfaceRailProps, 'surface'>) {
  return <NflRedraftPremiumSurfaceRail {...props} surface="league_dashboard" />
}

export function TeamPagePremiumShells(props: Omit<NflRedraftPremiumSurfaceRailProps, 'surface'>) {
  return <NflRedraftPremiumSurfaceRail {...props} surface="team_page" />
}

export function MatchupPremiumShells(props: Omit<NflRedraftPremiumSurfaceRailProps, 'surface'>) {
  return <NflRedraftPremiumSurfaceRail {...props} surface="matchup_page" />
}

export function WaiverPremiumShells(props: Omit<NflRedraftPremiumSurfaceRailProps, 'surface'>) {
  return <NflRedraftPremiumSurfaceRail {...props} surface="waiver_area" />
}

export function TradePremiumShells(props: Omit<NflRedraftPremiumSurfaceRailProps, 'surface'>) {
  return <NflRedraftPremiumSurfaceRail {...props} surface="trade_center" />
}

export function DraftPremiumShells(props: Omit<NflRedraftPremiumSurfaceRailProps, 'surface'>) {
  return <NflRedraftPremiumSurfaceRail {...props} surface="draft_room" />
}

export function PlayerCardPremiumShells(props: Omit<NflRedraftPremiumSurfaceRailProps, 'surface'>) {
  return <NflRedraftPremiumSurfaceRail {...props} surface="player_card" />
}

function canonicalIdOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(trimmed) ? trimmed : null
}

export function NflRedraftPremiumPlayerCardShells({
  leagueId,
  playerId,
  teamId,
  week,
  season,
  compact = true,
  className,
}: {
  leagueId: string
  playerId?: string | null
  teamId?: string | null
  week?: number | null
  season?: number | null
  compact?: boolean
  className?: string
}) {
  return (
    <PlayerCardPremiumShells
      leagueId={leagueId}
      playerId={canonicalIdOrNull(playerId)}
      teamId={canonicalIdOrNull(teamId)}
      week={week}
      season={season}
      compact={compact}
      className={className}
    />
  )
}
