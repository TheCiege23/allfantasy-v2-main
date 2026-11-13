'use client'

import type { LeagueCreationWizardState, LeagueTypeId } from '@/lib/league-creation-wizard/types'

export type Step2LeagueTypeProps = {
  state: LeagueCreationWizardState
  onLeagueTypeChange: (leagueType: LeagueTypeId) => void
  onBack: () => void
  onNext: () => void
}

