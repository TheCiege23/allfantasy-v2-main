import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { Trophy, Zap, Target } from 'lucide-react';
import { DraftSharePageContent } from '@/components/draft-sharing/DraftSharePageContent';
import type { DraftShareCardPayload } from '@/lib/draft-sharing/types';
import { MatchupSharePageContent } from '@/components/matchup-sharing/MatchupSharePageContent';
import type { MatchupSharePayload } from '@/lib/matchup-sharing/types';
import { LeagueStoryPageContent } from '@/components/league-story/LeagueStoryPageContent';
import type { LeagueStoryPayload } from '@/lib/league-story-engine/types';

const DRAFT_SHARE_TYPES = ['draft_grade', 'draft_rankings', 'draft_winner'];
const MATCHUP_SHARE_TYPE = 'matchup_share';
const LEAGUE_STORY_TYPE = 'league_story';

const TYPE_ICONS: Record<string, typeof Trophy> = {
  winning_matchup: Target,
  winning_league: Trophy,
  high_scoring_team: Zap,
  bracket_success: Trophy,
  rivalry_win: Target,
  playoff_qualification: Zap,
  championship_win: Trophy,
  great_waiver_pickup: Zap,
  great_trade: Target,
  major_upset: Zap,
  top_rank_legacy: Trophy,
};

export const dynamic = 'force-dynamic';

export default async function ShareMomentPage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const moment = await prisma.shareableMoment.findUnique({
    where: { id: shareId },
  });
  if (!moment) notFound();

  const meta = moment.metadata as {
    payload?: DraftShareCardPayload | MatchupSharePayload | LeagueStoryPayload;
  } | null;
  const isDraftShare = DRAFT_SHARE_TYPES.includes(moment.shareType);
  const draftPayload = isDraftShare && meta?.payload ? (meta.payload as DraftShareCardPayload) : null;
  const isMatchupShare = moment.shareType === MATCHUP_SHARE_TYPE;
  const matchupPayload = isMatchupShare && meta?.payload ? (meta.payload as MatchupSharePayload) : null;
  const isLeagueStory = moment.shareType === LEAGUE_STORY_TYPE;
  const leagueStoryPayload = isLeagueStory && meta?.payload ? (meta.payload as LeagueStoryPayload) : null;

  if (draftPayload) {
    const base = process.env.NEXTAUTH_URL ?? '';
    const shareUrl = base ? `${base.replace(/\/$/, '')}/share/${moment.id}` : '';
    return <DraftSharePageContent payload={draftPayload} shareUrl={shareUrl} />;
  }

  if (matchupPayload) {
    return <MatchupSharePageContent payload={matchupPayload} />;
  }

  if (leagueStoryPayload) {
    return <LeagueStoryPageContent payload={leagueStoryPayload} />;
  }

  const Icon = TYPE_ICONS[moment.shareType] ?? Trophy;

  return (
    <main className="min-h-screen bg-[#0f0f14] px-4 py-12">
      <div className="mx-auto max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        <div className="mb-6 flex justify-center">
          <div className="rounded-full bg-amber-500/20 p-4">
            <Icon className="h-12 w-12 text-amber-400" />
          </div>
        </div>
        <h1 className="text-xl font-bold text-white">{moment.title}</h1>
        <p className="mt-2 text-white/70">{moment.summary}</p>
        <p className="mt-6 text-sm text-white/40">
          Shared with AllFantasy — fantasy tools and rankings.
        </p>
        <Link
          href="/app"
          className="mt-6 inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
        >
          Try AllFantasy
        </Link>
      </div>
    </main>
  );
}
