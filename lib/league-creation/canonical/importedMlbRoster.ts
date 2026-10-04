const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Use source constraints, never a census of the players currently occupying slots. */
export function importedMlbRoster(settings: unknown) {
  const info = record(record(record(settings).fantrax_settings).rosterInfo)
  const constraints = record(info.positionConstraints)
  const slots: Record<string, number> = {}
  const supported = new Set(['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'P', 'UT', 'UTIL', 'CI', 'MI'])
  for (const [position, raw] of Object.entries(constraints)) {
    const count = record(raw).maxActive
    if (count === 0) continue
    if (!supported.has(position) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Imported roster slot ${position} cannot be reproduced. Review the source roster rules before native creation.`)
    }
    slots[position === 'UT' ? 'UTIL' : position] = count
  }
  if (!Object.keys(slots).length) throw new Error('The import has no verified baseball roster constraints. Refresh it before making it native.')
  const bench = info.maxTotalReservePlayers
  if (typeof bench !== 'number' || !Number.isSafeInteger(bench) || bench < 0) throw new Error('The imported bench limit could not be verified.')
  const totalActive = Object.values(slots).reduce((sum, count) => sum + count, 0)
  if (typeof info.maxTotalActivePlayers === 'number' && totalActive !== info.maxTotalActivePlayers) throw new Error('The source has a combined lineup limit that native slots cannot reproduce. Review the roster settings.')
  if (typeof info.maxTotalPlayers === 'number' && totalActive + bench !== info.maxTotalPlayers) throw new Error('The source has additional roster limits that require review before native creation.')
  const allSlots = { ...slots, BN: bench }
  return { starterSlots: slots, benchSlots: bench, irSlots: 0, taxiSlots: 0, source: 'IMPORTED_EXACT', config: { sections: [{ key: 'imported', label: 'Imported roster', slots: allSlots }] } }
}
