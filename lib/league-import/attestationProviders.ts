/**
 * Commissioner Import Attestation UI phase — single source of truth for
 * "which providers require a commissioner attestation for a full-league
 * commit," safe to import from BOTH server code (`commissionerGate.ts`)
 * and client components (the attestation UI). `commissionerGate.ts` itself
 * has server-only dependencies (`@/lib/prisma`, decrypted-auth lookups) and
 * must never be imported into a `'use client'` file — this file has none,
 * so it can be imported from either side without risk.
 *
 * `commissionerGate.ts` re-exports this same constant (does not redefine
 * it) so every existing import of
 * `MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER` from `commissionerGate`
 * keeps working unchanged — this is purely a visibility fix, not a second
 * classification list to keep in sync.
 */
import type { ImportProvider } from './types'

/**
 * Providers that went through REAL, active membership verification but have
 * no way to determine commissioner status (Import Security Closure phase
 * finding, applies identically to MFL, ESPN, and Yahoo). A full-league
 * commit for any of these requires an explicit, recorded attestation.
 */
export const MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER: readonly ImportProvider[] = [
  'mfl',
  'espn',
  'yahoo',
]

/** True when a full-league commit for this provider requires commissioner attestation. */
export function providerRequiresCommissionerAttestation(provider: ImportProvider): boolean {
  return MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER.includes(provider)
}
