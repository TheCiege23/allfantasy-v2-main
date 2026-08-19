/**
 * Fantasy OS Phase 5 — schema-drift protection at the adapter boundary (Part 14).
 *
 * Providers change payloads. `validateShape` structurally rejects malformed records BEFORE normalization so
 * malformed data is never persisted as valid. On failure the caller preserves the prior certified snapshot,
 * marks the provider degraded, and records a redacted schema PATH — never the full (possibly sensitive) payload.
 */
export type FieldSpec = { key: string; type: 'string' | 'number' | 'boolean' | 'object' | 'array'; required: boolean }

export type ShapeValidation =
  | { ok: true }
  | { ok: false; schemaPath: string; reason: string }

/** Validate one record against a minimal field spec. Returns a redacted path, never field values. */
export function validateShape(record: unknown, spec: FieldSpec[], path = '$'): ShapeValidation {
  if (record == null || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, schemaPath: path, reason: 'expected object' }
  }
  const obj = record as Record<string, unknown>
  for (const f of spec) {
    const present = Object.prototype.hasOwnProperty.call(obj, f.key) && obj[f.key] != null
    if (!present) {
      if (f.required) return { ok: false, schemaPath: `${path}.${f.key}`, reason: 'missing required field' }
      continue
    }
    const v = obj[f.key]
    const actual = Array.isArray(v) ? 'array' : typeof v
    if (actual !== f.type) return { ok: false, schemaPath: `${path}.${f.key}`, reason: `expected ${f.type}, got ${actual}` }
  }
  return { ok: true }
}

/** Validate a batch; returns the first drift found (redacted) or ok with a rejected count for partials. */
export function validateBatch(records: unknown[], spec: FieldSpec[]): { drift: ShapeValidation | null; rejected: number } {
  let rejected = 0
  let firstDrift: ShapeValidation | null = null
  records.forEach((r, i) => {
    const v = validateShape(r, spec, `$[${i}]`)
    if (!v.ok) {
      rejected++
      if (!firstDrift) firstDrift = v
    }
  })
  return { drift: firstDrift, rejected }
}
