/** Order-insensitive equality for rule values (plain JSON). Pure. `undefined` and `null` are equal. */
function canonical(v: unknown): string {
  if (v === undefined || v === null) return 'null'
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

export function sameRuleValue(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}
