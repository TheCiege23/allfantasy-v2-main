/**
 * A stand-in FULL-BLOCK state for tests of the dormant full-block machinery.
 *
 * Since November 2026 no real state is full-block (Washington moved to paid-block on counsel's
 * confirmation), so the gate, the account lock and the machine-credential exemption have no
 * live state to exercise. The machinery is kept so a future full-block state is a one-line
 * `restrictedStates.ts` edit — and these suites keep it honest by pretending Washington is
 * still that state, which is the shape everything was built and measured for.
 *
 * Use inside a hoisted mock:
 *
 *   vi.mock("@/lib/geo/restrictedStates", async (orig) =>
 *     (await import("./helpers/standInFullBlockState")).withStandInFullBlock(await orig()))
 *
 * ⚠ It overrides the exported predicates only. `RESTRICTED_STATES` itself still says WA is
 * paid-block, so a page that lists states from the array is NOT covered by this stand-in.
 */
type RestrictedStatesModule = typeof import("@/lib/geo/restrictedStates")

export const STAND_IN_FULL_BLOCK_STATE = "WA"

export function withStandInFullBlock(real: RestrictedStatesModule): RestrictedStatesModule {
  const isStandIn = (code: string | null | undefined) => (code ?? "").toUpperCase() === STAND_IN_FULL_BLOCK_STATE
  return {
    ...real,
    hasFullBlockStates: () => true,
    isFullyBlocked: (code) => isStandIn(code) || real.isFullyBlocked(code),
    isPaidBlocked: (code) => !isStandIn(code) && real.isPaidBlocked(code),
    getRestrictionLevel: (code) => (isStandIn(code) ? "full_block" : real.getRestrictionLevel(code)),
  }
}
