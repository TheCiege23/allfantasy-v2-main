/**
 * The words of an integrity alert, for every channel. Pure — no IO — so the copy is testable.
 *
 * ⚠ NAMES GO IN THE TITLE. A lock screen shows the title and a line or two of body, so a body that
 * opens with the AI note never reaches who is involved. The title carries the managers; the body
 * opens with what moved and the size of the gap, built from the evidence rather than the model's
 * prose; the note follows for whoever opens it.
 *
 * ⚠ THE TEXT MESSAGE HAS NO EMOJI. One emoji switches an SMS to UCS-2 and roughly halves what fits in
 * a segment, and a text has to carry the link.
 */

type Asset = { name?: string }
type Side = { teamName?: string }

export type IntegrityAlertInput = {
  flagType: "collusion" | "tanking"
  /** Manager names in flag order, already resolved. May be empty. */
  managers: string[]
  evidence: unknown
  summary: string
  leagueName: string | null
  /** Absolute link to the flag. */
  url: string
}

export type IntegrityAlertCopy = { title: string; body: string; sms: string }

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** "Bowers, 2027 1st" — or "Bowers, 2027 1st +2 more" past two, so a push line stays one line. */
export function assetList(assets: unknown): string | null {
  if (!Array.isArray(assets)) return null
  const names = (assets as Asset[]).map((a) => (typeof a?.name === "string" ? a.name.trim() : "")).filter(Boolean)
  if (names.length === 0) return null
  const shown = names.slice(0, 2).join(", ")
  return names.length > 2 ? `${shown} +${names.length - 2} more` : shown
}

export function buildIntegrityAlertCopy(input: IntegrityAlertInput): IntegrityAlertCopy {
  const ev = record(input.evidence)
  const summary = input.summary.trim()
  const where = input.leagueName?.trim() ? ` in ${input.leagueName.trim()}` : ""

  if (input.flagType === "tanking") {
    const who = input.managers[0] ?? (typeof ev.teamName === "string" && ev.teamName.trim() ? ev.teamName.trim() : null)
    return {
      title: who ? `⚠️ Possible tanking · ${who}` : "⚠️ Potential tanking detected",
      body: who ? `Manager: ${who}. ${summary}`.trim() : summary,
      sms: who
        ? `AllFantasy: Possible tanking${where} by ${who}. Review: ${input.url}`
        : `AllFantasy: A lineup${where} was flagged for review. Review: ${input.url}`,
    }
  }

  // Managers first; the team names are a fallback so a flag never reads "Side A".
  const t1 = record(ev.team1) as Side
  const t2 = record(ev.team2) as Side
  const a = input.managers[0] ?? t1.teamName?.trim() ?? null
  const b = input.managers[1] ?? t2.teamName?.trim() ?? null
  const pair = a && b ? `${a} ↔ ${b}` : null

  const gapPct = typeof ev.valueDifferentialPct === "number" && Number.isFinite(ev.valueDifferentialPct)
    ? Math.round(Math.abs(ev.valueDifferentialPct))
    : 0
  const gap = gapPct > 0 ? `${gapPct}% value gap` : null

  // Side A received what side B gave (assetsTeam2Gave), for what side A gave (assetsTeam1Gave).
  const got = assetList(ev.assetsTeam2Gave)
  const gave = assetList(ev.assetsTeam1Gave)
  const moved = a && got && gave ? `${a} got ${got} for ${gave}` : null
  const lead = [moved, gap].filter(Boolean).join(" · ")
  const opener = lead || (a && b ? `Trade between ${a} and ${b}` : "")

  return {
    title: pair ? `⚠️ Possible collusion · ${pair}` : "⚠️ Potential collusion detected",
    body: opener ? `${opener}. ${summary}`.trim() : summary,
    sms: a && b
      ? `AllFantasy: Possible collusion${where} between ${a} and ${b}${gap ? `, ${gap}` : ""}. Review: ${input.url}`
      : `AllFantasy: A trade${where} was flagged for review. Review: ${input.url}`,
  }
}
