type WeeklyRecap = { headline: string }

export async function generateWeeklyRecap(_seasonId: string, _week: number): Promise<WeeklyRecap> {
  return { headline: 'Weekly recap pending wiring.' }
}
