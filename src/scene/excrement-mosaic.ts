import * as THREE from 'three'
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js'
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js'

export function createExcrementMosaicBaker(
  renderer: THREE.WebGLRenderer,
  material: THREE.Material,
) {
  const preview = new THREE.Scene()
  const emptyGeometry = new THREE.BufferGeometry()
  const model = new THREE.Mesh(emptyGeometry, material)
  preview.add(model, new THREE.HemisphereLight('#fffaf0', '#a3afa0', 0.95))
  const light = new THREE.DirectionalLight('#fff6e5', 1.6)
  light.position.set(-0.5, 1, 0.3)
  preview.add(light)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2)
  camera.position.set(0, 1, 0)
  camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)
  const source = new THREE.WebGLRenderTarget(32, 48, { type: THREE.HalfFloatType })
  const intermediate = new THREE.WebGLRenderTarget(32, 48, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  })
  const horizontal = new THREE.ShaderMaterial({
    ...HorizontalBlurShader,
    uniforms: { tDiffuse: { value: source.texture }, h: { value: 2 / source.width } },
    depthTest: false,
    depthWrite: false,
  })
  const vertical = new THREE.ShaderMaterial({
    ...VerticalBlurShader,
    uniforms: { tDiffuse: { value: intermediate.texture }, v: { value: 2 / source.height } },
    depthTest: false,
    depthWrite: false,
  })
  const quadGeometry = new THREE.PlaneGeometry(2, 2)
  const quad = new THREE.Mesh(quadGeometry, horizontal)
  const blurScene = new THREE.Scene()
  blurScene.add(quad)
  const blurCamera = new THREE.Camera()

  function bake(
    geometry: THREE.BufferGeometry,
    target: THREE.WebGLRenderTarget,
    width: number,
    height: number,
  ): void {
    const previousTarget = renderer.getRenderTarget()
    const previousColor = renderer.getClearColor(new THREE.Color())
    const previousAlpha = renderer.getClearAlpha()
    model.geometry = geometry
    camera.left = -width / 2
    camera.right = width / 2
    camera.top = height / 2
    camera.bottom = -height / 2
    camera.updateProjectionMatrix()
    // 颜色和覆盖率一起模糊，保持透明渐隐边缘。
    renderer.setClearColor(0, 0)
    try {
      renderer.setRenderTarget(source)
      renderer.render(preview, camera)
      quad.material = horizontal
      renderer.setRenderTarget(intermediate)
      renderer.render(blurScene, blurCamera)
      quad.material = vertical
      renderer.setRenderTarget(target)
      renderer.render(blurScene, blurCamera)
    } finally {
      renderer.setRenderTarget(previousTarget)
      renderer.setClearColor(previousColor, previousAlpha)
    }
  }

  return {
    bake,
    dispose: () => {
      emptyGeometry.dispose()
      source.dispose()
      intermediate.dispose()
      horizontal.dispose()
      vertical.dispose()
      quadGeometry.dispose()
    },
  }
}
