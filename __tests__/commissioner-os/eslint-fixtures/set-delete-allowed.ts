// FIXTURE — must NOT be reported. Map/Set .delete() is ordinary JavaScript and
// already appears on this surface (lib/commissioner-os/platform/eventBus.ts).
// A property-only selector would flag it, the rule would be called noisy, and a
// noisy rule gets removed.
const listeners = new Set<() => void>()
const cache = new Map<string, number>()
export function a(fn: () => void) {
  listeners.delete(fn)
  cache.delete('k')
}
