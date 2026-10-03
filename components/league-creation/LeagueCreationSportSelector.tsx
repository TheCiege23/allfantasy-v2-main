'use client';

import { Label } from '@/components/ui/label';
import { LeagueStepPreviewVideo, OptionCardMedia } from '@/components/league-creation-wizard/OptionCardMedia';
import { getSportSelectionVideoUrl } from '@/lib/league-media/resolveOptionMedia';
import { COLLEGE_PAIR_WIZARD_PRIMARY_SPORTS, SUPPORTED_SPORTS, type SupportedSport } from '@/lib/sport-scope';
import type { LeagueSport } from '@prisma/client';
import type { LeagueTypeId } from '@/lib/league-creation-wizard/types';

export type LeagueSportOption = SupportedSport;

const SPORT_LABELS: Record<LeagueSportOption, string> = {
  NFL: 'NFL Football',
  NBA: 'NBA Basketball',
  MLB: 'MLB Baseball',
  NHL: 'NHL Hockey',
  NCAAF: 'NCAA Football',
  NCAAB: 'NCAA Basketball',
  SOCCER: 'Soccer',
};

const LEAGUE_SPORTS: LeagueSportOption[] = [...SUPPORTED_SPORTS];

const SPORT_EMOJI: Record<LeagueSportOption, string> = {
  NFL: '🏈',
  NBA: '🏀',
  MLB: '⚾',
  NHL: '🏒',
  NCAAF: '🏈',
  NCAAB: '🏀',
  SOCCER: '⚽',
};

const SPORT_MEDIA: Record<LeagueSportOption, { image: string; video: string; thumbFallback: string }> = {
  NFL: { image: '/Football.png', video: '/Football.mp4', thumbFallback: '/af-crest.svg' },
  NBA: { image: '/Basketball.png', video: '/Basketball.mp4', thumbFallback: '/af-crest.svg' },
  MLB: { image: '/Baseball.png', video: '/Baseball.mp4', thumbFallback: '/af-crest.svg' },
  NHL: { image: '/Hockey.png', video: '/Hockey.mp4', thumbFallback: '/af-crest.svg' },
  NCAAF: { image: '/Football.png', video: '/Football.mp4', thumbFallback: '/af-crest.svg' },
  NCAAB: { image: '/Basketball.png', video: '/Basketball.mp4', thumbFallback: '/af-crest.svg' },
  SOCCER: { image: '/Soccer.png', video: '/Soccer.mp4', thumbFallback: '/af-crest.svg' },
};

export interface LeagueCreationSportSelectorProps {
  value: LeagueSportOption;
  onChange: (sport: LeagueSportOption) => void;
  disabled?: boolean;
  showHelper?: boolean;
  /** When set (e.g. Devy / C2C), only these sports are shown (NFL/NBA + college pairing in defaults). */
  allowedSports?: readonly LeagueSport[];
  /** Drives footer copy (e.g. tournament vs standard league). */
  leagueType?: LeagueTypeId;
}

/**
 * Sport selector for league creation. Soccer is its own sport; NFL has presets (e.g. IDP) chosen separately.
 */
export function LeagueCreationSportSelector({
  value,
  onChange,
  disabled = false,
  showHelper = true,
  allowedSports,
  leagueType,
}: LeagueCreationSportSelectorProps) {
  const sportsList: LeagueSportOption[] =
    allowedSports && allowedSports.length > 0
      ? (allowedSports.filter((s) => (LEAGUE_SPORTS as readonly string[]).includes(s)) as LeagueSportOption[])
      : LEAGUE_SPORTS;
  const collegePairMode =
    sportsList.length === 2 && sportsList.every((s) => COLLEGE_PAIR_WIZARD_PRIMARY_SPORTS.includes(s as LeagueSport));
  const selectedMedia = SPORT_MEDIA[value];
  const selectedVideoUrl = getSportSelectionVideoUrl(value, selectedMedia.video);
  return (
    <div className="space-y-4">
      <Label className="text-cyan-300">Sport</Label>
      <div className="grid gap-3 sm:grid-cols-2">
        {sportsList.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            disabled={disabled}
            data-testid={`league-creation-sport-${s.toLowerCase()}`}
            className={`group relative overflow-hidden rounded-2xl border text-left transition ${
              value === s
                ? 'border-cyan-300 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(0,255,220,0.22)_inset]'
                : 'border-white/15 bg-black/25 hover:bg-white/[0.05]'
            } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <OptionCardMedia
              videoSrc={getSportSelectionVideoUrl(s, SPORT_MEDIA[s].video)}
              posterSrc={SPORT_MEDIA[s].image}
              fallbackSrc={SPORT_MEDIA[s].thumbFallback}
              gradientOverlay={false}
              frameClassName="relative aspect-[16/9] min-h-[6.5rem] w-full overflow-hidden bg-black/45 sm:min-h-[7rem]"
              mediaClassName="object-cover object-center"
            />
            <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-t from-black/78 via-black/35 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 z-[4] p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-white/85 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
                {SPORT_EMOJI[s]} {s}
              </p>
              <p className="text-sm font-semibold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.95)]">{SPORT_LABELS[s]}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-cyan-400/25 bg-[#07122d]/80 p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-cyan-200/80">Selected sport preview</p>
        <p className="mt-1 text-sm text-white/85">{SPORT_LABELS[value]}</p>
        <LeagueStepPreviewVideo
          videoSrc={selectedVideoUrl}
          posterSrc={selectedMedia.image}
          fallbackSrc={selectedMedia.thumbFallback}
          description={`${SPORT_LABELS[value]} preview clip`}
        />
      </div>

      {showHelper && (
        <p className="text-white/55 text-xs mt-1 leading-relaxed">
          {collegePairMode ? (
            <>
              <strong className="text-white/70">Devy</strong> and <strong className="text-white/70">Campus to Canton (C2C)</strong> use{' '}
              <strong className="text-white/70">NFL + NCAA football</strong> or <strong className="text-white/70">NBA + NCAA basketball</strong>{' '}
              player pools. Pick the pro league here; the matching college pool is wired in when the league is created.
            </>
          ) : leagueType === 'tournament' ? (
            <>
              Pick the <strong className="text-white/70">sport</strong> for every feeder league in this hub (draft pool,
              scoring, schedules). Below, <strong className="text-white/70">12 teams per feeder league</strong> is fixed;
              on the next step you set the <strong className="text-white/70">full tournament field</strong> (total
              managers).
            </>
          ) : (
            <>
              <strong className="text-white/70">Soccer</strong> is its own sport with its own roster and scoring.{' '}
              <strong className="text-white/70">IDP</strong> is an NFL preset — choose NFL, then pick a preset below such
              as Standard, PPR, Superflex, IDP, or Dynasty IDP. Selecting a preset updates roster and scoring
              automatically.
            </>
          )}
        </p>
      )}
    </div>
  );
}

export { LEAGUE_SPORTS, SPORT_LABELS };
