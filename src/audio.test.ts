import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFlushAudio, getAudioLevels } from './audio'
import { sampleFlush } from './simulation/flush-cycle'

afterEach(() => vi.unstubAllGlobals())

// 用假的 AudioContext 与 fetch 驱动播放引擎，记录每个声部的接入进度。
function fakeAudio() {
  const starts: { offset: number; stopped: boolean }[] = []
  const param = () => ({ value: 0, setTargetAtTime: vi.fn<AudioParam['setTargetAtTime']>() })
  class FakeContext {
    currentTime = 0
    destination = {}
    createGain = () => ({ gain: param(), connect: vi.fn<AudioNode['connect']>() })
    createBiquadFilter = () => ({
      type: '',
      frequency: param(),
      Q: param(),
      connect: vi.fn<AudioNode['connect']>(),
    })
    createBufferSource = () => {
      const record = { offset: Number.NaN, stopped: false }
      return {
        buffer: null,
        connect: vi.fn<AudioNode['connect']>(),
        disconnect: vi.fn<AudioNode['disconnect']>(),
        onended: null,
        start: (_when: number, offset: number) => {
          record.offset = offset
          starts.push(record)
        },
        stop: () => {
          record.stopped = true
        },
      }
    }
    resume = async () => {}
    close = async () => {}
    decodeAudioData = async () => ({ duration: 20 })
  }
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }))
  return starts
}

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

describe('录音播放引擎', () => {
  it('暂停恢复后各声部从原进度续播，不从录音开头重播', async () => {
    const starts = fakeAudio()
    const audio = createFlushAudio()
    audio.setEnabled(true)
    await audio.unlock()
    audio.update(sampleFlush(3))
    audio.setPaused(true)
    audio.setPaused(false)
    audio.update(sampleFlush(6))
    // 冲刷声部按动画时间接入，补水声部从自身的接入时刻起算。
    const offsets = starts.map((voice) => voice.offset)
    expect(offsets).toHaveLength(4)
    expect(offsets[0]).toBeCloseTo(3)
    expect(offsets[1]).toBeCloseTo(1.9)
    expect(offsets[2]).toBeCloseTo(6)
    expect(offsets[3]).toBeCloseTo(4.9)
    audio.dispose()
  })

  it('时间轴回退时停止旧声部，新循环从头接入', async () => {
    const starts = fakeAudio()
    const audio = createFlushAudio()
    audio.setEnabled(true)
    await audio.unlock()
    audio.update(sampleFlush(6))
    audio.update(sampleFlush(0.1))
    for (const voice of starts.slice(0, 2)) expect(voice.stopped).toBe(true)
    expect(starts[2].offset).toBeCloseTo(0.1)
    expect(starts[3].offset).toBeCloseTo(0)
    audio.dispose()
  })
})
