'use client';

/**
 * Renders the shareable graphic for social clips (Prompt 116).
 * Designed to be captured by html2canvas for download.
 */

import type { ClipPayload } from './types';
import type { ClipType } from './types';

const GRAPHIC_ID = 'social-clip-graphic';

export const SOCIAL_CLIP_GRAPHIC_ID = GRAPHIC_ID;

interface GraphicRendererProps {
  payload: ClipPayload;
  clipType?: ClipType;
  className?: string;
  /** If true, omit the wrapper id (e.g. when rendering multiple) */
  noCaptureId?: boolean;
}

export function GraphicRenderer({
  payload,
  clipType = 'weekly_league_winners',
  className = '',
  noCaptureId,
}: GraphicRendererProps) {
  const accent = getAccent(clipType);

  return (
    <div
      {...(noCaptureId ? {} : { id: GRAPHIC_ID })}
      className={`rounded-xl overflow-hidden bg-[#0f0f14] border border-white/10 text-white ${className}`}
      style={{
        width: 600,
        minHeight: 340,
        boxSizing: 'border-box',
      }}
    >
      <div
        className="h-2 w-full"
        style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }}
      />
      <div className="p-8 pb-10">
        <p
          className="text-xs font-medium uppercase tracking-wider opacity-70"
          style={{ color: accent }}
        >
          {getTypeLabel(clipType)}
        </p>
        <h2 className="mt-2 text-2xl font-bold leading-tight">{payload.title}</h2>
        {payload.subtitle && (
          <p className="mt-2 text-base text-white/80">{payload.subtitle}</p>
        )}
        {payload.stats && payload.stats.length > 0 && (
          <ul className="mt-6 space-y-1.5 text-sm text-white/70">
            {payload.stats.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="px-8 pb-6 text-right">
        <span className="text-xs text-white/50">allfantasy.ai</span>
      </div>
    </div>
  );
}

function getTypeLabel(type: ClipType): string {
  switch (type) {
    case 'weekly_league_winners':
      return 'League Winners';
    case 'biggest_upset':
      return 'Upset';
    case 'top_scoring_team':
      return 'Top Score';
    default:
      return 'Clip';
  }
}

function getAccent(type: ClipType): string {
  switch (type) {
    case 'weekly_league_winners':
      return '#a78bfa';
    case 'biggest_upset':
      return '#f97316';
    case 'top_scoring_team':
      return '#22c55e';
    default:
      return '#94a3b8';
  }
}
