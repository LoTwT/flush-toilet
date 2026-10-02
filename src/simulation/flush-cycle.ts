import {
  CYCLE_DURATION,
  FLUSH_END_TIME,
  FLUSH_STRENGTHS,
  LOW_WATER_HEIGHT,
  REST_WATER_HEIGHT,
} from '../constants'
import type { FlushPhase, FlushState, FlushStrength } from '../types'

export function smoothRange(start: number, end: number, value: number): number {
  const progress = Math.max(0, Math.min(1, (value - start) / (end - start)))
  return progress * progress * (3 - 2 * progress)
}

function getPhase(elapsed: number): FlushPhase {
  if (elapsed >= CYCLE_DURATION) return 'ready'
  if (elapsed < 2.6) return 'flushing'
  if (elapsed < FLUSH_END_TIME) return 'draining'
  if (elapsed < 10.5) return 'refilling'
  return 'settling'
}

export function sampleFlush(
  elapsed: number,
  strength: FlushStrength = 'standard',
  initialWater: Pick<FlushState, 'tankLevel' | 'bowlHeight'> = {
    tankLevel: 1,
    bowlHeight: REST_WATER_HEIGHT,
  },
): FlushState {
  const time = Math.max(0, Math.min(CYCLE_DURATION, elapsed))
  const phase = getPhase(time)
  const { pressure, volume } = FLUSH_STRENGTHS[strength]
  const drainedVolume = Math.min(volume, initialWater.tankLevel)
  // 虹吸与冲水录音对齐：座圈水流沿侧壁持续冲下时，便池水位快速退入排水口，
  // 紧接着约 2.8 秒的低沉咕噜声是断流；侧流在水退到底之后才减弱，
  // 便池随即由补水管回升，先于水箱蓄满。
  const tankDrain = smoothRange(0.12, 2.9, time)
  const refill =
    drainedVolume * smoothRange(1.1, 11.2, time) +
    (1 - initialWater.tankLevel) * smoothRange(0, 11.2, time)
  const bowlRise = 0.065 * smoothRange(0.12, 1.3, time)
  const bowlDrain =
    (initialWater.bowlHeight + 0.065 - LOW_WATER_HEIGHT) * smoothRange(1.3, 2.7, time)
  const bowlRefill = (REST_WATER_HEIGHT - LOW_WATER_HEIGHT) * smoothRange(3.1, 7.8, time)
  const surge = smoothRange(0.1, 0.7, time) * (1 - smoothRange(2.7, 3.8, time))
  const refillFlow = 0.16 * smoothRange(2.9, 4.4, time) * (1 - smoothRange(9.8, 11.1, time))
  const swirl = smoothRange(0.25, 1.8, time) * (1 - smoothRange(3, 7.5, time))

  return {
    phase,
    strength,
    elapsed: time,
    tankLevel: Math.max(
      0,
      Math.min(1, initialWater.tankLevel - drainedVolume * tankDrain + refill),
    ),
    bowlHeight: initialWater.bowlHeight + bowlRise - bowlDrain + bowlRefill,
    inflow: surge * pressure + refillFlow,
    swirl: swirl * pressure,
    turbulence:
      (0.008 * surge + 0.018 * swirl + 0.003 * refillFlow) *
      pressure *
      (1 - smoothRange(10, 12, time)),
    suction: smoothRange(1.2, 2, time) * (1 - smoothRange(2.6, 3.2, time)) * Math.sqrt(pressure),
    buttonPress: smoothRange(0, 0.12, time) * (1 - smoothRange(0.2, 0.5, time)),
  }
}

export class FlushCycle {
  boostEnabled = false
  private elapsed = CYCLE_DURATION
  private strength: FlushStrength = 'standard'
  private initialWater = { tankLevel: 1, bowlHeight: REST_WATER_HEIGHT }

  get canStart(): boolean {
    return this.elapsed >= (this.boostEnabled ? FLUSH_END_TIME : CYCLE_DURATION)
  }

  get state(): FlushState {
    return sampleFlush(this.elapsed, this.strength, this.initialWater)
  }

  start(strength: FlushStrength = 'standard'): boolean {
    if (!this.canStart) return false
    // Boost 可以提前重启，但水箱和便池必须从当前水位接续，不能瞬间加满。
    const { tankLevel, bowlHeight } = this.state
    this.initialWater = { tankLevel, bowlHeight }
    this.strength = strength
    this.elapsed = 0
    return true
  }

  advance(delta: number): FlushState {
    if (Number.isFinite(delta) && delta > 0) {
      this.elapsed = Math.min(CYCLE_DURATION, this.elapsed + delta)
    }
    return this.state
  }
}
