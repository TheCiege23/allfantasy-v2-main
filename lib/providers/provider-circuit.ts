/**
 * A circuit breaker for outbound provider calls.
 *
 * Blocker B12 says "provider budget/circuit-breaker absent for fantasy providers".
 * Half of that was already false when checked: `lib/workers/rate-limit-manager.ts`
 * declares budgets for sleeper/yahoo/espn/mfl/fantrax, and `lib/sports-router.ts`
 * runs a real breaker over ITS sources. What is genuinely missing is a breaker on
 * the fantasy ingestion paths, and this is it.
 *
 * 🛑 WHY A BREAKER AND NOT MORE RATE LIMITING. `SleeperLeagueFetchService` already
 * bounds CONCURRENCY (`pLimit(10)`) and retries with backoff. Neither helps when the
 * provider is refusing: one league fans out ~40 requests, each retried 3x, and the
 * durable sync now runs a 235-league rotation every 10 minutes. A provider outage
 * therefore costs ~28,000 requests per lap against a host already saying no — and the
 * retries make it worse, not better. Concurrency limits how many are in flight;
 * only a breaker stops them being made at all.
 *
 * ⚠ IN-MEMORY, AND THAT IS DELIBERATE. The obvious alternative is to consult the
 * DB-backed `rateLimitManager` per request, but that adds a round-trip to every one
 * of those ~40 calls per league — the breaker would then add load of exactly the kind
 * it exists to shed. Per-process state is weaker (each instance learns separately)
 * and is the right trade here. The same reasoning is already applied one file over:
 * `sports-router.ts` keeps its breaker in a module-level Map.
 *
 * ⚠ A 404 IS NOT A FAILURE. `fetchSleeperJson` treats 404 and an empty body as
 * legitimate "no data" — a week beyond the end of a season answers that way on every
 * healthy sync. Counting those would open the circuit during normal operation, which
 * is worse than having no breaker: it would stop real imports for a non-problem.
 * Only 429, 5xx and transport failures count.
 */

export interface ProviderCircuitOptions {
  /** Consecutive hard failures before the circuit opens. */
  threshold?: number
  /** How long the circuit stays open before a probe is allowed through. */
  cooldownMs?: number
}

interface CircuitState {
  failures: number
  openUntil: number
}

const DEFAULT_THRESHOLD = 5
const DEFAULT_COOLDOWN_MS = 60_000

const circuits = new Map<string, CircuitState>()

function keyFor(provider: string): string {
  return provider.trim().toLowerCase()
}

function stateFor(provider: string): CircuitState {
  const key = keyFor(provider)
  let state = circuits.get(key)
  if (!state) {
    state = { failures: 0, openUntil: 0 }
    circuits.set(key, state)
  }
  return state
}

/**
 * True while the provider is being given a rest. Reading this also expires an elapsed
 * cooldown, so the next call after the window is allowed through as a probe rather
 * than needing a separate half-open concept.
 */
export function isProviderCircuitOpen(
  provider: string,
  options: ProviderCircuitOptions = {},
): boolean {
  const state = stateFor(provider)
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  if (state.failures < threshold) return false
  if (Date.now() >= state.openUntil) {
    // Cooldown elapsed. Drop to threshold-1 rather than 0 so a provider that is still
    // down re-opens on its NEXT failure instead of having to earn all N again — an
    // outage should not need a fresh burst of traffic to be re-detected.
    state.failures = Math.max(0, threshold - 1)
    state.openUntil = 0
    return false
  }
  return true
}

/** A call that came back. Clears the count — recovery is complete, not gradual. */
export function recordProviderSuccess(provider: string): void {
  const state = stateFor(provider)
  state.failures = 0
  state.openUntil = 0
}

/**
 * A HARD failure — 429, 5xx or transport. Never call this for a 404 or an empty body.
 */
export function recordProviderFailure(
  provider: string,
  options: ProviderCircuitOptions = {},
): void {
  const state = stateFor(provider)
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS
  state.failures += 1
  if (state.failures >= threshold) state.openUntil = Date.now() + cooldownMs
}

/** Whether an HTTP status should count against the circuit. 404 deliberately does not. */
export function isCircuitFailureStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/** Test seam. Never call from application code. */
export function __resetProviderCircuits(): void {
  circuits.clear()
}
