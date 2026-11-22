import { prisma } from '@/lib/prisma'
import type { AutomationTrigger } from '@/lib/specialty-automation/types'
import { resolveSpecialtyConceptKey, isSpecialtyConcept } from '@/lib/specialty-automation/types'

type AutomationValidation = { ok: true } | { ok: false; reason: string }

/**
 * Ensure `conceptRules` shape is safe before handlers read `extensions` and other keys.
 */
export function validateConceptRulesShape(conceptRules: Record<string, unknown> | null): AutomationValidation {
  if (!conceptRules) return { ok: true }
  const ext = conceptRules.extensions
  if (ext !== undefined && ext !== null && (typeof ext !== 'object' || Array.isArray(ext))) {
    return { ok: false, reason: 'invalid_concept_rules_extensions' }
  }
  return { ok: true }
}

/**
 * Block automation for archived leagues and invalid seasons.
 */
export async function validateAutomationContext(input: {
  leagueId: string
  season: number
  trigger: AutomationTrigger
}): Promise<AutomationValidation> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: {
      id: true,
      status: true,
      season: true,
      settings: true,
      leagueType: true,
      leagueVariant: true,
      guillotineMode: true,
      survivorMode: true,
    },
  })
  if (!league) return { ok: false, reason: 'league_not_found' }

  const st = league.status?.toLowerCase()
  if (st === 'archived' || st === 'deleted') {
    return { ok: false, reason: 'league_inactive' }
  }

  if (input.season < 2000 || input.season > 2100) {
    return { ok: false, reason: 'invalid_season' }
  }

  const concept = resolveSpecialtyConceptKey(league)
  if (!isSpecialtyConcept(concept) && input.trigger !== 'onManualRun') {
    return { ok: false, reason: 'not_specialty_concept' }
  }

  return { ok: true }
}
