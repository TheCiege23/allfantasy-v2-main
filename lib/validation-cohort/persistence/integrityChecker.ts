/**
 * Fantasy OS Suite — Phase V8.1: evidence integrity checker (engineering-only, Part 5).
 *
 * Pure checks over the persisted corpus. Engineering diagnostics only — never customer-facing. Surfaces
 * problems for review; it does not repair or tune anything.
 */
import type { PersistedLeagueEvidence, PersistedPortfolio } from './evidenceStore'

export type IntegrityCode =
  | 'duplicate-league'
  | 'orphan-league'
  | 'broken-league-chain'
  | 'incomplete-roster'
  | 'transaction-inconsistency'
  | 'historical-continuity-gap'
  | 'impossible-roster-reference'

/** Severity taxonomy (Part 5) — a provider limitation is NOT an application defect. */
export type IntegritySeverity =
  | 'informational-coverage-gap'
  | 'partial-import'
  | 'recoverable-sync-defect'
  | 'corrupt-persisted-evidence'
  | 'provider-limitation'

export type IntegrityFinding = {
  code: IntegrityCode
  severity: IntegritySeverity
  leagueReference?: string
  detail: string
}

const SEVERITY: Record<IntegrityCode, IntegritySeverity> = {
  'duplicate-league': 'corrupt-persisted-evidence',
  'orphan-league': 'corrupt-persisted-evidence',
  'transaction-inconsistency': 'corrupt-persisted-evidence',
  'impossible-roster-reference': 'corrupt-persisted-evidence',
  'incomplete-roster': 'partial-import',
  'broken-league-chain': 'informational-coverage-gap',
  'historical-continuity-gap': 'informational-coverage-gap',
}

export function checkEvidenceIntegrity(
  leagues: PersistedLeagueEvidence[],
  portfolios: PersistedPortfolio[],
): IntegrityFinding[] {
  const findings: IntegrityFinding[] = []
  const add = (code: IntegrityCode, detail: string, leagueReference?: string) =>
    findings.push({ code, severity: SEVERITY[code], detail, leagueReference })

  const byRef = new Map<string, PersistedLeagueEvidence>()
  for (const l of leagues) {
    if (byRef.has(l.leagueReference)) add('duplicate-league', 'league reference persisted more than once', l.leagueReference)
    byRef.set(l.leagueReference, l)
  }

  // Orphan detection: a PERSISTED league that no portfolio references (a league with no owner in the
  // corpus). Genuine corruption — distinct from "discovered-but-not-yet-imported", which is expected
  // under bounded/incremental import and is NOT flagged.
  const referenced = new Set<string>()
  for (const p of portfolios) for (const ref of p.leagueRefs) referenced.add(ref)
  for (const l of byRef.values()) {
    if (!referenced.has(l.leagueReference)) add('orphan-league', 'persisted league is referenced by no portfolio', l.leagueReference)
  }

  for (const l of byRef.values()) {
    // Broken chain: a prior-season reference not persisted. On a COMPLETE import a true break; on a
    // bounded/partial import an expected coverage gap (severity informational).
    if (l.previousLeagueRef && !byRef.has(l.previousLeagueRef)) {
      add('broken-league-chain', `previous-league ${l.previousLeagueRef} is not persisted (true break on a full import; a coverage gap on a partial one)`, l.leagueReference)
    }
    if (l.facts && (l.facts.numTeams <= 0 || l.facts.activeManagers <= 0)) {
      add('incomplete-roster', `numTeams=${l.facts.numTeams} activeManagers=${l.facts.activeManagers}`, l.leagueReference)
    }
    if (l.facts && l.facts.totalTransactions < l.facts.totalTrades + l.facts.totalWaiverClaims) {
      add('transaction-inconsistency', `totalTransactions=${l.facts.totalTransactions} < trades(${l.facts.totalTrades})+waivers(${l.facts.totalWaiverClaims})`, l.leagueReference)
    }

    // Bundle-level checks (V8.2) — only when the full evidence bundle was imported.
    if (l.bundle) {
      const rosterIds = new Set(l.bundle.rosterMembership.map((r) => r.rosterId))
      if (rosterIds.size > 0) {
        for (const t of l.bundle.transactions) {
          for (const r of t.participatingRosterIds) {
            if (!rosterIds.has(r)) {
              add('impossible-roster-reference', `transaction references roster ${r} not in membership`, l.leagueReference)
              break
            }
          }
        }
      }
      // NOTE: duplicate transaction detection is done at FETCH time by provider transaction_id (see
      // fetchEvidence). A normalized-shape check is deliberately NOT done here — the neutral model omits
      // player ids, so two genuinely-distinct same-shape transactions are indistinguishable and a
      // shape-based check would false-positive on real data.
    }
  }

  // Historical-continuity gap: a chain whose linked seasons are not consecutive years.
  for (const l of byRef.values()) {
    if (l.previousLeagueRef && byRef.has(l.previousLeagueRef)) {
      const prev = byRef.get(l.previousLeagueRef)!
      const gap = Number(l.season) - Number(prev.season)
      if (Number.isFinite(gap) && gap !== 1) {
        add('historical-continuity-gap', `season ${prev.season} → ${l.season} is not consecutive (gap ${gap})`, l.leagueReference)
      }
    }
  }

  return findings
}

/** Group findings by severity (for the Integrity Findings Report). */
export function summarizeIntegrityBySeverity(findings: IntegrityFinding[]): Record<IntegritySeverity, number> {
  const out: Record<IntegritySeverity, number> = {
    'informational-coverage-gap': 0,
    'partial-import': 0,
    'recoverable-sync-defect': 0,
    'corrupt-persisted-evidence': 0,
    'provider-limitation': 0,
  }
  for (const f of findings) out[f.severity]++
  return out
}
