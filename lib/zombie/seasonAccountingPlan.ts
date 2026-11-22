/** Exact-cent, external-only 2025 season accounting. No payment API is called. */
export type AccountingTeam = { rosterId: string; role: string; points: number; weeklyCents: number;
  stints: Array<{ userId: string; startWeek: number; endWeek: number }> }
const cents = (n: number) => { if (!Number.isSafeInteger(n) || n < 0 || n > 100_000_000) throw new Error('Invalid nonnegative cents'); return n }
export function splitSeasonPot(amount: number, teams: readonly Pick<AccountingTeam, 'rosterId' | 'points'>[]) {
  cents(amount)
  if (!teams.length || new Set(teams.map(t => t.rosterId)).size !== teams.length || teams.some(t => !Number.isFinite(t.points))) throw new Error('A unique, scored recipient field is required')
  const ranked = [...teams].sort((a, b) => b.points - a.points || a.rosterId.localeCompare(b.rosterId))
  const share = Math.floor(amount / (100 * ranked.length)) * 100
  const result = Object.fromEntries(ranked.map(t => [t.rosterId, share]))
  let remainder = amount - share * ranked.length, index = 0
  while (remainder) { const add = Math.min(100, remainder); result[ranked[index++ % ranked.length].rosterId] += add; remainder -= add }
  return result
}
export function planSeasonAccounting(input: { teams: AccountingTeam[]; totalWeeks: number; fundedCents: number; feeCents: number; otherPrizeCents: number; paid: boolean }) {
  const { teams, totalWeeks } = input
  if (!Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 52 || teams.length < 2 || new Set(teams.map(t => t.rosterId)).size !== teams.length) throw new Error('Invalid completed season field')
  if (teams.some(t => !['Survivor', 'Zombie', 'Whisperer'].includes(t.role) || !Number.isFinite(t.points))) throw new Error('A canonical role and final points are required')
  for (const t of teams) {
    cents(t.weeklyCents)
    const weeks = new Set<number>()
    for (const s of t.stints) {
      if (!s.userId || !Number.isInteger(s.startWeek) || !Number.isInteger(s.endWeek) || s.startWeek < 1 || s.endWeek > totalWeeks || s.startWeek > s.endWeek) throw new Error('Invalid ownership stint')
      for (let w = s.startWeek; w <= s.endWeek; w++) { if (weeks.has(w)) throw new Error('Overlapping ownership stints'); weeks.add(w) }
    }
    if (!t.stints.length) throw new Error('Ownership history is required')
  }
  const funded = cents(input.fundedCents), fees = cents(input.feeCents), other = cents(input.otherPrizeCents)
  const weekly = teams.reduce((n, t) => n + t.weeklyCents, 0)
  if (!input.paid && (funded || fees || other)) throw new Error('Free leagues cannot declare cash funding or fees')
  const remaining = input.paid ? funded - fees - other - weekly : 0
  if (remaining < 0) throw new Error('Funding does not cover fees, separate prizes and weekly winnings')
  const seasonByRoster: Record<string, number> = Object.fromEntries(teams.map(t => [t.rosterId, 0]))
  const survivors = teams.filter(t => t.role === 'Survivor'), whisperers = teams.filter(t => t.role === 'Whisperer'), zombies = teams.filter(t => t.role === 'Zombie')
  if (whisperers.length > 1) throw new Error('The 2025 season policy requires at most one active Whisperer')
  if (survivors.length) Object.assign(seasonByRoster, splitSeasonPot(remaining, survivors))
  else if (whisperers.length) {
    if (!zombies.length) throw new Error('A Whisperer-only season needs explicit policy review')
    const third = Math.floor(remaining / 3)
    seasonByRoster[whisperers[0].rosterId] = third
    Object.assign(seasonByRoster, splitSeasonPot(remaining - third, zombies))
  } else Object.assign(seasonByRoster, splitSeasonPot(remaining, teams))
  const entitlements = Object.fromEntries(teams.map(t => [t.rosterId, (input.paid ? t.weeklyCents : 0) + seasonByRoster[t.rosterId]]))
  const { owners, redistributedByRoster } = prorateSeasonEntitlements(teams.map(t => ({ ...t, totalWeeks })), entitlements)
  const allocated = owners.reduce((n, o) => n + o.amountCents, 0)
  if (allocated !== (input.paid ? funded - fees - other : 0)) throw new Error('Accounting conservation failed')
  return { policy: 'beta_2025' as const, paid: input.paid, fundedCents: funded, feeCents: fees, otherPrizeCents: other,
    weeklyCents: input.paid ? weekly : 0, seasonPoolCents: remaining, seasonByRoster, redistributedByRoster, owners, allocatedCents: allocated, paymentsAreExternal: true }
}
/** The same approved ownership fractions apply to ordinary and Ultimate winnings. */
export function prorateSeasonEntitlements(teams: Array<AccountingTeam & { totalWeeks: number }>, entitlements: Record<string, number>) {
  const owners: Array<{ rosterId: string; userId: string; managedWeeks: number; amountCents: number; mustStartGamma: boolean }> = []
  const redistributedByRoster: Record<string, number> = Object.fromEntries(teams.map(t => [t.rosterId, 0]))
  for (const team of teams) {
    const entitlement = cents(entitlements[team.rosterId] ?? 0), totalWeeks = team.totalWeeks
    if (!Number.isInteger(totalWeeks) || totalWeeks < 1 || !team.stints.length) throw new Error('Complete ownership periods are required')
    const occupied = new Set<number>()
    let assigned = 0
    for (const stint of team.stints) {
      if (!stint.userId || !Number.isInteger(stint.startWeek) || !Number.isInteger(stint.endWeek) || stint.startWeek < 1 || stint.endWeek > totalWeeks || stint.startWeek > stint.endWeek) throw new Error('Invalid ownership stint')
      for (let w = stint.startWeek; w <= stint.endWeek; w++) { if (occupied.has(w)) throw new Error('Overlapping ownership stints'); occupied.add(w) }
      const managedWeeks = stint.endWeek - stint.startWeek + 1, amountCents = Math.floor(entitlement * managedWeeks / totalWeeks)
      assigned += amountCents
      owners.push({ rosterId: team.rosterId, userId: stint.userId, managedWeeks, amountCents, mustStartGamma: stint.startWeek > 9 })
    }
    const forfeited = entitlement - assigned
    if (forfeited) { const shares = splitSeasonPot(forfeited, teams.filter(t => t.rosterId !== team.rosterId)); for (const [id, n] of Object.entries(shares)) redistributedByRoster[id] += n }
  }
  // Redistribution is prorated by the receiving team's recorded ownership too.
  // Rounding cents go to its longest-serving owner, preserving the exact pool.
  for (const team of teams) {
    const rows = owners.filter(o => o.rosterId === team.rosterId), total = rows.reduce((n, r) => n + r.managedWeeks, 0)
    let left = redistributedByRoster[team.rosterId]
    for (const row of rows) { const n = Math.floor(redistributedByRoster[team.rosterId] * row.managedWeeks / total); row.amountCents += n; left -= n }
    if (left) [...rows].sort((a, b) => b.managedWeeks - a.managedWeeks || a.userId.localeCompare(b.userId))[0].amountCents += left
  }
  return { owners, redistributedByRoster }
}
export function planUltimatePot(openingCents: number, alphaTeams: readonly { rosterId: string; points: number; role: string }[]) {
  cents(openingCents)
  if (!alphaTeams.length || new Set(alphaTeams.map(t => t.rosterId)).size !== alphaTeams.length) throw new Error('A unique Alpha field is required')
  const contributionsCents = cents(alphaTeams.length * 500), availableCents = cents(openingCents + contributionsCents)
  const survivors = alphaTeams.filter(t => t.role === 'Survivor')
  return { openingCents, contributionsCents, availableCents, awards: survivors.length ? splitSeasonPot(availableCents, survivors) : {}, closingCents: survivors.length ? 0 : availableCents }
}
