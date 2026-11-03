'use client'

import type { LeagueTeam } from '@prisma/client'
import type { UserLeague } from '@/app/dashboard/types'
import { AICoachingWorkspace } from '@/components/league-ai-coaching/AICoachingWorkspace'
import { FeatureGate } from '@/components/subscription/FeatureGate'
import './redraft-tailwind-tabs.css'

export type AICoachingTabProps = {
  league: UserLeague
  userTeam: LeagueTeam | null
  sport: string
}

export function AICoachingTab({ league, userTeam, sport }: AICoachingTabProps) {
  return (
    <div className="rdt rdt-bridge min-h-0 px-1 sm:px-0">
      <FeatureGate
        featureId="league_ai_coaching"
        featureNameOverride="League Coaching with Chimmy"
        className="rdt-card p-5 sm:p-7"
        showTokenFallback={false}
      >
        <AICoachingWorkspace league={league} userTeam={userTeam} sport={sport} />
      </FeatureGate>
    </div>
  )
}
