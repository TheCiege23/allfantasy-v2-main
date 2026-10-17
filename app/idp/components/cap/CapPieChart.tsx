'use client'

type Props = {
  activeSalary: number
  deadMoney: number
  availableCap: number
  /** px diameter */
  size?: number
}

export function CapPieChart({ activeSalary, deadMoney, availableCap, size = 180 }: Props) {
  const a = Math.max(0, activeSalary)
  const d = Math.max(0, deadMoney)
  const o = Math.max(0, availableCap)
  const sum = a + d + o || 1
  const ca = (a / sum) * 360
  const cd = (d / sum) * 360
  const start2 = ca
  const start3 = ca + cd
  const grad = `conic-gradient(
    var(--cap-contract) 0deg ${ca}deg,
    var(--cap-dead) ${ca}deg ${ca + cd}deg,
    var(--cap-green) ${start3}deg 360deg
  )`

  return (
    <div className="flex flex-col items-center gap-2" data-testid="cap-pie-chart">
      <div
        className="relative rounded-full p-[10px]"
        style={{ width: size, height: size, background: grad }}
      >
        <div
          className="flex h-full w-full items-center justify-center rounded-full bg-[#0a0f18]"
          style={{ margin: 0 }}
        >
          <div className="text-center text-[11px] text-white/45">
            <p className="font-bold text-white/80">Cap</p>
            <p>${(a + d + o).toFixed(0)}M</p>
          </div>
        </div>
      </div>
      <ul className="w-full space-y-1 text-[11px] text-white/70">
        <li className="flex justify-between">
          <span className="text-[color:var(--cap-contract)]">Active</span>
          <span>${a.toFixed(1)}M</span>
        </li>
        <li className="flex justify-between">
          <span className="text-[color:var(--cap-dead)]">Dead</span>
          <span>${d.toFixed(1)}M</span>
        </li>
        <li className="flex justify-between">
          <span className="text-[color:var(--cap-green)]">Open</span>
          <span>${o.toFixed(1)}M</span>
        </li>
      </ul>
    </div>
  )
}
