import 'server-only'
import { NO_CAREER_FILTER } from './careerModel'
import { getCareerScreen } from './careerScreen'
import { renderCareerGroundingPrompt } from './careerChimmy'

/**
 * The career block for a Chimmy question asked from Career.
 *
 * ⚠ THE SAME READ AS THE SCREEN, UNFILTERED. `getCareerScreen(…, 'overview')` is what
 * `/core/career` renders: the stored profile (`careerProfile.ts`) plus the award scorer, no
 * extra history reads. Unfiltered on purpose — the drawer does not know which filter the
 * screen had set, and a whole-career answer labelled as such beats a guess at a filter.
 *
 * Fails closed to null: a missing career block costs one grounding section, while a thrown
 * read would cost the whole answer.
 */
export async function loadCareerGroundingBlock(userId: string): Promise<string | null> {
  try {
    const screen = await getCareerScreen(userId, NO_CAREER_FILTER, 'overview')
    return renderCareerGroundingPrompt(screen.data, screen.awards)
  } catch (err) {
    console.error('[chimmy] career grounding read failed', err)
    return null
  }
}
