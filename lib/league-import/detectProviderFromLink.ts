import type { ImportProvider } from './types';

/**
 * Which platform a pasted league LINK belongs to, or null when the text is not a recognisable link.
 *
 * ⚠ LINKS ONLY, NEVER BARE IDS. A bare "123456" is a valid league id on ESPN, MFL, Fleaflicker and
 * Yahoo alike, so guessing from digits would be a confident wrong answer. A host is unambiguous.
 *
 * Used by the import screen to catch the commonest wrong-box mistake: an ESPN link pasted while the
 * Sleeper tile is selected, a Fantrax link in the ESPN box. Matching is on the hostname's
 * registrable tail so `www44.myfantasyleague.com` and `fantasy.espn.com` both resolve.
 */
const HOSTS: { suffix: string; provider: ImportProvider }[] = [
  { suffix: 'espn.com', provider: 'espn' },
  { suffix: 'fantrax.com', provider: 'fantrax' },
  { suffix: 'myfantasyleague.com', provider: 'mfl' },
  { suffix: 'fleaflicker.com', provider: 'fleaflicker' },
  { suffix: 'sleeper.com', provider: 'sleeper' },
  { suffix: 'sleeper.app', provider: 'sleeper' },
  { suffix: 'fantasysports.yahoo.com', provider: 'yahoo' },
];

export function detectProviderFromLink(raw: string): ImportProvider | null {
  const text = raw.trim();
  if (!text || !/[a-z]\.[a-z]/i.test(text)) return null;
  let host: string;
  try {
    host = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const { suffix, provider } of HOSTS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return provider;
  }
  return null;
}
