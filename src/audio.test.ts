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

  it('水箱开始回补时接入水声，临近蓄满时保留录音中的关阀收尾', () => {
    expect(getAudioLevels(sampleFlush(1)).refill).toBe(0)
    const filling = getAudioLevels(sampleFlush(2)).refill
    expect(filling).toBeGreaterThan(0)
    expect(getAudioLevels(sampleFlush(10.7)).refill).toBe(filling)
    expect(getAudioLevels(sampleFlush(11.2)).refill).toBe(0)
  })

  it('合盖水箱的补水增益保持在柔和冲水增益的一半以内', () => {
    const gentleFlush = getAudioLevels(sampleFlush(2, 'gentle')).flush
    for (const elapsed of [2, 5, 9, 10.7]) {
      const refill = getAudioLevels(sampleFlush(elapsed)).refill
      expect(refill).toBeGreaterThan(0)
      expect(refill).toBeLessThanOrEqual(gentleFlush / 2)
    }
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
