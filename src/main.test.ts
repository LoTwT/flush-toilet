import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { createFlushAudio } from './audio'
import type { FlushState, SceneController } from './types'
import { MAX_EXCREMENT_PIECES } from './constants'

type AudioController = ReturnType<typeof createFlushAudio>

const { scene, audio } = vi.hoisted(() => ({
  scene: {
    update: vi.fn<(state: FlushState, delta: number) => void>(),
    setCleaner: vi.fn<SceneController['setCleaner']>(),
    setLidClosed: vi.fn<SceneController['setLidClosed']>(),
    addExcrement: vi.fn<SceneController['addExcrement']>(),
    flushExcrement: vi.fn<SceneController['flushExcrement']>(),
    hasExcrement: vi.fn<SceneController['hasExcrement']>(),
    setExcrementMosaic: vi.fn<SceneController['setExcrementMosaic']>(),
    excrementPlacement: {
      count: vi.fn<SceneController['excrementPlacement']['count']>(),
      setCount: vi.fn<SceneController['excrementPlacement']['setCount']>(),
      addPiece: vi.fn<SceneController['excrementPlacement']['addPiece']>(),
      removeSelected: vi.fn<SceneController['excrementPlacement']['removeSelected']>(),
      setEnabled: vi.fn<SceneController['excrementPlacement']['setEnabled']>(),
      select: vi.fn<SceneController['excrementPlacement']['select']>(),
      selection: vi.fn<SceneController['excrementPlacement']['selection']>(),
      transform: vi.fn<SceneController['excrementPlacement']['transform']>(),
      reshape: vi.fn<SceneController['excrementPlacement']['reshape']>(),
      beginDrag: vi.fn<SceneController['excrementPlacement']['beginDrag']>(),
      drag: vi.fn<SceneController['excrementPlacement']['drag']>(),
      endDrag: vi.fn<SceneController['excrementPlacement']['endDrag']>(),
      hits: vi.fn<SceneController['excrementPlacement']['hits']>(),
      nudge: vi.fn<SceneController['excrementPlacement']['nudge']>(),
    },
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
  hidden = false
  value = ''
  style = {}
  dataset = {}
  classList = {
    add: vi.fn<DOMTokenList['add']>(),
    remove: vi.fn<DOMTokenList['remove']>(),
    toggle: vi.fn<DOMTokenList['toggle']>(),
  }
  setAttribute = vi.fn<HTMLElement['setAttribute']>()
  focus = vi.fn<HTMLElement['focus']>()
  setPointerCapture = vi.fn<Element['setPointerCapture']>()
  hasPointerCapture = vi.fn<Element['hasPointerCapture']>().mockReturnValue(true)
  releasePointerCapture = vi.fn<Element['releasePointerCapture']>()
  replaceChildren = vi.fn<ParentNode['replaceChildren']>()
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
  let count = 3
  let selected = 0
  let editing = false
  scene.hasExcrement.mockReturnValue(false)
  scene.addExcrement.mockImplementation(() => {
    if (!count) count = 1
    scene.hasExcrement.mockReturnValue(true)
  })
  scene.excrementPlacement.count.mockImplementation(() => count)
  scene.excrementPlacement.setCount.mockImplementation((value) => {
    count = value
    selected = Math.max(0, Math.min(selected, count - 1))
    scene.hasExcrement.mockReturnValue(count > 0)
  })
  scene.excrementPlacement.setEnabled.mockImplementation((enabled) => {
    editing = enabled
  })
  scene.excrementPlacement.selection.mockImplementation(() =>
    editing && count
      ? {
          index: selected,
          rotation: 0,
          size: 1,
          shape: { kind: 'log', curvature: 0, thickness: 1 },
        }
      : null,
  )
  scene.excrementPlacement.select.mockImplementation((index) => {
    selected = index
  })
  scene.excrementPlacement.addPiece.mockImplementation(() => {
    if (count >= MAX_EXCREMENT_PIECES) return
    count++
    selected = count - 1
    scene.hasExcrement.mockReturnValue(true)
  })
  scene.excrementPlacement.removeSelected.mockImplementation(() => {
    count = Math.max(0, count - 1)
    selected = Math.max(0, Math.min(selected, count - 1))
    scene.hasExcrement.mockReturnValue(count > 0)
  })
  scene.excrementPlacement.beginDrag.mockReturnValue(false)
  elements = new Map()
  nextFrame = undefined
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  page = Object.assign(new EventTarget(), {
    hidden: false,
    querySelector: element,
    createElement: () => new PageElement(),
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
    expect(scene.flushExcrement).toHaveBeenCalledOnce()
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
    expect(element('#excrement-add').disabled).toBe(true)
    expect(element('#excrement-mosaic').disabled).toBe(true)
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
    for (const selector of [
      '#flush-button',
      '#boost-toggle',
      '#lid-toggle',
      '#strength-options',
      '#excrement-add',
      '#excrement-mosaic',
    ]) {
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

describe('排泄物操作', () => {
  it('马赛克默认开启，冲水中可切换且不会重启或停止本轮', async () => {
    await import('./main')
    expect(scene.setExcrementMosaic).toHaveBeenLastCalledWith(true)
    expect(element('#excrement-mosaic').disabled).toBe(false)
    renderAt(1000)
    element('#excrement-add').dispatchEvent(new Event('click'))
    element('#flush-button').dispatchEvent(new Event('click'))
    renderAt(2000)
    element('#excrement-mosaic').dispatchEvent(new Event('click'))
    expect(scene.setExcrementMosaic).toHaveBeenLastCalledWith(false)
    expect(element('#excrement-mosaic').setAttribute).toHaveBeenLastCalledWith(
      'aria-pressed',
      'false',
    )
    renderAt(3000)
    expect(scene.update.mock.lastCall![0].elapsed).toBeCloseTo(2)
    expect(element('#flush-button').disabled).toBe(true)
    element('#excrement-mosaic').dispatchEvent(new Event('click'))
    expect(scene.setExcrementMosaic).toHaveBeenLastCalledWith(true)
    expect(scene.flushExcrement).toHaveBeenCalledOnce()
    expect(scene.addExcrement).toHaveBeenCalledOnce()
  })

  it('每次只放入一份，冲走并结束本轮后可以再次放入', async () => {
    await import('./main')
    renderAt(1000)
    expect(element('#excrement-add').disabled).toBe(false)
    element('#excrement-add').dispatchEvent(new Event('click'))
    expect(scene.addExcrement).toHaveBeenCalledOnce()
    expect(element('#excrement-add').disabled).toBe(false)
    expect(element('#excrement-label').textContent).toBe('完成摆放')
    expect(element('#placement-options').hidden).toBe(false)
    element('#excrement-add').dispatchEvent(new Event('click'))
    expect(element('#excrement-label').textContent).toBe('调整摆放')
    expect(element('#placement-options').hidden).toBe(true)
    expect(scene.addExcrement).toHaveBeenCalledOnce()
    element('#flush-button').dispatchEvent(new Event('click'))
    scene.hasExcrement.mockReturnValue(false)
    renderAt(6000)
    expect(element('#excrement-add').disabled).toBe(true)
    renderAt(13000)
    expect(element('#excrement-add').disabled).toBe(false)
    element('#excrement-add').dispatchEvent(new Event('click'))
    expect(scene.addExcrement).toHaveBeenCalledTimes(2)
  })

  it('合盖和声音询问期间不能放入，重新掀盖后立即可用', async () => {
    await import('./main')
    element('#lid-toggle').dispatchEvent(new Event('click'))
    expect(element('#excrement-add').disabled).toBe(true)
    element('#excrement-add').dispatchEvent(new Event('click'))
    expect(scene.addExcrement).not.toHaveBeenCalled()
    element('#lid-toggle').dispatchEvent(new Event('click'))
    expect(element('#excrement-add').disabled).toBe(false)
    element('#sound-dialog').open = true
    element('#excrement-add').dispatchEvent(new Event('click'))
    expect(scene.addExcrement).not.toHaveBeenCalled()
  })

  it('冲刷时不能放入，Boost 在补水阶段允许按当前水位再次放入', async () => {
    await import('./main')
    renderAt(1000)
    element('#boost-toggle').dispatchEvent(new Event('click'))
    element('#flush-button').dispatchEvent(new Event('click'))
    element('#excrement-add').dispatchEvent(new Event('click'))
    expect(scene.addExcrement).not.toHaveBeenCalled()
    renderAt(6000)
    expect(element('#excrement-add').disabled).toBe(false)
    element('#excrement-add').dispatchEvent(new Event('click'))
    expect(scene.addExcrement).toHaveBeenCalledOnce()
    expect(scene.addExcrement.mock.lastCall![0]).toEqual(scene.update.mock.lastCall![0])
  })

  it('逐段选择、旋转和缩放仅在摆放模式生效，合盖或冲水立即结束编辑', async () => {
    await import('./main')
    element('#excrement-add').dispatchEvent(new Event('click'))
    expect(element('#app').classList.toggle).toHaveBeenCalledWith('is-arranging', true)
    element('#piece-select').value = '1'
    element('#piece-select').dispatchEvent(new Event('change'))
    expect(scene.excrementPlacement.select).toHaveBeenLastCalledWith(1)
    element('#placement-rotation').value = '75'
    element('#placement-rotation').dispatchEvent(new Event('input'))
    expect(scene.excrementPlacement.transform).toHaveBeenLastCalledWith({ rotation: 75 })
    element('#placement-size').value = '125'
    element('#placement-size').dispatchEvent(new Event('input'))
    expect(scene.excrementPlacement.transform).toHaveBeenLastCalledWith({ size: 1.25 })
    element('#lid-toggle').dispatchEvent(new Event('click'))
    expect(element('#placement-options').hidden).toBe(true)
    expect(element('#app').classList.toggle).toHaveBeenCalledWith('is-arranging', false)
    element('#placement-size').dispatchEvent(new Event('input'))
    expect(scene.excrementPlacement.transform).toHaveBeenCalledTimes(2)
    element('#lid-toggle').dispatchEvent(new Event('click'))
    element('#excrement-add').dispatchEvent(new Event('click'))
    element('#flush-button').dispatchEvent(new Event('click'))
    expect(element('#placement-options').disabled).toBe(true)
    expect(scene.excrementPlacement.setEnabled).toHaveBeenLastCalledWith(false)
  })

  it('拖动捕获同一指针，取消或冲水会释放，后续移动不会继续摆放', async () => {
    await import('./main')
    element('#excrement-add').dispatchEvent(new Event('click'))
    scene.excrementPlacement.beginDrag.mockReturnValue(true)
    const dispatch = (type: string, pointerId = 1): void => {
      const event = Object.assign(new Event(type, { cancelable: true }), {
        button: 0,
        pointerId,
        clientX: 200,
        clientY: 300,
      })
      element('#scene').dispatchEvent(event)
    }
    dispatch('pointerdown')
    expect(element('#scene').setPointerCapture).toHaveBeenCalledWith(1)
    dispatch('pointermove', 2)
    expect(scene.excrementPlacement.drag).not.toHaveBeenCalled()
    dispatch('pointermove')
    expect(scene.excrementPlacement.drag).toHaveBeenCalledOnce()
    dispatch('pointercancel')
    expect(element('#scene').releasePointerCapture).toHaveBeenCalledWith(1)
    dispatch('pointermove')
    expect(scene.excrementPlacement.drag).toHaveBeenCalledOnce()
    dispatch('pointerdown')
    element('#flush-button').dispatchEvent(new Event('click'))
    dispatch('pointermove')
    expect(scene.excrementPlacement.drag).toHaveBeenCalledOnce()
    expect(element('#scene').releasePointerCapture).toHaveBeenCalledTimes(2)
  })

  it('画布支持方向键和 WASD 微调，Escape 退出，Boost 提前解锁撤销时也退出', async () => {
    await import('./main')
    renderAt(1000)
    element('#excrement-add').dispatchEvent(new Event('click'))
    const key = (code: string, shiftKey = false): void => {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { code, shiftKey })
      Object.defineProperty(event, 'target', { value: element('#scene') })
      window.dispatchEvent(event)
    }
    key('ArrowRight')
    expect(scene.excrementPlacement.nudge).toHaveBeenLastCalledWith(0.01, 0)
    key('ArrowUp', true)
    expect(scene.excrementPlacement.nudge).toHaveBeenLastCalledWith(0, -0.03)
    key('KeyW')
    expect(scene.excrementPlacement.nudge).toHaveBeenLastCalledWith(0, -0.01)
    key('KeyD', true)
    expect(scene.excrementPlacement.nudge).toHaveBeenLastCalledWith(0.03, 0)
    key('Escape')
    expect(element('#placement-options').hidden).toBe(true)
    expect(element('#excrement-add').focus).toHaveBeenCalled()
    element('#boost-toggle').dispatchEvent(new Event('click'))
    element('#flush-button').dispatchEvent(new Event('click'))
    scene.hasExcrement.mockReturnValue(false)
    renderAt(6200)
    element('#excrement-add').dispatchEvent(new Event('click'))
    expect(element('#placement-options').hidden).toBe(false)
    element('#boost-toggle').dispatchEvent(new Event('click'))
    expect(element('#placement-options').hidden).toBe(true)
    expect(element('#excrement-add').disabled).toBe(true)
  })

  it('进入摆放页后键盘立即微调，重新进入沿用该页时也恢复画布焦点', async () => {
    await import('./main')
    let focused = element('#excrement-add')
    element('#scene').focus.mockImplementation(() => {
      focused = element('#scene')
    })
    element('#excrement-add').dispatchEvent(new Event('click'))
    expect(element('#scene').focus).not.toHaveBeenCalled()
    focused = element('#placement-tab-position')
    focused.dispatchEvent(new Event('click'))
    expect(focused).toBe(element('#scene'))
    expect(element('#scene').focus).toHaveBeenLastCalledWith({ preventScroll: true })
    for (const [code, x, z] of [
      ['KeyW', 0, -0.01],
      ['KeyA', -0.01, 0],
      ['KeyS', 0, 0.01],
      ['KeyD', 0.01, 0],
      ['ArrowUp', 0, -0.01],
      ['ArrowLeft', -0.01, 0],
      ['ArrowDown', 0, 0.01],
      ['ArrowRight', 0.01, 0],
    ] as const) {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { code })
      Object.defineProperty(event, 'target', { value: focused })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(scene.excrementPlacement.nudge).toHaveBeenLastCalledWith(x, z)
    }
    element('#excrement-add').dispatchEvent(new Event('click'))
    focused = element('#excrement-add')
    element('#excrement-add').dispatchEvent(new Event('click'))
    expect(focused).toBe(element('#scene'))
    for (const id of ['#placement-tab-quantity', '#placement-tab-shape']) {
      focused = element(id)
      focused.dispatchEvent(new Event('click'))
      expect(focused).toBe(element(id))
    }
  })

  it('WASD 不干扰表单控件、浏览器组合快捷键和输入法组合输入', async () => {
    await import('./main')
    element('#excrement-add').dispatchEvent(new Event('click'))
    for (const { target, ...keys } of [
      { target: '#piece-select', code: 'KeyW' },
      { target: '#placement-size', code: 'KeyA' },
      { target: '#scene', code: 'KeyW', metaKey: true },
      { target: '#scene', code: 'KeyS', ctrlKey: true },
      { target: '#scene', code: 'KeyD', altKey: true },
      { target: '#scene', code: 'KeyA', isComposing: true },
    ]) {
      const event = Object.assign(new Event('keydown', { cancelable: true }), keys)
      Object.defineProperty(event, 'target', { value: element(target) })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(scene.excrementPlacement.nudge).not.toHaveBeenCalled()
  })

  it('形状页将预设、弯曲和粗细传给选中段，冲水后不能继续修改', async () => {
    await import('./main')
    element('#excrement-add').dispatchEvent(new Event('click'))
    element('#placement-tab-shape').dispatchEvent(new Event('click'))
    expect(element('#placement-transform').hidden).toBe(true)
    expect(element('#placement-shape').hidden).toBe(false)
    element('#shape-kind').value = 'clump'
    element('#shape-kind').dispatchEvent(new Event('change'))
    expect(scene.excrementPlacement.reshape).toHaveBeenLastCalledWith({ kind: 'clump' })
    element('#shape-curvature').value = '-75'
    element('#shape-curvature').dispatchEvent(new Event('input'))
    expect(scene.excrementPlacement.reshape).toHaveBeenLastCalledWith({ curvature: -0.75 })
    element('#shape-thickness').value = '130'
    element('#shape-thickness').dispatchEvent(new Event('input'))
    expect(scene.excrementPlacement.reshape).toHaveBeenLastCalledWith({ thickness: 1.3 })
    element('#placement-tab-position').dispatchEvent(new Event('click'))
    expect(element('#placement-shape').hidden).toBe(true)
    expect(element('#placement-transform').hidden).toBe(false)
    element('#flush-button').dispatchEvent(new Event('click'))
    element('#shape-kind').dispatchEvent(new Event('change'))
    element('#shape-thickness').dispatchEvent(new Event('input'))
    expect(scene.excrementPlacement.reshape).toHaveBeenCalledTimes(3)
  })

  it('数量选择随增删更新，删空后仍可新增；冲水锁定数量操作', async () => {
    await import('./main')
    element('#excrement-add').dispatchEvent(new Event('click'))
    element('#placement-tab-position').dispatchEvent(new Event('click'))
    element('#piece-add').dispatchEvent(new Event('click'))
    expect(element('#piece-count').textContent).toBe('4 段')
    expect(element('#piece-select').value).toBe('3')
    expect(element('#piece-select').replaceChildren.mock.lastCall).toHaveLength(4)
    for (let index = 0; index < 4; index++)
      element('#piece-remove').dispatchEvent(new Event('click'))
    expect(element('#placement-options').hidden).toBe(false)
    expect(element('#placement-empty').hidden).toBe(false)
    expect(element('#piece-remove').disabled).toBe(true)
    expect(element('#piece-add').disabled).toBe(false)
    expect(element('#excrement-label').textContent).toBe('完成摆放')
    element('#piece-add').dispatchEvent(new Event('click'))
    expect(element('#piece-count').textContent).toBe('1 段')
    expect(element('#placement-empty').hidden).toBe(true)
    expect(element('#piece-select').value).toBe('0')
    element('#flush-button').dispatchEvent(new Event('click'))
    element('#piece-add').dispatchEvent(new Event('click'))
    element('#piece-remove').dispatchEvent(new Event('click'))
    expect(scene.excrementPlacement.addPiece).toHaveBeenCalledTimes(2)
    expect(scene.excrementPlacement.removeSelected).toHaveBeenCalledTimes(4)
  })

  it('数量预设同步计数与选中状态，手动增减和删空后仍可使用', async () => {
    await import('./main')
    element('#excrement-add').dispatchEvent(new Event('click'))
    expect(element('#placement-quantity').hidden).toBe(false)
    expect(element('#quantity-medium').setAttribute).toHaveBeenLastCalledWith(
      'aria-pressed',
      'true',
    )
    element('#quantity-large').dispatchEvent(new Event('click'))
    expect(scene.excrementPlacement.setCount).toHaveBeenLastCalledWith(6)
    expect(element('#piece-count').textContent).toBe('6 段')
    expect(element('#quantity-large').setAttribute).toHaveBeenLastCalledWith('aria-pressed', 'true')
    element('#piece-add').dispatchEvent(new Event('click'))
    for (const key of ['small', 'medium', 'large'])
      expect(element(`#quantity-${key}`).setAttribute).toHaveBeenLastCalledWith(
        'aria-pressed',
        'false',
      )
    element('#quantity-small').dispatchEvent(new Event('click'))
    expect(element('#piece-count').textContent).toBe('1 段')
    expect(element('#piece-select').value).toBe('0')
    element('#piece-remove').dispatchEvent(new Event('click'))
    expect(element('#piece-count').textContent).toBe('0 段')
    expect(element('#placement-quantity').hidden).toBe(false)
    expect(element('#quantity-medium').disabled).toBe(false)
    element('#quantity-medium').dispatchEvent(new Event('click'))
    expect(element('#piece-count').textContent).toBe('3 段')
    expect(element('#piece-remove').disabled).toBe(false)
  })

  it('退出编辑、合盖与冲水期间不接受数量预设', async () => {
    await import('./main')
    element('#quantity-large').dispatchEvent(new Event('click'))
    expect(scene.excrementPlacement.setCount).not.toHaveBeenCalled()
    element('#excrement-add').dispatchEvent(new Event('click'))
    element('#lid-toggle').dispatchEvent(new Event('click'))
    expect(element('#quantity-large').disabled).toBe(true)
    element('#quantity-large').dispatchEvent(new Event('click'))
    expect(scene.excrementPlacement.setCount).not.toHaveBeenCalled()
    element('#lid-toggle').dispatchEvent(new Event('click'))
    element('#excrement-add').dispatchEvent(new Event('click'))
    element('#quantity-large').dispatchEvent(new Event('click'))
    expect(scene.excrementPlacement.setCount).toHaveBeenCalledOnce()
    element('#flush-button').dispatchEvent(new Event('click'))
    element('#quantity-small').dispatchEvent(new Event('click'))
    expect(scene.excrementPlacement.setCount).toHaveBeenCalledOnce()
    expect(element('#quantity-small').disabled).toBe(true)
  })

  it('达到数量上限后禁用增加，减少后恢复；删空退出后主按钮可重新放入', async () => {
    await import('./main')
    element('#excrement-add').dispatchEvent(new Event('click'))
    for (let index = 3; index < MAX_EXCREMENT_PIECES; index++)
      element('#piece-add').dispatchEvent(new Event('click'))
    expect(element('#piece-add').disabled).toBe(true)
    element('#piece-remove').dispatchEvent(new Event('click'))
    expect(element('#piece-add').disabled).toBe(false)
    for (let index = 1; index < MAX_EXCREMENT_PIECES; index++)
      element('#piece-remove').dispatchEvent(new Event('click'))
    element('#excrement-add').dispatchEvent(new Event('click'))
    expect(element('#placement-options').hidden).toBe(true)
    expect(element('#excrement-label').textContent).toBe('放入排泄物')
    element('#excrement-add').dispatchEvent(new Event('click'))
    expect(element('#piece-count').textContent).toBe('1 段')
    expect(element('#placement-options').hidden).toBe(false)
  })
})
