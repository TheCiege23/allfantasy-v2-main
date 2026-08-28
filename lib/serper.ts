import { cachedFetch, cacheKey } from '@/lib/api-cache';
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard';

const SERPER_BASE = 'https://google.serper.dev';
const DEFAULT_TIMEOUT = 8000;

export interface SerperOrganicResult {
  position: number;
  title: string;
  link: string;
  snippet: string;
  date: string | null;
  sitelinks: { title: string; link: string }[] | null;
}

export interface SerperAnswerBox {
  snippet: string;
  snippetHighlighted: string[] | null;
  title: string | null;
  link: string | null;
}

export interface SerperKnowledgeGraph {
  title: string | null;
  type: string | null;
  description: string | null;
  imageUrl: string | null;
  attributes: Record<string, string> | null;
}

export interface SerperTopStory {
  title: string;
  link: string;
  source: string;
  date: string | null;
  imageUrl: string | null;
}

export interface SerperPeopleAlsoAsk {
  question: string;
  snippet: string | null;
  title: string | null;
  link: string | null;
}

export interface SerperRelatedSearch {
  query: string;
}

export interface SerperNewsResult {
  title: string;
  link: string;
  snippet: string;
  date: string | null;
  source: string;
  imageUrl: string | null;
}

export interface SerperSearchResponse {
  searchParameters: Record<string, any>;
  organic: SerperOrganicResult[];
  answerBox: SerperAnswerBox | null;
  knowledgeGraph: SerperKnowledgeGraph | null;
  topStories: SerperTopStory[];
  peopleAlsoAsk: SerperPeopleAlsoAsk[];
  relatedSearches: SerperRelatedSearch[];
}

export interface SerperNewsResponse {
  searchParameters: Record<string, any>;
  news: SerperNewsResult[];
}

function getApiKey(): string | null {
  return process.env.SERPER_API_KEY || null;
}

function parseOrganicResults(raw: any[]): SerperOrganicResult[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(r => ({
    position: r.position ?? 0,
    title: r.title || '',
    link: r.link || '',
    snippet: r.snippet || '',
    date: r.date || null,
    sitelinks: Array.isArray(r.sitelinks?.inline)
      ? r.sitelinks.inline.map((s: any) => ({ title: s.title || '', link: s.link || '' }))
      : null,
  }));
}

function parseAnswerBox(raw: any): SerperAnswerBox | null {
  if (!raw) return null;
  return {
    snippet: raw.snippet || raw.answer || '',
    snippetHighlighted: Array.isArray(raw.snippetHighlighted) ? raw.snippetHighlighted : null,
    title: raw.title || null,
    link: raw.link || null,
  };
}

function parseKnowledgeGraph(raw: any): SerperKnowledgeGraph | null {
  if (!raw) return null;
  return {
    title: raw.title || null,
    type: raw.type || null,
    description: raw.description || null,
    imageUrl: raw.imageUrl || null,
    attributes: raw.attributes && typeof raw.attributes === 'object' ? raw.attributes : null,
  };
}

function parseTopStories(raw: any[]): SerperTopStory[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(s => ({
    title: s.title || '',
    link: s.link || '',
    source: s.source || '',
    date: s.date || null,
    imageUrl: s.imageUrl || null,
  }));
}

function parsePeopleAlsoAsk(raw: any[]): SerperPeopleAlsoAsk[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(p => ({
    question: p.question || '',
    snippet: p.snippet || null,
    title: p.title || null,
    link: p.link || null,
  }));
}

function parseRelatedSearches(raw: any[]): SerperRelatedSearch[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(r => ({ query: r.query || '' }));
}

function parseNewsResults(raw: any[]): SerperNewsResult[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(n => ({
    title: n.title || '',
    link: n.link || '',
    snippet: n.snippet || '',
    date: n.date || null,
    source: n.source || '',
    imageUrl: n.imageUrl || null,
  }));
}

export async function serperSearch(
  query: string,
  options: {
    num?: number;
    gl?: string;
    hl?: string;
    tbs?: string;
    page?: number;
  } = {}
): Promise<SerperSearchResponse & { error?: string }> {
  const key = cacheKey('serper-search', query, options)
  return cachedFetch(key, 300, () => _serperSearchUncached(query, options))
}

async function _serperSearchUncached(
  query: string,
  options: {
    num?: number;
    gl?: string;
    hl?: string;
    tbs?: string;
    page?: number;
  } = {}
): Promise<SerperSearchResponse & { error?: string }> {
  /*
   * PROVIDER BOUNDARY. Serper is a METERED search API — it bills per query — so it is
   * outbound spend on the same footing as Google Custom Search, which this codebase
   * now guards in lib/autocoach/status-sources/GoogleSearchAdapter.ts.
   *
   * Deliberately in the UNCACHED path, not in serperSearch(): serving a cached answer
   * spends nothing and should not be refused. Same placement, and the same reason, as
   * _grokEnrichUncached in lib/ai-external/grok.ts.
   *
   * Reported, not thrown, because every failure path in this function returns an
   * `error` string in the response shape. The message names the switch rather than
   * reusing "Serper API key not configured", which would send the next person to check
   * a credential for what is a billing state.
   */
  if (!isAiSpendEnabled()) {
    return {
      searchParameters: {},
      organic: [],
      answerBox: null,
      knowledgeGraph: null,
      topStories: [],
      peopleAlsoAsk: [],
      relatedSearches: [],
      error: "AI spend is disabled (AI_FEATURES_ENABLED is not 'true').",
    };
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      searchParameters: {},
      organic: [],
      answerBox: null,
      knowledgeGraph: null,
      topStories: [],
      peopleAlsoAsk: [],
      relatedSearches: [],
      error: 'Serper API key not configured',
    };
  }

  try {
    const res = await fetch(`${SERPER_BASE}/search`, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: query,
        num: options.num ?? 10,
        gl: options.gl ?? 'us',
        hl: options.hl ?? 'en',
        ...(options.tbs ? { tbs: options.tbs } : {}),
        ...(options.page ? { page: options.page } : {}),
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });

    if (!res.ok) {
      return {
        searchParameters: {},
        organic: [],
        answerBox: null,
        knowledgeGraph: null,
        topStories: [],
        peopleAlsoAsk: [],
        relatedSearches: [],
        error: `Serper search failed: ${res.status}`,
      };
    }

    const data = await res.json();

    return {
      searchParameters: data.searchParameters || {},
      organic: parseOrganicResults(data.organic),
      answerBox: parseAnswerBox(data.answerBox),
      knowledgeGraph: parseKnowledgeGraph(data.knowledgeGraph),
      topStories: parseTopStories(data.topStories),
      peopleAlsoAsk: parsePeopleAlsoAsk(data.peopleAlsoAsk),
      relatedSearches: parseRelatedSearches(data.relatedSearches),
    };
  } catch (err: any) {
    return {
      searchParameters: {},
      organic: [],
      answerBox: null,
      knowledgeGraph: null,
      topStories: [],
      peopleAlsoAsk: [],
      relatedSearches: [],
      error: err.message || 'Serper search timeout',
    };
  }
}

export async function serperNews(
  query: string,
  options: {
    num?: number;
    gl?: string;
    hl?: string;
    tbs?: string;
  } = {}
): Promise<SerperNewsResponse & { error?: string }> {
  const key = cacheKey('serper-news', query, options)
  return cachedFetch(key, 300, () => _serperNewsUncached(query, options))
}

async function _serperNewsUncached(
  query: string,
  options: {
    num?: number;
    gl?: string;
    hl?: string;
    tbs?: string;
  } = {}
): Promise<SerperNewsResponse & { error?: string }> {
  /* PROVIDER BOUNDARY — second uncached path. See _serperSearchUncached above. */
  if (!isAiSpendEnabled()) {
    return {
      searchParameters: {},
      news: [],
      error: "AI spend is disabled (AI_FEATURES_ENABLED is not 'true').",
    };
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      searchParameters: {},
      news: [],
      error: 'Serper API key not configured',
    };
  }

  try {
    const res = await fetch(`${SERPER_BASE}/news`, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: query,
        num: options.num ?? 10,
        gl: options.gl ?? 'us',
        hl: options.hl ?? 'en',
        ...(options.tbs ? { tbs: options.tbs } : {}),
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });

    if (!res.ok) {
      return {
        searchParameters: {},
        news: [],
        error: `Serper news failed: ${res.status}`,
      };
    }

    const data = await res.json();

    return {
      searchParameters: data.searchParameters || {},
      news: parseNewsResults(data.news),
    };
  } catch (err: any) {
    return {
      searchParameters: {},
      news: [],
      error: err.message || 'Serper news timeout',
    };
  }
}

export async function executeSerperWebSearch(query: string, num: number = 10): Promise<any> {
  const result = await serperSearch(query, { num });

  if (result.error) {
    return { error: result.error };
  }

  const response: any = {
    results: result.organic.slice(0, num).map(r => ({
      position: r.position,
      title: r.title,
      snippet: r.snippet,
      link: r.link,
      date: r.date,
    })),
  };

  if (result.answerBox) {
    response.answerBox = result.answerBox;
  }

  if (result.knowledgeGraph) {
    response.knowledgeGraph = {
      title: result.knowledgeGraph.title,
      type: result.knowledgeGraph.type,
      description: result.knowledgeGraph.description,
      attributes: result.knowledgeGraph.attributes,
    };
  }

  if (result.topStories.length > 0) {
    response.topStories = result.topStories.slice(0, 5).map(s => ({
      title: s.title,
      link: s.link,
      source: s.source,
      date: s.date,
    }));
  }

  if (result.peopleAlsoAsk.length > 0) {
    response.peopleAlsoAsk = result.peopleAlsoAsk.slice(0, 4).map(p => ({
      question: p.question,
      snippet: p.snippet,
    }));
  }

  if (result.relatedSearches.length > 0) {
    response.relatedSearches = result.relatedSearches.slice(0, 5).map(r => r.query);
  }

  return response;
}

export async function executeSerperNewsSearch(query: string, num: number = 10): Promise<any> {
  const result = await serperNews(query, { num, tbs: 'qdr:w' });

  if (result.error) {
    return { error: result.error };
  }

  return {
    news: result.news.slice(0, num).map(n => ({
      title: n.title,
      snippet: n.snippet,
      link: n.link,
      date: n.date,
      source: n.source,
    })),
  };
}
