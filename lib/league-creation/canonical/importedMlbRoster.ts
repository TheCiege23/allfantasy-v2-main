const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Use source constraints, never a census of the players currently occupying slots. */
export function importedMlbRoster(settings: unknown) {
  const espn = record(record(settings).espn_settings)
  if (Object.keys(espn).length) {
    const r = record(espn.rosterSettings)
    if (r.isBenchUnlimited || Object.keys(record(r.lineupSlotStatLimits)).length)
      throw new Error('Imported unlimited bench or pitching limits cannot be reproduced exactly.')
    const labels: Record<string,string> = {'0':'C','1':'1B','2':'2B','3':'3B','4':'SS','5':'OF','6':'MI','7':'CI','12':'UTIL','13':'P','14':'SP','15':'RP','16':'BN','17':'IR'}
    const slots: Record<string,number> = {}
    let ir=0; let bench=0
    for (const [id,n] of Object.entries(record(r.lineupSlotCounts))) {
      if(n===0) continue
      if (!labels[id] || typeof n!=='number' || !Number.isSafeInteger(n) || n<0) throw new Error(`Imported roster slot ${id} cannot be reproduced.`)
      if(id==='17') ir=n; else if(id==='16') bench=n; else slots[labels[id]]=n
    }
    if(!Object.keys(slots).length) throw new Error('The import has no verified baseball roster constraints.')
    return {starterSlots:slots,benchSlots:bench,irSlots:ir,taxiSlots:0,source:'IMPORTED_EXACT',config:{sections:[{key:'imported',label:'Imported roster',slots:{...slots,BN:bench,IR:ir}}]}}
  }
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
