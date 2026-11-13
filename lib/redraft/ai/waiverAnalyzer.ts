export type WaiverRec = { addPlayerId: string; dropPlayerId?: string; reason: string }

export async function generateWaiverRecs(
  _rosterId: string,
  _seasonId: string,
  _week: number,
): Promise<WaiverRec[]> {
  return []
}
