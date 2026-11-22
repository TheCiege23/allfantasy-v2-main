export type TeamDirectoryRow = {
  id: string
  externalId: string
  name: string
  avatarUrl: string | null
  rosterId: string | null
  abbreviation: string
  status: 'managed' | 'open' | 'automated'
  manager: { id: string | null; username: string | null; name: string | null } | null
  role: string | null
  division: string | null
  coOwners: { id: string; accepted: boolean }[]
}

export function buildTeamDirectoryCsv(teams: readonly TeamDirectoryRow[]): string {
  const aliases = new Map<string, string>()
  function alias(id: string | null | undefined) {
    if (!id) return ''
    const existing = aliases.get(id)
    if (existing) return existing
    const next = `Manager ${aliases.size + 1}`
    aliases.set(id, next)
    return next
  }
  function cell(value: string) {
    const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(value) ? "'" + value : value
    return '"' + safe.replace(/"/g, '""') + '"'
  }
  const rows = [['Team ID', 'Team', 'Abbreviation', 'Division', 'Seat status', 'Assignment', 'Manager alias']]
  for (const team of [...teams].sort((a, b) => a.externalId.localeCompare(b.externalId))) {
    const shared = [team.externalId, team.name, team.abbreviation, team.division ?? '', team.status]
    rows.push([...shared, team.status === 'managed' ? 'Primary' : '', alias(team.status === 'managed' ? team.manager?.id : null)])
    for (const owner of team.coOwners) {
      rows.push([...shared, owner.accepted ? 'Co-owner' : 'Co-owner invited', alias(owner.id)])
    }
  }
  return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
