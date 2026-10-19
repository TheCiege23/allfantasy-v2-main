import { ExternalLink } from 'lucide-react'
import { ETSY_SHOP_URL, MERCH_DROP_1 } from '@/lib/merch/drop1'

/** "Drop 1" showcase for the shop tab: six tee designs, each linking to the Etsy shop. */
export default function MerchDrop1() {
  return (
    <section aria-labelledby="merch-drop-1-title" data-testid="merch-drop-1" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <span className="inline-block rounded-full bg-gradient-to-r from-cyan-500 to-purple-600 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
            New
          </span>
          <h2 id="merch-drop-1-title" className="mt-2 text-lg font-bold text-white sm:text-xl">
            Drop 1
          </h2>
          <p className="text-xs text-white/60 sm:text-sm">Six tees for people who take their league too seriously.</p>
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {MERCH_DROP_1.map((design) => (
          <li key={design.id}>
            <a
              href={design.url ?? ETSY_SHOP_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${design.title} — shop on Etsy (opens in a new tab)`}
              className="group block overflow-hidden rounded-xl border border-white/10 bg-black/30 transition-all hover:border-cyan-400/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
            >
              <div className="aspect-[5/6] overflow-hidden bg-[#22252e]">
                <img
                  src={design.image}
                  alt={design.alt}
                  width={900}
                  height={1080}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                />
              </div>
              <div className="flex min-h-[44px] items-center justify-between gap-2 p-3">
                <h3 className="text-xs font-semibold text-white group-hover:text-cyan-300 sm:text-sm">{design.title}</h3>
                <span className="flex flex-none items-center gap-1 text-[11px] text-white/50 group-hover:text-cyan-300/70">
                  <ExternalLink className="h-3 w-3" aria-hidden />
                  Etsy
                </span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
