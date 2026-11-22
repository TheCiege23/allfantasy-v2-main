const MANAGER_COLORS = [
  { bg: 'bg-blue-900/40', border: 'border-blue-500', text: 'text-blue-300' },
  { bg: 'bg-emerald-900/40', border: 'border-emerald-500', text: 'text-emerald-300' },
  { bg: 'bg-violet-900/40', border: 'border-violet-500', text: 'text-violet-300' },
  { bg: 'bg-orange-900/40', border: 'border-orange-500', text: 'text-orange-300' },
  { bg: 'bg-rose-900/40', border: 'border-rose-500', text: 'text-rose-300' },
  { bg: 'bg-cyan-900/40', border: 'border-cyan-500', text: 'text-cyan-300' },
  { bg: 'bg-yellow-900/40', border: 'border-yellow-500', text: 'text-yellow-300' },
  { bg: 'bg-pink-900/40', border: 'border-pink-500', text: 'text-pink-300' },
  { bg: 'bg-teal-900/40', border: 'border-teal-500', text: 'text-teal-300' },
  { bg: 'bg-indigo-900/40', border: 'border-indigo-500', text: 'text-indigo-300' },
  { bg: 'bg-lime-900/40', border: 'border-lime-500', text: 'text-lime-300' },
  { bg: 'bg-fuchsia-900/40', border: 'border-fuchsia-500', text: 'text-fuchsia-300' },
] as const

export function managerColorForIndex(index: number) {
  return MANAGER_COLORS[index % MANAGER_COLORS.length]!
}
