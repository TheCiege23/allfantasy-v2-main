import { prisma } from '@/lib/prisma';
import { normalizeTeamAbbrev } from '@/lib/team-abbrev';
import { createHash } from 'crypto';
import { SUPPORTED_SPORTS, type SupportedSport } from '@/lib/sport-scope';
import { ESPN_SITE_API_BASE } from '@/lib/providers/espnUrls'

const NEWS_FRESHNESS_MS = 30 * 60 * 1000;

const ABBREV_TO_FULL_NAME: Record<string, string> = {
  'ARI': 'Arizona Cardinals', 'ATL': 'Atlanta Falcons', 'BAL': 'Baltimore Ravens',
  'BUF': 'Buffalo Bills', 'CAR': 'Carolina Panthers', 'CHI': 'Chicago Bears',
  'CIN': 'Cincinnati Bengals', 'CLE': 'Cleveland Browns', 'DAL': 'Dallas Cowboys',
  'DEN': 'Denver Broncos', 'DET': 'Detroit Lions', 'GB': 'Green Bay Packers',
  'HOU': 'Houston Texans', 'IND': 'Indianapolis Colts', 'JAX': 'Jacksonville Jaguars',
  'KC': 'Kansas City Chiefs', 'LV': 'Las Vegas Raiders', 'LAC': 'Los Angeles Chargers',
  'LAR': 'Los Angeles Rams', 'MIA': 'Miami Dolphins', 'MIN': 'Minnesota Vikings',
  'NE': 'New England Patriots', 'NO': 'New Orleans Saints', 'NYG': 'New York Giants',
  'NYJ': 'New York Jets', 'PHI': 'Philadelphia Eagles', 'PIT': 'Pittsburgh Steelers',
  'SEA': 'Seattle Seahawks', 'SF': 'San Francisco 49ers', 'TB': 'Tampa Bay Buccaneers',
  'TEN': 'Tennessee Titans', 'WAS': 'Washington Commanders',
};

const SPORTS_DOMAINS = [
  'espn.com', 'bleacherreport.com', 'nfl.com', 'cbssports.com', 'foxsports.com',
  'theathletic.com', 'si.com', 'profootballtalk.nbcsports.com', 'yahoo.com',
  'rotoworld.com', 'fantasypros.com', 'rotowire.com', 'footballoutsiders.com',
  'pff.com', 'nfltraderumors.co', 'sportingnews.com',
].join(',');

const EXCLUDE_DOMAINS = [
  'reddit.com', 'twitter.com', 'facebook.com', 'tiktok.com',
].join(',');

const FANTASY_QUERY_PATTERNS = [
  'NFL fantasy football trade',
  'NFL waiver wire pickup',
  'NFL injury report update',
  'NFL draft prospect rookie',
  'NFL free agent signing',
  'NFL dynasty fantasy trade value',
  'NFL start sit fantasy',
];

function stableArticleId(url: string, fallback: string): string {
  const input = url || fallback;
  return createHash('sha256').update(input).digest('hex').slice(0, 40);
}

interface NewsArticle {
  id: string;
  /** Prisma `LeagueSport` — required for DB upsert (`SportsNews.sport`). */
  sport: SupportedSport;
  title: string;
  description: string | null;
  content: string | null;
  url: string;
  published: string;
  team: string | null;
  teams: string[];
  source: string;
  sourceId: string | null;
  author: string | null;
  imageUrl: string | null;
  playerNames: string[];
  categories: string[];
  sentiment: string | null;
}

/** ESPN `site.web.api.espn.com` sports path segment per league (multi-sport news ingest). */
const ESPN_NEWS_SPORTS_PATH: Record<SupportedSport, string> = {
  NFL: 'football/nfl',
  NBA: 'basketball/nba',
  NHL: 'hockey/nhl',
  MLB: 'baseball/mlb',
  NCAAF: 'football/college-football',
  NCAAB: 'basketball/mens-college-basketball',
  SOCCER: 'soccer/usa.1',
}

const NFL_TEAM_KEYWORDS: Record<string, string> = {
  'cardinals': 'ARI', 'arizona cardinals': 'ARI',
  'falcons': 'ATL', 'atlanta falcons': 'ATL',
  'ravens': 'BAL', 'baltimore ravens': 'BAL',
  'bills': 'BUF', 'buffalo bills': 'BUF',
  'panthers': 'CAR', 'carolina panthers': 'CAR',
  'bears': 'CHI', 'chicago bears': 'CHI',
  'bengals': 'CIN', 'cincinnati bengals': 'CIN',
  'browns': 'CLE', 'cleveland browns': 'CLE',
  'cowboys': 'DAL', 'dallas cowboys': 'DAL',
  'broncos': 'DEN', 'denver broncos': 'DEN',
  'lions': 'DET', 'detroit lions': 'DET',
  'packers': 'GB', 'green bay packers': 'GB',
  'texans': 'HOU', 'houston texans': 'HOU',
  'colts': 'IND', 'indianapolis colts': 'IND',
  'jaguars': 'JAX', 'jacksonville jaguars': 'JAX',
  'chiefs': 'KC', 'kansas city chiefs': 'KC',
  'raiders': 'LV', 'las vegas raiders': 'LV',
  'chargers': 'LAC', 'los angeles chargers': 'LAC',
  'rams': 'LAR', 'los angeles rams': 'LAR',
  'dolphins': 'MIA', 'miami dolphins': 'MIA',
  'vikings': 'MIN', 'minnesota vikings': 'MIN',
  'patriots': 'NE', 'new england patriots': 'NE',
  'saints': 'NO', 'new orleans saints': 'NO',
  'giants': 'NYG', 'new york giants': 'NYG',
  'jets': 'NYJ', 'new york jets': 'NYJ',
  'eagles': 'PHI', 'philadelphia eagles': 'PHI',
  'steelers': 'PIT', 'pittsburgh steelers': 'PIT',
  'seahawks': 'SEA', 'seattle seahawks': 'SEA',
  '49ers': 'SF', 'san francisco 49ers': 'SF', 'niners': 'SF',
  'buccaneers': 'TB', 'tampa bay buccaneers': 'TB', 'bucs': 'TB',
  'titans': 'TEN', 'tennessee titans': 'TEN',
  'commanders': 'WAS', 'washington commanders': 'WAS',
};

function extractAllTeamsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  const sortedKeywords = Object.entries(NFL_TEAM_KEYWORDS)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [keyword, abbrev] of sortedKeywords) {
    if (lower.includes(keyword)) {
      found.add(abbrev);
    }
  }
  return Array.from(found);
}

function extractTeamFromText(text: string): string | null {
  const teams = extractAllTeamsFromText(text);
  return teams.length > 0 ? teams[0] : null;
}

let _cachedPlayerNames: { names: Map<string, string>; fetchedAt: number } | null = null;
const PLAYER_CACHE_TTL = 10 * 60 * 1000;

async function getKnownPlayerNames(): Promise<Map<string, string>> {
  if (_cachedPlayerNames && Date.now() - _cachedPlayerNames.fetchedAt < PLAYER_CACHE_TTL) {
    return _cachedPlayerNames.names;
  }

  const nameMap = new Map<string, string>();
  try {
    const players = await prisma.playerIdentityMap.findMany({
      where: { sport: 'NFL' },
      select: { canonicalName: true },
      take: 3000,
    });
    for (const p of players) {
      if (p.canonicalName) {
        nameMap.set(p.canonicalName.toLowerCase(), p.canonicalName);
      }
    }
  } catch {
  }

  _cachedPlayerNames = { names: nameMap, fetchedAt: Date.now() };
  return nameMap;
}

function extractPlayerNamesFromText(text: string, knownPlayers: Map<string, string>): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();

  for (const [lowerName, canonical] of knownPlayers) {
    if (lower.includes(lowerName)) {
      found.push(canonical);
    }
  }

  if (found.length === 0) {
    const namePattern = /\b([A-Z][a-z]+(?:\s(?:Jr\.|Sr\.|III|II|IV))?)\s([A-Z][a-z]{2,}(?:\s(?:Jr\.|Sr\.|III|II|IV))?)\b/g;
    const commonWords = new Set([
      'The', 'New', 'San', 'Los', 'Las', 'Bay', 'Green', 'Kansas', 'City',
      'York', 'England', 'Tampa', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
      'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April',
      'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
      'Super', 'Bowl', 'Pro', 'Week', 'Season', 'Game', 'Trade', 'Draft', 'Free',
      'Agent', 'Fantasy', 'Football', 'Breaking', 'Report', 'Update', 'News',
      'According', 'Sources', 'Per', 'Via', 'Just', 'Now', 'First', 'Last',
      'North', 'South', 'East', 'West', 'United', 'States', 'National',
    ]);

    let match;
    while ((match = namePattern.exec(text)) !== null) {
      const first = match[1];
      const last = match[2];
      if (!commonWords.has(first) && !commonWords.has(last)) {
        found.push(`${first} ${last}`);
      }
    }
  }

  return [...new Set(found)].slice(0, 10);
}

function detectSentiment(title: string, description: string | null): string | null {
  const text = `${title} ${description || ''}`.toLowerCase();

  const negativePatterns = [
    'injury', 'injured', 'tear', 'torn', 'out for', 'ruled out', 'doubtful',
    'surgery', 'ir ', 'injured reserve', 'suspend', 'cut', 'released', 'waived',
    'arrested', 'setback', 'concern', 'disappointing', 'struggling', 'decline',
    'downgrade', 'questionable', 'miss', 'absence', 'sidelined', 'fracture',
    'concussion', 'acl', 'mcl', 'hamstring', 'ankle sprain',
  ];

  const positivePatterns = [
    'breakout', 'extension', 'signed', 'return', 'returning', 'cleared',
    'promoted', 'starter', 'upgrade', 'rising', 'surge', 'career high',
    'record', 'dominant', 'elite', 'contract', 'deal', 'activated',
    'practicing', 'full practice', 'no limitations', 'healthy',
    'trending up', 'hot streak', 'sleeper', 'must add', 'pickup',
  ];

  const tradePatterns = [
    'trade', 'traded', 'swap', 'deal', 'blockbuster', 'package',
    'acquire', 'send', 'move', 'exchange',
  ];

  let negScore = 0;
  let posScore = 0;
  let tradeScore = 0;

  for (const p of negativePatterns) {
    if (text.includes(p)) negScore++;
  }
  for (const p of positivePatterns) {
    if (text.includes(p)) posScore++;
  }
  for (const p of tradePatterns) {
    if (text.includes(p)) tradeScore++;
  }

  if (tradeScore >= 2) return 'trade';
  if (negScore > posScore && negScore >= 2) return 'negative';
  if (posScore > negScore && posScore >= 2) return 'positive';
  if (negScore > 0 && posScore > 0) return 'mixed';
  if (negScore > 0) return 'negative';
  if (posScore > 0) return 'positive';
  return 'neutral';
}

function classifyCategory(title: string, description: string | null): string {
  const text = `${title} ${description || ''}`.toLowerCase();

  if (/injur|torn|tear|surgery|concuss|hamstring|acl|mcl|ir\b|injured reserve|sidelined/.test(text)) return 'injury';
  if (/trade|traded|swap|deal|blockbuster|acquire|package/.test(text)) return 'trade';
  if (/waiver|pickup|add|claim|free agent|wire/.test(text)) return 'waiver';
  if (/draft|prospect|rookie|combine|mock draft|pick|selection/.test(text)) return 'draft';
  if (/sign|contract|extension|restructure|cap space|salary/.test(text)) return 'contract';
  if (/start|sit|lineup|matchup|projection|ranking|rest of season/.test(text)) return 'fantasy_advice';
  if (/score|touchdown|yard|game|win|loss|recap|highlight|play/.test(text)) return 'game_recap';
  if (/suspend|fine|arrest|disciplin|banned|personal conduct/.test(text)) return 'discipline';
  if (/coach|hire|fire|coordinator|staff|scheme/.test(text)) return 'coaching';
  if (/dynasty|keeper|rebuild|contend|window|long.?term/.test(text)) return 'dynasty';
  if (/devy|college|ncaa|cfb/.test(text)) return 'college';
  return 'general';
}

async function mapEspnNewsJsonToArticles(
  data: { articles?: unknown[] },
  sport: SupportedSport,
  teamFilter?: string
): Promise<NewsArticle[]> {
  const articles = data.articles || [];
  const knownPlayers = await getKnownPlayerNames();
  const results: NewsArticle[] = [];

  for (const raw of articles) {
    const a = raw as Record<string, unknown>;
    const categories = (a.categories || []) as Array<{ description?: string; type?: string }>;
    const teamCategory = categories.find((c) => c.type === 'team');
    const teamAbbrev = teamCategory ? normalizeTeamAbbrev(teamCategory.description || '') : null;

    const title = String(a.headline || a.title || '');
    const desc = String(a.description || '');
    const combinedText = `${title} ${desc}`;
    const allTeams = extractAllTeamsFromText(combinedText);
    const playerNames = extractPlayerNamesFromText(combinedText, knownPlayers);
    const primaryTeam =
      teamAbbrev || (teamFilter ? normalizeTeamAbbrev(teamFilter) : null) || (allTeams[0] || null);

    results.push({
      id: String(a.id || ''),
      sport,
      title,
      description: desc || null,
      content: String(a.story || a.description || ''),
      url: (a.links as { web?: { href?: string } } | undefined)?.web?.href || '',
      published: String(a.published || ''),
      team: primaryTeam,
      teams: allTeams,
      source: 'espn',
      sourceId: 'espn',
      author: (a.byline as string) || null,
      imageUrl: (a.images as Array<{ url?: string }> | undefined)?.[0]?.url || null,
      playerNames,
      categories: [
        ...categories.map((c) => c.description || ''),
        classifyCategory(title, desc),
      ],
      sentiment: detectSentiment(title, desc),
    });
  }

  return results;
}

/** ESPN headlines for one sport (stored with correct `sport` for DB reads). */
export async function fetchESPNNewsForSport(
  sport: SupportedSport,
  opts?: { team?: string; limit?: number }
): Promise<NewsArticle[]> {
  const path = ESPN_NEWS_SPORTS_PATH[sport];
  const limit = opts?.limit ?? 35;
  const teamQ = opts?.team ? `&team=${encodeURIComponent(opts.team)}` : '';
  const url = `${ESPN_SITE_API_BASE}/${path}/news?limit=${limit}${teamQ}`;

  try {
    const response = await fetch(url, { next: { revalidate: 300 } });
    if (!response.ok) return [];
    const data = await response.json();
    return mapEspnNewsJsonToArticles(data, sport, opts?.team);
  } catch (error) {
    console.error(`[News] ESPN fetch failed (${sport}):`, error);
    return [];
  }
}

/** All supported ESPN league feeds in parallel (DB-backed sync); optional NFL team filter. */
export async function fetchESPNNews(team?: string): Promise<NewsArticle[]> {
  try {
    if (team) {
      return fetchESPNNewsForSport('NFL', { team, limit: 50 });
    }

    const batches = await Promise.all(
      SUPPORTED_SPORTS.map((sport) =>
        fetchESPNNewsForSport(sport, { limit: 30 }).catch(() => [] as NewsArticle[])
      )
    );
    return batches.flat();
  } catch (error) {
    console.error('[News] ESPN fetch failed:', error);
    return [];
  }
}

export async function fetchNewsAPIEverything(query: string, opts?: {
  domains?: string;
  excludeDomains?: string;
  sortBy?: string;
  from?: string;
  pageSize?: number;
  /** Tag rows for `SportsNews.sport` (NewsAPI text is mixed; default NFL). */
  impliedSport?: SupportedSport;
}): Promise<NewsArticle[]> {
  const apiKey = process.env.NEWS_API_KEY || process.env.NEWSAPI_KEY;
  if (!apiKey) {
    console.warn('[News] NEWS_API_KEY/NEWSAPI_KEY not set, skipping NewsAPI fetch');
    return [];
  }

  try {
    const fromDate = opts?.from || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const params = new URLSearchParams({
      q: query,
      language: 'en',
      sortBy: opts?.sortBy || 'publishedAt',
      from: fromDate,
      pageSize: String(opts?.pageSize || 100),
      apiKey,
    });

    if (opts?.domains) {
      params.set('domains', opts.domains);
    }
    if (opts?.excludeDomains) {
      params.set('excludeDomains', opts.excludeDomains);
    }

    const response = await fetch(`https://newsapi.org/v2/everything?${params.toString()}`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[News] NewsAPI /everything failed:', response.status, errorData);
      return [];
    }

    const data = await response.json();
    return parseNewsAPIResponse(data.articles || [], 'newsapi_everything', opts?.impliedSport ?? 'NFL');
  } catch (error) {
    console.error('[News] NewsAPI /everything failed:', error);
    return [];
  }
}

export async function fetchNewsAPITopHeadlines(opts?: {
  category?: string;
  country?: string;
  query?: string;
  pageSize?: number;
}): Promise<NewsArticle[]> {
  const apiKey = process.env.NEWS_API_KEY || process.env.NEWSAPI_KEY;
  if (!apiKey) {
    console.warn('[News] NEWS_API_KEY/NEWSAPI_KEY not set, skipping NewsAPI top-headlines');
    return [];
  }

  try {
    const params = new URLSearchParams({
      country: opts?.country || 'us',
      category: opts?.category || 'sports',
      pageSize: String(opts?.pageSize || 100),
      apiKey,
    });

    if (opts?.query) {
      params.set('q', opts.query);
    }

    const response = await fetch(`https://newsapi.org/v2/top-headlines?${params.toString()}`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[News] NewsAPI /top-headlines failed:', response.status, errorData);
      return [];
    }

    const data = await response.json();
    return parseNewsAPIResponse(data.articles || [], 'newsapi_headlines', 'NFL');
  } catch (error) {
    console.error('[News] NewsAPI /top-headlines failed:', error);
    return [];
  }
}

async function parseNewsAPIResponse(
  articles: any[],
  sourceTag: string,
  impliedSport: SupportedSport = 'NFL'
): Promise<NewsArticle[]> {
  const knownPlayers = await getKnownPlayerNames();
  const results: NewsArticle[] = [];

  for (const a of articles) {
    const title = String(a.title || '');
    if (!title || title === '[Removed]') continue;

    const description = a.description ? String(a.description) : null;
    const articleContent = a.content ? String(a.content) : null;
    const articleUrl = String(a.url || '');
    const publishedAt = String(a.publishedAt || '');
    const author = a.author ? String(a.author) : null;
    const imageUrl = a.urlToImage ? String(a.urlToImage) : null;

    const sourceObj = a.source || {};
    const sourceName = sourceObj.name || 'NewsAPI';
    const sId = sourceObj.id || null;

    const combinedText = `${title} ${description || ''} ${articleContent || ''}`;
    const allTeams = extractAllTeamsFromText(combinedText);
    const primaryTeam = allTeams[0] || null;
    const playerNames = extractPlayerNamesFromText(combinedText, knownPlayers);
    const category = classifyCategory(title, description);
    const sentiment = detectSentiment(title, description);

    const articleId = stableArticleId(articleUrl, `${title}-${publishedAt}`);

    results.push({
      id: articleId,
      sport: impliedSport,
      title,
      description,
      content: articleContent,
      url: articleUrl,
      published: publishedAt,
      team: primaryTeam,
      teams: allTeams,
      source: sourceTag,
      sourceId: sId,
      author,
      imageUrl,
      playerNames,
      categories: [sourceName, category],
      sentiment,
    });
  }

  return results;
}

async function upsertArticles(articles: NewsArticle[], sourceName: string): Promise<number> {
  let synced = 0;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + NEWS_FRESHNESS_MS);

  for (const article of articles) {
    if (!article.id) continue;

    try {
      const sport = article.sport ?? 'NFL';

      await prisma.sportsNews.upsert({
        where: {
          sport_externalId_source: {
            sport,
            externalId: article.id,
            source: sourceName,
          },
        },
        update: {
          title: article.title,
          description: article.description,
          content: article.content,
          sourceUrl: article.url,
          sourceId: article.sourceId,
          author: article.author,
          imageUrl: article.imageUrl,
          team: article.team,
          teams: article.teams,
          playerName: article.playerNames[0] || null,
          playerNames: article.playerNames,
          publishedAt: article.published ? new Date(article.published) : null,
          category: article.categories?.join(', ') || null,
          sentiment: article.sentiment,
          fetchedAt: now,
          expiresAt,
        },
        create: {
          sport,
          externalId: article.id,
          title: article.title,
          description: article.description,
          content: article.content,
          source: sourceName,
          sourceId: article.sourceId,
          sourceUrl: article.url,
          author: article.author,
          imageUrl: article.imageUrl,
          team: article.team,
          teams: article.teams,
          playerName: article.playerNames[0] || null,
          playerNames: article.playerNames,
          publishedAt: article.published ? new Date(article.published) : null,
          category: article.categories?.join(', ') || null,
          sentiment: article.sentiment,
          fetchedAt: now,
          expiresAt,
        },
      });
      synced++;
    } catch (err) {
      console.error(`[News] Failed to sync article ${article.id}:`, err);
    }
  }

  return synced;
}

export async function syncNewsToDb(team?: string): Promise<number> {
  const normalizedTeam = team ? normalizeTeamAbbrev(team) : undefined;
  const fullTeamName = normalizedTeam ? ABBREV_TO_FULL_NAME[normalizedTeam] : undefined;
  const teamQuery = fullTeamName ? `NFL ${fullTeamName}` : undefined;

  const fetchPromises: Promise<NewsArticle[]>[] = [
    fetchESPNNews(team),
    fetchNewsAPITopHeadlines({ category: 'sports', query: teamQuery ? fullTeamName : 'NFL' }),
  ];

  if (teamQuery) {
    fetchPromises.push(
      fetchNewsAPIEverything(teamQuery, {
        domains: SPORTS_DOMAINS,
        excludeDomains: EXCLUDE_DOMAINS,
        sortBy: 'publishedAt',
        pageSize: 50,
      }),
    );
  } else {
    fetchPromises.push(
      fetchNewsAPIEverything('NFL football', {
        domains: SPORTS_DOMAINS,
        excludeDomains: EXCLUDE_DOMAINS,
        sortBy: 'publishedAt',
        pageSize: 50,
      }),
      fetchNewsAPIEverything('NFL fantasy trade waiver', {
        sortBy: 'relevancy',
        pageSize: 30,
      }),
    );
  }

  const results = await Promise.all(fetchPromises);

  const espnArticles = results[0];
  const headlineArticles = results[1];
  const everythingArticles = results.slice(2).flat();

  const seenIds = new Set<string>();
  const deduped = (articles: NewsArticle[]): NewsArticle[] => {
    return articles.filter((a) => {
      const key = `${a.sport}:${a.id}`;
      if (seenIds.has(key)) return false;
      seenIds.add(key);
      return true;
    });
  };

  const dedupedEspn = deduped(espnArticles);
  const dedupedHeadlines = deduped(headlineArticles);
  const dedupedEverything = deduped(everythingArticles);

  const [espnSynced, headlinesSynced, everythingSynced] = await Promise.all([
    upsertArticles(dedupedEspn, 'espn'),
    upsertArticles(dedupedHeadlines, 'newsapi_headlines'),
    upsertArticles(dedupedEverything, 'newsapi_everything'),
  ]);

  const total = espnSynced + headlinesSynced + everythingSynced;
  console.log(`[News] Synced: ${espnSynced} ESPN, ${headlinesSynced} Headlines, ${everythingSynced} Everything = ${total} total`);
  return total;
}

/**
 * ESPN-only refresh — no NewsAPI calls, so it is safe to run on a short cadence.
 *
 * WHY THIS EXISTS: `sports_news` sat 107 days stale because the only writers
 * (`syncNewsToDb` / `syncFullNewsCoverage`) are invoked by an on-demand route and
 * an aggregator refresh flag — nothing scheduled. The 15-minute `import-news` cron
 * calls `runNewsImporter`, which re-reads `sports_news` and writes the same rows
 * back into `player_news` under `skipDuplicates`, so it advanced nothing while
 * still reporting `ok:true`.
 *
 * Wiring full coverage into that cron would have meant ~384 NewsAPI calls/day
 * against a 100/day free tier. ESPN has no key and no documented quota, so the
 * fast cadence uses this and NewsAPI runs hourly via `?full=1`.
 */
export async function syncEspnNewsOnly(): Promise<{ total: number; breakdown: Record<string, number> }> {
  const espnArticles = await fetchESPNNews()
  const espn = await upsertArticles(espnArticles, 'espn')
  console.log(`[News] ESPN-only sync: ${espn} articles`)
  return { total: espn, breakdown: { espn } }
}

export async function syncFullNewsCoverage(): Promise<{ total: number; breakdown: Record<string, number> }> {
  const breakdown: Record<string, number> = {};

  const espnArticles = await fetchESPNNews();
  const espnSynced = await upsertArticles(espnArticles, 'espn');
  breakdown.espn = espnSynced;

  const headlineArticles = await fetchNewsAPITopHeadlines({
    category: 'sports',
    query: 'NFL',
    pageSize: 100,
  });
  const headlinesSynced = await upsertArticles(headlineArticles, 'newsapi_headlines');
  breakdown.newsapi_headlines = headlinesSynced;

  const seenIds = new Set<string>();
  for (const a of [...espnArticles, ...headlineArticles]) {
    seenIds.add(`${a.sport}:${a.id}`);
  }

  const queryRotation = FANTASY_QUERY_PATTERNS;
  const rotationIndex = Math.floor(Date.now() / (30 * 60 * 1000)) % queryRotation.length;
  const queriesToRun = [
    queryRotation[rotationIndex],
    queryRotation[(rotationIndex + 1) % queryRotation.length],
    'NFL',
  ];

  for (const q of queriesToRun) {
    const articles = await fetchNewsAPIEverything(q, {
      domains: SPORTS_DOMAINS,
      excludeDomains: EXCLUDE_DOMAINS,
      sortBy: q === 'NFL' ? 'publishedAt' : 'relevancy',
      pageSize: 50,
    });

    const fresh = articles.filter((a) => {
      const key = `${a.sport}:${a.id}`;
      if (seenIds.has(key)) return false;
      seenIds.add(key);
      return true;
    });

    const synced = await upsertArticles(fresh, 'newsapi_everything');
    breakdown[`everything_${q.replace(/\s+/g, '_').toLowerCase()}`] = synced;
  }

  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  console.log(`[News] Full coverage sync: ${total} total articles`, breakdown);
  return { total, breakdown };
}

export async function fetchNewsAPIArticles(query?: string): Promise<NewsArticle[]> {
  return fetchNewsAPIEverything(query || 'NFL football', {
    domains: SPORTS_DOMAINS,
    excludeDomains: EXCLUDE_DOMAINS,
  });
}

export async function syncNewsAPIOnly(query?: string): Promise<number> {
  const articles = await fetchNewsAPIArticles(query);
  return upsertArticles(articles, 'newsapi_everything');
}
