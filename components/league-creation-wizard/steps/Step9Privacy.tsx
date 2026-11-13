'use client'

import type { LeagueCreationWizardState, WizardPrivacySettings } from '@/lib/league-creation-wizard/types'

export type Step9PrivacyProps = {
  state: LeagueCreationWizardState
  onPrivacyChange: (patch: Partial<WizardPrivacySettings>) => void
  onBack: () => void
  onNext: () => void
}

