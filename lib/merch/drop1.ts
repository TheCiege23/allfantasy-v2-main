/**
 * Merch Drop 1: six t-shirt designs.
 *
 * The images in public/merch/drop-1/ are 900×1080 web previews composited onto a dark tee colour,
 * because the print art is light ink on a transparent background. The 4500×5400 print masters are
 * deliberately NOT committed.
 *
 * ⚠ THERE ARE NO PER-PRODUCT LISTINGS OR PRICES FOR THESE IN THE CODEBASE. Every card links to the
 * Etsy storefront (`ETSY_SHOP_URL`). When a design gets a real listing, add its `url` here; do not
 * guess one, and do not add prices that are not on the listing.
 */

/** The AllFantasy Etsy storefront (artbyciege). Every shop surface links here. */
export const ETSY_SHOP_URL = 'https://artbyciege.etsy.com'

export type MerchDesign = {
  id: string
  title: string
  /** Public path of the web preview. */
  image: string
  /** Describes the printed design for screen readers, including its text. */
  alt: string
  /** A real Etsy listing URL, once one exists. Absent means the card links to the shop. */
  url?: string
}

export const MERCH_DROP_1: MerchDesign[] = [
  {
    id: 'king-of-the-tuddys',
    title: 'King of the Tuddys',
    image: '/merch/drop-1/01-king-of-the-tuddys.webp',
    alt: 'King of the Tuddys tee design: a blue crown over the words "King of the Tuddys", with the tagline "6 pts every time" and the AllFantasy logo.',
  },
  {
    id: 'waiver-wire-warrior',
    title: 'Waiver Wire Warrior',
    image: '/merch/drop-1/02-waiver-wire-warrior.webp',
    alt: 'Waiver Wire Warrior tee design: bold stacked letters "Waiver Wire Warrior" above a waiver-claim receipt reading processed at 3:01 AM for a $1 FAAB bid.',
  },
  {
    id: 'sleeper-pick',
    title: 'Sleeper Pick',
    image: '/merch/drop-1/03-sleeper-pick.webp',
    alt: 'Sleeper Pick tee design: a draft card for round 14, pick 7 reading "Sleeper Pick", ADP undrafted, finish RB4, with the line "Nobody knew."',
  },
  {
    id: 'the-commish',
    title: 'The Commish',
    image: '/merch/drop-1/04-the-commish.webp',
    alt: 'The Commish tee design: a gavel inside a circular "Office of the Commissioner, vetoes are final" seal, above "The Commish" and "My league. My rules."',
  },
  {
    id: 'bench-points-dont-count',
    title: "Bench Points Don't Count",
    image: '/merch/drop-1/05-bench-points-dont-count.webp',
    alt: 'Bench Points Don\'t Count tee design: a week 7 scoreboard with 71.4 starters against 138.2 bench, above "Bench points don\'t count. I checked. Twice."',
  },
  {
    id: 'trade-rejected',
    title: 'Trade Rejected',
    image: '/merch/drop-1/06-trade-rejected.webp',
    alt: 'Trade Rejected tee design: a declined trade proposal offering a backup kicker and vibes for their RB1, stamped "Trade Rejected", with "Nice try though."',
  },
]
