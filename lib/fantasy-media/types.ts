/**
 * Fantasy media (video/podcast) — types for HeyGen and episodes (Prompt 115).
 */

export const MEDIA_TYPES = [
  'weekly_recap',
  'waiver_targets',
  'league_recap',
  'player_spotlight',
  'matchup_preview',
  'playoff_preview',
  'playoff_recap',
  'championship_recap',
  'trade_reaction',
  'sport_specific_content',
] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];

export interface VideoScriptSection {
  heading: string;
  body: string;
}

export interface GeneratedVideoScript {
  title: string;
  script: string;
  sections: VideoScriptSection[];
  contentType: MediaType;
  sport: string;
}

export interface HeyGenPayloadInput {
  title: string;
  sport: string;
  contentType: MediaType;
  script: string;
  sections?: VideoScriptSection[];
  language?: string;
  durationTargetSeconds?: number;
  avatarId?: string;
  voiceId?: string;
  toneStyle?: string;
  ctaEnding?: string;
  brandingInstructions?: string;
}

export interface HeyGenCreatePayload {
  script: string;
  voice_id: string;
  title?: string;
  avatar_id?: string;
  resolution?: '1080p' | '720p';
  aspect_ratio?: '16:9' | '9:16';
}

export interface HeyGenPayloadMetadata {
  videoTitle: string;
  sportContext: string;
  contentType: MediaType;
  narrationScript: string;
  presenterConfig: {
    avatarId: string;
    voiceId: string;
  };
  sceneSections: VideoScriptSection[];
  brandingInstructions: string;
  toneStyleInstructions: string;
  ctaEnding: string;
  language: string;
  durationTargetSeconds: number;
  outputMetadata: {
    provider: 'heygen';
    resolution: '1080p' | '720p';
    aspectRatio: '16:9' | '9:16';
    sceneCount: number;
  };
}

