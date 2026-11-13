'use client'

import type { LeagueCreationWizardState } from '@/lib/league-creation-wizard/types'

export type Step5ScoringProps = {
  state: LeagueCreationWizardState
  onScoringPresetChange: (value: string | null) => void
  onLeagueVariantChange: (value: string | null) => void
  onBack: () => void
  onNext: () => void
}

