export function RosterValidationBanner({
  warnings,
  errors,
}: {
  warnings: string[]
  errors?: string[]
}) {
  if ((!warnings || warnings.length === 0) && (!errors || errors.length === 0)) return null

  return (
    <div className="space-y-2" role="status">
      {errors && errors.length > 0 && (
        <div className="break-words rounded-xl border border-red-500/25 bg-red-950/25 px-3 py-2 text-xs text-red-200">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}
      {warnings && warnings.length > 0 && (
        <div className="break-words rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
    </div>
  )
}
