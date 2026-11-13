'use client'

import type { LeagueCreationWizardState, WizardDraftSettings } from '@/lib/league-creation-wizard/types'

export type Step6DraftSettingsProps = {
  state: LeagueCreationWizardState
  onDraftSettingsChange: (patch: Partial<WizardDraftSettings>) => void
  onBack: () => void
  onNext: () => void
}

