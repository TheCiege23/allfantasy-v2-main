import { z } from 'zod'

export const emailSchema = z.object({
  email: z.string().email('Invalid email address').max(255).transform(s => s.toLowerCase().trim()),
})

export const questionnaireSchema = z.object({
  email: z.string().email().max(255).transform(s => s.toLowerCase().trim()),
  favoriteSport: z.enum(['NFL', 'NBA', 'MLB']),
  favoriteLeagueType: z.enum(['Redraft', 'Dynasty', 'Keeper', 'Best Ball', 'Guilly', 'Survivor', 'Tournament']),
  competitiveness: z.enum(['Casual', 'Competitive', 'Degenerate 😈']),
  draftPreference: z.enum(['Snake', 'Auction', 'Either']),
  painPoint: z.enum(['Drafting', 'Waivers', 'Trades', 'Start/Sit', 'League Management']),
  experimentalInterest: z.array(z.string()).min(1, 'Select at least one option'),
  freeText: z.string().max(1000).optional().transform(s => s ? s.trim() : undefined),
})

export function sanitizeString(str: string): string {
  return str
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim()
}
