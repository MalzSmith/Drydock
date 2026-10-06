export type CompBlock = { t: number; name: string; large: string; small: string | null }

export const COMP_BLOCKS: CompBlock[] = [
  { t: 1, name: 'Light Armor Block', large: 'LargeBlockArmorBlock', small: 'SmallBlockArmorBlock' },
  { t: 2, name: 'Heavy Armor Block', large: 'LargeHeavyBlockArmorBlock', small: 'SmallHeavyBlockArmorBlock' },
  { t: 12, name: 'Interior Wall', large: 'LargeBlockInteriorWall', small: null },
]
