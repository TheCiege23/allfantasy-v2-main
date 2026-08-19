/**
 * Decision OS core — generic shadow parity (domain-agnostic).
 *
 * The Parity Gate's keyed comparison: a Decision OS output set vs a legacy output set, keyed and
 * field-compared, producing a pass/fail + human-readable diffs. The slice supplies the key + the
 * fields to compare; this engine knows nothing about the domain. Pure; no I/O.
 */
export interface ShadowParityResult {
  passed: boolean
  diffs: string[]
  comparedKeys: number
}

export interface KeyedParityField<T> {
  /** Label used in the diff message, e.g. "recommendedAction". */
  label: string
  valueOf: (item: T) => unknown
}

export interface KeyedParityConfig<T> {
  keyOf: (item: T) => string
  /** Noun used in diff messages, e.g. "slot". */
  entityLabel: string
  fields: KeyedParityField<T>[]
}

/**
 * Compare the Decision OS set (`left`) against the legacy set (`right`). A key present on only one
 * side, or a differing field on a shared key, is a diff. Parity passes iff there are zero diffs.
 */
export function compareKeyedParity<T>(left: T[], right: T[], config: KeyedParityConfig<T>): ShadowParityResult {
  const { keyOf, entityLabel, fields } = config
  const leftByKey = new Map(left.map((a) => [keyOf(a), a]))
  const rightByKey = new Map(right.map((a) => [keyOf(a), a]))
  const diffs: string[] = []

  for (const [k, a] of leftByKey) {
    const b = rightByKey.get(k)
    if (!b) {
      diffs.push(`${entityLabel} ${k}: present in Decision OS, absent in legacy`)
      continue
    }
    for (const f of fields) {
      if ((f.valueOf(a) ?? null) !== (f.valueOf(b) ?? null)) diffs.push(`${entityLabel} ${k}: ${f.label} differs`)
    }
  }
  for (const k of rightByKey.keys()) {
    if (!leftByKey.has(k)) diffs.push(`${entityLabel} ${k}: present in legacy, absent in Decision OS`)
  }

  return { passed: diffs.length === 0, diffs, comparedKeys: Math.max(leftByKey.size, rightByKey.size) }
}
