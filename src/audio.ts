import { CYCLE_DURATION, FLUSH_STRENGTHS } from './constants'
import { smoothRange } from './simulation/flush-cycle'
import type { FlushAudio, FlushState } from './types'

export const REFILL_START = 1.1
// 合盖后便池开口被遮住，声音主要从座圈下的缝隙透出：直达声和高频减弱。
// 补水声来自固定合上的水箱，不随马桶盖改变。
export const LID_MUFFLE = { gain: 0.72, cutoff: 1700 }
// 每个声部独立淡入淡出，停止旧声部时不会被新一轮的音量包络覆盖而截断。
export const VOICE_RELEASE = 0.03
const VOICE_ATTACK = 0.012

export function getAudioLevels(
  state: FlushState,
  lidClosed = false,
): { flush: number; refill: number } {
  if (state.phase === 'ready') return { flush: 0, refill: 0 }
  return {
    flush:
      FLUSH_STRENGTHS[state.strength].sound *
      (lidClosed ? LID_MUFFLE.gain : 1) *
      (1 - smoothRange(4.3, 5, state.elapsed)),
    // 水箱盖固定合上，补水声应轻于便池内的冲刷声。
    refill:
      0.28 *
      smoothRange(REFILL_START, 1.8, state.elapsed) *
      (1 - smoothRange(11, 11.2, state.elapsed)),
  }
}

interface Voice {
  source: AudioBufferSourceNode
  envelope: GainNode
}

export function createFlushAudio(): FlushAudio {
  let context: AudioContext | undefined
  let flushBuffer: AudioBuffer | undefined
  let refillBuffer: AudioBuffer | undefined
  let flushGain: GainNode | undefined
  let refillGain: GainNode | undefined
  let flushFilter: BiquadFilterNode | undefined
  let loading: Promise<void> | undefined
  let voices: Voice[] = []
  let playing = false
  let enabled = false
  let paused = false
  let disposed = false
  let lidClosed = false
  let lastElapsed = CYCLE_DURATION
  const requests = new AbortController()

  async function unlock(): Promise<void> {
    if (!enabled || disposed) return
    if (!context) {
      context = new AudioContext()
      flushGain = context.createGain()
      refillGain = context.createGain()
      flushGain.gain.value = 0
      refillGain.gain.value = 0
      flushFilter = context.createBiquadFilter()
      flushFilter.type = 'lowpass'
      flushFilter.frequency.value = 6800
      flushFilter.Q.value = 0.3
      flushGain.connect(flushFilter)
      flushFilter.connect(context.destination)
      // 素材已按合盖水箱削弱高频，补水音色不随冲水力度改变。
      refillGain.connect(context.destination)
    }
    // resume 必须在用户手势内调用，音频加载后按当前动画时间接入。
    const resumed = context.resume()
    if (!loading) {
      const audioContext = context
      loading = Promise.all(
        ['flush', 'refill'].map(async (name) => {
          const response = await fetch(import.meta.env.BASE_URL + 'audio/' + name + '.mp3', {
            signal: requests.signal,
          })
          if (!response.ok) throw new Error('Unable to load ' + name + ' audio: ' + response.status)
          return audioContext.decodeAudioData(await response.arrayBuffer())
        }),
      )
        .then(([flush, refill]) => {
          if (disposed) return
          flushBuffer = flush
          refillBuffer = refill
        })
        .catch((error: unknown) => {
          loading = undefined
          throw error
        })
    }
    await Promise.all([resumed, loading])
  }

  function stopPlayback(): void {
    if (!context) return
    const now = context.currentTime
    for (const { source, envelope } of voices) {
      envelope.gain.setTargetAtTime(0, now, VOICE_RELEASE)
      source.stop(now + VOICE_RELEASE * 6)
    }
    voices = []
    playing = false
  }

  function startVoice(
    buffer: AudioBuffer,
    gain: GainNode,
    elapsed: number,
    startsAt: number,
  ): void {
    if (!context) return
    const offset = Math.max(0, elapsed - startsAt)
    if (offset >= buffer.duration) return
    const source = context.createBufferSource()
    const envelope = context.createGain()
    const when = context.currentTime + Math.max(0, startsAt - elapsed)
    source.buffer = buffer
    envelope.gain.value = 0
    envelope.gain.setTargetAtTime(1, when, VOICE_ATTACK)
    source.connect(envelope)
    envelope.connect(gain)
    source.onended = (): void => {
      source.disconnect()
      envelope.disconnect()
    }
    source.start(when, offset)
    voices.push({ source, envelope })
  }

  function update(state: FlushState): void {
    if (
      !context ||
      !flushBuffer ||
      !refillBuffer ||
      !flushGain ||
      !refillGain ||
      !flushFilter ||
      disposed
    )
      return
    if (!enabled || paused || state.phase === 'ready') {
      if (playing) stopPlayback()
      lastElapsed = state.elapsed
      return
    }
    if (state.elapsed < lastElapsed && playing) stopPlayback()
    if (!playing) {
      startVoice(flushBuffer, flushGain, state.elapsed, 0)
      startVoice(refillBuffer, refillGain, state.elapsed, REFILL_START)
      playing = true
    }
    lastElapsed = state.elapsed
    const levels = getAudioLevels(state, lidClosed)
    const now = context.currentTime
    flushGain.gain.setTargetAtTime(levels.flush, now, 0.04)
    refillGain.gain.setTargetAtTime(levels.refill, now, 0.1)
    // 时间常数与盖子开合的缓动相近，闷化随盖子位置逐渐变化。
    flushFilter.frequency.setTargetAtTime(
      lidClosed ? LID_MUFFLE.cutoff : 4400 + FLUSH_STRENGTHS[state.strength].pressure * 1800,
      now,
      lidClosed ? 0.12 : 0.1,
    )
  }

  function setEnabled(value: boolean): void {
    enabled = value
    if (!value) stopPlayback()
  }

  function setPaused(value: boolean): void {
    paused = value
    if (value) stopPlayback()
  }

  function setLidClosed(value: boolean): void {
    lidClosed = value
  }

  function dispose(): void {
    disposed = true
    requests.abort()
    stopPlayback()
    void context?.close()
  }

  return { unlock, update, setEnabled, setPaused, setLidClosed, dispose }
}
