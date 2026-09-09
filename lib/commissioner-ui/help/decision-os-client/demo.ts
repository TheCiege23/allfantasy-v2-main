import type { HelpClient } from './types'
import { HELP_ARTICLES, HELP_GLOSSARY } from '../helpCatalog'

/*
 * The catalog moved to `../helpCatalog` so live mode can serve it too — it is authored prose about
 * this product, not demo fixtures, and keeping it here was the only reason Help had no live
 * implementation. Demo behaviour is unchanged.
 */
const ARTICLES = HELP_ARTICLES
const GLOSSARY = HELP_GLOSSARY

// The envelope's `timestamp` is when this response was produced, which is genuinely now. Distinct
// from each article's `updatedAt`, which is when the prose was authored — see `CATALOG_REVISED_AT`.
function ts() {
  return new Date().toISOString()
}

export const demoHelpClient: HelpClient = {
  async getArticles() {
    return { data: ARTICLES, error: null, source: 'demo', timestamp: ts() }
  },
  async getGlossary() {
    return { data: GLOSSARY, error: null, source: 'demo', timestamp: ts() }
  },
}
