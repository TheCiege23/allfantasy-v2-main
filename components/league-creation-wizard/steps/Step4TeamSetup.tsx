'use client'

import type { LeagueCreationWizardState } from '@/lib/league-creation-wizard/types'

export type Step4TeamSetupProps = {
  state: LeagueCreationWizardState
  onTeamCountChange: (n: number) => void
  onRosterSizeChange: (n: number | null) => void
  onNameChange: (name: string) => void
  onBack: () => void
  onNext: () => void
}

