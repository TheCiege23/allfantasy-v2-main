/** "1.03" — a round and a slot, the way managers say a pick. Client-safe. */
export function pickSlotLabel(round: number, slot: number): string {
  return `${round}.${String(slot).padStart(2, '0')}`
}
