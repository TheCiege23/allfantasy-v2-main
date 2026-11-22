export type DraftPoolMergeIdentity = {
  name: string
  looseName: string
  position: string
  team: string
}

/**
 * Lookup for the pool merge's original first-match rule.
 * Namespaces stay separate: canonical matches canonical, loose matches loose.
 * Blank position/team retain their wildcard meaning. Refresh after enrichment
 * because filling a blank team changes which later rows may match.
 */
export class DraftPoolMergeIndex {
  private readonly names = new Map<string, Set<number>>()
  private readonly looseNames = new Map<string, Set<number>>()
  private readonly identities = new Map<number, DraftPoolMergeIdentity>()

  private add(map: Map<string, Set<number>>, key: string, index: number): void {
    if (!key) return
    let bucket = map.get(key)
    if (!bucket) { bucket = new Set(); map.set(key, bucket) }
    bucket.add(index)
  }

  upsert(index: number, identity: DraftPoolMergeIdentity): void {
    const previous = this.identities.get(index)
    if (previous?.name !== identity.name) this.names.get(previous?.name ?? '')?.delete(index)
    if (previous?.looseName !== identity.looseName) this.looseNames.get(previous?.looseName ?? '')?.delete(index)
    this.identities.set(index, identity)
    this.add(this.names, identity.name, index)
    this.add(this.looseNames, identity.looseName, index)
  }

  find(query: DraftPoolMergeIdentity): number {
    let best = -1
    const visit = (bucket: Set<number> | undefined) => {
      if (!bucket) return
      for (const index of bucket) {
        if (best >= 0 && index >= best) continue
        const row = this.identities.get(index)!
        if (query.position && row.position && query.position !== row.position) continue
        if (query.team && row.team && query.team !== row.team) continue
        best = index
      }
    }
    visit(this.names.get(query.name))
    if (query.looseName) visit(this.looseNames.get(query.looseName))
    return best
  }
}
