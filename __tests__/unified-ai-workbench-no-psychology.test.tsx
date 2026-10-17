/**
 * Milestone 32 (owner decision 2026-09-29): manager characterisation is shown to
 * nobody. The workbench carried a "Psychological Profile" entry button that sent a
 * HARDCODED `{ style: 'aggressive', risk: 'high' }` profile to /api/ai/run, and a
 * tool selector option for the same tool. Neither may render.
 *
 * Positive control: the other entry buttons and tool options render in the same
 * markup, so this cannot pass by rendering nothing.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import UnifiedAIWorkbench from '@/components/ai-hub/UnifiedAIWorkbench'

describe('UnifiedAIWorkbench — no psychology surface', () => {
  const html = renderToStaticMarkup(<UnifiedAIWorkbench />)

  it('still renders the other entry buttons and tool options', () => {
    expect(html).toContain('data-testid="unified-ai-entry-rankings-button"')
    expect(html).toContain('data-testid="unified-ai-entry-story-button"')
    expect(html).toContain('value="trade_analyzer"')
  })

  it('renders no psychological entry button, tool option or profile prompt', () => {
    expect(html).not.toContain('unified-ai-entry-psychological-button')
    expect(html).not.toContain('value="psychological"')
    expect(html).not.toMatch(/psycholog/i)
    expect(html).not.toContain('Explain this manager profile')
  })
})
