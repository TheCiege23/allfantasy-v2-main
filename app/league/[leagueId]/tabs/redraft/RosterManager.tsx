'use client'

import type { RedraftRosterClient } from '@/lib/redraft/client'

function slotRank(slot: string): number {
  const normalized = slot.toLowerCase()
  if (normalized === 'bench') return 50
  if (normalized === 'taxi') return 60
  if (normalized === 'ir') return 70
  return 10
}

export function RosterManager({
  roster,
  week,
}: {
  roster: RedraftRosterClient | null
  week: number
}) {
  const players = [...(roster?.players ?? [])].sort((a, b) => {
    const slotDiff = slotRank(a.slotType) - slotRank(b.slotType)
    if (slotDiff !== 0) return slotDiff
    return a.playerName.localeCompare(b.playerName)
  })
  const scored = players.filter((p) => p.weeklyScore).length
  const validation = roster?.lineupValidation
  const playerIssueMap = new Map<string, NonNullable<typeof validation>['issues']>()
  for (const issue of validation?.issues ?? []) {
    if (!issue.playerId) continue
    const current = playerIssueMap.get(issue.playerId) ?? []
    current.push(issue)
    playerIssueMap.set(issue.playerId, current)
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-bold text-white">Roster</h3>
          <p className="text-[11px] text-white/45">
            {roster ? `${roster.teamName ?? roster.ownerName ?? 'Roster'} - Week ${week}` : 'Select a roster to view players.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {validation ? (
            <span
              className={[
                'rounded-full border px-2 py-1 text-[10px] font-semibold',
                validation.ok
                  ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'
                  : 'border-rose-300/25 bg-rose-400/10 text-rose-100',
              ].join(' ')}
            >
              {validation.ok ? 'Lineup legal' : `${validation.errorCount} lineup issue${validation.errorCount === 1 ? '' : 's'}`}
            </span>
          ) : null}
          <span className="rounded-full border border-[#ff9ec0]/20 bg-[#ff9ec0]/10 px-2 py-1 text-[10px] font-semibold text-[#ffd7e5]">
            {scored}/{players.length} scored
          </span>
        </div>
      </div>

      {validation && validation.issues.length > 0 ? (
        <div className="mb-3 space-y-1 rounded-lg border border-amber-300/20 bg-amber-400/10 p-3">
          {validation.issues.slice(0, 5).map((issue, index) => (
            <p
              key={`${issue.code}-${issue.playerId ?? issue.slotType ?? index}`}
              className={issue.severity === 'error' ? 'text-[11px] text-rose-100' : 'text-[11px] text-amber-100'}
            >
              {issue.message}
            </p>
          ))}
          {validation.issues.length > 5 ? (
            <p className="text-[11px] text-white/45">+{validation.issues.length - 5} more lineup notices</p>
          ) : null}
        </div>
      ) : null}

      {!roster ? (
        <div className="rounded-lg border border-white/[0.06] bg-black/20 p-4 text-[12px] text-white/45">
          No roster loaded yet.
        </div>
      ) : players.length === 0 ? (
        <div className="rounded-lg border border-amber-300/20 bg-amber-400/10 p-4 text-[12px] text-amber-100">
          This roster has no active players yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px] text-white/80">
            <thead className="border-b border-white/[0.08] text-[10px] uppercase text-white/40">
              <tr>
                <th className="py-2 pr-2">Slot</th>
                <th className="py-2 pr-2">Player</th>
                <th className="py-2 pr-2">Team</th>
                <th className="py-2 text-right">Pts</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => {
                const playerIssues = playerIssueMap.get(player.playerId) ?? []
                const hasError = playerIssues.some((issue) => issue.severity === 'error')
                return (
                  <tr
                    key={player.id}
                    className={[
                      'border-b border-white/[0.05]',
                      hasError ? 'bg-rose-500/10' : playerIssues.length ? 'bg-amber-400/10' : '',
                    ].join(' ')}
                  >
                    <td className="py-2 pr-2">
                      <span className="rounded-md border border-white/10 bg-black/20 px-1.5 py-0.5 text-[10px] text-white/60">
                        {player.slotType}
                      </span>
                    </td>
                    <td className="min-w-0 py-2 pr-2">
                      <div className="font-semibold text-white/85">{player.playerName}</div>
                      <div className="flex flex-wrap gap-1 text-[10px] text-white/35">
                        <span>{player.position}</span>
                        {player.injuryStatus ? <span>Injury: {player.injuryStatus}</span> : null}
                        {player.byeWeek ? <span>Bye: W{player.byeWeek}</span> : null}
                        {player.isLocked ? <span>Locked</span> : null}
                      </div>
                      {playerIssues.length > 0 ? (
                        <p className={hasError ? 'mt-1 text-[10px] text-rose-100' : 'mt-1 text-[10px] text-amber-100'}>
                          {playerIssues[0]?.message}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2 text-white/50">{player.team ?? 'FA'}</td>
                    <td className="py-2 text-right font-bold text-white">
                      {player.weeklyScore ? player.weeklyScore.fantasyPts.toFixed(2) : 'Missing'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
