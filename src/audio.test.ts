import { describe, expect, it } from 'vitest'
import { createFlushAudio, getAudioLevels } from './audio'
import { sampleFlush } from './simulation/flush-cycle'

describe('分阶段水声', () => {
  it('默认静音，未开启时不会创建或加载音频', async () => {
    const audio = createFlushAudio()
    await expect(audio.unlock()).resolves.toBeUndefined()
    audio.dispose()
  })

  it('旋流停止后仍有补水声，蓄满后完全安静', () => {
    const lateRefill = sampleFlush(9)
    expect(lateRefill.swirl).toBe(0)
    expect(getAudioLevels(lateRefill).refill).toBeGreaterThan(0)
    expect(getAudioLevels(lateRefill).flush).toBe(0)
    expect(getAudioLevels(sampleFlush(12))).toEqual({ flush: 0, refill: 0 })
  })

  it('三档冲水声随力度增强，补水声不被放大', () => {
    const gentle = getAudioLevels(sampleFlush(3, 'gentle'))
    const standard = getAudioLevels(sampleFlush(3, 'standard'))
    const strong = getAudioLevels(sampleFlush(3, 'strong'))
    expect(gentle.flush).toBeLessThan(standard.flush)
    expect(standard.flush).toBeLessThan(strong.flush)
    expect(gentle.refill).toBe(strong.refill)
  })
})
