/**
 * Pure maths for the Salary Cap specialty home and the free-agent bid check (handoff
 * salary/SalaryCapHome + SalaryCapBid). Inputs are the summary route's own numbers — the ledger and
 * `getFutureCapProjection` — so nothing here re-derives a cap rule the engine owns.
 */

export type CapYearInput = {
  capYear: number
  capCeiling: number
  totalCapHit: number
  deadMoney: number
  projectedSpace: number
}

export type CapLedgerInput = {
  totalCapHit: number
  deadMoneyHit: number
  rolloverUsed: number
  capSpace: number
}

const r1 = (n: number) => Math.round(n * 10) / 10

/**
 * The cap bar: active contracts, dead money and rollover credit, each as a share of the ceiling.
 * `totalCapHit` already includes dead money, so active = hit − dead. Rollover is credit on top of the
 * ceiling the engine applied, drawn after the two spends.
 */
export function capBarSegments(ledger: CapLedgerInput, ceiling: number) {
  const dead = Math.max(0, ledger.deadMoneyHit)
  const active = Math.max(0, ledger.totalCapHit - dead)
  const rollover = Math.max(0, ledger.rolloverUsed)
  const base = Math.max(1, ceiling + rollover)
  const pct = (n: number) => Math.min(100, (n / base) * 100)
  return {
    active: r1(active),
    dead: r1(dead),
    rollover: r1(rollover),
    committed: r1(ledger.totalCapHit),
    ceiling: r1(ceiling),
    activePct: pct(active),
    deadPct: pct(dead),
    rolloverPct: pct(rollover),
  }
}

export type BidPreviewRow = {
  capYear: number
  ceiling: number
  committedBefore: number
  /** This bid's cap hit in that year (0 for years past the contract). */
  bidHit: number
  left: number
  over: boolean
}

/**
 * Cap after a bid of `salary` per year for `years` years, for each projected year. The bid lands in
 * the first `years` projection rows; later rows are unchanged. `left` is the projection's own space
 * minus the bid.
 */
export function bidCapPreview(projection: CapYearInput[], salary: number, years: number): BidPreviewRow[] {
  const s = Math.max(0, salary)
  return [...projection]
    .sort((a, b) => a.capYear - b.capYear)
    .map((y, i) => {
      const bidHit = i < years ? s : 0
      const left = r1(y.projectedSpace - bidHit)
      return {
        capYear: y.capYear,
        ceiling: r1(y.capCeiling),
        committedBefore: r1(y.totalCapHit),
        bidHit,
        left,
        over: left < 0,
      }
    })
}

export function bidFits(rows: BidPreviewRow[]): boolean {
  return rows.length > 0 && rows.every((r) => !r.over)
}

/** Clamp a salary to the league's minimum and step (whole dollars, like the mockup's ±$1). */
export function clampSalary(value: number, minimumSalary: number, maximum: number): number {
  const v = Math.round(Number.isFinite(value) ? value : minimumSalary)
  return Math.max(Math.max(0, minimumSalary), Math.min(Math.max(minimumSalary, maximum), v))
}

export type ContractTag = { label: string; tone: 'safe' | 'acc' | 'gold' | 'danger' | 'zone' }

/**
 * Status tags for a contract row. Mirrors how the summary route counts candidates: a contract in its
 * final year is "expiring"; with extensions on it is extension-eligible, with tags on a tag candidate.
 */
export function contractTags(
  c: { yearsRemaining: number; source: string; status: string; contractYear: number; yearsTotal: number },
  config: { extensionsEnabled: boolean; franchiseTagEnabled: boolean },
  capYear: number,
): ContractTag[] {
  const tags: ContractTag[] = []
  const finalYear = c.contractYear >= c.yearsTotal
  if (c.status === 'tagged') tags.push({ label: 'Franchise tag', tone: 'gold' })
  if (c.source === 'rookie_draft' && !finalYear) tags.push({ label: 'Rookie deal', tone: 'acc' })
  if (finalYear && c.status !== 'tagged') {
    if (config.franchiseTagEnabled) tags.push({ label: 'Expiring · tag candidate', tone: 'danger' })
    else tags.push({ label: 'Expiring', tone: 'danger' })
    if (config.extensionsEnabled) tags.push({ label: `Extension eligible ${capYear}`, tone: 'safe' })
  }
  return tags
}

/** Offseason phases in engine order (`SalaryCapOffseasonCalendar.OffseasonPhase`), with copy. */
export const OFFSEASON_STEPS: { phase: string; title: string; sub: string }[] = [
  { phase: 'expiration', title: 'Contracts expire', sub: 'Final-year deals come off the books' },
  { phase: 'rollover', title: 'Cap rollover', sub: 'Unused space carries over, up to the limit' },
  { phase: 'extension', title: 'Extension window', sub: 'Extend players in their final year' },
  { phase: 'tag', title: 'Franchise tag', sub: 'One tag per team' },
  { phase: 'draft', title: 'Rookie draft', sub: 'Slot salary scale' },
  { phase: 'fa_open', title: 'Free-agent bidding', sub: 'Salary + years, blind' },
]
