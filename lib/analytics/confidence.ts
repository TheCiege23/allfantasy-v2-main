export type ConfidenceLevel = 'high' | 'learning' | 'evolving';

export interface InsightMetadata {
  insight_id: string;
  insight_type: 'trade_analysis' | 'roster_summary' | 'dynasty_projection' | 'waiver_analysis' | 'player_finder' | 'league_ranking' | 'manager_compare' | 'ai_coach';
  confidence_level: ConfidenceLevel;
  confidence_score: number;
  league_id?: string;
  sport?: string;
  scoring_type?: string;
  data_coverage?: 'dense' | 'moderate' | 'sparse';
}

export function getConfidenceColor(level: ConfidenceLevel): {
  bg: string;
  text: string;
  border: string;
  dot: string;
} {
  switch (level) {
    case 'high':
      return {
        bg: 'bg-emerald-500/10',
        text: 'text-emerald-400',
        border: 'border-emerald-500/20',
        dot: '🟢',
      };
    case 'learning':
      return {
        bg: 'bg-amber-500/10',
        text: 'text-amber-400',
        border: 'border-amber-500/20',
        dot: '🟡',
      };
    case 'evolving':
      return {
        bg: 'bg-blue-500/10',
        text: 'text-blue-400',
        border: 'border-blue-500/20',
        dot: '🔵',
      };
  }
}

