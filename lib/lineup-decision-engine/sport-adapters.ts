/**
 * Sport-specific signal hooks — deterministic layer supplies values; adapters document
 * what each sport emphasizes when filling PremiumPlayerSignals from feeds/cache.
 */

type SportSignalHints = {
  primary: string[]
  secondary: string[]
}

const HINTS: Record<string, SportSignalHints> = {
  NFL: {
    primary: ['snap share', 'routes', 'touches', 'red zone', 'matchup vs position', 'weather'],
    secondary: ['handcuff', 'bye week'],
  },
  NBA: {
    primary: ['minutes', 'usage rate', 'starting role', 'back-to-backs', 'load management'],
    secondary: ['category fit'],
  },
  MLB: {
    primary: ['lineup slot', 'platoon', 'pitching matchup', 'two-start SP', 'closer path'],
    secondary: ['weekly volume'],
  },
  NHL: {
    primary: ['line', 'PP unit', 'goalie start probability', 'categories'],
    secondary: ['short-term usage'],
  },
  SOCCER: {
    primary: ['XI probability', 'minutes', 'set pieces', 'clean sheet', 'sub risk'],
    secondary: ['fixture difficulty'],
  },
  NCAAF: { primary: ['usage', 'matchup', 'injury replacements'], secondary: ['bye'] },
  NCAAB: { primary: ['minutes', 'role', 'pace'], secondary: ['schedule density'] },
  GOLF: {
    primary: ['field strength', 'cut probability', 'course fit', 'form'],
    secondary: ['volatility'],
  },
  NASCAR: {
    primary: ['track fit', 'qualifying', 'recent finishes', 'volatility'],
    secondary: ['starting position'],
  },
}

export function getSportSignalHints(sport: string): SportSignalHints {
  const u = sport.trim().toUpperCase()
  return HINTS[u] ?? HINTS.NFL
}
