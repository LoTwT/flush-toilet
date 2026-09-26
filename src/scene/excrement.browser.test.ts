import { expect, it } from 'vitest'
import * as THREE from 'three'
import { CYCLE_DURATION } from '../constants'
import { sampleFlush } from '../simulation/flush-cycle'
import { createScene } from './create-scene'
import { createExcrement } from './excrement'

function pixels(canvas: HTMLCanvasElement): Uint8Array {
  const gl = canvas.getContext('webgl2')!
  const result = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
  gl.readPixels(
    0,
    0,
    gl.drawingBufferWidth,
    gl.drawingBufferHeight,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    result,
  )
  return result
}

it('清空后实际水面恢复为空便池，没有沿用折射背景中的旧影', async () => {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'width: 256px; height: 320px;'
  document.body.append(canvas)
  const controller = await createScene(canvas, canvas)
  try {
    const state = sampleFlush(CYCLE_DURATION)
    controller.update(state, 0)
    const empty = pixels(canvas)
    controller.addExcrement(state)
    controller.excrementPlacement.setEnabled(true)
    controller.update(state, 0)
    // 尺寸刷新也会捕获背景，确保清空前背景中确实存在物件。
    controller.resize()
    controller.update(state, 0)
    const occupied = pixels(canvas)
    expect(occupied.some((value, index) => Math.abs(value - empty[index]) > 5)).toBe(true)
    controller.excrementPlacement.setCount(0)
    controller.update(state, 0)
    const cleared = pixels(canvas)
    let maxDifference = 0
    for (const [index, value] of cleared.entries())
      maxDifference = Math.max(maxDifference, Math.abs(value - empty[index]))
    expect(maxDifference).toBeLessThanOrEqual(1)
  } finally {
    controller.dispose()
    canvas.remove()
  }
}, 15_000)

it('模糊颜色按覆盖率混合，半透明边缘不会变黑且透明区域保持背景色', () => {
  const renderer = new THREE.WebGLRenderer()
  renderer.setSize(4, 4)
  renderer.setClearColor(0xffffff, 1)
  // 直接比较线性颜色，排除显示器色域和色调映射差异。
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  const excrement = createExcrement()
  const mosaic = excrement.group.children[0].children[1] as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >
  const geometry = new THREE.PlaneGeometry(2, 2)
  const plane = new THREE.Mesh(geometry, mosaic.material)
  const scene = new THREE.Scene()
  scene.add(plane)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2)
  camera.position.z = 1
  const data = new Uint8Array(4)
  const texture = new THREE.DataTexture(data, 1, 1)
  mosaic.material.uniforms.tDiffuse.value = texture
  try {
    for (const rgba of [
      [0, 0, 0, 0],
      [32, 16, 8, 64],
      [128, 64, 32, 255],
    ]) {
      data.set(rgba)
      texture.needsUpdate = true
      renderer.render(scene, camera)
      const actual = pixels(renderer.domElement)
      // 输入已经含覆盖率，在白底上的结果是输入颜色加未覆盖的背景。
      for (let channel = 0; channel < 3; channel++)
        expect(Math.abs(actual[channel] - (rgba[channel] + 255 - rgba[3]))).toBeLessThanOrEqual(1)
      expect(actual[3]).toBe(255)
    }
  } finally {
    texture.dispose()
    geometry.dispose()
    excrement.dispose()
    renderer.dispose()
  }
})
