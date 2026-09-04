import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { HelpCenterView } from '@/components/commissioner-os/help/HelpCenterView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'

/**
 * Server Component — fetches through the Decision OS Adapter Layer, same
 * as every other module page. Help & Knowledge Center owns explanatory
 * content only; it never renders or recomputes another module's own
 * data, only links out to it (see HELP BLUEPRINT.md §1, §6, §7).
 */
export default async function HelpCenterPage() {
  const adapter = await getDecisionOSAdapter()
  const [articlesResponse, glossaryResponse] = await Promise.all([
    adapter.help.getArticles(),
    adapter.help.getGlossary(),
  ])

  const errorMessage = articlesResponse.data || glossaryResponse.data ? null : articlesResponse.error?.message ?? glossaryResponse.error?.message

  return (
    <CommissionerPageContainer>
      <HelpCenterView
        articles={articlesResponse.data ?? []}
        glossary={glossaryResponse.data ?? []}
        dataMode={adapter.mode}
        errorMessage={errorMessage}
      />
    </CommissionerPageContainer>
  )
}
