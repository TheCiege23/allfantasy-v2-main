/**
 * Builds HeyGen API payload from fantasy script and options (Prompt 115).
 * Server-side only; no secrets in payload beyond what HeyGen expects.
 */

import type {
  HeyGenPayloadInput,
  HeyGenCreatePayload,
  HeyGenPayloadMetadata,
  VideoScriptSection,
} from './types';
import { normalizeToSupportedSport } from '@/lib/sport-scope';

const DEFAULT_VOICE_ID = '1bd001e7e9f34d2e8c526aeb26c8ea61';
const DEFAULT_AVATAR_ID = 'josh_lite2_20220814';
const DEFAULT_LANGUAGE = 'en';
const DEFAULT_DURATION_TARGET = 120;
const DEFAULT_TONE = 'confident, energetic, analyst-style';
const DEFAULT_BRANDING = 'AllFantasy brand voice: crisp, data-driven, no gambling claims.';
const DEFAULT_CTA = 'Follow AllFantasy for weekly lineup, waiver, and matchup edge.';

export function buildHeyGenPayload(input: HeyGenPayloadInput): HeyGenCreatePayload {
  const script = truncateScript(buildNarrationScript(input), 12000);
  const payload: HeyGenCreatePayload = {
    script,
    voice_id: input.voiceId ?? DEFAULT_VOICE_ID,
    avatar_id: input.avatarId ?? DEFAULT_AVATAR_ID,
    title: input.title?.slice(0, 200) ?? 'Fantasy recap',
    resolution: '1080p',
    aspect_ratio: '16:9',
  };
  return payload;
}

function truncateScript(script: string, maxChars: number): string {
  if (script.length <= maxChars) return script;
  const trimmed = script.slice(0, maxChars - 50);
  const lastSentence = trimmed.lastIndexOf('.');
  return lastSentence > 0 ? trimmed.slice(0, lastSentence + 1) : trimmed + '...';
}

function normalizeSections(input: HeyGenPayloadInput): VideoScriptSection[] {
  if (Array.isArray(input.sections) && input.sections.length > 0) return input.sections;
  return [{ heading: 'Narration', body: input.script }];
}

function buildNarrationScript(input: HeyGenPayloadInput): string {
  const sport = normalizeToSupportedSport(input.sport);
  const sections = normalizeSections(input);
  const branding = input.brandingInstructions ?? DEFAULT_BRANDING;
  const tone = input.toneStyle ?? DEFAULT_TONE;
  const cta = input.ctaEnding ?? DEFAULT_CTA;
  const language = input.language ?? DEFAULT_LANGUAGE;
  const duration = input.durationTargetSeconds ?? DEFAULT_DURATION_TARGET;

  const sceneScript = sections
    .map((section, index) => `Scene ${index + 1} — ${section.heading}: ${section.body}`)
    .join('\n\n');

  return [
    `Video title: ${input.title}`,
    `Sport context: ${sport}`,
    `Content type: ${input.contentType}`,
    `Language: ${language}`,
    `Duration target: ${duration} seconds`,
    `Tone/style: ${tone}`,
    `Branding instructions: ${branding}`,
    'Narration script:',
    sceneScript,
    `CTA ending: ${cta}`,
  ].join('\n');
}

export function buildHeyGenPayloadMetadata(input: HeyGenPayloadInput): HeyGenPayloadMetadata {
  const sport = normalizeToSupportedSport(input.sport);
  const sceneSections = normalizeSections(input);
  const avatarId = input.avatarId ?? DEFAULT_AVATAR_ID;
  const voiceId = input.voiceId ?? DEFAULT_VOICE_ID;
  const language = input.language ?? DEFAULT_LANGUAGE;
  const durationTargetSeconds = input.durationTargetSeconds ?? DEFAULT_DURATION_TARGET;
  const brandingInstructions = input.brandingInstructions ?? DEFAULT_BRANDING;
  const toneStyleInstructions = input.toneStyle ?? DEFAULT_TONE;
  const ctaEnding = input.ctaEnding ?? DEFAULT_CTA;
  const narrationScript = truncateScript(buildNarrationScript(input), 12000);

  return {
    videoTitle: input.title.slice(0, 200),
    sportContext: sport,
    contentType: input.contentType,
    narrationScript,
    presenterConfig: { avatarId, voiceId },
    sceneSections,
    brandingInstructions,
    toneStyleInstructions,
    ctaEnding,
    language,
    durationTargetSeconds,
    outputMetadata: {
      provider: 'heygen',
      resolution: '1080p',
      aspectRatio: '16:9',
      sceneCount: sceneSections.length,
    },
  };
}
