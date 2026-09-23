export type FlushPhase = 'ready' | 'flushing' | 'draining' | 'refilling' | 'settling'
export type FlushStrength = 'gentle' | 'standard' | 'strong'
export type CleanerColor = 'clear' | 'blue' | 'mint' | 'lavender'

export interface FlushState {
  phase: FlushPhase
  strength: FlushStrength
  elapsed: number
  progress: number
  tankLevel: number
  bowlHeight: number
  inflow: number
  swirl: number
  turbulence: number
  suction: number
  buttonPress: number
}

export interface BowlSection {
  height: number
  radiusX: number
  radiusZ: number
  centerZ: number
}

export interface SceneController {
  update: (state: FlushState, delta: number) => void
  setCleaner: (color: CleanerColor) => void
  setLidClosed: (closed: boolean) => void
  resize: () => void
  hitsFlushButton: (clientX: number, clientY: number) => boolean
  dispose: () => void
}

export interface FlushAudio {
  unlock: () => Promise<void>
  update: (state: FlushState) => void
  setEnabled: (enabled: boolean) => void
  setPaused: (paused: boolean) => void
  dispose: () => void
}
