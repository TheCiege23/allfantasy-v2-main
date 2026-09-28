/** Vendor aliases for common player-name suffixes. Used only within the same sport. */
export function injuryNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\./g, '').replace(/\s+(jr|sr|ii|iii|iv)$/, '').replace(/\s+/g, ' ')
}

export function injuryNameVariants(name: string): string[] {
  const base = name.trim().replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, '')
  return [...new Set([name.trim(), base, `${base} Jr.`, `${base} Jr`, `${base} Sr.`, `${base} Sr`, `${base} II`, `${base} III`, `${base} IV`])]
}
