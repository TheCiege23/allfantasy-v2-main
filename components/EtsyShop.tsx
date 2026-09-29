'use client'

import React, { useState } from 'react'
import { ExternalLink, ShoppingBag } from 'lucide-react'

interface Product {
  name: string
  price: string
  url: string
  image: string
  category: 'shirts' | 'hoodies' | 'hats' | 'drinkware'
  featured?: boolean
}

const PRODUCTS: Product[] = [
  {
    name: 'ALLFANTASY T-Shirt | Minimalist Sports Logo, Draft Day Tee',
    price: '$25.33',
    url: 'https://www.etsy.com/listing/4445127823/allfantasy-t-shirt-minimalist-sports',
    image: 'https://i.etsystatic.com/23295144/r/il/2f9121/7627696126/il_340x270.7627696126_ox6d.jpg',
    category: 'shirts',
    featured: true,
  },
  {
    name: 'AF Shield Logo T-Shirt | Minimalist Streetwear Graphic Tee',
    price: '$25.33',
    url: 'https://www.etsy.com/listing/4445145393/af-shield-logo-t-shirt-minimalist',
    image: 'https://i.etsystatic.com/23295144/r/il/498379/7627812734/il_340x270.7627812734_7rql.jpg',
    category: 'shirts',
    featured: true,
  },
  {
    name: 'AF Shield Logo Hoodie | Minimalist Cotton-Poly Blend Sweatshirt',
    price: '$44.97',
    url: 'https://www.etsy.com/listing/4445161380/af-shield-logo-hoodie-minimalist-cotton',
    image: 'https://i.etsystatic.com/23295144/r/il/5bc3f8/7627864846/il_340x270.7627864846_f12g.jpg',
    category: 'hoodies',
    featured: true,
  },
  {
    name: 'AF Shield Logo Trucker Hat | AllFantasy Snapback Cap',
    price: '$38.07',
    url: 'https://www.etsy.com/listing/4445174026/af-shield-logo-trucker-hat-allfantasy',
    image: 'https://i.etsystatic.com/23295144/r/il/a767bc/7627956648/il_340x270.7627956648_ikiu.jpg',
    category: 'hats',
    featured: true,
  },
  {
    name: 'AllFantasy Logo Travel Mug 40oz | Insulated Stainless Steel Tumbler',
    price: '$77.32',
    url: 'https://www.etsy.com/listing/4449287864/allfantasy-logo-travel-mug-40oz',
    image: 'https://i.etsystatic.com/23295144/r/il/313bb9/7655115624/il_340x270.7655115624_ltkz.jpg',
    category: 'drinkware',
  },
  {
    name: 'I Draft Better Than You T-Shirt | Fantasy Football League Tee',
    price: '$31.46',
    url: 'https://www.etsy.com/listing/4445201437/i-draft-better-than-you-t-shirt-fantasy',
    image: 'https://i.etsystatic.com/23295144/r/il/3c62a9/7628169026/il_340x270.7628169026_9674.jpg',
    category: 'shirts',
  },
  {
    name: 'AllFantasy AF Logo T-Shirt | Minimalist Fantasy Sports Tee',
    price: '$31.46',
    url: 'https://www.etsy.com/listing/4445191161/allfantasy-af-logo-t-shirt-minimalist',
    image: 'https://i.etsystatic.com/23295144/r/il/2cd364/7628100768/il_340x270.7628100768_ctz8.jpg',
    category: 'shirts',
  },
  {
    name: 'Think Different Fantasy Football T-Shirt | Draft Day Tee',
    price: '$28.34',
    url: 'https://www.etsy.com/listing/4445191846/think-different-fantasy-football-t-shirt',
    image: 'https://i.etsystatic.com/23295144/r/il/24c55c/7628118020/il_340x270.7628118020_76qw.jpg',
    category: 'shirts',
  },
  {
    name: 'Built For Winners Graphic Tee | Sports Motivation Shirt',
    price: '$28.92',
    url: 'https://www.etsy.com/listing/4445186110/built-for-winners-graphic-tee-sports',
    image: 'https://i.etsystatic.com/23295144/r/il/c98687/7675976621/il_340x270.7675976621_t4yn.jpg',
    category: 'shirts',
  },
  {
    name: 'AF Shield Logo Stainless Steel Tumbler | 20oz Skinny Travel Cup',
    price: '$48.68',
    url: 'https://www.etsy.com/listing/4445165555/af-shield-logo-stainless-steel-tumbler',
    image: 'https://i.etsystatic.com/23295144/r/il/cb981e/7675900627/il_340x270.7675900627_rput.jpg',
    category: 'drinkware',
  },
]

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'shirts', label: 'Shirts' },
  { id: 'hoodies', label: 'Hoodies' },
  { id: 'hats', label: 'Hats' },
  { id: 'drinkware', label: 'Drinkware' },
] as const

type Category = typeof CATEGORIES[number]['id']

export default function EtsyShop() {
  const [activeCategory, setActiveCategory] = useState<Category>('all')

  const filtered = activeCategory === 'all'
    ? PRODUCTS
    : PRODUCTS.filter(p => p.category === activeCategory)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              activeCategory === cat.id
                ? 'bg-gradient-to-r from-cyan-500 to-purple-600 text-white shadow-lg shadow-cyan-500/20'
                : 'bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            {cat.label}
            {cat.id !== 'all' && (
              <span className="ml-1 opacity-60">
                ({PRODUCTS.filter(p => p.category === cat.id).length})
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {filtered.map((product, i) => (
          <a
            key={i}
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative bg-black/30 border border-white/10 rounded-xl overflow-hidden hover:border-cyan-400/30 transition-all hover:shadow-lg hover:shadow-cyan-500/10 hover:scale-[1.02]"
          >
            {product.featured && (
              <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-[11px] font-bold text-white uppercase tracking-wider">
                Featured
              </div>
            )}

            <div className="aspect-square bg-white/5 overflow-hidden">
              <img
                src={product.image}
                alt={product.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
            </div>

            <div className="p-3">
              <h3 className="text-xs sm:text-sm font-semibold text-white line-clamp-2 mb-2 group-hover:text-cyan-300 transition-colors">
                {product.name.split('|')[0].trim()}
              </h3>
              <div className="flex items-center justify-between">
                <span className="text-sm sm:text-base font-bold text-cyan-400">{product.price}</span>
                <span className="text-[11px] text-emerald-400/80 font-medium">FREE shipping</span>
              </div>
              <div className="mt-2 flex items-center gap-1 text-[11px] text-white/40 group-hover:text-cyan-300/60 transition-colors">
                <ExternalLink className="w-3 h-3" />
                <span>View on Etsy</span>
              </div>
            </div>
          </a>
        ))}
      </div>

      <div className="text-center pt-4">
        <a
          href="https://artbyciege.etsy.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white font-semibold text-sm hover:shadow-lg hover:shadow-orange-500/30 transition-all hover:scale-105"
        >
          <ShoppingBag className="w-4 h-4" />
          Visit Full Etsy Shop
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <p className="mt-3 text-xs text-white/40">All purchases are handled securely through Etsy</p>
      </div>
    </div>
  )
}
