/** Strict bounded operational options shared by historical refresh and verification. */
export function draftBackfillOptions(args: string[], currentSeason = new Date().getUTCFullYear()) {
  const numeric = (name: string, fallback: number) => {
    const options = args.filter(v => v.startsWith('--'+name+'='))
    if (options.length > 1) throw new Error('Duplicate historical option')
    if (!options.length) return fallback
    const value = options[0].slice(name.length+3)
    if (!/^\d+$/.test(value)) throw new Error('Invalid historical option')
    return Number(value)
  }
  const fromSeason = numeric('from-season',currentSeason), throughSeason = numeric('through-season',currentSeason)
  const limit = numeric('limit',2), offset = numeric('offset',0)
  if (fromSeason < 1900 || throughSeason > currentSeason || fromSeason > throughSeason ||
      limit < 1 || limit > 20 || offset < 0 || offset > 100000) throw new Error('Historical options exceed bounds')
  return {fromSeason,throughSeason,limit,offset}
}
