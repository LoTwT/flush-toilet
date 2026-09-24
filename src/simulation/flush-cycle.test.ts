import { describe, expect, it } from 'vitest'
import { CYCLE_DURATION, FLUSH_END_TIME, LOW_WATER_HEIGHT, REST_WATER_HEIGHT } from '../constants'
import { FlushCycle, sampleFlush } from './flush-cycle'

describe('一次完整冲水', () => {
  it('力度影响喷流、旋流与耗水量，并在整个循环内锁定', () => {
    const gentle = sampleFlush(2, 'gentle')
    const standard = sampleFlush(2, 'standard')
    const strong = sampleFlush(2, 'strong')
    expect(gentle.inflow).toBeLessThan(standard.inflow)
    expect(standard.inflow).toBeLessThan(strong.inflow)
    expect(gentle.swirl).toBeLessThan(strong.swirl)
    expect(gentle.turbulence).toBeLessThan(strong.turbulence)
    expect(gentle.tankLevel).toBeGreaterThan(strong.tankLevel)
    const cycle = new FlushCycle()
    cycle.start('gentle')
    cycle.advance(2)
    expect(cycle.start('strong')).toBe(false)
    expect(cycle.state.strength).toBe('gentle')
    cycle.advance(CYCLE_DURATION)
    expect(cycle.start('strong')).toBe(true)
    expect(cycle.state.strength).toBe('strong')
  })

  it.each(['gentle', 'standard', 'strong'] as const)(
    '%s 档全程保持有效水位并完成蓄水',
    (strength) => {
      for (let time = 0; time <= CYCLE_DURATION; time += 0.1) {
        const state = sampleFlush(time, strength)
        expect(state.tankLevel).toBeGreaterThanOrEqual(0)
        expect(state.tankLevel).toBeLessThanOrEqual(1)
        expect(state.bowlHeight).toBeGreaterThanOrEqual(LOW_WATER_HEIGHT - 0.00001)
      }
      const end = sampleFlush(CYCLE_DURATION, strength)
      expect(end.phase).toBe('ready')
      expect(end.tankLevel).toBe(1)
      expect(end.bowlHeight).toBeCloseTo(REST_WATER_HEIGHT)
      expect(end.inflow).toBe(0)
    },
  )

  it('初始就绪，冲水和补水期间都不重复启动，完成后可以再来一次', () => {
    const cycle = new FlushCycle()
    expect(cycle.state.phase).toBe('ready')
    expect(cycle.start()).toBe(true)
    cycle.advance(2)
    expect(cycle.start()).toBe(false)
    expect(cycle.state.elapsed).toBe(2)
    cycle.advance(5)
    expect(cycle.state.phase).toBe('refilling')
    expect(cycle.start()).toBe(false)
    cycle.advance(5)
    expect(cycle.state.phase).toBe('ready')
    expect(cycle.state.bowlHeight).toBeCloseTo(REST_WATER_HEIGHT)
    expect(cycle.state.tankLevel).toBe(1)
    expect(cycle.state.inflow).toBe(0)
    expect(cycle.state.turbulence).toBe(0)
    expect(cycle.start()).toBe(true)
  })

  it('水箱补水与冲水重叠，便池随后恢复水位', () => {
    expect(sampleFlush(1).bowlHeight).toBeGreaterThan(REST_WATER_HEIGHT)
    expect(sampleFlush(4).tankLevel).toBeGreaterThan(sampleFlush(3).tankLevel)
    expect(sampleFlush(4).inflow).toBeGreaterThan(0)
    expect(sampleFlush(4.85).bowlHeight).toBeCloseTo(LOW_WATER_HEIGHT)
    expect(sampleFlush(8).bowlHeight).toBeGreaterThan(sampleFlush(6).bowlHeight)
  })

  it('不同帧率到达相同时间时有相同状态', () => {
    const slow = new FlushCycle()
    const fast = new FlushCycle()
    slow.start()
    fast.start()
    for (let index = 0; index < 150; index++) slow.advance(1 / 30)
    for (let index = 0; index < 600; index++) fast.advance(1 / 120)
    expect(slow.state.bowlHeight).toBeCloseTo(fast.state.bowlHeight, 9)
    expect(slow.state.tankLevel).toBeCloseTo(fast.state.tankLevel, 9)
  })

  it('全程水量保持有效，结束没有水位跳变', () => {
    for (let time = 0; time <= CYCLE_DURATION; time += 0.01) {
      const state = sampleFlush(time)
      expect(state.tankLevel).toBeGreaterThanOrEqual(0)
      expect(state.tankLevel).toBeLessThanOrEqual(1)
      expect(state.bowlHeight).toBeGreaterThanOrEqual(LOW_WATER_HEIGHT - 0.00001)
      expect(state.bowlHeight).toBeLessThan(0.4)
    }
    expect(sampleFlush(11.999).bowlHeight).toBeCloseTo(sampleFlush(12).bowlHeight, 8)
  })

  it('长时间步完成并复位，异常时间步不改变状态', () => {
    const cycle = new FlushCycle()
    cycle.start()
    cycle.advance(Number.NaN)
    cycle.advance(Number.POSITIVE_INFINITY)
    cycle.advance(-1)
    expect(cycle.state.elapsed).toBe(0)
    cycle.advance(60)
    expect(cycle.state.elapsed).toBe(CYCLE_DURATION)
    expect(cycle.state.phase).toBe('ready')
  })
})

describe('Boost 连续冲水', () => {
  it('默认关闭；在补水时切换 Boost 只改变能否再冲，不改变当前水位和进度', () => {
    const cycle = new FlushCycle()
    expect(cycle.boostEnabled).toBe(false)
    cycle.start()
    cycle.advance(FLUSH_END_TIME)
    const before = cycle.state
    expect(cycle.canStart).toBe(false)
    cycle.boostEnabled = true
    expect(cycle.canStart).toBe(true)
    expect(cycle.state).toEqual(before)
    cycle.boostEnabled = false
    expect(cycle.canStart).toBe(false)
    expect(cycle.start()).toBe(false)
    cycle.advance(CYCLE_DURATION - FLUSH_END_TIME)
    expect(cycle.canStart).toBe(true)
  })

  it.each(['gentle', 'standard', 'strong'] as const)(
    '%s 档冲完即能再冲，衔接当前水位，连续启动后仍能恢复蓄满',
    (strength) => {
      const cycle = new FlushCycle()
      cycle.boostEnabled = true
      expect(cycle.start(strength)).toBe(true)
      for (let repeat = 0; repeat < 10; repeat++) {
        cycle.advance(FLUSH_END_TIME - 0.001)
        expect(cycle.canStart).toBe(false)
        expect(cycle.start()).toBe(false)
        cycle.advance(0.001)
        const before = cycle.state
        expect(before.phase).toBe('refilling')
        expect(before.tankLevel).toBeLessThan(1)
        expect(cycle.canStart).toBe(true)
        expect(cycle.start(strength)).toBe(true)
        expect(cycle.state.phase).toBe('flushing')
        expect(cycle.state.elapsed).toBe(0)
        expect(cycle.state.tankLevel).toBeCloseTo(before.tankLevel, 10)
        expect(cycle.state.bowlHeight).toBeCloseTo(before.bowlHeight, 10)
      }
      for (let frame = 0; frame < CYCLE_DURATION * 60; frame++) {
        const state = cycle.advance(1 / 60)
        expect(state.tankLevel).toBeGreaterThanOrEqual(0)
        expect(state.tankLevel).toBeLessThanOrEqual(1)
        expect(state.bowlHeight).toBeGreaterThanOrEqual(LOW_WATER_HEIGHT - 0.00001)
        expect(state.bowlHeight).toBeLessThan(0.4)
      }
      cycle.advance(1 / 60)
      expect(cycle.state.phase).toBe('ready')
      expect(cycle.state.tankLevel).toBeCloseTo(1, 10)
      expect(cycle.state.bowlHeight).toBeCloseTo(REST_WATER_HEIGHT, 10)
      expect(cycle.state.inflow).toBe(0)
    },
  )
})
