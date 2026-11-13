'use client'

import type { LeagueCreationWizardState } from '@/lib/league-creation-wizard/types'

export type Step10ReviewProps = {
  state: LeagueCreationWizardState
  onCreate: () => void
  onBack: () => void
  creating: boolean
  error: string | null
}

