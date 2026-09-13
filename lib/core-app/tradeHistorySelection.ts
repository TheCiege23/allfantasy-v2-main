export type MirroredTradeRow = {
  transactionId: string
  history: { sleeperUsername: string }
}

/**
 * Collapse the per-manager rows written for one Sleeper transaction into one
 * row. When the viewer has a mirrored row, keep that one so "gave" and
 * "received" are oriented correctly for the person reading the screen.
 */
export function collapseMirroredTradeRows<T extends MirroredTradeRow>(
  rows: T[],
  viewerPlatformUserId: string | null,
  limit = 60,
): T[] {
  const byTransaction = new Map<string, T>()
  for (const row of rows) {
    const current = byTransaction.get(row.transactionId)
    if (
      !current ||
      (viewerPlatformUserId != null && row.history.sleeperUsername === viewerPlatformUserId)
    ) {
      byTransaction.set(row.transactionId, row)
    }
  }
  return [...byTransaction.values()].slice(0, Math.max(0, limit))
}

