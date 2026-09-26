export type FlushPhase = 'ready' | 'flushing' | 'draining' | 'refilling' | 'settling'
export type FlushStrength = 'gentle' | 'standard' | 'strong'
export type CleanerColor = 'clear' | 'blue' | 'mint' | 'lavender'
export type ExcrementShape = 'log' | 'curved' | 'clump'

export interface ExcrementShapeSettings {
  kind: ExcrementShape
  curvature: number
  thickness: number
}

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

export interface ExcrementSelection {
  index: number
  rotation: number
  size: number
  shape: ExcrementShapeSettings
}

export interface ExcrementPlacementController {
  count: () => number
  setCount: (count: number) => void
  addPiece: () => void
  removeSelected: () => void
  setEnabled: (enabled: boolean) => void
  select: (index: number) => void
  selection: () => ExcrementSelection | null
  transform: (values: Partial<Pick<ExcrementSelection, 'rotation' | 'size'>>) => void
  reshape: (values: Partial<ExcrementShapeSettings>) => void
  beginDrag: (clientX: number, clientY: number) => boolean
  drag: (clientX: number, clientY: number) => void
  endDrag: () => void
  hits: (clientX: number, clientY: number) => boolean
  nudge: (x: number, z: number) => void
}

export interface SceneController {
  update: (state: FlushState, delta: number) => void
  setCleaner: (color: CleanerColor) => void
  setLidClosed: (closed: boolean) => void
  addExcrement: (state: FlushState) => void
  flushExcrement: () => void
  hasExcrement: () => boolean
  setExcrementMosaic: (enabled: boolean) => void
  excrementPlacement: ExcrementPlacementController
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
