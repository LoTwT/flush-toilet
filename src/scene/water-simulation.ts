import * as THREE from 'three'
import type { BowlSection, FlushState } from '../types'
import waterNoise from './shaders/water-noise.glsl?raw'
import rimFlow from './shaders/rim-flow.glsl?raw'
import fluidFragment from './shaders/fluid-step.frag.glsl?raw'

// 网格间距传给计算和材质着色器；固定步长保持波动方程稳定。
const RESOLUTION = 192
const STEP = 1 / 90
// 同一帧最多同时激起的落水波纹数；更多的落点合并到下一帧。
const MAX_SPLASHES = 4

export function createWaterSimulation(renderer: THREE.WebGLRenderer): {
  texelSize: number
  flowTime: () => number
  texture: () => THREE.Texture
  update: (state: FlushState, section: BowlSection, delta: number) => void
  splash: (x: number, z: number, strength: number, section: BowlSection) => void
  dispose: () => void
} {
  const targets = [0, 1].map(
    () =>
      new THREE.WebGLRenderTarget(RESOLUTION, RESOLUTION, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      }),
  )
  const previousTarget = renderer.getRenderTarget()
  const clearColor = renderer.getClearColor(new THREE.Color())
  const clearAlpha = renderer.getClearAlpha()
  renderer.setClearColor(0, 0)
  for (const target of targets) {
    renderer.setRenderTarget(target)
    renderer.clear()
  }
  renderer.setRenderTarget(previousTarget)
  renderer.setClearColor(clearColor, clearAlpha)
  const uniforms = {
    uPrevious: { value: targets[0].texture },
    uTexel: { value: 1 / RESOLUTION },
    uStep: { value: STEP },
    uTime: { value: 0 },
    uInflow: { value: 0 },
    uSwirl: { value: 0 },
    uSuction: { value: 0 },
    uHeight: { value: 0.32 },
    uDrain: { value: new THREE.Vector2() },
    uSplashes: { value: Array.from({ length: MAX_SPLASHES }, () => new THREE.Vector3()) },
  }
  const pendingSplashes: THREE.Vector3[] = []
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader:
      'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `#define MAX_SPLASHES ${MAX_SPLASHES}\n` + waterNoise + rimFlow + fluidFragment,
    depthTest: false,
    depthWrite: false,
  })
  const geometry = new THREE.PlaneGeometry(2, 2)
  const scene = new THREE.Scene()
  scene.add(new THREE.Mesh(geometry, material))
  const camera = new THREE.Camera()
  let current = 0
  let accumulator = 0

  function update(state: FlushState, section: BowlSection, delta: number): void {
    uniforms.uInflow.value = state.inflow
    uniforms.uSwirl.value = state.swirl
    uniforms.uSuction.value = state.suction
    uniforms.uHeight.value = state.bowlHeight
    uniforms.uDrain.value.set(0, (-0.19 - section.centerZ) / section.radiusZ)
    accumulator = Math.min(accumulator + delta, STEP * 6)
    const targetBeforeStep = renderer.getRenderTarget()
    while (accumulator >= STEP) {
      const next = 1 - current
      // 落水冲量只作用一个固定步，之后由波动方程自行传播和衰减。
      const splashes = pendingSplashes.splice(0, MAX_SPLASHES)
      for (const [index, slot] of uniforms.uSplashes.value.entries()) {
        if (splashes[index]) slot.copy(splashes[index])
        else slot.set(0, 0, 0)
      }
      uniforms.uTime.value += STEP * (0.35 + state.inflow * 1.4)
      uniforms.uPrevious.value = targets[current].texture
      renderer.setRenderTarget(targets[next])
      renderer.render(scene, camera)
      current = next
      accumulator -= STEP
    }
    renderer.setRenderTarget(targetBeforeStep)
  }

  function splash(x: number, z: number, strength: number, section: BowlSection): void {
    // 转成与模拟纹理一致的归一化便池坐标。
    pendingSplashes.push(
      new THREE.Vector3(x / section.radiusX, (z - section.centerZ) / section.radiusZ, strength),
    )
  }

  function dispose(): void {
    for (const target of targets) target.dispose()
    geometry.dispose()
    material.dispose()
  }

  return {
    texelSize: 1 / RESOLUTION,
    flowTime: () => uniforms.uTime.value,
    texture: () => targets[current].texture,
    update,
    splash,
    dispose,
  }
}
