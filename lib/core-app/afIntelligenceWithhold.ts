/**
 * WHAT A VIEWER WITHOUT AF INTELLIGENCE IS SENT (owner's decision, 2026-11-22: "the AF projections, AF
 * ADP … should be covered by AF Pro, Supreme or Commissioner").
 *
 * One rule for every surface, applied to the payload on the SERVER before it leaves — a lock drawn over
 * data the page already sent is a client-only gate (coreDepthAccess.ts). The free viewer keeps the
 * provider's projection and the provider's ADP; what goes is AllFantasy's own:
 *
 *   afEngine*   the projection engine's number, its source and its totals (the "second opinion")
 *   afAdp*      AF ADP and the draft counts behind it
 *   aiAdp*      the AllFantasy-drafts ADP (lib/adp/recomputeAllFantasyAdp.ts) and its trends
 *   afFactors   the measured factors — and the number they moved is put BACK to what it was before
 *               them (`afFactors.unadjusted`), so a locked viewer does not get AF's number unlabelled
 *
 * PURE and structural: it walks plain objects and arrays, copies only what it changes, and leaves
 * Dates, Maps and class instances alone. A payload with none of these keys comes back identical.
 */

const AF_KEY = /^(afEngine|afAdp|aiAdp)/

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

export function withholdAfIntelligence<T>(value: T): T {
  return walk(value, 0) as T
}

function walk(v: unknown, depth: number): unknown {
  if (depth > 40) return v
  if (Array.isArray(v)) {
    let changed = false
    const out = v.map((x) => {
      const y = walk(x, depth + 1)
      if (y !== x) changed = true
      return y
    })
    return changed ? out : v
  }
  if (!isPlainObject(v)) return v
  let out: Record<string, unknown> | null = null
  const ensure = () => (out ??= { ...v })
  for (const [k, x] of Object.entries(v)) {
    if (AF_KEY.test(k)) {
      delete ensure()[k]
      continue
    }
    if (k === 'afFactors') {
      const o = ensure()
      delete o.afFactors
      const unadjusted = isPlainObject(x) && isPlainObject(x.unadjusted) ? x.unadjusted : null
      if (unadjusted) for (const [field, before] of Object.entries(unadjusted)) if (field in v) o[field] = before
      continue
    }
    const y = walk(x, depth + 1)
    if (y !== x) ensure()[k] = y
  }
  return out ?? v
}

/** The gate in one call: unchanged for a viewer with AF Intelligence (or no paywall read), withheld otherwise. */
export function afIntelligenceFor<T>(value: T, access: { unlocked: boolean } | null | undefined): T {
  return access && !access.unlocked ? withholdAfIntelligence(value) : value
}
