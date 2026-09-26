import './style.css'
import { createFlushAudio } from './audio'
import {
  CLEANER_COLORS,
  EXCREMENT_QUANTITY_PRESETS,
  FLUSH_STRENGTHS,
  MAX_EXCREMENT_PIECES,
  PHASE_LABELS,
} from './constants'
import { createScene } from './scene/create-scene'
import { FlushCycle } from './simulation/flush-cycle'
import { readRememberedSound, rememberSound } from './sound-preference'
import type {
  CleanerColor,
  ExcrementShape,
  FlushState,
  FlushStrength,
  SceneController,
} from './types'

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!
const app = document.querySelector<HTMLElement>('#app')!
const sceneFrame = document.querySelector<HTMLElement>('.scene-frame')!
const flushButton = document.querySelector<HTMLButtonElement>('#flush-button')!
const flushLabel = document.querySelector<HTMLElement>('#flush-label')!
const boostButton = document.querySelector<HTMLButtonElement>('#boost-toggle')!
const phaseLabel = document.querySelector<HTMLElement>('#phase-label')!
const soundButton = document.querySelector<HTMLButtonElement>('#sound-toggle')!
const soundLabel = document.querySelector<HTMLElement>('#sound-label')!
const soundDialog = document.querySelector<HTMLDialogElement>('#sound-dialog')!
const rememberCheckbox = document.querySelector<HTMLInputElement>('#sound-remember')!
const keepMutedButton = document.querySelector<HTMLButtonElement>('#sound-keep-muted')!
const enableSoundButton = document.querySelector<HTMLButtonElement>('#sound-enable')!
const tankLabel = document.querySelector<HTMLElement>('#tank-label')!
const tankFill = document.querySelector<HTMLElement>('#tank-fill')!
const tankMeter = document.querySelector<HTMLElement>('#tank-meter')!
const loading = document.querySelector<HTMLElement>('#loading')!
const lidButton = document.querySelector<HTMLButtonElement>('#lid-toggle')!
const settings = document.querySelector<HTMLElement>('.settings')!
const strengthOptions = document.querySelector<HTMLFieldSetElement>('#strength-options')!
const excrementButton = document.querySelector<HTMLButtonElement>('#excrement-add')!
const excrementLabel = document.querySelector<HTMLElement>('#excrement-label')!
const excrementNote = document.querySelector<HTMLElement>('#excrement-note')!
const mosaicButton = document.querySelector<HTMLButtonElement>('#excrement-mosaic')!
const placementOptions = document.querySelector<HTMLFieldSetElement>('#placement-options')!
const pieceSelect = document.querySelector<HTMLSelectElement>('#piece-select')!
const pieceCount = document.querySelector<HTMLElement>('#piece-count')!
const addPieceButton = document.querySelector<HTMLButtonElement>('#piece-add')!
const removePieceButton = document.querySelector<HTMLButtonElement>('#piece-remove')!
const placementEmpty = document.querySelector<HTMLElement>('#placement-empty')!
const rotationInput = document.querySelector<HTMLInputElement>('#placement-rotation')!
const sizeInput = document.querySelector<HTMLInputElement>('#placement-size')!
const rotationValue = document.querySelector<HTMLOutputElement>('#placement-rotation-value')!
const sizeValue = document.querySelector<HTMLOutputElement>('#placement-size-value')!
const quantityTab = document.querySelector<HTMLButtonElement>('#placement-tab-quantity')!
const quantityPanel = document.querySelector<HTMLElement>('#placement-quantity')!
const quantityPresets = Object.entries(EXCREMENT_QUANTITY_PRESETS).map(([key, preset]) => {
  const button = document.querySelector<HTMLButtonElement>(`#quantity-${key}`)!
  button.textContent = `${preset.label} · ${preset.count} 段`
  return { button, count: preset.count }
})
const positionTab = document.querySelector<HTMLButtonElement>('#placement-tab-position')!
const shapeTab = document.querySelector<HTMLButtonElement>('#placement-tab-shape')!
const transformPanel = document.querySelector<HTMLElement>('#placement-transform')!
const shapePanel = document.querySelector<HTMLElement>('#placement-shape')!
const shapeKind = document.querySelector<HTMLSelectElement>('#shape-kind')!
const curvatureInput = document.querySelector<HTMLInputElement>('#shape-curvature')!
const thicknessInput = document.querySelector<HTMLInputElement>('#shape-thickness')!
const curvatureValue = document.querySelector<HTMLOutputElement>('#shape-curvature-value')!
const thicknessValue = document.querySelector<HTMLOutputElement>('#shape-thickness-value')!
const cycle = new FlushCycle()
const audio = createFlushAudio()
const listeners = new AbortController()
const { signal } = listeners
let scene: SceneController | undefined
let frame = 0
let lastTime = 0
const rememberedSound = readRememberedSound()
let soundEnabled = rememberedSound ?? false
let rememberSoundSelection = rememberedSound !== null
let lastInterfaceState = ''
let lastTankPercent = -1
let failed = false
let strength: FlushStrength = 'standard'
let cleaner: CleanerColor = 'blue'
let lidClosed = false
let mosaicEnabled = true
let placementEditing = false
let placementTab: 'quantity' | 'position' | 'shape' = 'quantity'
let lastPieceCount = -1
let dragPointer: number | null = null

function endPlacementDrag(): void {
  const pointer = dragPointer
  dragPointer = null
  if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer)
  scene?.excrementPlacement.endDrag()
  canvas.style.cursor = 'default'
}

function canArrange(): boolean {
  return (
    !!scene &&
    !failed &&
    !soundDialog.open &&
    cycle.canStart &&
    !lidClosed &&
    (scene.hasExcrement() || placementEditing)
  )
}

function updatePlacementControls(): void {
  const count = scene?.excrementPlacement.count() ?? 0
  const selection = scene?.excrementPlacement.selection()
  if (count !== lastPieceCount) {
    lastPieceCount = count
    pieceCount.textContent = `${count} 段`
    pieceSelect.replaceChildren(
      ...Array.from({ length: Math.max(1, count) }, (_, index) => {
        const option = document.createElement('option')
        option.value = count ? String(index) : ''
        option.textContent = count ? `第 ${index + 1} 段` : '暂无段落'
        return option
      }),
    )
  }
  addPieceButton.disabled = !placementEditing || count >= MAX_EXCREMENT_PIECES
  addPieceButton.title =
    count >= MAX_EXCREMENT_PIECES ? `最多 ${MAX_EXCREMENT_PIECES} 段` : '添加一段'
  removePieceButton.disabled = !selection
  for (const control of [
    pieceSelect,
    rotationInput,
    sizeInput,
    shapeKind,
    curvatureInput,
    thicknessInput,
    positionTab,
    shapeTab,
  ])
    control.disabled = !selection
  quantityTab.disabled = !placementEditing
  for (const preset of quantityPresets) {
    preset.button.disabled = !placementEditing
    preset.button.setAttribute('aria-pressed', String(count === preset.count))
  }
  quantityPanel.hidden = placementTab !== 'quantity'
  placementEmpty.hidden = !!selection || placementTab === 'quantity'
  transformPanel.hidden = !selection || placementTab !== 'position'
  shapePanel.hidden = !selection || placementTab !== 'shape'
  quantityTab.setAttribute('aria-pressed', String(placementTab === 'quantity'))
  positionTab.setAttribute('aria-pressed', String(placementTab === 'position'))
  shapeTab.setAttribute('aria-pressed', String(placementTab === 'shape'))
  if (!selection) return
  pieceSelect.value = String(selection.index)
  rotationInput.value = String(Math.round(selection.rotation))
  sizeInput.value = String(Math.round(selection.size * 100))
  rotationValue.textContent = `${rotationInput.value}°`
  sizeValue.textContent = `${sizeInput.value}%`
  shapeKind.value = selection.shape.kind
  curvatureInput.value = String(Math.round(selection.shape.curvature * 100))
  thicknessInput.value = String(Math.round(selection.shape.thickness * 100))
  curvatureValue.textContent = `${curvatureInput.value}%`
  thicknessValue.textContent = `${thicknessInput.value}%`
}

function setPlacementEditing(enabled: boolean): void {
  endPlacementDrag()
  const nextEditing = enabled && canArrange()
  const layoutChanged = nextEditing !== placementEditing
  placementEditing = nextEditing
  scene?.excrementPlacement.setEnabled(placementEditing)
  placementOptions.hidden = !placementEditing
  placementOptions.disabled = !placementEditing
  canvas.classList.toggle('is-placing', placementEditing)
  canvas.tabIndex = placementEditing ? 0 : -1
  app.classList.toggle('is-arranging', placementEditing)
  if (layoutChanged && !failed) scene?.resize()
  updatePlacementControls()
  updateInterface(cycle.state)
  if (placementEditing && placementTab === 'position') canvas.focus({ preventScroll: true })
}

function updateInterface(state: FlushState): void {
  const canStart = cycle.canStart
  const hasExcrement = scene?.hasExcrement() ?? false
  const count = scene?.excrementPlacement.count() ?? 0
  const interfaceState = `${state.phase}:${cycle.boostEnabled}:${canStart}:${lidClosed}:${hasExcrement}:${placementEditing}:${count}`
  if (interfaceState !== lastInterfaceState) {
    lastInterfaceState = interfaceState
    const ready = state.phase === 'ready'
    app.classList.toggle('has-excrement', hasExcrement)
    flushButton.disabled = !canStart
    strengthOptions.disabled = !canStart
    excrementButton.disabled = !canStart || lidClosed
    excrementLabel.textContent = placementEditing
      ? '完成摆放'
      : hasExcrement
        ? '调整摆放'
        : '放入排泄物'
    excrementNote.textContent = placementEditing
      ? count
        ? '拖动摆放 · 方向键微调'
        : '可直接完成摆放'
      : hasExcrement
        ? state.phase === 'flushing' || state.phase === 'draining'
          ? '正在随水流冲走'
          : lidClosed
            ? '掀开马桶盖后可调整摆放'
            : '可以调整摆放，也可以直接冲水'
        : lidClosed
          ? '先掀开马桶盖，再放入'
          : canStart
            ? '放入一份，看看水流如何带走它'
            : '等待本轮冲水完成后可放入'
    boostButton.setAttribute('aria-pressed', String(cycle.boostEnabled))
    flushLabel.textContent = canStart
      ? ready
        ? '冲水'
        : '再次冲水'
      : state.phase === 'refilling' || state.phase === 'settling'
        ? '正在补水'
        : '正在冲水'
    phaseLabel.textContent = canStart && !ready ? '补水中，可再次冲水' : PHASE_LABELS[state.phase]
    document.body.dataset.phase = state.phase
    tankLabel.textContent = ready ? '水箱已蓄满' : '水箱自动蓄水中'
  }
  const percent = Math.round(state.tankLevel * 100)
  if (percent !== lastTankPercent) {
    lastTankPercent = percent
    tankFill.style.transform = `scaleX(${state.tankLevel})`
    tankMeter.setAttribute('aria-valuenow', String(percent))
  }
}

function showError(): void {
  failed = true
  setPlacementEditing(false)
  cancelAnimationFrame(frame)
  audio.setEnabled(false)
  flushButton.disabled = true
  strengthOptions.disabled = true
  lidButton.disabled = true
  boostButton.disabled = true
  excrementButton.disabled = true
  mosaicButton.disabled = true
  placementOptions.disabled = true
  flushLabel.textContent = '暂时无法冲水'
  loading.classList.remove('is-hidden')
  loading.classList.add('has-error')
  loading.textContent = '三维画面未能加载，请尝试启用硬件加速，或更换浏览器、设备后重试。'
  phaseLabel.textContent = '画面加载失败'
}

function render(timestamp: number): void {
  if (!scene || failed || document.hidden) return
  // 时间轴保留完整经过时间，与录音时钟同步；步长限制由流体积分层负责。
  // 同一帧的 RAF 时间戳可能早于点击时刻，计时基准不能倒退。
  const currentTime = Math.max(timestamp, lastTime)
  const delta = lastTime === 0 ? 0 : (currentTime - lastTime) / 1000
  lastTime = currentTime
  const state = cycle.advance(delta)
  scene.update(state, delta)
  audio.update(state)
  updateInterface(state)
  frame = requestAnimationFrame(render)
}

function requestFlush(): void {
  if (!scene || failed || soundDialog.open || !cycle.start(strength)) return
  // 新循环从接受请求时计时，点击前积累的长帧不属于本次冲水。
  lastTime = performance.now()
  setPlacementEditing(false)
  scene.flushExcrement()
  updateInterface(cycle.state)
  void audio.unlock().catch(() => {
    soundEnabled = false
    updateSoundButton()
  })
}

function updateSoundButton(): void {
  audio.setEnabled(soundEnabled && !document.hidden)
  soundButton.setAttribute('aria-pressed', String(soundEnabled))
  soundButton.setAttribute('aria-label', soundEnabled ? '关闭声音' : '开启声音')
  soundLabel.textContent = soundEnabled ? '声音已开启' : '声音已关闭'
  soundButton.classList.toggle('is-muted', !soundEnabled)
}

function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled
  updateSoundButton()
  if (rememberSoundSelection) rememberSound(enabled)
  if (enabled)
    void audio.unlock().catch(() => {
      soundEnabled = false
      updateSoundButton()
    })
}

function finishSoundChoice(enabled: boolean, remember = rememberCheckbox.checked): void {
  rememberSoundSelection = remember
  setSoundEnabled(enabled)
  soundDialog.close()
  soundButton.focus({ preventScroll: true })
}

keepMutedButton.addEventListener('click', () => finishSoundChoice(false), { signal })
enableSoundButton.addEventListener('click', () => finishSoundChoice(true), { signal })
soundDialog.addEventListener(
  'cancel',
  (event) => {
    event.preventDefault()
    finishSoundChoice(false, false)
  },
  { signal },
)

flushButton.addEventListener('click', requestFlush, { signal })
mosaicButton.addEventListener(
  'click',
  () => {
    if (!scene || failed || soundDialog.open) return
    mosaicEnabled = !mosaicEnabled
    scene.setExcrementMosaic(mosaicEnabled)
    mosaicButton.setAttribute('aria-pressed', String(mosaicEnabled))
  },
  { signal },
)
excrementButton.addEventListener(
  'click',
  () => {
    if (!scene || failed || soundDialog.open || !cycle.canStart || lidClosed) return
    if (placementEditing) setPlacementEditing(false)
    else if (scene.hasExcrement()) setPlacementEditing(true)
    else {
      scene.addExcrement(cycle.state)
      setPlacementEditing(true)
    }
  },
  { signal },
)
boostButton.addEventListener(
  'click',
  () => {
    if (!scene || failed) return
    cycle.boostEnabled = !cycle.boostEnabled
    if (!cycle.canStart) setPlacementEditing(false)
    updateInterface(cycle.state)
  },
  { signal },
)
lidButton.addEventListener(
  'click',
  () => {
    if (!scene || failed) return
    lidClosed = !lidClosed
    if (lidClosed) setPlacementEditing(false)
    scene.setLidClosed(lidClosed)
    lidButton.setAttribute('aria-pressed', String(lidClosed))
    lidButton.textContent = lidClosed ? '掀开马桶盖' : '盖上马桶盖'
    updateInterface(cycle.state)
  },
  { signal },
)
settings.addEventListener(
  'change',
  (event) => {
    const input = event.target
    if (!(input instanceof HTMLInputElement) || !input.checked) return
    if (input.name === 'strength' && Object.hasOwn(FLUSH_STRENGTHS, input.value)) {
      strength = input.value as FlushStrength
    }
    if (input.name === 'cleaner' && Object.hasOwn(CLEANER_COLORS, input.value)) {
      cleaner = input.value as CleanerColor
      scene?.setCleaner(cleaner)
    }
  },
  { signal },
)
soundButton.addEventListener('click', () => setSoundEnabled(!soundEnabled), { signal })

pieceSelect.addEventListener(
  'change',
  () => {
    if (!placementEditing || !canArrange()) return
    endPlacementDrag()
    scene!.excrementPlacement.select(Number(pieceSelect.value))
    updatePlacementControls()
  },
  { signal },
)
for (const button of [addPieceButton, removePieceButton]) {
  button.addEventListener(
    'click',
    () => {
      if (!placementEditing || !canArrange()) return
      endPlacementDrag()
      if (button === addPieceButton) scene!.excrementPlacement.addPiece()
      else scene!.excrementPlacement.removeSelected()
      updatePlacementControls()
      updateInterface(cycle.state)
      if (button.disabled)
        (addPieceButton.disabled ? pieceSelect : addPieceButton).focus({ preventScroll: true })
    },
    { signal },
  )
}
for (const preset of quantityPresets) {
  preset.button.addEventListener(
    'click',
    () => {
      if (!placementEditing || !canArrange()) return
      endPlacementDrag()
      scene!.excrementPlacement.setCount(preset.count)
      updatePlacementControls()
      updateInterface(cycle.state)
    },
    { signal },
  )
}
for (const input of [rotationInput, sizeInput]) {
  input.addEventListener(
    'input',
    () => {
      if (!placementEditing || !canArrange()) return
      scene!.excrementPlacement.transform(
        input === rotationInput
          ? { rotation: Number(input.value) }
          : { size: Number(input.value) / 100 },
      )
      updatePlacementControls()
    },
    { signal },
  )
}
for (const tab of [quantityTab, positionTab, shapeTab]) {
  tab.addEventListener(
    'click',
    () => {
      if (!placementEditing || !canArrange()) return
      placementTab = tab === quantityTab ? 'quantity' : tab === shapeTab ? 'shape' : 'position'
      updatePlacementControls()
      // 摆放页进入场景键盘操作，数量和形状页继续保留控件自身的焦点。
      if (tab === positionTab) canvas.focus({ preventScroll: true })
    },
    { signal },
  )
}
shapeKind.addEventListener(
  'change',
  () => {
    if (!placementEditing || !canArrange() || !['log', 'curved', 'clump'].includes(shapeKind.value))
      return
    scene!.excrementPlacement.reshape({ kind: shapeKind.value as ExcrementShape })
    updatePlacementControls()
  },
  { signal },
)
for (const input of [curvatureInput, thicknessInput]) {
  input.addEventListener(
    'input',
    () => {
      if (!placementEditing || !canArrange()) return
      scene!.excrementPlacement.reshape(
        input === curvatureInput
          ? { curvature: Number(input.value) / 100 }
          : { thickness: Number(input.value) / 100 },
      )
      updatePlacementControls()
    },
    { signal },
  )
}

canvas.addEventListener(
  'pointerdown',
  (event) => {
    if (event.button !== 0 || dragPointer !== null) return
    if (
      placementEditing &&
      canArrange() &&
      scene!.excrementPlacement.beginDrag(event.clientX, event.clientY)
    ) {
      event.preventDefault()
      dragPointer = event.pointerId
      canvas.setPointerCapture(event.pointerId)
      canvas.focus({ preventScroll: true })
      canvas.style.cursor = 'grabbing'
      updatePlacementControls()
      return
    }
    if (scene?.hitsFlushButton(event.clientX, event.clientY)) requestFlush()
  },
  { signal },
)
canvas.addEventListener(
  'pointermove',
  (event) => {
    if (dragPointer !== null) {
      if (event.pointerId === dragPointer)
        scene?.excrementPlacement.drag(event.clientX, event.clientY)
      return
    }
    canvas.style.cursor =
      placementEditing && scene?.excrementPlacement.hits(event.clientX, event.clientY)
        ? 'grab'
        : scene?.hitsFlushButton(event.clientX, event.clientY) && cycle.canStart
          ? 'pointer'
          : 'default'
  },
  { signal },
)
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  canvas.addEventListener(
    type,
    (event) => {
      if (event.pointerId === dragPointer) endPlacementDrag()
    },
    { signal },
  )
}
window.addEventListener('blur', endPlacementDrag, { signal })

window.addEventListener(
  'keydown',
  (event) => {
    if (placementEditing && !soundDialog.open) {
      if (event.code === 'Escape') {
        setPlacementEditing(false)
        excrementButton.focus({ preventScroll: true })
        return
      }
      if (
        event.target === canvas &&
        canArrange() &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.isComposing
      ) {
        const step = event.shiftKey ? 0.03 : 0.01
        const direction: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
          KeyA: [-step, 0],
          KeyD: [step, 0],
          KeyW: [0, -step],
          KeyS: [0, step],
        }
        if (direction[event.code]) {
          event.preventDefault()
          scene!.excrementPlacement.nudge(...direction[event.code])
          return
        }
      }
    }
    if (
      event.code !== 'Space' ||
      event.repeat ||
      soundDialog.open ||
      event.target instanceof HTMLButtonElement ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement
    )
      return
    event.preventDefault()
    requestFlush()
  },
  { signal },
)

window.addEventListener(
  'resize',
  () => {
    scene?.resize()
    if (scene && document.hidden) scene.update(cycle.state, 0)
  },
  { signal },
)
document.addEventListener(
  'visibilitychange',
  () => {
    endPlacementDrag()
    cancelAnimationFrame(frame)
    lastTime = 0
    audio.setEnabled(soundEnabled && !document.hidden)
    audio.setPaused(document.hidden)
    if (!document.hidden && scene && !failed) frame = requestAnimationFrame(render)
  },
  { signal },
)
canvas.addEventListener(
  'webglcontextlost',
  (event) => {
    event.preventDefault()
    showError()
  },
  { signal },
)

updateSoundButton()
if (rememberedSound === null) {
  rememberCheckbox.checked = false
  soundDialog.showModal()
}

void createScene(canvas, sceneFrame)
  .then((controller) => {
    // 初始化完成前可能已经失去上下文，或因热更新销毁了旧页面。
    if (failed || signal.aborted) {
      controller.dispose()
      return
    }
    scene = controller
    scene.setCleaner(cleaner)
    scene.setExcrementMosaic(mosaicEnabled)
    lidButton.disabled = false
    boostButton.disabled = false
    mosaicButton.disabled = false
    scene.update(cycle.state, 0)
    updateInterface(cycle.state)
    loading.classList.add('is-hidden')
    document.body.classList.add('is-loaded')
    frame = requestAnimationFrame(render)
  })
  .catch((error: unknown) => {
    if (signal.aborted) return
    console.error('Unable to initialize the toilet scene:', error)
    showError()
  })

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    endPlacementDrag()
    cancelAnimationFrame(frame)
    listeners.abort()
    soundDialog.close()
    audio.dispose()
    scene?.dispose()
  })
}
