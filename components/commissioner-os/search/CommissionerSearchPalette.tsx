'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { ErrorState } from '@/components/commissioner-os/states'
import { useCommissionerPlatform } from '@/components/commissioner-os/providers/CommissionerPlatformProvider'
import { useRecentSearches } from './useRecentSearches'
import { SEARCH_CATEGORY_ICONS, SEARCH_CATEGORY_LABELS, SEARCH_CATEGORY_ORDER } from './searchLabels'
import type { CommissionerSearchResultContract, CommissionerSearchResultCategory } from '@/lib/commissioner-ui/contracts'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { searchResultTitleText, toolsText } from '@/lib/commissioner-os/i18n/toolsCopy'

export interface CommissionerSearchPaletteProps {
  /** The full cross-module index, fetched once by the layout via adapter.search.getIndex(). Matching against the typed query is cmdk's own job (shouldFilter), not logic duplicated here. */
  index: CommissionerSearchResultContract[]
  /**
   * Set when `adapter.search.getIndex()` itself failed (e.g. live mode,
   * not yet integrated) — added during the Phase 2 production-hardening
   * audit. Before this, an empty `index` from a real error and an empty
   * index from a genuinely empty result set were indistinguishable, both
   * silently showing "No results found." — the one inconsistency with
   * every other module's honest ErrorState in live mode.
   */
  errorMessage?: string | null
}

/**
 * Global Search & Command Palette, mounted once in the Commissioner OS
 * layout. Deliberately its own, self-contained overlay — not wired into
 * the existing whole-app lib/search system (SearchOverlay/
 * UniversalSearchService), which never mounts inside Commissioner OS's
 * layout at all today. See components/commissioner-os/search/README.md
 * for why that's a documented, deliberate boundary rather than an
 * oversight.
 */
export function CommissionerSearchPalette({ index, errorMessage }: CommissionerSearchPaletteProps) {
  const router = useRouter()
  const { openServiceId, openService, closeService } = useCommissionerPlatform()
  const { recent, addRecent } = useRecentSearches()
  const [query, setQuery] = useState('')
  const open = openServiceId === 'search'
  const { language } = useOptionalLanguage()
  const t = (english: string) => toolsText(english, language)

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openService('search')
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [openService])

  const grouped = useMemo(() => {
    const map = new Map<CommissionerSearchResultCategory, CommissionerSearchResultContract[]>()
    for (const category of SEARCH_CATEGORY_ORDER) map.set(category, [])
    for (const result of index) {
      map.get(result.category)?.push(result)
    }
    return map
  }, [index])

  function handleSelect(result: CommissionerSearchResultContract) {
    addRecent(result)
    closeService()
    router.push(result.href)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeService()
      }}
    >
      <DialogContent
        className="max-w-xl gap-0 overflow-hidden p-0"
        style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
      >
        <DialogTitle className="sr-only">{t('Search Commissioner OS')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('Search recommendations, managers, tasks, reports, automations, settings, help articles, and pages.')}
        </DialogDescription>
        {errorMessage ? (
          <div className="p-4">
            <ErrorState message={t(errorMessage)} />
          </div>
        ) : (
          <>
            <Command shouldFilter className="bg-transparent text-[var(--text)]">
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder={t('Search Commissioner OS...')}
                aria-label={t('Search Commissioner OS')}
                className="text-[var(--text)] placeholder:text-[var(--muted2)]"
              />
              <CommandList>
                <CommandEmpty className="text-[var(--muted)]">{t('No results found.')}</CommandEmpty>

                {query.length === 0 && recent.length > 0 && (
                  <CommandGroup heading={t('Recent')} className="[&_[cmdk-group-heading]]:text-[var(--muted2)]">
                    {recent.map((result) => (
                      <ResultItem key={`recent-${result.id}`} result={result} language={language} onSelect={handleSelect} />
                    ))}
                  </CommandGroup>
                )}

                {SEARCH_CATEGORY_ORDER.map((category) => {
                  const results = grouped.get(category) ?? []
                  if (results.length === 0) return null
                  return (
                    <CommandGroup
                      key={category}
                      heading={t(SEARCH_CATEGORY_LABELS[category])}
                      className="[&_[cmdk-group-heading]]:text-[var(--muted2)]"
                    >
                      {results.map((result) => (
                        <ResultItem key={result.id} result={result} language={language} onSelect={handleSelect} />
                      ))}
                    </CommandGroup>
                  )
                })}
              </CommandList>
            </Command>
            <div
              className="border-t px-3 py-2 text-xs"
              style={{ borderColor: 'var(--border)', color: 'var(--muted2)' }}
            >
              {t('↑↓ to navigate · Enter to select · Esc to close')}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ResultItem({
  result,
  language,
  onSelect,
}: {
  result: CommissionerSearchResultContract
  language: string
  onSelect: (result: CommissionerSearchResultContract) => void
}) {
  const Icon = SEARCH_CATEGORY_ICONS[result.category]
  const title = searchResultTitleText(result, language)
  return (
    /*
     * cmdk matches the typed query against `value`, so it carries the title the reader sees; the
     * English title rides along as a keyword, so a commissioner who types the English name of a page
     * still finds it.
     */
    <CommandItem
      value={title}
      keywords={title === result.title ? undefined : [result.title]}
      onSelect={() => onSelect(result)}
      className="text-[var(--muted)] data-[selected=true]:bg-[var(--panel2)] data-[selected=true]:text-[var(--text)]"
    >
      <Icon size={16} aria-hidden />
      <span>{title}</span>
    </CommandItem>
  )
}
