/** Team crests shown alongside the final score in in-app notifications. */
export function FinalScoreLogos({ type, meta }: { type: string; meta: unknown }) {
  if (!['game_final', 'postgame_recap'].includes(type) || !meta || typeof meta !== 'object') return null
  const data = meta as Record<string, unknown>
  const sides = [
    { name: data.awayTeam, logo: data.awayLogo },
    { name: data.homeTeam, logo: data.homeLogo },
  ].filter((side): side is { name: string; logo: string } =>
    typeof side.name === 'string' && typeof side.logo === 'string' && /^https:\/\/[^\s]+$/i.test(side.logo))
  if (!sides.length) return null
  return (
    <span className="mt-1 inline-flex items-center gap-1.5" aria-label="Final score teams">
      {sides.map((side) => <img key={side.name} src={side.logo} alt={`${side.name} logo`} width={24} height={24} className="h-6 w-6 object-contain" loading="lazy" />)}
    </span>
  )
}
