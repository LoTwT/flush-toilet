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
  const tankDrain = smoothRange(0.12, 3, time)
  const refill =
    drainedVolume * smoothRange(1.1, 11.2, time) +
    (1 - initialWater.tankLevel) * smoothRange(0, 11.2, time)
  const bowlRise = 0.065 * smoothRange(0.12, 1.5, time)
  const bowlDrain =
    (initialWater.bowlHeight + 0.065 - LOW_WATER_HEIGHT) * smoothRange(2.2, 4.8, time)
  const bowlRefill = (REST_WATER_HEIGHT - LOW_WATER_HEIGHT) * smoothRange(4.9, 10.5, time)
  const surge = smoothRange(0.1, 0.7, time) * (1 - smoothRange(2.6, 4.5, time))
  const refillFlow = 0.16 * smoothRange(3, 4.8, time) * (1 - smoothRange(9.8, 11.1, time))
  const swirl = smoothRange(0.25, 2, time) * (1 - smoothRange(3.5, 8, time))

  return {
    phase,
    strength,
    elapsed: time,
    progress: time / CYCLE_DURATION,
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
    suction: smoothRange(2.4, 3.4, time) * (1 - smoothRange(4.3, 5.1, time)) * Math.sqrt(pressure),
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
