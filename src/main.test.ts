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

function element(selector: string): PageElement {
  if (!elements.has(selector)) elements.set(selector, new PageElement())
  return elements.get(selector)!
}

function renderAt(timestamp: number): void {
  expect(nextFrame).toBeTypeOf('function')
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
    expect(audio.setEnabled).toHaveBeenLastCalledWith(false)
    expect(nextFrame).toBeUndefined()
  })
})
