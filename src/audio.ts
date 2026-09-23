import { CYCLE_DURATION, FLUSH_STRENGTHS } from './constants'
import { smoothRange } from './simulation/flush-cycle'
import type { FlushAudio, FlushState } from './types'

const REFILL_START = 2.2

export function getAudioLevels(state: FlushState): { flush: number; refill: number } {
  if (state.phase === 'ready') return { flush: 0, refill: 0 }
  return {
    flush: FLUSH_STRENGTHS[state.strength].sound * (1 - smoothRange(4.3, 5, state.elapsed)),
    refill:
      0.48 *
      smoothRange(REFILL_START, 4.8, state.elapsed) *
      (1 - smoothRange(9.6, 11.2, state.elapsed)),
  }
}

export function createFlushAudio(): FlushAudio {
  let context: AudioContext | undefined
  let flushBuffer: AudioBuffer | undefined
  let refillBuffer: AudioBuffer | undefined
  let flushGain: GainNode | undefined
  let refillGain: GainNode | undefined
  let filter: BiquadFilterNode | undefined
  let loading: Promise<void> | undefined
  let voices: AudioBufferSourceNode[] = []
  let playing = false
  let enabled = false
  let paused = false
  let disposed = false
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
      filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 6800
      filter.Q.value = 0.3
      flushGain.connect(filter)
      refillGain.connect(filter)
      filter.connect(context.destination)
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
    flushGain?.gain.setTargetAtTime(0, context.currentTime, 0.01)
    refillGain?.gain.setTargetAtTime(0, context.currentTime, 0.01)
    for (const voice of voices) voice.stop(context.currentTime + 0.04)
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
    const voice = context.createBufferSource()
    voice.buffer = buffer
    voice.connect(gain)
    voice.onended = (): void => voice.disconnect()
    voice.start(context.currentTime + Math.max(0, startsAt - elapsed), offset)
    voices.push(voice)
  }

  function update(state: FlushState): void {
    if (
      !context ||
      !flushBuffer ||
      !refillBuffer ||
      !flushGain ||
      !refillGain ||
      !filter ||
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
    const levels = getAudioLevels(state)
    const now = context.currentTime
    flushGain.gain.setTargetAtTime(levels.flush, now, 0.04)
    refillGain.gain.setTargetAtTime(levels.refill, now, 0.1)
    filter.frequency.setTargetAtTime(
      4400 + FLUSH_STRENGTHS[state.strength].pressure * 1800,
      now,
      0.1,
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

  function dispose(): void {
    disposed = true
    requests.abort()
    stopPlayback()
    void context?.close()
  }

  return { unlock, update, setEnabled, setPaused, dispose }
}
