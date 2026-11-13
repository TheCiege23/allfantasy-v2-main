'use client';

import type { WizardStepId } from '@/lib/league-creation-wizard/types';

export interface CreateLeagueViewProps {
  userId: string;
  /** Open the wizard on a specific step (e.g. edit from review). */
  initialStep?: WizardStepId | null;
}

