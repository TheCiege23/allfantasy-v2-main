/**
 * A lossless JSON encoding for facts the domain-OS store keeps (2026-11-21).
 *
 * `domain_os_facts.facts` is JSON, and three things a built fact can hold do not survive a JSON round trip:
 *
 *   - a `Map` becomes `{}` — every entry gone, with no error;
 *   - a `Date` becomes a string, so `getTime()` throws and a comparison quietly compares strings;
 *   - `NaN` and `±Infinity` become `null`, and `null` reads as 0 in arithmetic.
 *
 * The league value board carries all three (its roster index and free-agent levels are Maps, the dynasty context
 * holds Maps, and a player with no rate has a non-finite one), so it is stored through this codec: each is written
 * as a small tagged object and restored exactly. Anything else JSON already keeps is written as is.
 *
 * ⚠ ONLY PLAIN DATA. A class instance (other than Map / Date) or a function has no faithful encoding; `encodeFacts`
 * throws on one rather than storing a fact that would come back as something else.
 */

const MAP = '__afMap'
const DATE = '__afDate'
const NUM = '__afNum'

export type EncodedFacts = unknown

export function encodeFacts(value: unknown): EncodedFacts {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : { [NUM]: Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity' }
  }
  if (value === undefined) return undefined
  if (value instanceof Date) return { [DATE]: Number.isNaN(value.getTime()) ? null : value.toISOString() }
  if (value instanceof Map) return { [MAP]: [...value].map(([k, v]) => [encodeFacts(k), encodeFacts(v)]) }
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : encodeFacts(v)))
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`encodeFacts: ${proto?.constructor?.name ?? 'unknown'} has no faithful JSON encoding`)
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = encodeFacts(v)
    }
    return out
  }
  throw new Error(`encodeFacts: a ${typeof value} has no faithful JSON encoding`)
}

export function decodeFacts<T = unknown>(value: EncodedFacts): T {
  return decode(value) as T
}

function decode(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(decode)
  const o = value as Record<string, unknown>
  const keys = Object.keys(o)
  if (keys.length === 1) {
    if (keys[0] === MAP && Array.isArray(o[MAP])) {
      return new Map((o[MAP] as unknown[]).map((pair) => {
        const [k, v] = pair as [unknown, unknown]
        return [decode(k), decode(v)]
      }))
    }
    if (keys[0] === DATE) return o[DATE] == null ? new Date(NaN) : new Date(String(o[DATE]))
    if (keys[0] === NUM) return o[NUM] === 'NaN' ? NaN : o[NUM] === 'Infinity' ? Infinity : -Infinity
  }
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = decode(o[k])
  return out
}
