import { prisma } from '@/lib/prisma'
import { getCachedGameWeather } from '@/lib/weather/weatherService'
import { resolveVenueForTeam } from '@/lib/weather/venueResolver'
import { fetchWeatherForTeamHomeWindow } from '@/lib/weather/venueResolver'
import { defaultNflGameTime } from '@/lib/weather/defaultGameTimes'
import { calculateWeatherImpact } from '@/lib/weather/weatherImpactEngine'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { fetchFantasyCalcValues, findPlayerByName, getTrendingPlayers, getValueTier, type FantasyCalcPlayer } from '@/lib/player-valuations/canonicalPlayerValuations'
import { getConsensusADP } from '@/lib/multi-platform-adp'
import { getTrendingAdds, getTrendingDrops, getPlayerName, getAllPlayers } from '@/lib/sleeper-client'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { resolvePlayerInjuryNewsBatch } from '@/lib/news-injury-aggregation/resolveBatch'

export interface ChatDataSources {
  news: { title: string; source: string; publishedAt: string; teams: string[] }[]
  injuries: { playerName: string; team: string; status: string; description: string }[]
  weather: { team: string; venue: string; isDome: boolean; temp?: number; wind?: number; impact?: string }[]
  playerStats: { name: string; position: string; team: string; stats: Record<string, any> }[]
  liveScores: { homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; status: string; quarter?: string; clock?: string }[]
  valuations: { name: string; position: string; team: string; value: number; tier: string; trend30Day: number; rank: number }[]
  trendingPlayers: { name: string; position: string; team: string; adds: number; drops: number; signal: string }[]
  depthCharts: { team: string; position: string; starters: string[] }[]
}

function extractPlayerAndTeamMentions(message: string): { players: string[]; teams: string[] } {
  const teamPatterns = [
    'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
    'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
    'LV', 'LAC', 'LAR', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
    'NYJ', 'PHI', 'PIT', 'SF', 'SEA', 'TB', 'TEN', 'WAS',
    'Cardinals', 'Falcons', 'Ravens', 'Bills', 'Panthers', 'Bears',
    'Bengals', 'Browns', 'Cowboys', 'Broncos', 'Lions', 'Packers',
    'Texans', 'Colts', 'Jaguars', 'Chiefs', 'Raiders', 'Chargers',
    'Rams', 'Dolphins', 'Vikings', 'Patriots', 'Saints', 'Giants',
    'Jets', 'Eagles', 'Steelers', '49ers', 'Seahawks', 'Buccaneers',
    'Titans', 'Commanders',
  ]

  const teamNameToAbbrev: Record<string, string> = {
    'cardinals': 'ARI', 'falcons': 'ATL', 'ravens': 'BAL', 'bills': 'BUF',
    'panthers': 'CAR', 'bears': 'CHI', 'bengals': 'CIN', 'browns': 'CLE',
    'cowboys': 'DAL', 'broncos': 'DEN', 'lions': 'DET', 'packers': 'GB',
    'texans': 'HOU', 'colts': 'IND', 'jaguars': 'JAX', 'chiefs': 'KC',
    'raiders': 'LV', 'chargers': 'LAC', 'rams': 'LAR', 'dolphins': 'MIA',
    'vikings': 'MIN', 'patriots': 'NE', 'saints': 'NO', 'giants': 'NYG',
    'jets': 'NYJ', 'eagles': 'PHI', 'steelers': 'PIT', '49ers': 'SF',
    'seahawks': 'SEA', 'buccaneers': 'TB', 'titans': 'TEN', 'commanders': 'WAS',
  }

  const foundTeams: Set<string> = new Set()
  const upper = message.toUpperCase()
  const lower = message.toLowerCase()

  for (const t of teamPatterns) {
    if (t.length <= 3) {
      const regex = new RegExp(`\\b${t}\\b`, 'i')
      if (regex.test(message)) {
        foundTeams.add(normalizeTeamAbbrev(t) || t.toUpperCase())
      }
    } else {
      if (lower.includes(t.toLowerCase())) {
        const abbrev = teamNameToAbbrev[t.toLowerCase()]
        if (abbrev) foundTeams.add(abbrev)
      }
    }
  }

  const players: string[] = []
  const words = message.split(/\s+/)
  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i].replace(/[^a-zA-Z']/g, '')
    const w2 = words[i + 1].replace(/[^a-zA-Z']/g, '')
    if (w1.length >= 2 && w2.length >= 2 && /^[A-Z]/.test(w1) && /^[A-Z]/.test(w2)) {
      players.push(`${w1} ${w2}`)
    }
  }

  return { players, teams: Array.from(foundTeams) }
}

export interface ChatEnrichmentAudit {
  sourcesUsed: string[]
  partialData: boolean
  missingSources: string[]
  errors: string[]
}

export async function enrichChatWithData(
  userMessage: string,
  options?: {
    leagueId?: string
    sleeperUsername?: string
    includeWeather?: boolean
    includeLiveScores?: boolean
    /** Defaults to NFL when omitted; used for shared injury/news aggregation. */
    sport?: string
  }
): Promise<{ context: string; sources: ChatDataSources; audit: ChatEnrichmentAudit }> {
  const { players, teams } = extractPlayerAndTeamMentions(userMessage)
  const lower = userMessage.toLowerCase()

  const sources: ChatDataSources = {
    news: [],
    injuries: [],
    weather: [],
    playerStats: [],
    liveScores: [],
    valuations: [],
    trendingPlayers: [],
    depthCharts: [],
  }

  const contextParts: string[] = []
  const enrichErrors: string[] = []
  const enrichMissing: string[] = []
  const enrichSourcesUsed: string[] = []

  const wantsNews = lower.includes('news') || lower.includes('update') || lower.includes('latest') || lower.includes('report') || teams.length > 0 || players.length > 0
  const wantsWeather = lower.includes('weather') || lower.includes('start') || lower.includes('sit') || lower.includes('lineup') || lower.includes('game day') || lower.includes('gameday')
  const wantsInjury = lower.includes('injur') || lower.includes('hurt') || lower.includes('out') || lower.includes('questionable') || lower.includes('doubtful') || lower.includes('health')
  const wantsScores = lower.includes('score') || lower.includes('game') || lower.includes('live') || lower.includes('playing') || lower.includes('winning') || lower.includes('losing')
  const wantsStats = lower.includes('stat') || lower.includes('yards') || lower.includes('touchdown') || lower.includes('point') || lower.includes('average') || lower.includes('how') || players.length > 0
  const wantsValues = lower.includes('value') || lower.includes('worth') || lower.includes('trade') || lower.includes('dynasty') || lower.includes('redraft') || lower.includes('tier') || lower.includes('rank') || players.length > 0
  const wantsTrending = lower.includes('trending') || lower.includes('waiver') || lower.includes('pickup') || lower.includes('add') || lower.includes('drop') || lower.includes('hot') || lower.includes('buzz') || lower.includes('hype')
  const wantsDepthChart = lower.includes('depth') || lower.includes('starter') || lower.includes('backup') || lower.includes('rb1') || lower.includes('wr1') || lower.includes('qb1') || (lower.includes('start') && teams.length > 0)

  const tasks: Promise<void>[] = []

  if (wantsNews || teams.length > 0) {
    tasks.push((async () => {
      try {
        const whereClause: any = {
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        }
        if (teams.length > 0) {
          whereClause.OR = teams.map(t => ({
            team: t
          }))
        }

        const newsArticles = await prisma.sportsNews.findMany({
          where: whereClause,
          orderBy: { publishedAt: 'desc' },
          take: 8,
        })

        if (newsArticles.length > 0) {
          enrichSourcesUsed.push('news')
          sources.news = newsArticles.map(a => ({
            title: a.title,
            source: a.source,
            publishedAt: a.publishedAt?.toISOString() || a.createdAt.toISOString(),
            teams: a.team ? [a.team] : [],
          }))

          contextParts.push(`\n## LATEST NEWS (from ESPN + NewsAPI)\n${newsArticles.map(a =>
            `- [${a.source}] ${a.title} (${a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : 'recent'})`
          ).join('\n')}`)
        }
      } catch (err) {
        enrichErrors.push(`news: ${String(err)}`)
        enrichMissing.push('news')
        console.warn('[ChatEnrich] News fetch failed:', err)
      }
    })())
  }

  if (wantsInjury || teams.length > 0) {
    tasks.push((async () => {
      try {
        const sport = normalizeToSupportedSport(options?.sport ?? 'NFL')

        if (players.length > 0) {
          const batch = await resolvePlayerInjuryNewsBatch({
            prisma,
            sport,
            players: players.slice(0, 14).map((name) => ({
              playerName: name,
              teamAbbrev: teams[0] ?? null,
            })),
            skipNewsContext: players.length > 18,
          })

          const lines: string[] = []
          let usedNewsInjuryAgg = false
          for (const name of players.slice(0, 14)) {
            const layer = batch.get(name.toLowerCase())
            if (!layer) continue
            usedNewsInjuryAgg = true
            const desc = [
              layer.playerNewsSummary,
              layer.conflict ? `CONFLICT: ${layer.conflictDetail ?? 'sources disagree'}` : null,
              layer.materialProjectionImpact
                ? `projection multiplier ~${layer.projectionMultiplier.toFixed(2)} vs baseline`
                : null,
            ]
              .filter(Boolean)
              .join(' — ')
            sources.injuries.push({
              playerName: layer.playerName,
              team: layer.teamAbbrev || 'Unknown',
              status: layer.canonicalStatus,
              description: desc,
            })
            lines.push(
              `- ${layer.playerName} (${layer.teamAbbrev ?? '?'}): ${layer.canonicalStatus}${
                layer.practiceReport ? ` · practice ${layer.practiceReport}` : ''
              }${desc ? ` — ${desc}` : ''}`,
            )
          }

          if (lines.length > 0) {
            if (usedNewsInjuryAgg) enrichSourcesUsed.push('news_injury_aggregation')
            contextParts.push(`\n## INJURY / NEWS (shared aggregation layer — DB + news pipeline)\n${lines.join('\n')}`)
            return
          }
        }

        const whereClause: any = {
          status: { not: 'Active' },
        }
        if (teams.length > 0) {
          whereClause.team = { in: teams }
        }
        if (players.length > 0 && teams.length === 0) {
          whereClause.playerName = {
            in: players.map(p => p),
          }
        }

        const injuries = await prisma.sportsInjury.findMany({
          where: whereClause,
          orderBy: { updatedAt: 'desc' },
          take: 10,
        })

        if (injuries.length > 0) {
          enrichSourcesUsed.push('injuries')
          sources.injuries = injuries.map(i => ({
            playerName: i.playerName,
            team: i.team || 'Unknown',
            status: i.status || 'Unknown',
            description: i.description || '',
          }))

          contextParts.push(`\n## INJURY REPORT (from API-Sports)\n${injuries.map(i =>
            `- ${i.playerName} (${i.team}): ${i.status}${i.description ? ' - ' + i.description : ''}`
          ).join('\n')}`)
        }
      } catch (err) {
        enrichErrors.push(`injuries: ${String(err)}`)
        enrichMissing.push('injuries')
        console.warn('[ChatEnrich] Injury fetch failed:', err)
      }
    })())
  }

  if ((wantsWeather || options?.includeWeather) && teams.length > 0) {
    tasks.push((async () => {
      try {
        const forecastTime = defaultNflGameTime()
        const weatherResults = await Promise.all(
          teams.slice(0, 4).map(async (team) => {
            const live = await getCachedGameWeather({ homeTeam: team, referenceDate: new Date() })
            const forecast = await fetchWeatherForTeamHomeWindow({
              sport: 'NFL',
              teamAbbrev: team,
              gameTime: forecastTime,
            })
            if (!live && !forecast) return null

            const resolvedVenue = resolveVenueForTeam({ sport: 'NFL', teamAbbrev: team })
            const venue = live?.venue ?? (resolvedVenue.kind !== 'none' ? resolvedVenue.label : 'Unknown')
            const isDome = live?.isDome ?? Boolean(forecast?.isDome)
            let forecastBlurb = ''
            if (!isDome && forecast) {
              const imp = calculateWeatherImpact('NFL', 'QB', forecast, 20)
              forecastBlurb = ` Sunday-window forecast (${forecast.conditionLabel}, ${Math.round(forecast.temperatureF)}°F, ${Math.round(forecast.windSpeedMph)}mph wind, ~${Math.round(forecast.precipChancePct)}% precip): model vs ~20pt QB baseline ${imp.totalAdjustment >= 0 ? '+' : ''}${imp.totalAdjustment.toFixed(1)} pts — ${imp.shortReason}.`
            }

            if (isDome) {
              return {
                team,
                venue,
                isDome: true,
                impact: 'Indoor stadium — no weather impact',
              }
            }

            if (!live) {
              return {
                team,
                venue,
                isDome: false,
                temp: forecast ? Math.round(forecast.temperatureF) : undefined,
                wind: forecast ? Math.round(forecast.windSpeedMph) : undefined,
                impact: forecastBlurb || 'Forecast context available from WeatherCache.',
              }
            }

            return {
              team,
              venue,
              isDome: false,
              temp: live.weather.temp,
              wind: live.weather.windSpeed,
              impact: live.weather.fantasyImpact + forecastBlurb,
            }
          })
        )

        const validWeather = weatherResults.filter(Boolean) as NonNullable<typeof weatherResults[number]>[]
        if (validWeather.length > 0) {
          enrichSourcesUsed.push('weather')
          sources.weather = validWeather
          contextParts.push(`\n## GAME-DAY WEATHER (WeatherCache-first current + Sunday forecast window)\n${validWeather.map(w =>
            `- ${w.team} at ${w.venue}: ${w.isDome ? 'DOME (no weather impact)' : `${Math.round(w.temp!)}°F, ${Math.round(w.wind!)} mph wind`}${w.impact ? ' — ' + w.impact : ''}`
          ).join('\n')}`)
        }
      } catch (err) {
        enrichErrors.push(`weather: ${String(err)}`)
        enrichMissing.push('weather')
        console.warn('[ChatEnrich] Weather fetch failed:', err)
      }
    })())
  }

  if (wantsScores || options?.includeLiveScores) {
    tasks.push((async () => {
      try {
        const today = new Date()
        const startOfDay = new Date(today)
        startOfDay.setHours(0, 0, 0, 0)

        const games = await prisma.sportsGame.findMany({
          where: {
            source: 'espn_live',
            startTime: { gte: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
          },
          orderBy: { startTime: 'desc' },
          take: 16,
        })

        if (games.length > 0) {
          enrichSourcesUsed.push('live_scores')
          sources.liveScores = games.map(g => ({
            homeTeam: g.homeTeam,
            awayTeam: g.awayTeam,
            homeScore: g.homeScore ?? 0,
            awayScore: g.awayScore ?? 0,
            status: g.status || 'Scheduled',
          }))

          contextParts.push(`\n## LIVE/RECENT SCORES (from ESPN)\n${games.map(g =>
            `- ${g.awayTeam} ${g.awayScore ?? 0} @ ${g.homeTeam} ${g.homeScore ?? 0} (${g.status || 'Scheduled'})`
          ).join('\n')}`)
        }
      } catch (err) {
        enrichErrors.push(`live_scores: ${String(err)}`)
        enrichMissing.push('live_scores')
        console.warn('[ChatEnrich] Scores fetch failed:', err)
      }
    })())
  }

  if (wantsStats && players.length > 0) {
    tasks.push((async () => {
      try {
        for (const playerName of players.slice(0, 3)) {
          const [firstName, ...rest] = playerName.split(' ')
          const lastName = rest.join(' ')

          const identity = await prisma.playerIdentityMap.findFirst({
            where: {
              OR: [
                { canonicalName: { contains: lastName, mode: 'insensitive' } },
                { canonicalName: { equals: playerName, mode: 'insensitive' } },
              ],
            },
          })

          if (identity) {
            const seasonStats = await prisma.playerSeasonStats.findFirst({
              where: {
                playerId: identity.rollingInsightsId || identity.sleeperId || '',
                sport: 'NFL',
              },
              orderBy: { season: 'desc' },
            })

            if (seasonStats?.stats && typeof seasonStats.stats === 'object') {
              const s = seasonStats.stats as Record<string, any>
              sources.playerStats.push({
                name: identity.canonicalName,
                position: identity.position || 'Unknown',
                team: identity.currentTeam || 'FA',
                stats: {
                  season: seasonStats.season,
                  gamesPlayed: s.games_played ?? null,
                  passingYards: s.passing_yards ?? null,
                  rushingYards: s.rushing_yards ?? null,
                  receivingYards: s.receiving_yards ?? null,
                  touchdowns: (s.passing_touchdowns ?? 0) + (s.rushing_touchdowns ?? 0) + (s.receiving_touchdowns ?? 0),
                  receptions: s.receptions ?? null,
                },
              })
            }
          }
        }

        if (sources.playerStats.length > 0) {
          enrichSourcesUsed.push('player_stats')
          contextParts.push(`\n## PLAYER STATS (from Rolling Insights / API-Sports)\n${sources.playerStats.map(p => {
            const s = p.stats
            const statLines: string[] = []
            if (s.passingYards) statLines.push(`${s.passingYards} pass yds`)
            if (s.rushingYards) statLines.push(`${s.rushingYards} rush yds`)
            if (s.receivingYards) statLines.push(`${s.receivingYards} rec yds`)
            if (s.receptions) statLines.push(`${s.receptions} rec`)
            if (s.touchdowns) statLines.push(`${s.touchdowns} TDs`)
            return `- ${p.name} (${p.position}, ${p.team}) [${s.season}]: ${statLines.join(', ') || 'No stats available'} in ${s.gamesPlayed ?? '?'} games`
          }).join('\n')}`)
        }
      } catch (err) {
        enrichErrors.push(`player_stats: ${String(err)}`)
        enrichMissing.push('player_stats')
        console.warn('[ChatEnrich] Stats fetch failed:', err)
      }
    })())
  }

  if (wantsValues) {
    tasks.push((async () => {
      try {
        const isDynasty = lower.includes('dynasty')
        const allValues = await fetchFantasyCalcValues({
          isDynasty,
          numQbs: lower.includes('superflex') || lower.includes('sf') ? 2 : 1,
          numTeams: 12,
          ppr: 1,
        })

        const matched: typeof sources.valuations = []

        if (players.length > 0) {
          for (const pName of players.slice(0, 5)) {
            const found = findPlayerByName(allValues, pName)
            if (found) {
              matched.push({
                name: found.player.name,
                position: found.player.position,
                team: found.player.maybeTeam || 'FA',
                value: found.value,
                tier: getValueTier(found.value),
                trend30Day: found.trend30Day,
                rank: found.overallRank,
              })
            }
          }
        }

        if (matched.length === 0 && !players.length) {
          const topPlayers = allValues.slice(0, 10)
          for (const p of topPlayers) {
            matched.push({
              name: p.player.name,
              position: p.player.position,
              team: p.player.maybeTeam || 'FA',
              value: p.value,
              tier: getValueTier(p.value),
              trend30Day: p.trend30Day,
              rank: p.overallRank,
            })
          }
        }

        const trendingUp = getTrendingPlayers(allValues, 'up', 5)
        const trendingDown = getTrendingPlayers(allValues, 'down', 5)

        if (matched.length > 0) {
          enrichSourcesUsed.push('valuations')
          sources.valuations = matched
          contextParts.push(`\n## PLAYER VALUES (from FantasyCalc — ${isDynasty ? 'Dynasty' : 'Redraft'})\n${matched.map(p => {
            let line = `- ${p.name} (${p.position}, ${p.team}): Value=${p.value} | Tier=${p.tier} | Rank=#${p.rank} | 30-Day Trend=${p.trend30Day > 0 ? '+' : ''}${p.trend30Day}`
            const consensus = getConsensusADP(p.name, p.position, p.team)
            if (consensus && consensus.consensusADP < 9999) {
              line += ` | ConsensusADP: ${consensus.consensusADP.toFixed(1)} (${consensus.platformCount} platforms) [${consensus.tier}]`
              if (consensus.dynastyADP) line += ` DynADP:${consensus.dynastyADP.toFixed(1)}`
              if (consensus.aav) line += ` AAV:$${consensus.aav.toFixed(1)}`
              if (consensus.injury) line += ` ⚠${consensus.injury}`
            }
            return line
          }).join('\n')}`)

          contextParts.push(`\n## VALUE TRENDS (FantasyCalc 30-Day)\nRising: ${trendingUp.map(p => `${p.player.name} (+${p.trend30Day})`).join(', ')}\nFalling: ${trendingDown.map(p => `${p.player.name} (${p.trend30Day})`).join(', ')}`)
        }
      } catch (err) {
        enrichErrors.push(`valuations: ${String(err)}`)
        enrichMissing.push('valuations')
        console.warn('[ChatEnrich] Valuations fetch failed:', err)
      }
    })())
  }

  if (wantsTrending) {
    tasks.push((async () => {
      try {
        const [adds, drops, sleeperPlayers] = await Promise.all([
          getTrendingAdds('nfl', 24, 10),
          getTrendingDrops('nfl', 24, 10),
          getAllPlayers(),
        ])

        const trendingItems: typeof sources.trendingPlayers = []

        for (const add of adds) {
          const name = getPlayerName(sleeperPlayers, add.player_id) || add.player_id
          const player = sleeperPlayers[add.player_id]
          trendingItems.push({
            name,
            position: player?.position || '?',
            team: player?.team || 'FA',
            adds: add.count,
            drops: 0,
            signal: 'rising',
          })
        }

        for (const drop of drops) {
          const existing = trendingItems.find(t => t.name === (getPlayerName(sleeperPlayers, drop.player_id) || drop.player_id))
          if (existing) {
            existing.drops = drop.count
            existing.signal = existing.adds > existing.drops ? 'rising' : 'falling'
          } else {
            const name = getPlayerName(sleeperPlayers, drop.player_id) || drop.player_id
            const player = sleeperPlayers[drop.player_id]
            trendingItems.push({
              name,
              position: player?.position || '?',
              team: player?.team || 'FA',
              adds: 0,
              drops: drop.count,
              signal: 'falling',
            })
          }
        }

        if (trendingItems.length > 0) {
          enrichSourcesUsed.push('trending')
          sources.trendingPlayers = trendingItems
          const rising = trendingItems.filter(t => t.signal === 'rising')
          const falling = trendingItems.filter(t => t.signal === 'falling')
          contextParts.push(`\n## TRENDING PLAYERS (from Sleeper — last 24 hours)\nMost Added: ${rising.slice(0, 5).map(p => `${p.name} (${p.position}, ${p.team}) +${p.adds} adds`).join(', ')}\nMost Dropped: ${falling.slice(0, 5).map(p => `${p.name} (${p.position}, ${p.team}) -${p.drops} drops`).join(', ')}`)
        }
      } catch (err) {
        enrichErrors.push(`trending: ${String(err)}`)
        enrichMissing.push('trending')
        console.warn('[ChatEnrich] Trending fetch failed:', err)
      }
    })())
  }

  if (wantsDepthChart && teams.length > 0) {
    tasks.push((async () => {
      try {
        const depthRows = await prisma.depthChart.findMany({
          where: {
            sport: 'NFL',
            team: { in: teams },
          },
          orderBy: { fetchedAt: 'desc' },
        })

        if (depthRows.length > 0) {
          enrichSourcesUsed.push('depth_charts')
          const chartsByTeam = new Map<string, { position: string; starters: string[] }[]>()

          for (const row of depthRows) {
            if (!chartsByTeam.has(row.team)) chartsByTeam.set(row.team, [])
            const playersArr = Array.isArray(row.players) ? row.players as { name: string; rank?: number }[] : []
            const starters = playersArr.slice(0, 2).map(p => typeof p === 'string' ? p : p.name || String(p))
            chartsByTeam.get(row.team)!.push({ position: row.position, starters })
            sources.depthCharts.push({ team: row.team, position: row.position, starters })
          }

          const lines: string[] = []
          for (const [team, positions] of chartsByTeam) {
            const keyPositions = positions.filter(p => ['QB', 'RB', 'WR', 'TE'].includes(p.position.toUpperCase()))
            if (keyPositions.length > 0) {
              lines.push(`**${team}**: ${keyPositions.map(p => `${p.position}: ${p.starters.join(' → ')}`).join(' | ')}`)
            }
          }
          if (lines.length > 0) {
            contextParts.push(`\n## DEPTH CHARTS (from Rolling Insights)\n${lines.join('\n')}`)
          }
        }
      } catch (err) {
        enrichErrors.push(`depth_charts: ${String(err)}`)
        enrichMissing.push('depth_charts')
        console.warn('[ChatEnrich] Depth charts fetch failed:', err)
      }
    })())
  }

  await Promise.all(tasks)

  const context = contextParts.length > 0
    ? `\n\n## REAL-TIME DATA CONTEXT\nThe following data was pulled from your integrated data sources to help answer this question. Cite this data in your response — be specific about where it came from.\n${contextParts.join('\n')}`
    : ''

  const audit: ChatEnrichmentAudit = {
    sourcesUsed: enrichSourcesUsed,
    partialData: enrichMissing.length > 0,
    missingSources: enrichMissing,
    errors: enrichErrors,
  }

  return { context, sources, audit }
}

export function buildDataSourcesSummary(sources: ChatDataSources): string[] {
  const summary: string[] = []
  if (sources.news.length > 0) summary.push(`${sources.news.length} news articles (ESPN, NewsAPI)`)
  if (sources.injuries.length > 0) summary.push(`${sources.injuries.length} injury reports (API-Sports)`)
  if (sources.weather.length > 0) summary.push(`${sources.weather.length} weather reports (OpenWeatherMap)`)
  if (sources.playerStats.length > 0) summary.push(`${sources.playerStats.length} player stat profiles (Rolling Insights)`)
  if (sources.liveScores.length > 0) summary.push(`${sources.liveScores.length} game scores (ESPN)`)
  if (sources.valuations.length > 0) summary.push(`${sources.valuations.length} player valuations (FantasyCalc)`)
  if (sources.trendingPlayers.length > 0) summary.push(`${sources.trendingPlayers.length} trending players (Sleeper)`)
  if (sources.depthCharts.length > 0) summary.push(`${sources.depthCharts.length} depth chart entries (Rolling Insights)`)
  return summary
}
