import type { BowlSection, CleanerColor, FlushPhase, FlushStrength } from './types'

export const CYCLE_DURATION = 12
export const FLUSH_END_TIME = 5
export const REST_WATER_HEIGHT = 0.32
export const LOW_WATER_HEIGHT = 0.095

export const FLUSH_STRENGTHS: Record<
  FlushStrength,
  { pressure: number; volume: number; sound: number }
> = {
  gentle: { pressure: 0.58, volume: 0.65, sound: 0.58 },
  standard: { pressure: 1, volume: 0.85, sound: 0.8 },
  strong: { pressure: 1.45, volume: 0.97, sound: 1 },
}

export const CLEANER_COLORS: Record<CleanerColor, { color: string; concentration: number }> = {
  clear: { color: '#a6d1d4', concentration: 0 },
  blue: { color: '#168bc5', concentration: 0.8 },
  mint: { color: '#279e7e', concentration: 0.72 },
  lavender: { color: '#9272bd', concentration: 0.75 },
}

export const PHASE_LABELS: Record<FlushPhase, string> = {
  ready: '准备就绪',
  flushing: '座圈下沿正在冲刷',
  draining: '冲刷，汇入深处',
  refilling: '正在自动补水',
  settling: '水面渐渐平静',
}

// 内腔与水面使用同一组截面，水位变化时才能始终贴合陶瓷。
export const BOWL_SECTIONS: readonly BowlSection[] = [
  { height: -0.1, radiusX: 0.125, radiusZ: 0.15, centerZ: -0.19 },
  { height: 0.01, radiusX: 0.2, radiusZ: 0.25, centerZ: -0.15 },
  { height: 0.18, radiusX: 0.31, radiusZ: 0.43, centerZ: -0.045 },
  { height: 0.42, radiusX: 0.45, radiusZ: 0.64, centerZ: 0.11 },
  { height: 0.64, radiusX: 0.57, radiusZ: 0.8, centerZ: 0.18 },
  { height: 0.8, radiusX: 0.62, radiusZ: 0.87, centerZ: 0.2 },
]
