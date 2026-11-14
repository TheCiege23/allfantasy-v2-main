/**
 * Builds structured video scripts for fantasy content (Prompt 115).
 * Sections: intro, key storylines, top performers, waiver targets, trending, drama, CTA.
 */

import { normalizeToSupportedSport } from '@/lib/sport-scope';
import type { GeneratedVideoScript, VideoScriptSection, MediaType } from './types';

export interface ScriptBuildOptions {
  sport?: string;
  leagueName?: string;
  leagueId?: string;
  week?: number;
  contentType?: MediaType;
}

const CONTENT_LABELS: Record<MediaType, string> = {
  weekly_recap: 'Weekly fantasy recap',
  waiver_targets: 'Waiver wire targets',
  league_recap: 'League recap',
  player_spotlight: 'Player spotlight',
  matchup_preview: 'Matchup preview',
  playoff_preview: 'Playoff preview',
  playoff_recap: 'Playoff recap',
  championship_recap: 'Championship recap',
  trade_reaction: 'Trade reaction',
  sport_specific_content: 'Sport-specific fantasy spotlight',
};

export function buildFantasyVideoScript(options: ScriptBuildOptions = {}): GeneratedVideoScript {
  const sport = normalizeToSupportedSport(options.sport ?? undefined);
  const leagueName = options.leagueName ?? 'your league';
  const week = options.week ?? 1;
  const contentType = options.contentType ?? 'weekly_recap';

  const sections: VideoScriptSection[] = [];

  sections.push({
    heading: 'Intro',
    body: `Welcome to your ${CONTENT_LABELS[contentType]} for ${leagueName}. This is your ${sport} fantasy update.`,
  });

  sections.push({
    heading: 'Key storylines',
    body: `This week we saw big performances and some surprises. Stay tuned for who to add and who might be trending down.`,
  });

  sections.push({
    heading: 'Top performers',
    body: `Elite quarterbacks with rushing upside continue to drive wins. At running back, volume and goal-line work are king. For receivers, target share and red zone usage tell the story.`,
  });

  sections.push({
    heading: 'Waiver targets',
    body: `On the wire this week: prioritize backs with new opportunity, handcuffs that might have become starters, and receivers in high-volume offenses with favorable matchups ahead.`,
  });

  sections.push({
    heading: 'Trending players',
    body: `Trend watch for ${sport}: buy momentum only when role and usage both support it. Target players with rising snaps, touches, or route participation over one-week spike performances.`,
  });

  sections.push({
    heading: 'League drama and rivalry watch',
    body: `Rivalry pressure is peaking in ${leagueName}. Lean into matchup leverage and schedule context when setting lineups or trade offers to win the psychological edge.`,
  });

  sections.push({
    heading: 'Closing CTA',
    body: `That's your ${CONTENT_LABELS[contentType]}. Lock lineups, attack waivers, and share this update with your league before kickoff. Good luck in ${leagueName}.`,
  });

  const script = sections.map((s) => `${s.heading}. ${s.body}`).join('\n\n');
  const title = `${CONTENT_LABELS[contentType]} — ${leagueName}${options.week != null ? ` Week ${week}` : ''}`;

  return { title, script, sections, contentType, sport };
}
