/**
 * Decision OS — Phase 7.11 Browser Iframe Adapter: nonce generation.
 *
 * Produces the nonce that binds one specific message exchange to one
 * specific widget instance (PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md §2).
 * Phase 7.9's `isValidNonceFormat` only validates a nonce's *shape*; actual
 * generation needs real randomness, which is why this lives in the browser
 * adapter layer rather than the framework-agnostic core.
 */

import { isValidNonceFormat } from '../protocol'

/** The subset of the Web Crypto API this helper depends on. */
export type RandomSource = Pick<Crypto, 'getRandomValues'>

const NONCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const NONCE_LENGTH = 24

/**
 * Generates a nonce satisfying `isValidNonceFormat`. Defaults to the global
 * `crypto` (available in every browser and modern Node); injectable for
 * deterministic tests.
 */
export function generateNonce(randomSource: RandomSource = crypto): string {
  const bytes = new Uint8Array(NONCE_LENGTH)
  randomSource.getRandomValues(bytes)

  let nonce = ''
  for (let i = 0; i < NONCE_LENGTH; i++) {
    nonce += NONCE_ALPHABET[bytes[i] % NONCE_ALPHABET.length]
  }

  /* istanbul ignore next -- NONCE_ALPHABET/NONCE_LENGTH always satisfy the format regex by construction */
  if (!isValidNonceFormat(nonce)) {
    throw new Error('generateNonce produced a nonce failing isValidNonceFormat — this indicates a bug in NONCE_ALPHABET/NONCE_LENGTH.')
  }

  return nonce
}
