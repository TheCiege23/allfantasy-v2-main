/** Old persisted rebuild events quoted private profile labels. Read-time projection also covers history. */
export function publicDramaSummary(type: string, summary: string | null): string | null {
  return type === 'REBUILD_PROGRESS' ? 'Recorded competitive signals prompted a team progress update.' : summary
}
