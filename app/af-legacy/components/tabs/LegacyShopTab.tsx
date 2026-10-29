'use client'

import EtsyShop from '@/components/EtsyShop'
import MerchDrop1 from '@/components/merch/MerchDrop1'

export default function LegacyShopTab() {
  return (
    <>
      <p className="text-center text-sm sm:text-base text-white/60 mb-4">
        Gear up with official AllFantasy merchandise. T-shirts, hoodies, hats, and more.
      </p>
      <div className="bg-black/30 border border-white/10 rounded-2xl p-4 sm:p-6 mb-4">
        <MerchDrop1 />
      </div>
      <div className="bg-black/30 border border-white/10 rounded-2xl p-4 sm:p-6">
        <EtsyShop />
      </div>
    </>
  )
}
