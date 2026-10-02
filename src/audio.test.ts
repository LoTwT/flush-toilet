import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFlushAudio, getAudioLevels, LID_MUFFLE, VOICE_RELEASE } from './audio'
import { sampleFlush } from './simulation/flush-cycle'

afterEach(() => vi.unstubAllGlobals())

// 用假的 AudioContext 与 fetch 驱动播放引擎，记录每个声部的接入进度。
function fakeAudio() {
  const starts: { offset: number; stopped: boolean; stopAt: number }[] = []
  const gains: ReturnType<typeof param>[] = []
  const filters: { frequency: ReturnType<typeof param> }[] = []
  const param = () => ({ value: 0, setTargetAtTime: vi.fn<AudioParam['setTargetAtTime']>() })
  class FakeContext {
    currentTime = 0
    destination = {}
    createGain = () => {
      const gain = param()
      gains.push(gain)
      return {
        gain,
        connect: vi.fn<AudioNode['connect']>(),
        disconnect: vi.fn<AudioNode['disconnect']>(),
      }
    }
    createBiquadFilter = () => {
      const filter = {
        type: '',
        frequency: param(),
        Q: param(),
        connect: vi.fn<AudioNode['connect']>(),
      }
      filters.push(filter)
      return filter
    }
    createBufferSource = () => {
      const record = { offset: Number.NaN, stopped: false, stopAt: Number.NaN }
      return {
        buffer: null,
        connect: vi.fn<AudioNode['connect']>(),
        disconnect: vi.fn<AudioNode['disconnect']>(),
        onended: null,
        start: (_when: number, offset: number) => {
          record.offset = offset
          starts.push(record)
        },
        stop: (when = 0) => {
          record.stopped = true
          record.stopAt = when
        },
      }
    }
    resume = async () => {}
    close = async () => {}
    decodeAudioData = async () => ({ duration: 20 })
  }
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }))
  return Object.assign(starts, { gains, filters })
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

  it('合盖只让便池冲刷声变闷变轻，水箱补水声保持不变', () => {
    for (const elapsed of [0.8, 2, 3, 6]) {
      const open = getAudioLevels(sampleFlush(elapsed))
      const closed = getAudioLevels(sampleFlush(elapsed), true)
      expect(closed.flush).toBeCloseTo(open.flush * LID_MUFFLE.gain)
      expect(closed.refill).toBe(open.refill)
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

  it('Boost 重启时旧声部按自身包络淡出后停止，不被新一轮的音量覆盖而截断', async () => {
    const starts = fakeAudio()
    const audio = createFlushAudio()
    audio.setEnabled(true)
    await audio.unlock()
    audio.update(sampleFlush(5.2))
    // 前两个增益节点是冲刷与补水声道，其后每个声部各有一个包络。
    const oldEnvelopes = starts.gains.slice(2, 4)
    audio.update(sampleFlush(0))
    for (const envelope of oldEnvelopes)
      expect(envelope.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, VOICE_RELEASE)
    for (const voice of starts.slice(0, 2)) expect(voice.stopAt).toBeGreaterThan(VOICE_RELEASE * 4)
    // 新声部各自从静音淡入，不继承旧声部的包络。
    for (const envelope of starts.gains.slice(4)) {
      expect(envelope.value).toBe(0)
      expect(envelope.setTargetAtTime.mock.calls[0][0]).toBe(1)
    }
    audio.dispose()
  })

  it('合盖时冲刷声道的低通频率降低，掀盖后恢复按力度设置', async () => {
    const starts = fakeAudio()
    const audio = createFlushAudio()
    audio.setEnabled(true)
    await audio.unlock()
    const frequency = starts.filters[0].frequency.setTargetAtTime
    audio.update(sampleFlush(1))
    const open = frequency.mock.lastCall![0]
    audio.setLidClosed(true)
    audio.update(sampleFlush(1.1))
    expect(frequency.mock.lastCall![0]).toBe(LID_MUFFLE.cutoff)
    expect(LID_MUFFLE.cutoff).toBeLessThan(open / 2)
    audio.setLidClosed(false)
    audio.update(sampleFlush(1.2))
    expect(frequency.mock.lastCall![0]).toBe(open)
    audio.dispose()
  })
})
