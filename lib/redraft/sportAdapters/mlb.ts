import type { ParsedStats, SportAdapter } from './types'
import { MLB_CONFIG } from '@/lib/sportConfig/configs/mlb'

export const MLB_SCORING_CATEGORY_KEYS = MLB_CONFIG.scoringCategories.map((c) => c.key)

export const mlbAdapter: SportAdapter = {
  parseRawStats(raw: Record<string, number>): ParsedStats {
    return {
      ab: raw.ab ?? 0,
      h: raw.h ?? 0,
      r: raw.r ?? 0,
      hr: raw.hr ?? 0,
      rbi: raw.rbi ?? 0,
      sb: raw.sb ?? 0,
      avg: raw.avg ?? 0,
      tb: raw.tb ?? 0,
      bb: raw.bb ?? 0,
      ip: raw.ip ?? 0,
      so: raw.so ?? 0,
      w: raw.w ?? 0,
      sv: raw.sv ?? 0,
      era: raw.era ?? 0,
      qs: raw.qs ?? 0,
      l: raw.l ?? 0,
      er: raw.er ?? 0,
      // Per-type hitting and allowed-by-pitcher keys (mlbStatNormalization.ts keeps the groups apart).
      single: raw.single ?? 0,
      double: raw.double ?? 0,
      triple: raw.triple ?? 0,
      bat_so: raw.bat_so ?? 0,
      hbp: raw.hbp ?? 0,
      ibb: raw.ibb ?? 0,
      cs: raw.cs ?? 0,
      hld: raw.hld ?? 0,
      bs: raw.bs ?? 0,
      outs: raw.outs ?? 0,
      p_h: raw.p_h ?? 0,
      p_r: raw.p_r ?? 0,
      p_bb: raw.p_bb ?? 0,
      p_hbp: raw.p_hbp ?? 0,
      p_hr: raw.p_hr ?? 0,
      wp: raw.wp ?? 0,
      bk: raw.bk ?? 0,
    }
  },
  getLineupLockTime(_sport: string, gameTimeIso: string): Date {
    return new Date(gameTimeIso)
  },
}

export function getStartingPitchers(_week: number): string[] {
  void _week
  return []
}

export function getPlatoonSplit(_playerId: string, _oppHand: string): number {
  void _playerId
  void _oppHand
  return 0
}
