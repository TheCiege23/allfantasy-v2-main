/** Only promote Fantrax maximums to starter slots when they account for every active spot. */
export function fantraxStarterSlots(rosterInfo: unknown): Array<{ position: string; count: number }> {
  if (!rosterInfo || typeof rosterInfo !== 'object' || Array.isArray(rosterInfo)) return []
  const info = rosterInfo as Record<string, unknown>
  const total = Number(info.maxTotalActivePlayers)
  const constraints = info.positionConstraints
  if (!Number.isInteger(total) || total < 1 || total > 60 ||
      !constraints || typeof constraints !== 'object' || Array.isArray(constraints)) return []
  const slots: Array<{ position: string; count: number }> = []
  for (const [rawPosition, raw] of Object.entries(constraints)) {
    const position = rawPosition.trim().toUpperCase()
    if (!/^[A-Z][A-Z0-9/ -]{0,15}$/.test(position) ||
        !raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const count = Number((raw as Record<string, unknown>).maxActive)
    if (!Number.isInteger(count) || count < 1 || count > 25) return []
    slots.push({ position, count })
  }
  return slots.length && slots.reduce((sum, slot) => sum + slot.count, 0) === total ? slots : []
}
