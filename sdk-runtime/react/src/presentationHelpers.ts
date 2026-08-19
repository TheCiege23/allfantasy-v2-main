/**
 * Decision OS — Phase 7.8 React Adapter: presentation field selection.
 *
 * Pure structural selection only — picks which ALREADY-COMPUTED field to
 * display based on which entity-type shape arrived. Never computes a score,
 * severity, or color; those were fully resolved server-side (Phase 7.2
 * presentation-adapters.ts) before this data ever reached the wire.
 */

import type { SeverityDefinition } from '../../../lib/decision-os/presentation/types'
import type { WidgetPresentationData } from './types'

export interface WidgetHeadline {
  score: number
  severity: SeverityDefinition
  label: string
}

export function extractHeadline(data: WidgetPresentationData): WidgetHeadline {
  switch (data.entityType) {
    case 'league':
      return { score: data.healthScore, severity: data.healthSeverity, label: 'League Health' }
    case 'manager':
      return { score: data.healthScore, severity: data.healthSeverity, label: 'Manager Health' }
    case 'platform':
      return { score: data.platformHealthScore, severity: data.platformHealthSeverity, label: 'Platform Health' }
  }
}
