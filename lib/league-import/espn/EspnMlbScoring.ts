/** ESPN MLB stat ids; sourced from the baseball contract, never the NFL registry. */
export const ESPN_MLB_POINT_KEYS: Readonly<Record<number,string>> = {
  3:'double',4:'triple',5:'hr',7:'single',8:'tb',10:'bb',11:'ibb',12:'hbp',20:'r',21:'rbi',23:'sb',24:'cs',27:'bat_so',
  34:'outs',37:'p_h',39:'p_bb',42:'p_hbp',44:'p_r',45:'er',46:'p_hr',48:'so',50:'wp',51:'bk',53:'w',54:'l',57:'sv',58:'bs',60:'hld',63:'qs',
}
export const ESPN_MLB_CATEGORY_KEYS: Readonly<Record<number,string>> = {2:'avg',5:'hr',20:'r',21:'rbi',23:'sb',41:'whip',47:'era',48:'k',53:'w',57:'sv',8:'tb',60:'hld'}
