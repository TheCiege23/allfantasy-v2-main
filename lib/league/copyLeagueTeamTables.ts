/**
 * The real teams a copy league can take in the NBA, NHL and MLB (lib/league/copyLeague.ts; NFL comes from
 * lib/team-abbrev). Generated from ESPN's team lists, captured 2026-11-19 through
 * contracts/espn/scripts/probe.sh: contracts/espn/fixtures/teams.{NBA,NHL,MLB}.json. Each row is a team's
 * `abbreviation`, `displayName` and default 500px logo, as ESPN sends them.
 *
 * Why not lib/sport-teams/SportTeamMetadataRegistry.ts: its lists are abbreviations only and out of date
 * (NHL still has ARI and no Utah; MLB has OAK and builds the White Sox crest as `cws`, which ESPN does not
 * serve: it is `chw`). The test __tests__/league/copy-league-team-tables.test.ts reads the captures and fails
 * if this file and them disagree, so a recapture that adds, renames or moves a team shows up there.
 *
 * Codes are ESPN's, because they are also the crest file names. They are stored in
 * `League.settings.copy_league.teams`, so do not change a code once leagues use it.
 */
import type { CopyLeagueTeam } from './copyLeague'

export const COPY_LEAGUE_NBA_TEAMS: readonly CopyLeagueTeam[] = [
  { code: 'ATL', name: 'Atlanta Hawks', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/atl.png' },
  { code: 'BOS', name: 'Boston Celtics', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/bos.png' },
  { code: 'BKN', name: 'Brooklyn Nets', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/bkn.png' },
  { code: 'CHA', name: 'Charlotte Hornets', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/cha.png' },
  { code: 'CHI', name: 'Chicago Bulls', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/chi.png' },
  { code: 'CLE', name: 'Cleveland Cavaliers', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/cle.png' },
  { code: 'DAL', name: 'Dallas Mavericks', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/dal.png' },
  { code: 'DEN', name: 'Denver Nuggets', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/den.png' },
  { code: 'DET', name: 'Detroit Pistons', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/det.png' },
  { code: 'GS', name: 'Golden State Warriors', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/gs.png' },
  { code: 'HOU', name: 'Houston Rockets', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/hou.png' },
  { code: 'IND', name: 'Indiana Pacers', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/ind.png' },
  { code: 'LAC', name: 'LA Clippers', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/lac.png' },
  { code: 'LAL', name: 'Los Angeles Lakers', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/lal.png' },
  { code: 'MEM', name: 'Memphis Grizzlies', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/mem.png' },
  { code: 'MIA', name: 'Miami Heat', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/mia.png' },
  { code: 'MIL', name: 'Milwaukee Bucks', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/mil.png' },
  { code: 'MIN', name: 'Minnesota Timberwolves', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/min.png' },
  { code: 'NO', name: 'New Orleans Pelicans', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/no.png' },
  { code: 'NY', name: 'New York Knicks', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/ny.png' },
  { code: 'OKC', name: 'Oklahoma City Thunder', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/okc.png' },
  { code: 'ORL', name: 'Orlando Magic', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/orl.png' },
  { code: 'PHI', name: 'Philadelphia 76ers', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/phi.png' },
  { code: 'PHX', name: 'Phoenix Suns', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/phx.png' },
  { code: 'POR', name: 'Portland Trail Blazers', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/por.png' },
  { code: 'SAC', name: 'Sacramento Kings', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/sac.png' },
  { code: 'SA', name: 'San Antonio Spurs', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/sa.png' },
  { code: 'TOR', name: 'Toronto Raptors', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/tor.png' },
  { code: 'UTAH', name: 'Utah Jazz', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/utah.png' },
  { code: 'WSH', name: 'Washington Wizards', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/wsh.png' },
]

export const COPY_LEAGUE_NHL_TEAMS: readonly CopyLeagueTeam[] = [
  { code: 'ANA', name: 'Anaheim Ducks', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/ana.png' },
  { code: 'BOS', name: 'Boston Bruins', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/bos.png' },
  { code: 'BUF', name: 'Buffalo Sabres', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/buf.png' },
  { code: 'CGY', name: 'Calgary Flames', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/cgy.png' },
  { code: 'CAR', name: 'Carolina Hurricanes', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/car.png' },
  { code: 'CHI', name: 'Chicago Blackhawks', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/chi.png' },
  { code: 'COL', name: 'Colorado Avalanche', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/col.png' },
  { code: 'CBJ', name: 'Columbus Blue Jackets', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/cbj.png' },
  { code: 'DAL', name: 'Dallas Stars', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/dal.png' },
  { code: 'DET', name: 'Detroit Red Wings', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/det.png' },
  { code: 'EDM', name: 'Edmonton Oilers', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/edm.png' },
  { code: 'FLA', name: 'Florida Panthers', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/fla.png' },
  { code: 'LA', name: 'Los Angeles Kings', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/la.png' },
  { code: 'MIN', name: 'Minnesota Wild', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/min.png' },
  { code: 'MTL', name: 'Montreal Canadiens', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/mtl.png' },
  { code: 'NSH', name: 'Nashville Predators', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/nsh.png' },
  { code: 'NJ', name: 'New Jersey Devils', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/nj.png' },
  { code: 'NYI', name: 'New York Islanders', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/nyi.png' },
  { code: 'NYR', name: 'New York Rangers', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/nyr.png' },
  { code: 'OTT', name: 'Ottawa Senators', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/ott.png' },
  { code: 'PHI', name: 'Philadelphia Flyers', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/phi.png' },
  { code: 'PIT', name: 'Pittsburgh Penguins', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/pit.png' },
  { code: 'SJ', name: 'San Jose Sharks', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/sj.png' },
  { code: 'SEA', name: 'Seattle Kraken', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/sea.png' },
  { code: 'STL', name: 'St. Louis Blues', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/stl.png' },
  { code: 'TB', name: 'Tampa Bay Lightning', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/tb.png' },
  { code: 'TOR', name: 'Toronto Maple Leafs', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/tor.png' },
  { code: 'UTAH', name: 'Utah Mammoth', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/utah.png' },
  { code: 'VAN', name: 'Vancouver Canucks', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/van.png' },
  { code: 'VGK', name: 'Vegas Golden Knights', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/vgk.png' },
  { code: 'WSH', name: 'Washington Capitals', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/wsh.png' },
  { code: 'WPG', name: 'Winnipeg Jets', logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/wpg.png' },
]

export const COPY_LEAGUE_MLB_TEAMS: readonly CopyLeagueTeam[] = [
  { code: 'ARI', name: 'Arizona Diamondbacks', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/ari.png' },
  { code: 'ATH', name: 'Athletics', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/ath.png' },
  { code: 'ATL', name: 'Atlanta Braves', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/atl.png' },
  { code: 'BAL', name: 'Baltimore Orioles', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/bal.png' },
  { code: 'BOS', name: 'Boston Red Sox', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/bos.png' },
  { code: 'CHC', name: 'Chicago Cubs', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/chc.png' },
  { code: 'CHW', name: 'Chicago White Sox', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/chw.png' },
  { code: 'CIN', name: 'Cincinnati Reds', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/cin.png' },
  { code: 'CLE', name: 'Cleveland Guardians', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/cle.png' },
  { code: 'COL', name: 'Colorado Rockies', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/col.png' },
  { code: 'DET', name: 'Detroit Tigers', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/det.png' },
  { code: 'HOU', name: 'Houston Astros', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/hou.png' },
  { code: 'KC', name: 'Kansas City Royals', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/kc.png' },
  { code: 'LAA', name: 'Los Angeles Angels', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/laa.png' },
  { code: 'LAD', name: 'Los Angeles Dodgers', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/lad.png' },
  { code: 'MIA', name: 'Miami Marlins', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/mia.png' },
  { code: 'MIL', name: 'Milwaukee Brewers', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/mil.png' },
  { code: 'MIN', name: 'Minnesota Twins', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/min.png' },
  { code: 'NYM', name: 'New York Mets', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/nym.png' },
  { code: 'NYY', name: 'New York Yankees', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/nyy.png' },
  { code: 'PHI', name: 'Philadelphia Phillies', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/phi.png' },
  { code: 'PIT', name: 'Pittsburgh Pirates', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/pit.png' },
  { code: 'SD', name: 'San Diego Padres', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/sd.png' },
  { code: 'SF', name: 'San Francisco Giants', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/sf.png' },
  { code: 'SEA', name: 'Seattle Mariners', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/sea.png' },
  { code: 'STL', name: 'St. Louis Cardinals', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/stl.png' },
  { code: 'TB', name: 'Tampa Bay Rays', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/tb.png' },
  { code: 'TEX', name: 'Texas Rangers', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/tex.png' },
  { code: 'TOR', name: 'Toronto Blue Jays', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/tor.png' },
  { code: 'WSH', name: 'Washington Nationals', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/wsh.png' },
]
