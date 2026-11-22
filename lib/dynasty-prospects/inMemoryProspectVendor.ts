import type {
  ProspectSport,
  ProspectVendorAdapter,
  VendorProspectRecord,
  VendorRookieEligibilityRecord,
} from './vendorAdapter'

/**
 * An in-memory `ProspectVendorAdapter` for tests and local wiring. It makes no network call — it
 * serves whatever it was constructed with — so it is safe to import anywhere, and it is the
 * reference for what a real vendor adapter returns.
 */
export class InMemoryProspectVendor implements ProspectVendorAdapter {
  readonly source: string
  readonly sports: readonly ProspectSport[]
  private prospects: Partial<Record<ProspectSport, VendorProspectRecord[]>>
  private eligibility: Map<string, VendorRookieEligibilityRecord[]>

  constructor(opts: {
    source: string
    prospects?: Partial<Record<ProspectSport, VendorProspectRecord[]>>
    eligibility?: Array<{ sport: ProspectSport; season: number; records: VendorRookieEligibilityRecord[] }>
  }) {
    this.source = opts.source
    this.prospects = { ...(opts.prospects ?? {}) }
    this.eligibility = new Map((opts.eligibility ?? []).map((e) => [`${e.sport}:${e.season}`, e.records]))
    const sports = new Set<ProspectSport>(Object.keys(this.prospects) as ProspectSport[])
    for (const e of opts.eligibility ?? []) sports.add(e.sport)
    this.sports = [...sports]
  }

  /** Replace one sport's prospects, e.g. to simulate the vendor changing a record between runs. */
  setProspects(sport: ProspectSport, records: VendorProspectRecord[]): void {
    this.prospects[sport] = records
  }

  async fetchProspects(sport: ProspectSport): Promise<VendorProspectRecord[]> {
    return (this.prospects[sport] ?? []).map((r) => ({ ...r }))
  }

  async fetchRookieEligibility(sport: ProspectSport, season: number): Promise<VendorRookieEligibilityRecord[]> {
    return (this.eligibility.get(`${sport}:${season}`) ?? []).map((r) => ({ ...r }))
  }
}
