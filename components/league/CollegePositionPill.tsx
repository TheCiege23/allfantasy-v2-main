const COLLEGE_PILL_STYLES: Record<string, string> = {
  QB: 'bg-[#4A1A3D] text-[#F06090]',
  RB: 'bg-[#1A4A2A] text-[#50E8A0]',
  WR: 'bg-[#1A3A5A] text-[#50B0F5]',
  TE: 'bg-[#4A3A1A] text-[#F5B840]',
  K: 'bg-[#3a3f52] text-[#d6dbea]',
  OL: 'bg-[#2d3548] text-[#cfd8ea]',
  DL: 'bg-[#342641] text-[#d5b5ff]',
  LB: 'bg-[#2b3241] text-[#c7d5ef]',
  DB: 'bg-[#2a2f46] text-[#aebef5]',
  PG: 'bg-[#1A2A4A] text-[#60A0FF]',
  SG: 'bg-[#1A2A4A] text-[#60A0FF]',
  SF: 'bg-[#1A2A4A] text-[#60A0FF]',
  PF: 'bg-[#1A2A4A] text-[#60A0FF]',
  C: 'bg-[#1A2A4A] text-[#60A0FF]',
  G: 'bg-[#1A2A4A] text-[#60A0FF]',
  F: 'bg-[#1A2A4A] text-[#60A0FF]',
  UTIL: 'bg-[#1A2A4A] text-[#60A0FF]',
  COLLEGE: 'bg-[#1d2740] text-[#c5d8ff]',
}

export default function CollegePositionPill({
  label,
  className = '',
}: {
  label: string
  className?: string
}) {
  const upper = label.toUpperCase()
  const style = COLLEGE_PILL_STYLES[upper] ?? 'bg-[#1d2740] text-[#c5d8ff]'

  return (
    <span className={`relative inline-flex min-w-[56px] items-center justify-center rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-wide ${style} ${className}`}>
      <span>{label}</span>
      <span className="absolute -right-1 -top-1 rounded-full bg-[#FFB800] px-1 py-[1px] text-[11px] font-bold uppercase tracking-[0.12em] text-[#231600]">
        COL
      </span>
    </span>
  )
}
