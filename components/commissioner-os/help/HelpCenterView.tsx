'use client'

import { useMemo, useState } from 'react'
import { Search as SearchIcon, HelpCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/commissioner-os/states'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import { HelpArticleCard } from './HelpArticleCard'
import { HELP_CATEGORY_LABELS, HELP_CATEGORY_ORDER } from './helpLabels'
import type { CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'
import type { CommissionerHelpArticleContract, CommissionerGlossaryTermContract, CommissionerHelpCategory } from '@/lib/commissioner-ui/contracts'

export interface HelpCenterViewProps {
  articles: CommissionerHelpArticleContract[]
  glossary: CommissionerGlossaryTermContract[]
  dataMode: CommissionerDataMode
  errorMessage?: string | null
}

const ALL_CATEGORIES = 'all' as const
type CategoryFilter = CommissionerHelpCategory | typeof ALL_CATEGORIES

function matches(haystacks: string[], needle: string): boolean {
  if (!needle.trim()) return true
  const lowerNeedle = needle.toLowerCase()
  return haystacks.some((text) => text.toLowerCase().includes(lowerNeedle))
}

/**
 * Documentation hub, contextual help, operational guides, glossary,
 * onboarding resources, support articles, feature documentation — all in
 * one browsable page, per the approved blueprint §1/§9. A single local
 * text filter narrows both articles and glossary terms at once; the
 * category tablist (only articles carry a category) reuses the exact
 * tablist pattern Activity Stream/Workspace/Recommendations already
 * established.
 */
export function HelpCenterView({ articles, glossary, dataMode, errorMessage }: HelpCenterViewProps) {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(ALL_CATEGORIES)
  const [searchText, setSearchText] = useState('')

  const presentCategories = useMemo(() => {
    const present = new Set<CommissionerHelpCategory>(articles.map((article) => article.category))
    return HELP_CATEGORY_ORDER.filter((category) => present.has(category))
  }, [articles])

  const visibleArticles = useMemo(() => {
    return articles.filter((article) => {
      if (categoryFilter !== ALL_CATEGORIES && article.category !== categoryFilter) return false
      return matches([article.title, article.summary], searchText)
    })
  }, [articles, categoryFilter, searchText])

  const visibleGlossary = useMemo(() => {
    return glossary.filter((term) => matches([term.term, term.definition], searchText))
  }, [glossary, searchText])

  return (
    <div>
      <PreviewDataBanner mode={dataMode} />

      {errorMessage ? (
        <ErrorState message={errorMessage} />
      ) : (
        <div className="space-y-6">
          <div className="relative max-w-sm">
            <SearchIcon size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted2)' }} />
            <Input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search help articles and glossary…"
              aria-label="Search help articles and glossary"
              className="pl-9"
            />
          </div>

          <div className="space-y-4">
            <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Help category">
              <button
                type="button"
                role="tab"
                aria-selected={categoryFilter === ALL_CATEGORIES}
                onClick={() => setCategoryFilter(ALL_CATEGORIES)}
                className="focus-ring shrink-0 whitespace-nowrap rounded-[var(--radius-standard)] px-3 py-1.5 text-sm font-medium"
                style={{
                  background: categoryFilter === ALL_CATEGORIES ? 'var(--panel2)' : 'transparent',
                  color: categoryFilter === ALL_CATEGORIES ? 'var(--text)' : 'var(--muted)',
                  border: '1px solid var(--border)',
                }}
              >
                All <span style={{ color: 'var(--muted2)' }}>({articles.length})</span>
              </button>
              {presentCategories.map((category) => {
                const count = articles.filter((article) => article.category === category).length
                const isActive = categoryFilter === category
                return (
                  <button
                    key={category}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setCategoryFilter(category)}
                    className="focus-ring shrink-0 whitespace-nowrap rounded-[var(--radius-standard)] px-3 py-1.5 text-sm font-medium"
                    style={{
                      background: isActive ? 'var(--panel2)' : 'transparent',
                      color: isActive ? 'var(--text)' : 'var(--muted)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {HELP_CATEGORY_LABELS[category]} <span style={{ color: 'var(--muted2)' }}>({count})</span>
                  </button>
                )
              })}
            </div>

            {visibleArticles.length === 0 ? (
              <EmptyState
                icon={HelpCircle}
                title="No articles match."
                description="Try a different search term or category."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {visibleArticles.map((article) => (
                  <HelpArticleCard key={article.id} article={article} />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3 border-t pt-6" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-sm font-bold" style={{ color: 'var(--text)' }}>
              Glossary
            </h2>
            {visibleGlossary.length === 0 ? (
              <EmptyState title="No glossary terms match." description="Try a different search term." />
            ) : (
              <dl className="grid gap-3 sm:grid-cols-2">
                {visibleGlossary.map((term) => (
                  <div key={term.id} className="rounded-2xl p-4" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
                    <dt className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                      {term.term}
                    </dt>
                    <dd className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                      {term.definition}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
