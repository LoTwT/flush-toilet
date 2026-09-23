import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { CLEANER_COLORS } from '../constants'
import type { CleanerColor, FlushState, SceneController } from '../types'
import { bowlAtHeight } from './bowl-profile'
import { createWaterGeometry } from './geometry'
import { createToilet, OPEN_LID_ANGLE } from './toilet-model'
import { createWaterSimulation } from './water-simulation'
import waterNoise from './shaders/water-noise.glsl?raw'
import rimFlow from './shaders/rim-flow.glsl?raw'
import waterOptics from './shaders/water-optics.glsl?raw'
import waterVertex from './shaders/water.vert.glsl?raw'
import waterFragment from './shaders/water.frag.glsl?raw'
import flowVertex from './shaders/flow.vert.glsl?raw'
import flowFragment from './shaders/flow.frag.glsl?raw'

function createFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')!
  const image = context.createImageData(512, 512)
  let seed = 821
  for (let index = 0; index < image.data.length; index += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const noise = (seed / 4294967296 - 0.5) * 5
    image.data[index] = 203 + noise
    image.data[index + 1] = 199 + noise
    image.data[index + 2] = 188 + noise
    image.data[index + 3] = 255
  }
  context.putImageData(image, 0, 0)
  context.fillStyle = 'rgba(101, 99, 88, 0.13)'
  context.fillRect(0, 0, 1.2, 512)
  context.fillRect(0, 0, 512, 1.2)
  context.fillStyle = 'rgba(255, 255, 248, 0.22)'
  context.fillRect(1.2, 1.2, 1, 510)
  context.fillRect(1.2, 1.2, 510, 1)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(18, 18)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

export async function createScene(canvas: HTMLCanvasElement): Promise<SceneController> {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  })
  // 环境贴图、折射背景和水面模拟都依赖半浮点颜色附件。
  if (
    !renderer.extensions.has('EXT_color_buffer_float') &&
    !renderer.extensions.has('EXT_color_buffer_half_float')
  ) {
    renderer.dispose()
    throw new Error('Floating-point render targets are not supported')
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.94
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.setClearColor('#e8e5dc')
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 30)
  camera.position.set(0, 12, 0)
  camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)

  const room = new RoomEnvironment()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const environment = pmrem.fromScene(room, 0.05)
  scene.environment = environment.texture
  scene.environmentIntensity = 0.4
  room.dispose()
  pmrem.dispose()

  scene.add(new THREE.HemisphereLight('#fffaf0', '#a3afa0', 0.95))
  const sunlight = new THREE.DirectionalLight('#fff6e5', 1.6)
  // 接近顶部的柔光将投影收在底座附近，避免掀起的盖子留下大块长影。
  sunlight.position.set(-1.4, 12, 1.3)
  sunlight.castShadow = true
  sunlight.shadow.intensity = 0.38
  sunlight.shadow.mapSize.set(2048, 2048)
  sunlight.shadow.camera.left = -3
  sunlight.shadow.camera.right = 3
  sunlight.shadow.camera.top = 3
  sunlight.shadow.camera.bottom = -3
  sunlight.shadow.camera.near = 0.1
  sunlight.shadow.camera.far = 20
  sunlight.shadow.normalBias = 0.018
  sunlight.shadow.bias = -0.0001
  sunlight.shadow.radius = 5
  scene.add(sunlight)

  const floorTexture = createFloorTexture()
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.91, metalness: 0 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.23
  floor.receiveShadow = true
  scene.add(floor)

  const toilet = createToilet()
  scene.add(toilet.group)
  const background = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: 4,
  })
  background.depthTexture = new THREE.DepthTexture(1, 1)
  const fluid = createWaterSimulation(renderer)
  const waterMaterial = new THREE.ShaderMaterial({
    vertexShader: waterVertex,
    fragmentShader: waterNoise + rimFlow + waterOptics + waterFragment,
    side: THREE.DoubleSide,
    uniforms: {
      uBackground: { value: background.texture },
      uBackgroundDepth: { value: background.depthTexture },
      uWaterState: { value: fluid.texture() },
      uWaterTexel: { value: fluid.texelSize },
      uClip: { value: new THREE.Vector2(camera.near, camera.far) },
      uResolution: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uFlowTime: { value: 0 },
      uInflow: { value: 0 },
      uHeight: { value: 0.32 },
      uRadii: { value: new THREE.Vector2(0.4, 0.56) },
      uCenterZ: { value: 0.05 },
      uTurbulence: { value: 0 },
      uSuction: { value: 0 },
      uDyeColor: { value: new THREE.Color(CLEANER_COLORS.blue.color) },
      uConcentration: { value: CLEANER_COLORS.blue.concentration },
    },
  })
  const water = new THREE.Mesh(createWaterGeometry(), waterMaterial)
  water.frustumCulled = false
  water.renderOrder = 1
  scene.add(water)

  const wallMaterial = new THREE.ShaderMaterial({
    vertexShader: flowVertex,
    fragmentShader: waterNoise + rimFlow + waterOptics + flowFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uBackground: { value: background.texture },
      uResolution: { value: waterMaterial.uniforms.uResolution.value },
      uTime: { value: 0 },
      uInflow: { value: 0 },
      uHeight: { value: 0.32 },
      uDyeColor: { value: new THREE.Color(CLEANER_COLORS.blue.color) },
      uConcentration: { value: CLEANER_COLORS.blue.concentration },
    },
  })
  const wallFlow = new THREE.Mesh(toilet.innerGeometry, wallMaterial)
  wallFlow.renderOrder = 2
  scene.add(wallFlow)

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const drawingSize = new THREE.Vector2()
  let time = 0
  let lidTarget = OPEN_LID_ANGLE
  const dyeColor = new THREE.Color(CLEANER_COLORS.blue.color)
  let concentration = CLEANER_COLORS.blue.concentration
  let disposed = false

  function captureBackground(): void {
    water.visible = false
    wallFlow.visible = false
    renderer.setRenderTarget(background)
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)
    water.visible = true
    wallFlow.visible = true
  }

  function resize(): void {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    // 普通屏也进行适度超采样；像素上限避免大窗口占用过多显存。
    const pixelRatio = Math.min(
      Math.max(window.devicePixelRatio, 1.5),
      2,
      Math.sqrt(6_000_000 / (width * height)),
    )
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
    const aspect = width / height
    const narrow = width <= 800
    // 窄屏给底部设置留出空间，模型始终落在标题与控件之间。
    const sceneTop = 128
    const sceneBottom = height - 334
    const viewHeight = Math.max(
      5.6,
      2.7 / aspect,
      narrow ? (height * 3.65) / (sceneBottom - sceneTop) : 0,
    )
    const shiftX = width > 1000 ? -0.37 : 0
    const centerZ = narrow
      ? -0.35 - ((sceneTop + sceneBottom) / (2 * height) - 0.5) * viewHeight
      : -0.23
    camera.left = (-viewHeight * aspect) / 2 + shiftX
    camera.right = (viewHeight * aspect) / 2 + shiftX
    camera.top = viewHeight / 2 - centerZ
    camera.bottom = -viewHeight / 2 - centerZ
    camera.updateProjectionMatrix()
    renderer.getDrawingBufferSize(drawingSize)
    // 折射背景与最终画布逐像素对应，避免把低分辨率池底重新放大。
    background.setSize(drawingSize.x, drawingSize.y)
    waterMaterial.uniforms.uResolution.value.copy(drawingSize)
    captureBackground()
  }

  function update(state: FlushState, delta: number): void {
    if (disposed) return
    time += delta * (state.phase === 'ready' ? 0.09 : 1)
    const section = bowlAtHeight(state.bowlHeight)
    fluid.update(state, section, delta)
    const oldLidAngle = toilet.lid.rotation.x
    toilet.lid.rotation.x =
      Math.abs(oldLidAngle - lidTarget) < 0.001
        ? lidTarget
        : THREE.MathUtils.damp(oldLidAngle, lidTarget, 7, delta)
    if (oldLidAngle !== toilet.lid.rotation.x) captureBackground()
    const uniforms = waterMaterial.uniforms
    uniforms.uWaterState.value = fluid.texture()
    uniforms.uTime.value = time
    uniforms.uFlowTime.value = fluid.flowTime()
    uniforms.uInflow.value = state.inflow
    uniforms.uHeight.value = state.bowlHeight
    uniforms.uRadii.value.set(section.radiusX, section.radiusZ)
    uniforms.uCenterZ.value = section.centerZ
    uniforms.uTurbulence.value = state.turbulence
    uniforms.uSuction.value = state.suction
    const blend = 1 - Math.exp(-delta * 4)
    uniforms.uDyeColor.value.lerp(dyeColor, blend)
    uniforms.uConcentration.value += (concentration - uniforms.uConcentration.value) * blend
    wallMaterial.uniforms.uDyeColor.value.copy(uniforms.uDyeColor.value)
    wallMaterial.uniforms.uConcentration.value = uniforms.uConcentration.value
    wallMaterial.uniforms.uTime.value = fluid.flowTime()
    wallMaterial.uniforms.uInflow.value = state.inflow
    wallMaterial.uniforms.uHeight.value = state.bowlHeight
    toilet.button.position.y = toilet.buttonRestHeight - state.buttonPress * 0.025
    renderer.render(scene, camera)
  }

  function setCleaner(color: CleanerColor): void {
    dyeColor.set(CLEANER_COLORS[color].color)
    concentration = CLEANER_COLORS[color].concentration
  }

  function setLidClosed(closed: boolean): void {
    lidTarget = closed ? 0 : OPEN_LID_ANGLE
  }

  function hitsFlushButton(clientX: number, clientY: number): boolean {
    const bounds = canvas.getBoundingClientRect()
    pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    )
    raycaster.setFromCamera(pointer, camera)
    return raycaster.intersectObject(toilet.button, true).length > 0
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry)
        const list = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of list) materials.add(material)
      }
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
    floorTexture.dispose()
    background.dispose()
    fluid.dispose()
    environment.dispose()
    sunlight.shadow.map?.dispose()
    renderer.dispose()
  }

  try {
    await renderer.compileAsync(scene, camera)
    resize()
  } catch (error) {
    dispose()
    throw error
  }

  return { update, setCleaner, setLidClosed, resize, hitsFlushButton, dispose }
}
