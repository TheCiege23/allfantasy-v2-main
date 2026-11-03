/**
 * Share only concurrent cold builds, including server-page prewarming and pool API reads.
 * The global registry also spans Next server bundles in the same process. Settled work is
 * removed immediately: this is not a result cache and cannot keep a roster change stale.
 */
type BuildRegistry = Map<string, Promise<unknown>>
const registryHost = globalThis as typeof globalThis & { __afDraftPoolColdBuilds?: BuildRegistry }

export function draftPoolBuildKey(leagueId: string, options: unknown): string {
  return JSON.stringify([leagueId, options], (_key, value) => {
    if (value instanceof Set) return [...value].sort()
    if (value instanceof Map) return [...value.entries()].sort()
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    }
    return value
  })
}

export function shareDraftPoolBuild<T>(key: string, build: () => Promise<T>): Promise<T> {
  const registry = registryHost.__afDraftPoolColdBuilds ??= new Map()
  const existing = registry.get(key)
  if (existing) return existing as Promise<T>
  const pending = Promise.resolve().then(build).finally(() => {
    if (registry.get(key) === pending) registry.delete(key)
  })
  registry.set(key, pending)
  return pending
}
