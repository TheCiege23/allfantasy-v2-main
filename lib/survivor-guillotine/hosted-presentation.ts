type HistoryEntry = Record<string, unknown>

/** Member projection while a hosted ceremony is revealing its result. */
export function projectSGHostedHistory(history: Record<string, HistoryEntry>, currentPeriod: number) {
  const key = String(currentPeriod)
  const entry = history[key]
  const hosted = entry?.hostedCeremony as { stage?: number } | null | undefined
  if (!hosted || typeof hosted.stage !== 'number' || hosted.stage >= 3) {
    return { history, hiddenHostedChop: false, hiddenChopRosterIds: [] as string[] }
  }
  return { hiddenHostedChop: true,
    hiddenChopRosterIds: Array.isArray(entry.choppedTeamIds) ? entry.choppedTeamIds as string[] : [],
    history: { ...history, [key]: { ...entry,
      immuneTribeId: hosted.stage >= 1 ? entry.immuneTribeId : null,
      savedTeamIds: hosted.stage >= 2 ? entry.savedTeamIds : [],
      choppedTeamIds: [], placements: [], scores: {}, teams: [], protectedTeamIds: [],
    } },
  }
}
