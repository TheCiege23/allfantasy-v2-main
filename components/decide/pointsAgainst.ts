/**
 * Points against, or "—" when it reads 0. An import that does not carry the provider's points
 * against leaves 0 on a team that has played (measured live 2026-10-07 on a Sleeper dynasty league:
 * "736.5 / 0.0" after four weeks), and 0 is not a score anyone concedes over a played week. Same
 * rule as the managers standings section (LeagueManagersStandingsSection: `> 0 ? … : '—'`).
 */
export function pointsAgainstText(pa: number | null | undefined): string {
  return typeof pa === 'number' && pa > 0 ? pa.toFixed(1) : '—'
}
