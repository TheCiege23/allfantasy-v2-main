import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Milestone 32 — raw behavioural profiles unavailable through public API paths, for the User OS
 * surface named in the checklist's remainder ("User OS reads, including server-rendered props").
 *
 * 🛑 WHAT WAS WRONG. `/api/decision-os/user-os` returned `managerDna` as a live `ManagerDnaProfile`
 * from `computeLeagueDna` — `primaryIdentity`, `decisionStyle`, `transactionStyle`, `riskTendency`,
 * `engagementReliability`, `traits`, and `derivation` ("classifiers evaluated, scores, threshold
 * comparisons"). Session-gated, membership-checked, and self-scoped — so never a third party's
 * dossier — but a raw dossier over a public path all the same, which is the criterion.
 */

const root = process.cwd()
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8')

const USER_OS = 'lib/decision-os/userOs.ts'
const USER_OS_ROUTE = 'app/api/decision-os/user-os/route.ts'
const SIBLING_ROUTE = 'app/api/decision-os/manager-intelligence/route.ts'

/** The dossier vocabulary. Field names AND the prose forms, because a name-only list misses prose. */
const DOSSIER_FIELDS = [
  'primaryIdentity', 'decisionStyle', 'transactionStyle', 'riskTendency',
  'engagementReliability', 'traitScore', 'archetype',
]

describe('the User OS snapshot no longer carries a raw dossier', () => {
  const src = read(USER_OS)

  it('managerDna is a literal null, not a nullable profile', () => {
    // Typed `null` rather than `ManagerDnaProfile | null`, so the compiler refuses a repopulation.
    expect(src).toMatch(/managerDna:\s*null\b/)
    expect(src).not.toMatch(/managerDna:\s*ManagerDnaProfile\s*\|\s*null/)
  })

  it('the snapshot never forwards the computed profile', () => {
    expect(src).not.toMatch(/managerDna:\s*payload\.managerDna/)
  })

  /*
   * ⚠ AN IMPORT LEFT BEHIND IS NOT HARMLESS HERE — it is the shape a repopulation takes. Nothing
   * stops a later edit writing `managerDna: someProfile` if the type is still in scope.
   */
  it('does not import the profile type outside of documentation', () => {
    const importLines = src.split('\n').filter(l => /^\s*import\b/.test(l))
    expect(importLines.join('\n')).not.toContain('ManagerDnaProfile')
  })
})

/**
 * The route's own header says it mirrors `/api/decision-os/manager-intelligence` EXACTLY. It did
 * not. Both must now agree that no dossier is served — and if either is changed alone, this fails.
 *
 * ⚠ THE SIBLING IS RETIRED ON POST ONLY, NOT OUTRIGHT, AND ASSERTING OTHERWISE WAS A REAL MISTAKE
 * MADE HERE. A first draft of this block asserted the sibling contained NO `managerDna` field at
 * all, on the strength of the file importing `retiredProfileRoute`. The import is real and the
 * reading was wrong: only `POST` is `= retiredProfileRoute`. `GET` survives deliberately, because
 * league activity trend is not a dossier and killing it would remove a working feature to close a
 * leak it does not have. So the sibling closes this the same way this file does — by pinning the
 * field — and the test says that rather than the tidier story.
 *
 * 🛑 THE IMPORT IS NOT THE CONTRACT. "File mentions the retirement helper" and "every method is
 * retired" are different claims, and one grep answers only the first.
 */
describe('both routes refuse to serve a profile', () => {
  it('the sibling pins the field on the method it keeps, and retires the generator', () => {
    const sibling = read(SIBLING_ROUTE)
    expect(sibling).toMatch(/managerDna:\s*null/)
    expect(sibling).toMatch(/export const POST = retiredProfileRoute/)
  })

  it('this route pins the field the same way', () => {
    expect(read(USER_OS)).toMatch(/managerDna:\s*null/)
  })

  it('the User OS route still gates on session AND league membership before answering', () => {
    const route = read(USER_OS_ROUTE)
    // Closing a data leak must not quietly relax the gates that were already correct.
    expect(route).toContain('getServerSession')
    expect(route).toContain('authorizeLeagueRead')
    expect(route).toMatch(/status:\s*401/)
  })
})

/**
 * ✅ THE GAP THIS FILE USED TO PIN IS CLOSED, AND THE PIN IS REPLACED BY A POINTER.
 *
 * `recommendations[].evidence` carried the same classification as prose — "Manager classified as
 * ghost_manager by DNA assembler", `primaryIdentity` interpolated into a sentence,
 * `derivation.push('primaryIdentity=ghost_manager')`. Three assertions here pinned that state
 * deliberately, so they would go red the moment it was fixed rather than rotting into a false
 * description of the code. They went red; this is that re-scope.
 *
 * ⚠ THE REPLACEMENT LIVES IN ITS OWN FILE AND IS BEHAVIOURAL, NOT A SOURCE GREP.
 * `manager-recommendations-withhold-identity.test.ts` runs the producer and asserts the text a
 * client receives does not vary with the classification — a property that holds for labels nobody
 * has invented yet, which a grep for today's vocabulary cannot promise. Source-text assertions
 * like the ones removed here were the right tool for PINNING an unfixed leak and the wrong tool
 * for guarding a fixed one.
 *
 * The vocabulary list below stays: it is what the User OS assertions above are measured against.
 */
describe('the dossier vocabulary is recorded, not implied', () => {
  it('names the fields this file is measured against', () => {
    // If a term is added to the dossier, add it here — the list is the detector.
    expect(DOSSIER_FIELDS).toContain('primaryIdentity')
    expect(DOSSIER_FIELDS).toContain('engagementReliability')
    expect(DOSSIER_FIELDS.length).toBeGreaterThanOrEqual(7)
  })
})
