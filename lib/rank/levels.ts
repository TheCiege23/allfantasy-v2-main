export const RANK_LEVELS = [
  { level: 1, name: 'Undrafted', tier: 'Rookie', tierGroup: 1, minXp: 0, color: '#888780', bgColor: '#F1EFE8' },
  { level: 2, name: 'Practice Squad', tier: 'Rookie', tierGroup: 1, minXp: 100, color: '#888780', bgColor: '#F1EFE8' },
  { level: 3, name: 'Backup', tier: 'Rookie', tierGroup: 1, minXp: 300, color: '#888780', bgColor: '#F1EFE8' },
  { level: 4, name: 'Rotational', tier: 'Rookie', tierGroup: 1, minXp: 600, color: '#888780', bgColor: '#F1EFE8' },
  { level: 5, name: 'Starter', tier: 'Starter', tierGroup: 2, minXp: 1000, color: '#185FA5', bgColor: '#E6F1FB' },
  { level: 6, name: 'Reliable Starter', tier: 'Starter', tierGroup: 2, minXp: 2000, color: '#185FA5', bgColor: '#E6F1FB' },
  { level: 7, name: 'Featured Starter', tier: 'Starter', tierGroup: 2, minXp: 3500, color: '#185FA5', bgColor: '#E6F1FB' },
  { level: 8, name: 'Proven Starter', tier: 'Starter', tierGroup: 2, minXp: 5500, color: '#185FA5', bgColor: '#E6F1FB' },
  { level: 9, name: 'Veteran', tier: 'Veteran', tierGroup: 3, minXp: 8000, color: '#3B6D11', bgColor: '#EAF3DE' },
  { level: 10, name: 'Seasoned Vet', tier: 'Veteran', tierGroup: 3, minXp: 12000, color: '#3B6D11', bgColor: '#EAF3DE' },
  { level: 11, name: 'Veteran Leader', tier: 'Veteran', tierGroup: 3, minXp: 17000, color: '#3B6D11', bgColor: '#EAF3DE' },
  { level: 12, name: 'Grizzled Vet', tier: 'Veteran', tierGroup: 3, minXp: 24000, color: '#3B6D11', bgColor: '#EAF3DE' },
  { level: 13, name: 'All-Pro Candidate', tier: 'All-Pro', tierGroup: 4, minXp: 32000, color: '#533AB7', bgColor: '#EEEDFE' },
  { level: 14, name: 'All-Pro', tier: 'All-Pro', tierGroup: 4, minXp: 42000, color: '#533AB7', bgColor: '#EEEDFE' },
  { level: 15, name: 'First-Team All-Pro', tier: 'All-Pro', tierGroup: 4, minXp: 55000, color: '#533AB7', bgColor: '#EEEDFE' },
  { level: 16, name: 'Perennial All-Pro', tier: 'All-Pro', tierGroup: 4, minXp: 70000, color: '#533AB7', bgColor: '#EEEDFE' },
  { level: 17, name: 'Elite', tier: 'All-Pro', tierGroup: 4, minXp: 88000, color: '#533AB7', bgColor: '#EEEDFE' },
  { level: 18, name: 'Playoff Threat', tier: 'Playoff Performer', tierGroup: 5, minXp: 110000, color: '#BA7517', bgColor: '#FAEEDA' },
  { level: 19, name: 'Playoff Machine', tier: 'Playoff Performer', tierGroup: 5, minXp: 135000, color: '#BA7517', bgColor: '#FAEEDA' },
  { level: 20, name: 'Clutch', tier: 'Playoff Performer', tierGroup: 5, minXp: 162000, color: '#BA7517', bgColor: '#FAEEDA' },
  { level: 21, name: 'Unstoppable', tier: 'Playoff Performer', tierGroup: 5, minXp: 192000, color: '#BA7517', bgColor: '#FAEEDA' },
  { level: 22, name: 'Champion', tier: 'Champion', tierGroup: 6, minXp: 225000, color: '#993556', bgColor: '#FBEAF0' },
  { level: 23, name: 'Multi-Champion', tier: 'Champion', tierGroup: 6, minXp: 260000, color: '#993556', bgColor: '#FBEAF0' },
  { level: 24, name: 'Serial Champion', tier: 'Champion', tierGroup: 6, minXp: 300000, color: '#993556', bgColor: '#FBEAF0' },
  { level: 25, name: 'Dynasty', tier: 'Dynasty', tierGroup: 7, minXp: 350000, color: '#3C3489', bgColor: '#CECBF6' },
] as const

export type RankLevelRow = (typeof RANK_LEVELS)[number]

type LevelFromXpResult = RankLevelRow & {
  xpIntoLevel: number
  xpForLevel: number
  progressPct: number
  nextLevel: RankLevelRow | null
}

export function getLevelFromXp(xp: number): LevelFromXpResult {
  let current: RankLevelRow = RANK_LEVELS[0]
  for (const lvl of RANK_LEVELS) {
    if (xp >= lvl.minXp) current = lvl
    else break
  }
  const idx = RANK_LEVELS.findIndex((l) => l.level === current.level)
  const next = RANK_LEVELS[idx + 1] ?? null
  const xpIntoLevel = xp - current.minXp
  const xpForLevel = next ? next.minXp - current.minXp : 50000
  const progressPct = Math.min(100, Math.round((xpIntoLevel / xpForLevel) * 100))
  return { ...current, xpIntoLevel, xpForLevel, progressPct, nextLevel: next }
}

export function getLevelIcon(tierGroup: number): string {
  const icons = ['', '📋', '▶️', '🛡️', '⭐', '🔥', '🏆', '👑']
  return icons[tierGroup] ?? '📋'
}
