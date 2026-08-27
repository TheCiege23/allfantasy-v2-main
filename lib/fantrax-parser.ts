export interface FantraxStanding {
  rank: number
  team: string
  wins: number
  losses: number
  ties: number
  winPct: number
  gamesBack: number
  consolationRank: number | null
  pointsFor: number
  pointsAgainst: number
  streak: string
}

export interface FantraxMatchup {
  week: number
  awayTeam: string
  awayScore: number
  homeTeam: string
  homeScore: number
  isPlayoff: boolean
  playoffRound?: number
}

export interface FantraxPlayer {
  fantraxId: string
  position: string
  name: string
  nflTeam: string
  eligiblePositions: string
  primaryPosition: string
  status: string
  year: string
  age: number | null
  opponent: string
  fantasyPoints: number
  avgFantasyPoints: number
  byeWeeks: string
  passingYards: number
  passingTDs: number
  rushingYards: number
  rushingTDs: number
  receptions: number
  receivingYards: number
  receivingTDs: number
  fumblesRecoveredTD: number
  returnTDs: number
  twoPtConversions: number
  gamesPlayed: number
}

export interface FantraxTeamStats {
  rank: number
  team: string
  totalPoints: number
  pointsPerGame: number
  gamesPlayed: number
  passingYards: number
  passingTDs: number
  rushingYards: number
  rushingTDs: number
  receptions: number
  receivingYards: number
  receivingTDs: number
}

export interface FantraxTransaction {
  type: 'claim' | 'drop' | 'trade' | 'lineup_change'
  player: string
  team: string
  position: string
  date: string
  week: number
  managerTeam: string
  bid?: number
  fromTeam?: string
  toTeam?: string
  fromSlot?: string
  toSlot?: string
  isDraftPick?: boolean
  pickRound?: number
  pickNumber?: number
}

export interface FantraxTransactionHistory {
  claims: FantraxTransaction[]
  drops: FantraxTransaction[]
  trades: FantraxTransaction[]
  lineupChanges: FantraxTransaction[]
  userTransactions: FantraxTransaction[]
}

export interface FantraxLeagueData {
  leagueName: string
  season: number
  teamCount: number
  standings: FantraxStanding[]
  matchups: FantraxMatchup[]
  roster: FantraxPlayer[]
  teamStats: FantraxTeamStats[]
  playoffResults: FantraxMatchup[]
  userTeam: string
  champion: string | null
  transactions?: FantraxTransactionHistory
  isDevy?: boolean
  sport?: string
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  
  return result
}

function parseNumber(value: string): number {
  const cleaned = value.replace(/,/g, '').replace(/"/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

export function parseFantraxStandings(csvContent: string): FantraxStanding[] {
  const lines = csvContent.split('\n').filter(l => l.trim())
  const standings: FantraxStanding[] = []
  
  let inStandingsSection = false
  
  for (const line of lines) {
    const cells = parseCSVLine(line)
    
    if (cells[0] === '"Standings"' || cells[0] === 'Standings') {
      inStandingsSection = true
      continue
    }
    
    if (cells[0] === '"Rk"' || cells[0] === 'Rk') {
      continue
    }
    
    if (cells[0]?.startsWith('"Week') || cells[0]?.startsWith('Week') || 
        cells[0]?.startsWith('"Playoffs') || cells[0]?.startsWith('Playoffs')) {
      inStandingsSection = false
      continue
    }
    
    if (inStandingsSection && cells.length >= 10) {
      const rank = parseInt(cells[0].replace(/"/g, ''))
      if (!isNaN(rank)) {
        standings.push({
          rank,
          team: cells[1].replace(/"/g, ''),
          wins: parseInt(cells[2].replace(/"/g, '')) || 0,
          losses: parseInt(cells[3].replace(/"/g, '')) || 0,
          ties: parseInt(cells[4].replace(/"/g, '')) || 0,
          winPct: parseFloat(cells[5].replace(/"/g, '').replace('.', '0.')) || 0,
          gamesBack: parseNumber(cells[6]),
          consolationRank: cells[7] ? parseInt(cells[7].replace(/"/g, '')) : null,
          pointsFor: parseNumber(cells[8]),
          pointsAgainst: parseNumber(cells[9]),
          streak: cells[10]?.replace(/"/g, '') || ''
        })
      }
    }
  }
  
  return standings
}

export function parseFantraxMatchups(csvContent: string): FantraxMatchup[] {
  const lines = csvContent.split('\n').filter(l => l.trim())
  const matchups: FantraxMatchup[] = []
  
  let currentWeek = 0
  let isPlayoff = false
  let playoffRound = 0
  
  for (const line of lines) {
    const cells = parseCSVLine(line)
    const firstCell = cells[0]?.replace(/"/g, '')
    
    if (firstCell?.startsWith('Week ')) {
      currentWeek = parseInt(firstCell.replace('Week ', ''))
      isPlayoff = false
      playoffRound = 0
      continue
    }
    
    if (firstCell?.startsWith('Playoffs - Round')) {
      const match = firstCell.match(/Round (\d+)/)
      if (match) {
        playoffRound = parseInt(match[1])
      }
      const weekMatch = firstCell.match(/Week (\d+)/)
      if (weekMatch) {
        currentWeek = parseInt(weekMatch[1])
      }
      isPlayoff = true
      continue
    }
    
    if (firstCell === 'Away' || firstCell === '"Away"') {
      continue
    }
    
    if (cells.length >= 4 && currentWeek > 0) {
      const awayTeam = cells[0].replace(/"/g, '')
      const awayScore = parseNumber(cells[1])
      const homeTeam = cells[2].replace(/"/g, '')
      const homeScore = parseNumber(cells[3])
      
      if (awayTeam && homeTeam && awayTeam !== 'None/Bye' && homeTeam !== 'None/Bye') {
        matchups.push({
          week: currentWeek,
          awayTeam,
          awayScore,
          homeTeam,
          homeScore,
          isPlayoff,
          playoffRound: isPlayoff ? playoffRound : undefined
        })
      }
    }
  }
  
  return matchups
}

export function parseFantraxRoster(csvContent: string): FantraxPlayer[] {
  const lines = csvContent.split('\n').filter(l => l.trim())
  const players: FantraxPlayer[] = []
  
  let headerFound = false
  
  for (const line of lines) {
    const cells = parseCSVLine(line)
    
    if (cells[0] === '"ID"' || cells[0] === 'ID') {
      headerFound = true
      continue
    }
    
    if (cells[0] === '""' || cells[0] === '' || cells[0] === '"Offense"' || cells[0] === 'Offense') {
      continue
    }
    
    if (headerFound && cells.length >= 24) {
      const fantraxId = cells[0].replace(/"/g, '').replace(/\*/g, '')
      if (fantraxId) {
        players.push({
          fantraxId,
          position: cells[1].replace(/"/g, ''),
          name: cells[2].replace(/"/g, ''),
          nflTeam: cells[3].replace(/"/g, ''),
          eligiblePositions: cells[4].replace(/"/g, ''),
          primaryPosition: cells[5].replace(/"/g, ''),
          status: cells[6].replace(/"/g, ''),
          year: cells[7].replace(/"/g, ''),
          age: cells[8] ? parseInt(cells[8].replace(/"/g, '')) : null,
          opponent: cells[9].replace(/"/g, ''),
          fantasyPoints: parseNumber(cells[10]),
          avgFantasyPoints: parseNumber(cells[11]),
          byeWeeks: cells[12].replace(/"/g, ''),
          passingYards: parseNumber(cells[13]),
          passingTDs: parseInt(cells[14].replace(/"/g, '')) || 0,
          rushingYards: parseNumber(cells[15]),
          rushingTDs: parseInt(cells[16].replace(/"/g, '')) || 0,
          receptions: parseInt(cells[17].replace(/"/g, '')) || 0,
          receivingYards: parseNumber(cells[18]),
          receivingTDs: parseInt(cells[19].replace(/"/g, '')) || 0,
          fumblesRecoveredTD: parseInt(cells[20].replace(/"/g, '')) || 0,
          returnTDs: parseInt(cells[21].replace(/"/g, '')) || 0,
          twoPtConversions: parseInt(cells[22].replace(/"/g, '')) || 0,
          gamesPlayed: parseInt(cells[23].replace(/"/g, '')) || 0
        })
      }
    }
  }
  
  return players
}

export function parseFantraxTeamStats(csvContent: string): FantraxTeamStats[] {
  const lines = csvContent.split('\n').filter(l => l.trim())
  const stats: FantraxTeamStats[] = []
  
  let inStatsSection = false
  
  for (const line of lines) {
    const cells = parseCSVLine(line)
    const firstCell = cells[0]?.replace(/"/g, '')
    
    if (firstCell === 'Standings' && cells.length >= 7) {
      const secondCell = cells[1]?.replace(/"/g, '')
      if (secondCell === '' || !secondCell) {
        continue
      }
    }
    
    if (cells[1]?.replace(/"/g, '') === 'Team' && cells[2]?.replace(/"/g, '') === 'FPts') {
      inStatsSection = true
      continue
    }
    
    if (firstCell?.startsWith('Passing') || firstCell?.startsWith('Rushing') || 
        firstCell?.startsWith('Receiving') || firstCell?.startsWith('Receptions') ||
        firstCell?.startsWith('Fumbles') || firstCell?.startsWith('Kickoff') ||
        firstCell?.startsWith('Two Point') || firstCell?.startsWith('Standings -')) {
      inStatsSection = false
      continue
    }
    
    if (inStatsSection && cells.length >= 8) {
      const rank = parseInt(cells[0].replace(/"/g, ''))
      if (!isNaN(rank)) {
        stats.push({
          rank,
          team: cells[1].replace(/"/g, ''),
          totalPoints: parseNumber(cells[2]),
          pointsPerGame: parseNumber(cells[3]),
          gamesPlayed: parseInt(cells[4].replace(/"/g, '')) || 0,
          passingYards: 0,
          passingTDs: 0,
          rushingYards: 0,
          rushingTDs: 0,
          receptions: 0,
          receivingYards: 0,
          receivingTDs: 0
        })
      }
    }
  }
  
  return stats
}

export function extractLeagueNameFromFilename(filename: string): string {
  const match = filename.match(/Fantrax-.*?-(.+?)(?:_\d+)?\.csv/)
  if (match) {
    return match[1].replace(/_/g, ' ').replace(/\(\d+\)/g, '').trim()
  }
  return 'Unknown League'
}

function cleanHtmlTags(str: string): string {
  return str.replace(/<\/?b>/g, '').replace(/"/g, '').trim()
}

export function parseFantraxClaimsDrops(csvContent: string, userTeam: string): FantraxTransaction[] {
  const lines = csvContent.split('\n').filter(l => l.trim())
  const transactions: FantraxTransaction[] = []
  
  let headerSkipped = false
  
  for (const line of lines) {
    const cells = parseCSVLine(line)
    
    if (cells[0]?.includes('Player') || cells[0] === '"Player"') {
      headerSkipped = true
      continue
    }
    
    if (!headerSkipped || cells.length < 7) continue
    
    const player = cleanHtmlTags(cells[0])
    const team = cleanHtmlTags(cells[1])
    const position = cleanHtmlTags(cells[2])
    const transactionType = cleanHtmlTags(cells[3]).toLowerCase()
    const managerTeam = cleanHtmlTags(cells[4])
    const bidStr = cleanHtmlTags(cells[5])
    const dateStr = cleanHtmlTags(cells[6])
    const weekStr = cleanHtmlTags(cells[7] || '0')
    
    const bid = bidStr ? parseFloat(bidStr) : undefined
    const week = parseInt(weekStr) || 0
    
    if (transactionType === 'claim' || transactionType === 'drop') {
      transactions.push({
        type: transactionType as 'claim' | 'drop',
        player,
        team,
        position,
        date: dateStr,
        week,
        managerTeam,
        bid: transactionType === 'claim' ? bid : undefined
      })
    }
  }
  
  return transactions
}

export function parseFantraxTrades(csvContent: string, userTeam: string): FantraxTransaction[] {
  const lines = csvContent.split('\n').filter(l => l.trim())
  const transactions: FantraxTransaction[] = []
  
  let headerSkipped = false
  
  for (const line of lines) {
    const cells = parseCSVLine(line)
    
    if (cells[0]?.includes('Player') || cells[0] === '"Player"') {
      headerSkipped = true
      continue
    }
    
    if (!headerSkipped || cells.length < 6) continue
    
    const player = cleanHtmlTags(cells[0])
    const team = cleanHtmlTags(cells[1])
    const position = cleanHtmlTags(cells[2])
    const fromTeam = cleanHtmlTags(cells[3])
    const toTeam = cleanHtmlTags(cells[4])
    const dateStr = cleanHtmlTags(cells[5])
    const weekStr = cleanHtmlTags(cells[6] || '0')
    
    const week = parseInt(weekStr) || 0
    
    const isDraftPick = player.includes('Draft Pick')
    let pickRound: number | undefined
    let pickNumber: number | undefined
    
    if (isDraftPick) {
      const pickMatch = player.match(/Round (\d+) Pick (\d+)/)
      if (pickMatch) {
        pickRound = parseInt(pickMatch[1])
        pickNumber = parseInt(pickMatch[2])
      }
    }
    
    transactions.push({
      type: 'trade',
      player,
      team,
      position,
      date: dateStr,
      week,
      managerTeam: fromTeam,
      fromTeam,
      toTeam,
      isDraftPick,
      pickRound,
      pickNumber
    })
  }
  
  return transactions
}

export function parseFantraxLineupChanges(csvContent: string, userTeam: string): FantraxTransaction[] {
  const lines = csvContent.split('\n').filter(l => l.trim())
  const transactions: FantraxTransaction[] = []
  
  let headerSkipped = false
  
  for (const line of lines) {
    const cells = parseCSVLine(line)
    
    if (cells[0]?.includes('Player') || cells[0] === '"Player"') {
      headerSkipped = true
      continue
    }
    
    if (!headerSkipped || cells.length < 7) continue
    
    const player = cleanHtmlTags(cells[0])
    const team = cleanHtmlTags(cells[1])
    const position = cleanHtmlTags(cells[2])
    const managerTeam = cleanHtmlTags(cells[3])
    const fromSlot = cleanHtmlTags(cells[4])
    const toSlot = cleanHtmlTags(cells[5])
    const dateStr = cleanHtmlTags(cells[6])
    const weekStr = cleanHtmlTags(cells[7] || '0')
    
    const week = parseInt(weekStr) || 0
    
    transactions.push({
      type: 'lineup_change',
      player,
      team,
      position,
      date: dateStr,
      week,
      managerTeam,
      fromSlot,
      toSlot
    })
  }
  
  return transactions
}

export function parseFantraxTransactionHistory(
  files: { name: string; content: string }[],
  userTeam: string
): FantraxTransactionHistory {
  const history: FantraxTransactionHistory = {
    claims: [],
    drops: [],
    trades: [],
    lineupChanges: [],
    userTransactions: []
  }
  
  for (const file of files) {
    const name = file.name.toLowerCase()
    
    try {
      if (name.includes('claims') || name.includes('drops')) {
        const transactions = parseFantraxClaimsDrops(file.content, userTeam)
        history.claims.push(...transactions.filter(t => t.type === 'claim'))
        history.drops.push(...transactions.filter(t => t.type === 'drop'))
      } else if (name.includes('trade') && !name.includes('lineup')) {
        history.trades.push(...parseFantraxTrades(file.content, userTeam))
      } else if (name.includes('lineup')) {
        history.lineupChanges.push(...parseFantraxLineupChanges(file.content, userTeam))
      }
    } catch (err) {
      console.error(`Error parsing transaction file ${file.name}:`, err)
    }
  }
  
  const normalizedUserTeam = userTeam.toLowerCase()
  history.userTransactions = [
    ...history.claims.filter(t => t.managerTeam.toLowerCase().includes(normalizedUserTeam)),
    ...history.drops.filter(t => t.managerTeam.toLowerCase().includes(normalizedUserTeam)),
    ...history.trades.filter(t => 
      t.fromTeam?.toLowerCase().includes(normalizedUserTeam) || 
      t.toTeam?.toLowerCase().includes(normalizedUserTeam)
    ),
    ...history.lineupChanges.filter(t => t.managerTeam.toLowerCase().includes(normalizedUserTeam))
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  
  return history
}

export function findChampion(standings: FantraxStanding[], playoffMatchups: FantraxMatchup[]): string | null {
  const finalRound = playoffMatchups.filter(m => m.isPlayoff)
    .sort((a, b) => (b.playoffRound || 0) - (a.playoffRound || 0))
  
  if (finalRound.length > 0) {
    const championship = finalRound[0]
    return championship.homeScore > championship.awayScore 
      ? championship.homeTeam 
      : championship.awayTeam
  }
  
  if (standings.length > 0 && standings[0].winPct === 1) {
    return standings[0].team
  }
  
  return null
}

export function calculateUserStats(
  userTeam: string,
  standings: FantraxStanding[],
  matchups: FantraxMatchup[]
): {
  record: { wins: number; losses: number; ties: number }
  pointsFor: number
  pointsAgainst: number
  rank: number
  playoffFinish: string | null
  isChampion: boolean
} {
  const userStanding = standings.find(s => s.team === userTeam)
  const userMatchups = matchups.filter(m => 
    m.awayTeam === userTeam || m.homeTeam === userTeam
  )
  
  const playoffGames = userMatchups.filter(m => m.isPlayoff)
  let playoffFinish: string | null = null
  let isChampion = false
  
  if (playoffGames.length > 0) {
    const lastPlayoffGame = playoffGames.sort((a, b) => (b.playoffRound || 0) - (a.playoffRound || 0))[0]
    const didWin = (lastPlayoffGame.homeTeam === userTeam && lastPlayoffGame.homeScore > lastPlayoffGame.awayScore) ||
                   (lastPlayoffGame.awayTeam === userTeam && lastPlayoffGame.awayScore > lastPlayoffGame.homeScore)
    
    if (lastPlayoffGame.playoffRound === 3 || lastPlayoffGame.playoffRound === 4) {
      playoffFinish = didWin ? 'Champion' : 'Runner-up'
      isChampion = didWin
    } else if (lastPlayoffGame.playoffRound === 2) {
      playoffFinish = didWin ? 'Finalist' : 'Semifinalist'
    } else {
      playoffFinish = 'Playoff Team'
    }
  }
  
  return {
    record: {
      wins: userStanding?.wins || 0,
      losses: userStanding?.losses || 0,
      ties: userStanding?.ties || 0
    },
    pointsFor: userStanding?.pointsFor || 0,
    pointsAgainst: userStanding?.pointsAgainst || 0,
    rank: userStanding?.rank || 0,
    playoffFinish,
    isChampion
  }
}

export interface FantraxImportResult {
  success: boolean
  leagueName: string
  season: number
  userTeam: string
  teamCount: number
  standings: FantraxStanding[]
  matchups: FantraxMatchup[]
  roster: FantraxPlayer[]
  userStats: ReturnType<typeof calculateUserStats>
  champion: string | null
  errors: string[]
  transactions?: FantraxTransactionHistory
  isDevy?: boolean
  sport?: string
}

export function parseFantraxFiles(
  files: { name: string; content: string }[],
  userTeam: string,
  options?: { leagueName?: string; isDevy?: boolean; sport?: string }
): FantraxImportResult {
  const errors: string[] = []
  let leagueName = options?.leagueName || 'Unknown League'
  let standings: FantraxStanding[] = []
  let matchups: FantraxMatchup[] = []
  let roster: FantraxPlayer[] = []
  let playoffMatchups: FantraxMatchup[] = []
  let transactions: FantraxTransactionHistory | undefined
  
  const transactionFiles: { name: string; content: string }[] = []
  
  for (const file of files) {
    const name = file.name.toLowerCase()
    
    if (leagueName === 'Unknown League') {
      leagueName = extractLeagueNameFromFilename(file.name)
    }
    
    try {
      if (name.includes('transaction') || name.includes('claims') || name.includes('drops') || 
          (name.includes('trade') && name.includes('history')) || name.includes('lineup_changes')) {
        transactionFiles.push(file)
      } else if (name.includes('roster')) {
        roster = parseFantraxRoster(file.content)
      } else if (name.includes('standings')) {
        const parsedStandings = parseFantraxStandings(file.content)
        if (parsedStandings.length > standings.length) {
          standings = parsedStandings
        }
        
        const parsedMatchups = parseFantraxMatchups(file.content)
        if (parsedMatchups.length > 0) {
          const regularSeason = parsedMatchups.filter(m => !m.isPlayoff)
          const playoffs = parsedMatchups.filter(m => m.isPlayoff)
          
          if (regularSeason.length > matchups.filter(m => !m.isPlayoff).length) {
            matchups = [...matchups.filter(m => m.isPlayoff), ...regularSeason]
          }
          if (playoffs.length > playoffMatchups.length) {
            playoffMatchups = playoffs
            matchups = [...matchups.filter(m => !m.isPlayoff), ...playoffs]
          }
        }
      }
    } catch (err) {
      errors.push(`Error parsing ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }
  
  if (transactionFiles.length > 0) {
    transactions = parseFantraxTransactionHistory(transactionFiles, userTeam)
  }
  
  const teamCount = standings.length || 12
  const season = new Date().getFullYear()
  const champion = findChampion(standings, playoffMatchups)
  const userStats = calculateUserStats(userTeam, standings, matchups)
  
  const hasData = standings.length > 0 || roster.length > 0 || transactionFiles.length > 0

  /*
   * ⚠ A PARSE THAT EXTRACTED NOTHING IS NOT A SUCCESS. This previously returned
   * `errors.length === 0 || hasData`, so a file whose format we did not
   * recognise — which throws nothing, it simply matches no filename branch —
   * reported success with an empty roster and empty standings. The upload route
   * only rejects when `!success && errors.length > 0`, so that hollow result
   * sailed through and upserted a FantraxLeague row with no players in it. A
   * franchise link would then attach to an empty league and grade trades against
   * a roster that does not exist.
   *
   * Naming it as an error is what makes the existing route reject it, and tells
   * the uploader the real problem: the files were readable, they just were not
   * the ones we select on.
   */
  if (!hasData) {
    errors.push(
      'No recognisable Fantrax data was found. Export the league CSVs from Fantrax and include ' +
        'files whose names contain "roster", "standings", or "transactions"/"claims"/"drops" — ' +
        'the parser selects files by name and ignores anything else.',
    )
  }

  return {
    /* Both halves required: no errors AND something actually parsed. */
    success: errors.length === 0 && hasData,
    leagueName,
    season,
    userTeam,
    teamCount,
    standings,
    matchups,
    roster,
    userStats,
    champion,
    errors,
    transactions,
    isDevy: options?.isDevy,
    sport: options?.sport || 'cfb'
  }
}
