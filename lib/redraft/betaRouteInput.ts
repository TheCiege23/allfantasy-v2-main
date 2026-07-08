export type RedraftPositiveIntegerParseResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string }

export function parseOptionalRedraftPositiveInteger(
  raw: unknown,
  fieldName: string,
): RedraftPositiveIntegerParseResult {
  if (raw == null || raw === '') return { ok: true, value: null }

  const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
  if (!Number.isInteger(numeric) || numeric < 1) {
    return { ok: false, error: `${fieldName} must be a positive integer` }
  }

  return { ok: true, value: numeric }
}
