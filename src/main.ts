import './style.css'
import { createFlushAudio } from './audio'
import { CLEANER_COLORS, FLUSH_STRENGTHS, PHASE_LABELS } from './constants'
import { createScene } from './scene/create-scene'
import { FlushCycle } from './simulation/flush-cycle'
import { readRememberedSound, rememberSound } from './sound-preference'
import type { CleanerColor, FlushState, FlushStrength, SceneController } from './types'

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!
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

function updateInterface(state: FlushState): void {
  const canStart = cycle.canStart
  const interfaceState = `${state.phase}:${cycle.boostEnabled}:${canStart}`
  if (interfaceState !== lastInterfaceState) {
    lastInterfaceState = interfaceState
    const ready = state.phase === 'ready'
    flushButton.disabled = !canStart
    strengthOptions.disabled = !canStart
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
  cancelAnimationFrame(frame)
  audio.setEnabled(false)
  flushButton.disabled = true
  strengthOptions.disabled = true
  lidButton.disabled = true
  boostButton.disabled = true
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
boostButton.addEventListener(
  'click',
  () => {
    if (!scene || failed) return
    cycle.boostEnabled = !cycle.boostEnabled
    updateInterface(cycle.state)
  },
  { signal },
)
lidButton.addEventListener(
  'click',
  () => {
    if (!scene || failed) return
    lidClosed = !lidClosed
    scene.setLidClosed(lidClosed)
    lidButton.setAttribute('aria-pressed', String(lidClosed))
    lidButton.textContent = lidClosed ? '掀开马桶盖' : '盖上马桶盖'
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

canvas.addEventListener(
  'pointerdown',
  (event) => {
    if (scene?.hitsFlushButton(event.clientX, event.clientY)) requestFlush()
  },
  { signal },
)
canvas.addEventListener(
  'pointermove',
  (event) => {
    canvas.style.cursor =
      scene?.hitsFlushButton(event.clientX, event.clientY) && cycle.canStart ? 'pointer' : 'default'
  },
  { signal },
)

window.addEventListener(
  'keydown',
  (event) => {
    if (
      event.code !== 'Space' ||
      event.repeat ||
      soundDialog.open ||
      event.target instanceof HTMLButtonElement ||
      event.target instanceof HTMLInputElement
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

void createScene(canvas)
  .then((controller) => {
    // 初始化完成前可能已经失去上下文，或因热更新销毁了旧页面。
    if (failed || signal.aborted) {
      controller.dispose()
      return
    }
    scene = controller
    scene.setCleaner(cleaner)
    lidButton.disabled = false
    boostButton.disabled = false
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
    cancelAnimationFrame(frame)
    listeners.abort()
    soundDialog.close()
    audio.dispose()
    scene?.dispose()
  })
}
