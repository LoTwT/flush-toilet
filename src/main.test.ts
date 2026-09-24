import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { createFlushAudio } from './audio'
import type { FlushState, SceneController } from './types'

type AudioController = ReturnType<typeof createFlushAudio>

const { scene, audio } = vi.hoisted(() => ({
  scene: {
    update: vi.fn<(state: FlushState, delta: number) => void>(),
    setCleaner: vi.fn<SceneController['setCleaner']>(),
    setLidClosed: vi.fn<SceneController['setLidClosed']>(),
    resize: vi.fn<SceneController['resize']>(),
    hitsFlushButton: vi.fn<SceneController['hitsFlushButton']>(),
    dispose: vi.fn<SceneController['dispose']>(),
  },
  audio: {
    update: vi.fn<(state: FlushState) => void>(),
    unlock: vi.fn<AudioController['unlock']>().mockResolvedValue(undefined),
    setEnabled: vi.fn<AudioController['setEnabled']>(),
    setPaused: vi.fn<AudioController['setPaused']>(),
    dispose: vi.fn<AudioController['dispose']>(),
  },
}))

vi.mock('./scene/create-scene', () => ({ createScene: vi.fn<typeof createScene>() }))
vi.mock('./audio', () => ({ createFlushAudio: () => audio }))
vi.mock('./sound-preference', () => ({
  readRememberedSound: () => true,
  rememberSound: vi.fn<(enabled: boolean) => void>(),
}))

import { createScene } from './scene/create-scene'

class PageElement extends EventTarget {
  disabled = false
  open = false
  textContent = ''
  style = {}
  dataset = {}
  classList = {
    add: vi.fn<DOMTokenList['add']>(),
    remove: vi.fn<DOMTokenList['remove']>(),
    toggle: vi.fn<DOMTokenList['toggle']>(),
  }
  setAttribute = vi.fn<HTMLElement['setAttribute']>()
}

let elements: Map<string, PageElement>
let page: EventTarget & { hidden: boolean }
let nextFrame: FrameRequestCallback | undefined
let now: number

function element(selector: string): PageElement {
  if (!elements.has(selector)) elements.set(selector, new PageElement())
  return elements.get(selector)!
}

function renderAt(timestamp: number, currentTime = timestamp): void {
  expect(nextFrame).toBeTypeOf('function')
  now = currentTime
  const callback = nextFrame!
  nextFrame = undefined
  callback(timestamp)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.mocked(createScene).mockResolvedValue(scene)
  elements = new Map()
  nextFrame = undefined
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  page = Object.assign(new EventTarget(), {
    hidden: false,
    querySelector: element,
    body: new PageElement(),
  })
  vi.stubGlobal('document', page)
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame = callback
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    nextFrame = undefined
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('页面时间轴与失败状态', () => {
  it.each([false, true])('Boost=%s 时，点击前的长帧不会计入新一轮冲水', async (boost) => {
    await import('./main')
    renderAt(1000)
    if (boost) element('#boost-toggle').dispatchEvent(new Event('click'))
    now = 6500
    element('#flush-button').dispatchEvent(new Event('click'))
    renderAt(6516)

    expect(scene.update.mock.lastCall![0].elapsed).toBeCloseTo(0.016)
    expect(scene.update.mock.lastCall![0].phase).toBe('flushing')
    expect(audio.update.mock.lastCall![0]).toEqual(scene.update.mock.lastCall![0])
    expect(element('#flush-button').disabled).toBe(true)

    // 被拒绝的重复请求不能再次重置计时起点。
    now = 6600
    element('#flush-button').dispatchEvent(new Event('click'))
    renderAt(7500)
    expect(scene.update.mock.lastCall![0].elapsed).toBeCloseTo(1)
  })

  it('同一帧的时间戳早于点击时，不倒退计时，也不向场景传入负时间步', async () => {
    await import('./main')
    renderAt(1000)
    now = 1010
    element('#flush-button').dispatchEvent(new Event('click'))
    renderAt(1008, 1011)
    expect(scene.update.mock.lastCall![0].elapsed).toBe(0)
    expect(scene.update.mock.lastCall![1]).toBe(0)
    renderAt(1026)
    expect(scene.update.mock.lastCall![0].elapsed).toBeCloseTo(0.016)
  })

  it('前台停顿一秒后，画面和声音收到完整的同一时间进度', async () => {
    await import('./main')
    renderAt(1000)
    element('#flush-button').dispatchEvent(new Event('click'))
    renderAt(1016)
    renderAt(2016)

    const state = scene.update.mock.lastCall![0]
    expect(state.elapsed).toBeCloseTo(1.016)
    expect(audio.update.mock.lastCall![0]).toEqual(state)
  })

  it('切后台的时间不计入循环，返回后从暂停进度继续', async () => {
    await import('./main')
    renderAt(1000)
    element('#flush-button').dispatchEvent(new Event('click'))
    renderAt(1100)
    page.hidden = true
    page.dispatchEvent(new Event('visibilitychange'))
    expect(nextFrame).toBeUndefined()
    expect(audio.setPaused).toHaveBeenLastCalledWith(true)
    page.hidden = false
    page.dispatchEvent(new Event('visibilitychange'))
    renderAt(10000)
    expect(scene.update.mock.lastCall![0].elapsed).toBeCloseTo(0.1)
    renderAt(10016)
    expect(scene.update.mock.lastCall![0].elapsed).toBeCloseTo(0.116)
    expect(audio.setPaused).toHaveBeenLastCalledWith(false)
  })

  it('场景初始化失败时显示错误并禁用冲水', async () => {
    vi.mocked(createScene).mockRejectedValue(new Error('Unsupported rendering capability'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await import('./main')

    expect(element('#phase-label').textContent).toBe('画面加载失败')
    expect(element('#flush-button').disabled).toBe(true)
    expect(element('#boost-toggle').disabled).toBe(true)
    expect(audio.setEnabled).toHaveBeenLastCalledWith(false)
    expect(nextFrame).toBeUndefined()
  })

  it('初始化期间失去上下文后，迟到的场景不能覆盖错误或重新启用操作', async () => {
    let finish!: (value: SceneController) => void
    const pending = new Promise<SceneController>((resolve) => {
      finish = resolve
    })
    vi.mocked(createScene).mockReturnValue(pending)
    await import('./main')
    element('#scene').dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    expect(element('#phase-label').textContent).toBe('画面加载失败')
    finish(scene)
    await pending

    expect(element('#phase-label').textContent).toBe('画面加载失败')
    for (const selector of ['#flush-button', '#boost-toggle', '#lid-toggle', '#strength-options']) {
      expect(element(selector).disabled).toBe(true)
    }
    expect(element('#loading').classList.add).toHaveBeenCalledWith('has-error')
    expect(element('#loading').classList.add).not.toHaveBeenCalledWith('is-hidden')
    expect(scene.dispose).toHaveBeenCalledOnce()
    expect(scene.update).not.toHaveBeenCalled()
    expect(audio.setEnabled).toHaveBeenLastCalledWith(false)
    expect(nextFrame).toBeUndefined()
    element('#flush-button').dispatchEvent(new Event('click'))
    expect(audio.unlock).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)('页面已销毁时忽略初始化的迟到 %s', async (result) => {
    const lifecycle = new AbortController()
    vi.stubGlobal(
      'AbortController',
      vi.fn(function () {
        return lifecycle
      }),
    )
    let finish!: (value: SceneController) => void
    let fail!: (reason: Error) => void
    const pending = new Promise<SceneController>((resolve, reject) => {
      finish = resolve
      fail = reject
    })
    vi.mocked(createScene).mockReturnValue(pending)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await import('./main')
    lifecycle.abort()
    if (result === 'resolve') finish(scene)
    else fail(new Error('Disposed during initialization'))
    await pending.catch(() => {})
    await Promise.resolve()

    expect(createScene).toHaveBeenCalledOnce()
    expect(scene.dispose).toHaveBeenCalledTimes(result === 'resolve' ? 1 : 0)
    expect(scene.update).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
    expect(element('#loading').classList.add).not.toHaveBeenCalled()
    expect(nextFrame).toBeUndefined()
  })

  it('Boost 在冲刷结束后解锁主按钮和力度选择，补水时可以立即再冲', async () => {
    await import('./main')
    renderAt(1000)
    element('#boost-toggle').dispatchEvent(new Event('click'))
    expect(element('#boost-toggle').setAttribute).toHaveBeenLastCalledWith('aria-pressed', 'true')
    element('#flush-button').dispatchEvent(new Event('click'))
    renderAt(5999)
    expect(element('#flush-button').disabled).toBe(true)
    expect(element('#strength-options').disabled).toBe(true)
    renderAt(6000)
    expect(element('#flush-button').disabled).toBe(false)
    expect(element('#strength-options').disabled).toBe(false)
    expect(element('#flush-label').textContent).toBe('再次冲水')
    expect(element('#phase-label').textContent).toBe('补水中，可再次冲水')
    expect(element('#tank-label').textContent).toBe('水箱自动蓄水中')
    expect(scene.update.mock.lastCall![0].tankLevel).toBeLessThan(1)

    element('#flush-button').dispatchEvent(new Event('click'))
    expect(element('#flush-button').disabled).toBe(true)
    renderAt(6016)
    expect(scene.update.mock.lastCall![0].elapsed).toBeCloseTo(0.016)
    expect(audio.update.mock.lastCall![0].phase).toBe('flushing')
  })

  it('补水期间开关 Boost 会立即更新按钮，同一阶段也不会残留错误的可用状态', async () => {
    await import('./main')
    renderAt(1000)
    element('#flush-button').dispatchEvent(new Event('click'))
    renderAt(6000)
    expect(element('#flush-button').disabled).toBe(true)
    element('#boost-toggle').dispatchEvent(new Event('click'))
    expect(element('#flush-button').disabled).toBe(false)
    element('#boost-toggle').dispatchEvent(new Event('click'))
    expect(element('#flush-button').disabled).toBe(true)
    expect(element('#flush-label').textContent).toBe('正在补水')
    expect(element('#strength-options').disabled).toBe(true)
    renderAt(13000)
    expect(element('#flush-button').disabled).toBe(false)
  })
})
