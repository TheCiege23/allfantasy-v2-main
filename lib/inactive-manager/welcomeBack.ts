/**
 * WELCOME BACK (phase 13, 2026-10-29). When a manager whose team AllFantasy (or Chimmy autopilot) was
 * running saves a lineup of their own, the mode ends — and they get one short summary of what was done
 * while they were away, read from the logs: lineup changes (`automationAuditLog`) and waiver claims
 * Chimmy autopilot made (`chimmy_autopilot.claim`).
 *
 * ⚠ NO "UNDO" FOR THE LINEUP CHANGES HERE, AND THAT IS NOT AN OMISSION. The mode ends BECAUSE the
 * owner saved a lineup, so the lineup AllFantasy left is already replaced by theirs. What can still be
 * acted on is a claim waiting to process, which the owner can cancel on the Waivers tab; the summary
 * says so.
 *
 * Pure.
 */
export type WelcomeBackInput = {
  since: Date
  endedAt: Date
  lineupChanges: Array<{ at: Date; message: string }>
  claims: Array<{ at: Date; add: string | null; drop: string | null }>
  autopilot: boolean
}

export type WelcomeBackSummary = {
  days: number
  lineupChanges: number
  claims: number
  en: { headline: string; lines: string[]; claimsNote: string | null }
  es: { headline: string; lines: string[]; claimsNote: string | null }
}

const MAX_LINES = 5
const DAY_MS = 86_400_000

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function welcomeBackSummary(input: WelcomeBackInput): WelcomeBackSummary {
  const days = Math.max(1, Math.round((input.endedAt.getTime() - input.since.getTime()) / DAY_MS))
  const n = input.lineupChanges.length
  const c = input.claims.length
  const who = input.autopilot ? 'Chimmy autopilot' : 'AllFantasy'
  const whoEs = input.autopilot ? 'el piloto automático de Chimmy' : 'AllFantasy'

  const doneEn: string[] = []
  const doneEs: string[] = []
  if (n) {
    doneEn.push(`set your lineup ${plural(n, 'time', 'times')}`)
    doneEs.push(`ajustó tu alineación ${plural(n, 'vez', 'veces')}`)
  }
  if (c) {
    doneEn.push(`made ${plural(c, 'waiver claim', 'waiver claims')}`)
    doneEs.push(`hizo ${plural(c, 'reclamo', 'reclamos')}`)
  }
  const forDays = plural(days, 'day', 'days')
  const forDaysEs = plural(days, 'día', 'días')
  const headline = doneEn.length
    ? `Welcome back. In the ${forDays} you were away, ${who} ${doneEn.join(' and ')}.`
    : `Welcome back. ${who} ran your team for ${forDays} and did not need to change anything.`
  const headlineEs = doneEs.length
    ? `Hola de nuevo. En los ${forDaysEs} que estuviste fuera, ${whoEs} ${doneEs.join(' y ')}.`
    : `Hola de nuevo. ${whoEs[0]!.toUpperCase()}${whoEs.slice(1)} llevó tu equipo durante ${forDaysEs} y no tuvo que cambiar nada.`

  const recent = [
    ...input.lineupChanges.map((l) => ({ at: l.at, en: l.message, es: l.message })),
    ...input.claims.map((cl) => ({
      at: cl.at,
      en: `Waiver claim: add ${cl.add ?? 'a player'}${cl.drop ? `, drop ${cl.drop}` : ''}.`,
      es: `Reclamo: añadir a ${cl.add ?? 'un jugador'}${cl.drop ? `, soltar a ${cl.drop}` : ''}.`,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, MAX_LINES)

  return {
    days,
    lineupChanges: n,
    claims: c,
    en: { headline, lines: recent.map((r) => r.en), claimsNote: c ? 'A claim that has not processed yet can still be cancelled on the Waivers tab.' : null },
    es: { headline: headlineEs, lines: recent.map((r) => r.es), claimsNote: c ? 'Un reclamo que aún no se procesó todavía se puede cancelar en la pestaña de agentes libres.' : null },
  }
}
