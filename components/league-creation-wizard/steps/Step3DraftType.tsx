'use client'

import type { LeagueCreationWizardState, DraftTypeId } from '@/lib/league-creation-wizard/types'

export type Step3DraftTypeProps = {
  state: LeagueCreationWizardState
  onDraftTypeChange: (draftType: DraftTypeId) => void
  onBack: () => void
  onNext: () => void
}

