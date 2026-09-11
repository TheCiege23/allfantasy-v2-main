import 'server-only'

import { prisma } from '@/lib/prisma'
import { apiChainSportToDbSport, type ApiChainSport, type ApiDataType } from '@/lib/workers/api-config'

const DEFAULT_SOURCE = 'rolling_insights'

function ttlMsForRow(kind: 'player' | 'injury' | 'news' | 'team' | 'game'): number {
  if (kind === 'news') return 24 * 60 * 60 * 1000
  if (kind === 'injury') return 6 * 60 * 60 * 1000
  if (kind === 'team') return 7 * 24 * 60 * 60 * 1000
  if (kind === 'game') return 12 * 60 * 60 * 1000
  return 7 * 24 * 60 * 60 * 1000
}

export async function persistNormalizedSportsRows(
  sport: ApiChainSport,
  dataType: ApiDataType,
  data: unknown,
  source: string = DEFAULT_SOURCE
): Promise<void> {
  const dbSport = apiChainSportToDbSport(sport)
  const expiresBase = new Date(Date.now() + ttlMsForRow('player'))

  if (dataType === 'players' && Array.isArray(data)) {
    for (const raw of data) {
      if (!raw || typeof raw !== 'object') continue
      const player = raw as Record<string, unknown>
      const id = String(player.id ?? player.playerId ?? '').trim()
      if (!id) continue
      const name = String(player.name ?? player.player ?? '').trim()
      if (!name) continue
      await prisma.sportsPlayer
        .upsert({
          where: {
            sport_externalId_source: {
              sport: dbSport,
              externalId: id,
              source,
            },
          },
          update: {
            name,
            position: typeof player.position === 'string' ? player.position : null,
            team: typeof player.team === 'string' ? player.team : null,
            teamId: player.teamId != null ? String(player.teamId) : null,
            status: typeof player.status === 'string' ? player.status : null,
            imageUrl: typeof player.imageUrl === 'string' ? player.imageUrl : null,
            updatedAt: new Date(),
            expiresAt: expiresBase,
          },
          create: {
            sport: dbSport,
            externalId: id,
            name,
            position: typeof player.position === 'string' ? player.position : null,
            team: typeof player.team === 'string' ? player.team : null,
            teamId: player.teamId != null ? String(player.teamId) : null,
            status: typeof player.status === 'string' ? player.status : null,
            imageUrl: typeof player.imageUrl === 'string' ? player.imageUrl : null,
            source,
            expiresAt: expiresBase,
          },
        })
        .catch(() => {})
    }
    return
  }

  if (dataType === 'injuries' && Array.isArray(data)) {
    const exp = new Date(Date.now() + ttlMsForRow('injury'))
    for (const raw of data) {
      if (!raw || typeof raw !== 'object') continue
      const injury = raw as Record<string, unknown>
      const externalId = String(
        injury.externalId ?? injury.playerId ?? `${injury.playerName ?? 'unk'}:${injury.reportDate ?? ''}`
      ).slice(0, 180)
      const playerName = String(injury.playerName ?? injury.player ?? 'Unknown')
      const reportDate = injury.reportDate ? new Date(String(injury.reportDate)) : new Date()
      await prisma.sportsInjury
        .upsert({
          where: {
            sport_externalId_source: {
              sport: dbSport,
              externalId,
              source,
            },
          },
          update: {
            status: typeof injury.status === 'string' ? injury.status : null,
            description:
              typeof injury.notes === 'string'
                ? injury.notes
                : typeof injury.bodyPart === 'string'
                  ? injury.bodyPart
                  : null,
            date: reportDate,
            playerName,
            updatedAt: new Date(),
            expiresAt: exp,
          },
          create: {
            sport: dbSport,
            externalId,
            playerName,
            playerId: injury.playerId != null ? String(injury.playerId) : null,
            team: typeof injury.team === 'string' ? injury.team : null,
            status: typeof injury.status === 'string' ? injury.status : null,
            description:
              typeof injury.notes === 'string'
                ? injury.notes
                : typeof injury.bodyPart === 'string'
                  ? injury.bodyPart
                  : null,
            date: reportDate,
            source,
            expiresAt: exp,
          },
        })
        .catch(() => {})
    }
    return
  }

  if (dataType === 'news' && Array.isArray(data)) {
    const exp = new Date(Date.now() + ttlMsForRow('news'))
    for (const raw of data) {
      if (!raw || typeof raw !== 'object') continue
      const article = raw as Record<string, unknown>
      const externalId = String(article.id ?? article.sourceId ?? article.headline ?? '').slice(0, 180)
      if (!externalId) continue
      const title = String(article.title ?? article.headline ?? '').trim()
      if (!title) continue
      const publishedAt = article.publishedAt
        ? new Date(String(article.publishedAt))
        : article.date
          ? new Date(String(article.date))
          : new Date()
      await prisma.sportsNews
        .upsert({
          where: {
            sport_externalId_source: {
              sport: dbSport,
              externalId,
              source,
            },
          },
          update: {
            title,
            sourceId: externalId,
            description: typeof article.description === 'string' ? article.description : null,
            content:
              typeof article.body === 'string'
                ? article.body
                : typeof article.content === 'string'
                  ? article.content
                  : null,
            publishedAt,
            updatedAt: new Date(),
            expiresAt: exp,
          },
          create: {
            sport: dbSport,
            externalId,
            sourceId: externalId,
            title,
            description: typeof article.description === 'string' ? article.description : null,
            content:
              typeof article.body === 'string'
                ? article.body
                : typeof article.content === 'string'
                  ? article.content
                  : null,
            source,
            publishedAt,
            expiresAt: exp,
          },
        })
        .catch(() => {})
    }
    return
  }

  if (dataType === 'teams' && Array.isArray(data)) {
    const exp = new Date(Date.now() + ttlMsForRow('team'))
    for (const raw of data) {
      if (!raw || typeof raw !== 'object') continue
      const team = raw as Record<string, unknown>
      const externalId = String(team.id ?? team.teamId ?? team.externalId ?? '').trim()
      if (!externalId) continue
      const name = String(team.name ?? team.team ?? '').trim()
      if (!name) continue

      await prisma.sportsTeam
        .upsert({
          where: {
            sport_externalId_source: {
              sport: dbSport,
              externalId,
              source,
            },
          },
          update: {
            name,
            shortName:
              typeof team.abbrv === 'string'
                ? team.abbrv
                : typeof team.shortName === 'string'
                  ? team.shortName
                  : null,
            city: typeof team.city === 'string' ? team.city : null,
            logo:
              typeof team.logo === 'string'
                ? team.logo
                : typeof team.img === 'string'
                  ? team.img
                  : null,
            fetchedAt: new Date(),
            expiresAt: exp,
          },
          create: {
            sport: dbSport,
            externalId,
            name,
            shortName:
              typeof team.abbrv === 'string'
                ? team.abbrv
                : typeof team.shortName === 'string'
                  ? team.shortName
                  : null,
            city: typeof team.city === 'string' ? team.city : null,
            logo:
              typeof team.logo === 'string'
                ? team.logo
                : typeof team.img === 'string'
                  ? team.img
                  : null,
            source,
            fetchedAt: new Date(),
            expiresAt: exp,
          },
        })
        .catch(() => {})
    }
    return
  }

  if ((dataType === 'schedule' || dataType === 'scores') && Array.isArray(data)) {
    const exp = new Date(Date.now() + ttlMsForRow('game'))
    for (const raw of data) {
      if (!raw || typeof raw !== 'object') continue
      const game = raw as Record<string, unknown>
      const externalId = String(game.gameId ?? game.id ?? game.externalId ?? '').trim()
      const homeTeam = String(game.homeTeam ?? game.home ?? '').trim()
      const awayTeam = String(game.awayTeam ?? game.away ?? '').trim()
      if (!externalId || !homeTeam || !awayTeam) continue

      const seasonRaw = Number(game.season)
      const season = Number.isFinite(seasonRaw)
        ? Math.floor(seasonRaw)
        : new Date().getUTCFullYear()

      /*
       * 🛑 SCORES, WEEK AND SEASON TYPE WERE FETCHED AND THEN THROWN AWAY.
       *
       * `SportsGame` has held `homeScore`, `awayScore`, `week` and `seasonType`
       * all along — and carries `@@index([sport, season, seasonType, week])` —
       * but this upsert named none of them. So the api-chain persisted every
       * `scores` payload it fetched as a bare schedule row, and its own reader
       * then had nothing to read. The two halves failed together, which is why
       * fixing either one alone changes nothing.
       *
       * ⚠ ABSENT IS NOT ZERO, AND IT IS NOT NULL EITHER. A `schedule` payload
       * legitimately carries no score, and writing `null` for it would wipe the
       * score a `scores` run stored minutes earlier — this upsert is keyed on
       * `[sport, externalId, source]`, so both data types land on the SAME ROW.
       * Only a value actually present in the payload is written.
       */
      const toScore = (value: unknown): number | undefined => {
        if (value == null || value === '') return undefined
        const n = Number(value)
        return Number.isFinite(n) ? Math.trunc(n) : undefined
      }
      const homeScore = toScore(game.homeScore ?? game.homePoints ?? game.home_score)
      const awayScore = toScore(game.awayScore ?? game.awayPoints ?? game.away_score)
      const weekRaw = Number(game.week)
      const week = Number.isFinite(weekRaw) ? Math.floor(weekRaw) : undefined
      const seasonType =
        typeof game.seasonType === 'string' && game.seasonType.trim()
          ? game.seasonType.trim()
          : undefined

      const scoring = {
        ...(homeScore === undefined ? {} : { homeScore }),
        ...(awayScore === undefined ? {} : { awayScore }),
        ...(week === undefined ? {} : { week }),
        ...(seasonType === undefined ? {} : { seasonType }),
      }

      await prisma.sportsGame
        .upsert({
          where: {
            sport_externalId_source: {
              sport: dbSport,
              externalId,
              source,
            },
          },
          update: {
            homeTeam,
            awayTeam,
            status: typeof game.status === 'string' ? game.status : null,
            startTime:
              typeof game.date === 'string'
                ? new Date(game.date)
                : typeof game.startTime === 'string'
                  ? new Date(game.startTime)
                  : null,
            venue: typeof game.venue === 'string' ? game.venue : null,
            season,
            ...scoring,
            fetchedAt: new Date(),
            expiresAt: exp,
          },
          create: {
            sport: dbSport,
            externalId,
            homeTeam,
            awayTeam,
            status: typeof game.status === 'string' ? game.status : null,
            startTime:
              typeof game.date === 'string'
                ? new Date(game.date)
                : typeof game.startTime === 'string'
                  ? new Date(game.startTime)
                  : null,
            venue: typeof game.venue === 'string' ? game.venue : null,
            season,
            source,
            ...scoring,
            fetchedAt: new Date(),
            expiresAt: exp,
          },
        })
        .catch(() => {})
    }
  }
}
