import { createHash } from 'node:crypto'

/**
 * Change detection for vendor imports: hash the payload, never trust an HTTP status
 * (CLAUDE.md "The 304 rule"). The writer compares this against the stored `payloadHash` and skips
 * the upsert when they match.
 *
 * Keys are sorted at every depth so the same record hashes the same whatever order a vendor
 * serialises it in; `undefined` is dropped (as JSON does) and a Date hashes as its ISO string.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (value instanceof Date) return JSON.stringify(Number.isNaN(value.getTime()) ? null : value.toISOString())
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const parts = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
  return `{${parts.join(',')}}`
}

export function payloadHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}
