/**
 * Social clip types for shareable graphics (Prompt 116).
 */

export const CLIP_TYPES = [
  'weekly_league_winners',
  'biggest_upset',
  'top_scoring_team',
] as const;

export type ClipType = (typeof CLIP_TYPES)[number];

export interface ClipPayload {
  title: string;
  subtitle: string | null;
  stats?: string[];
  meta?: Record<string, unknown>;
}

