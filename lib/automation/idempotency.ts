import crypto from "crypto"

function normalizeIdempotencyPart(value: unknown): string {
  if (value === null || value === undefined) return "none"
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/** Deterministic, stable key material (hash separately via `hashIdempotencyKey` when a shorter DB key is needed). */
export function buildIdempotencyKey(
  parts: Array<string | number | Date | null | undefined>
): string {
  return parts.map(normalizeIdempotencyPart).join("|")
}

export function hashIdempotencyKey(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex")
}
