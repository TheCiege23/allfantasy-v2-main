'use client'

import type { LeagueCreationWizardState } from '@/lib/league-creation-wizard/types'

export type Step1SportProps = {
  state: LeagueCreationWizardState
  onSportChange: (sport: string) => void
  onNext: () => void
}

