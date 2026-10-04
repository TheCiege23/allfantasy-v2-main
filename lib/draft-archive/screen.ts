import 'server-only';
import { prisma } from '@/lib/prisma';
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession';
import { draftArchiveCatalog } from './catalog';
import { draftArchiveDetail } from './detail';
export async function getDraftArchiveScreen(authorizedLeagueIds: string[], leagueId: string | null, userId: string, params: Record<string, string | string[] | undefined>) {
    const value = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
    const query = value('archiveQuery').slice(0, 120);
    const seasonText = value('archiveSeason');
    const season = /^\d{4}$/.test(seasonText) ? Number(seasonText) : null;
    const scope = leagueId ? authorizedLeagueIds.filter(id => id === leagueId) : authorizedLeagueIds;
    const catalog = await draftArchiveCatalog(scope, { page: Number(value('archivePage')) || 1, query, season });
    const current = leagueId && scope.length ? await prisma.draftSession.findFirst({
        where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER,
        select: { id: true, status: true, sessionKind: true, sleeperDraftId: true },
    }) : null;
    const requested = value('draft');
    const timelinePage = Math.max(1, Math.min(10000, Number(value('timelinePage')) || 1));
    const key = requested || (current?.sessionKind === 'live' ? (current.sleeperDraftId ? 'imported:' + current.sleeperDraftId : 'native:' + current.id) : catalog.choices[0]?.key);
    const detail = leagueId && scope.length && key ? await draftArchiveDetail(leagueId, userId, key, timelinePage) : null;
    const isCurrent = !!current && (!requested || requested === 'native:' + current.id);
    return {
        choices: catalog.choices.map(({ createdAt, total, ...choice }) => { void createdAt; void total; return choice; }),
        detail, leagueId, page: catalog.page, more: catalog.more, total: catalog.total, query, season: seasonText, timelinePage,
        error: requested && !detail ? 'This draft is unavailable in this league.' : null,
        // An explicit archive selection must never render the current draft's live controls.
        showCurrent: (!detail && !requested) || (isCurrent && !current?.sleeperDraftId && current?.status !== 'completed'),
    };
}
