'use client'

import { Label } from '@/components/ui/label'
import type { LeagueCreationWizardState, WizardAISettings } from '@/lib/league-creation-wizard/types'

export type Step7AISettingsProps = {
  state: LeagueCreationWizardState
  onAISettingsChange: (patch: Partial<WizardAISettings>) => void
  onBack: () => void
  onNext: () => void
}

