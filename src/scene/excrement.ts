import * as THREE from 'three'
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js'
import { FLUSH_END_TIME, FLUSH_STRENGTHS, MAX_EXCREMENT_PIECES } from '../constants'
import { smoothRange } from '../simulation/flush-cycle'
import type { ExcrementSelection, ExcrementShapeSettings, FlushState } from '../types'
import { bowlAtHeight } from './bowl-profile'
import {
  createExcrementGeometry,
  createExcrementMaterial,
  defaultExcrementShape,
  EXCREMENT_SHAPE_PRESETS,
} from './excrement-model'
import { createExcrementMosaicBaker } from './excrement-mosaic'

export function createExcrement() {
  const group = new THREE.Group()
  group.visible = false
  const material = createExcrementMaterial()
  const mosaicGeometry = new THREE.PlaneGeometry(1, 1)
  mosaicGeometry.rotateX(-Math.PI / 2)
  const mosaicTemplate = {
    vertexShader: HorizontalBlurShader.vertexShader,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        vec4 blurred = texture2D(tDiffuse, vUv);
        if (blurred.a < 0.005) discard;
        // 卷积后的颜色带有覆盖率，恢复直通颜色再透明混合，避免模糊边缘发黑。
        gl_FragColor = vec4(blurred.rgb / blurred.a, blurred.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  }
  let age = 0
  let nextVariant = 0
  let mosaicEnabled = true
  function createPiece(layout: { x: number; z: number; rotation: number }) {
    // 形态和浮动相位使用稳定编号，删除别的段落不会改变当前段。
    const variant = nextVariant++
    const shapeSettings = defaultExcrementShape(variant)
    const geometry = createExcrementGeometry(variant, shapeSettings)
    const mosaicTarget = new THREE.WebGLRenderTarget(32, 48, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
    })
    const mosaicMaterial = new THREE.ShaderMaterial({
      ...mosaicTemplate,
      uniforms: { tDiffuse: { value: mosaicTarget.texture } },
    })
    const object = new THREE.Group()
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.visible = !mosaicEnabled
    const mosaic = new THREE.Mesh(mosaicGeometry, mosaicMaterial)
    mosaic.visible = mosaicEnabled
    object.add(mesh, mosaic)
    group.add(object)
    const bounds = geometry.boundingBox!
    return {
      ...layout,
      variant,
      addedAt: age,
      shapeSettings,
      size: 1,
      object,
      mesh,
      mosaic,
      mosaicTarget,
      mosaicDirty: true,
      footprint: geometry.boundingSphere!.radius + geometry.boundingSphere!.center.length() + 0.012,
      halfWidth: Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)),
      halfLength: Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)),
    }
  }
  const pieces = [
    { x: 0.45, z: 0.37, rotation: -0.45 },
    { x: -0.45, z: -0.46, rotation: 0.65 },
    { x: -0.49, z: 0.47, rotation: 1.1 },
  ].map(createPiece)
  const marker = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: {
        uAccent: { value: new THREE.Color('#285b52') },
        uPixelRatio: { value: 1 },
      },
      vertexShader: HorizontalBlurShader.vertexShader,
      fragmentShader: `
        uniform vec3 uAccent;
        uniform float uPixelRatio;
        varying vec2 vUv;
        void main() {
          float radius = length((vUv - 0.5) * 4.0);
          // 按屏幕像素计算线宽，避免椭圆短轴和小屏上的轮廓变细。
          float pixelStep = max(length(vec2(dFdx(radius), dFdy(radius))), 0.0001);
          float distancePx = abs(radius - 1.0) / (pixelStep * uPixelRatio);
          float stroke = 1.0 - smoothstep(0.35, 1.05, distancePx);
          gl_FragColor = vec4(uAccent, stroke * 0.82);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
    }),
  )
  marker.onBeforeRender = (renderer) => {
    marker.material.uniforms.uPixelRatio.value = renderer.getPixelRatio()
  }
  marker.renderOrder = 4
  marker.visible = false
  let flushing = false
  let editing = false
  let selected = 0
  let currentState: FlushState | undefined
  let mosaicBaker: ReturnType<typeof createExcrementMosaicBaker> | undefined
  let backgroundDirty = false
  const pickRaycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0))

  function availableSpace(piece: (typeof pieces)[number], state: FlushState) {
    const section = bowlAtHeight(state.bowlHeight)
    const footprint = piece.footprint * piece.size
    // 在归一化椭圆里为整个物件留出空间，旋转与缩放后也不会越过陶瓷内壁。
    const inset = Math.max(0.01, 1 - footprint / Math.min(section.radiusX, section.radiusZ))
    return {
      x: section.radiusX * inset,
      z: section.radiusZ * inset,
      centerZ: section.centerZ,
    }
  }

  function update(state: FlushState, delta: number): boolean {
    currentState = state
    if (!group.visible) {
      const dirty = backgroundDirty
      backgroundDirty = false
      return dirty
    }
    backgroundDirty = false
    age += delta
    if (flushing && state.elapsed >= FLUSH_END_TIME) {
      group.visible = false
      flushing = false
      marker.visible = false
      // 消失的这一帧仍需刷新折射背景，清除水下残影。
      return true
    }
    const elapsed = flushing ? state.elapsed : 0
    const pressure = FLUSH_STRENGTHS[state.strength].pressure
    const orbit = -elapsed * (0.6 + pressure * 0.65) * smoothRange(0, 1.1, elapsed)
    const pull = smoothRange(1.7, 4.5, elapsed)
    const sink = smoothRange(3.2, 4.9, elapsed)
    const shrink = 1 - 0.82 * smoothRange(3.4, 4.8, elapsed)
    for (const piece of pieces) {
      const drop = 0.28 * (1 - smoothRange(0, 0.45, age - piece.addedAt)) * (1 - sink)
      const space = availableSpace(piece, state)
      const x = piece.x * Math.cos(orbit) + piece.z * Math.sin(orbit)
      const z = piece.z * Math.cos(orbit) - piece.x * Math.sin(orbit)
      const bob = Math.sin(age * 2.3 + piece.variant * 1.8) * 0.006 * (1 - sink)
      piece.object.position.set(
        x * space.x * (1 - pull),
        state.bowlHeight + 0.012 + bob + drop - sink * (state.bowlHeight + 0.25),
        space.centerZ * (1 - pull) - 0.19 * pull + z * space.z * (1 - pull),
      )
      piece.object.rotation.set(
        Math.sin(age * 1.7 + piece.variant) * 0.07,
        piece.rotation + orbit,
        0,
      )
      piece.object.scale.setScalar(piece.size * shrink)
    }
    marker.visible = editing && !flushing
    const piece = pieces[selected]
    marker.position.copy(piece.object.position)
    marker.position.y += 0.13 * piece.size
    marker.rotation.y = piece.rotation
    marker.scale.set(
      (piece.halfWidth + 0.04) * piece.size,
      1,
      (piece.halfLength + 0.04) * piece.size,
    )
    return true
  }

  function nextLayout(): { x: number; z: number; rotation: number } {
    let best = { x: 0, z: 0, rotation: ((nextVariant * 0.7) % (Math.PI * 2)) - Math.PI }
    let bestDistance = -1
    for (let index = 0; index < 16; index++) {
      const angle = (index * Math.PI * 2) / 16
      const candidate = {
        x: Math.sin(angle) * 0.72,
        z: Math.cos(angle) * 0.72,
        rotation: best.rotation,
      }
      const distance = Math.min(
        ...pieces.map((piece) => Math.hypot(candidate.x - piece.x, candidate.z - piece.z)),
      )
      if (distance > bestDistance) {
        best = candidate
        bestDistance = distance
      }
    }
    return pieces.length ? best : { ...best, x: 0, z: 0 }
  }

  function addPiece(): void {
    if (!editing || !currentState || flushing || pieces.length >= MAX_EXCREMENT_PIECES) return
    pieces.push(createPiece(nextLayout()))
    selected = pieces.length - 1
    group.visible = true
    update(currentState, 0)
  }

  function disposePiece(piece: (typeof pieces)[number]): void {
    piece.object.removeFromParent()
    piece.mesh.geometry.dispose()
    piece.mosaic.material.dispose()
    piece.mosaicTarget.dispose()
  }

  function setCount(count: number): void {
    if (
      !editing ||
      !currentState ||
      flushing ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > MAX_EXCREMENT_PIECES ||
      count === pieces.length
    )
      return
    // 从末尾减少，保留其余段的形状、位置和浮动进度；新增段沿用当前遮挡设置。
    for (const piece of pieces.splice(count)) disposePiece(piece)
    while (pieces.length < count) pieces.push(createPiece(nextLayout()))
    selected = Math.max(0, Math.min(selected, pieces.length - 1))
    group.visible = pieces.length > 0
    if (pieces.length) update(currentState, 0)
    else {
      marker.visible = false
      backgroundDirty = true
    }
  }

  function removeSelected(): void {
    if (!editing || !currentState || flushing || !pieces[selected]) return
    const [piece] = pieces.splice(selected, 1)
    disposePiece(piece)
    selected = Math.max(0, Math.min(selected, pieces.length - 1))
    if (pieces.length) update(currentState, 0)
    else {
      group.visible = false
      marker.visible = false
      // 最后一段删除后仍需让下一帧重绘水下背景。
      backgroundDirty = true
    }
  }

  function add(state: FlushState): void {
    if (group.visible) return
    age = 0
    if (!pieces.length) pieces.push(createPiece(nextLayout()))
    for (const piece of pieces) piece.addedAt = 0
    flushing = false
    group.visible = true
    update(state, 0)
  }

  function flush(): void {
    setEditing(false)
    if (group.visible) {
      flushing = true
    }
  }

  function setEditing(enabled: boolean): void {
    editing = enabled && (group.visible || pieces.length === 0) && !flushing
    marker.visible = editing && pieces.length > 0
    if (currentState && group.visible) update(currentState, 0)
  }

  function selection(): ExcrementSelection | null {
    if (!editing || !pieces[selected]) return null
    const piece = pieces[selected]
    return {
      index: selected,
      rotation: THREE.MathUtils.radToDeg(piece.rotation),
      size: piece.size,
      shape: { ...piece.shapeSettings },
    }
  }

  function select(index: number): void {
    if (!editing || !Number.isInteger(index) || !pieces[index]) return
    selected = index
    if (currentState) update(currentState, 0)
  }

  function transform(values: Partial<Pick<ExcrementSelection, 'rotation' | 'size'>>): void {
    if (!editing || !currentState || !pieces[selected]) return
    const piece = pieces[selected]
    const { x, z } = piece.object.position
    if (values.rotation !== undefined && Number.isFinite(values.rotation))
      piece.rotation = THREE.MathUtils.degToRad(values.rotation)
    if (values.size !== undefined && Number.isFinite(values.size))
      piece.size = THREE.MathUtils.clamp(values.size, 0.65, 1.3)
    move(x, z)
  }

  function reshape(values: Partial<ExcrementShapeSettings>): void {
    if (!editing || !currentState || !pieces[selected]) return
    const piece = pieces[selected]
    const next =
      values.kind && Object.hasOwn(EXCREMENT_SHAPE_PRESETS, values.kind)
        ? { ...EXCREMENT_SHAPE_PRESETS[values.kind] }
        : { ...piece.shapeSettings }
    if (values.curvature !== undefined && Number.isFinite(values.curvature))
      next.curvature = THREE.MathUtils.clamp(values.curvature, -1, 1)
    if (values.thickness !== undefined && Number.isFinite(values.thickness))
      next.thickness = THREE.MathUtils.clamp(values.thickness, 0.65, 1.45)
    if (
      next.kind === piece.shapeSettings.kind &&
      next.curvature === piece.shapeSettings.curvature &&
      next.thickness === piece.shapeSettings.thickness
    )
      return
    const { x, z } = piece.object.position
    const geometry = createExcrementGeometry(piece.variant, next)
    const previousGeometry = piece.mesh.geometry
    piece.mesh.geometry = geometry
    previousGeometry.dispose()
    piece.shapeSettings = next
    const bounds = geometry.boundingBox!
    piece.footprint =
      geometry.boundingSphere!.radius + geometry.boundingSphere!.center.length() + 0.012
    piece.halfWidth = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x))
    piece.halfLength = Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z))
    piece.mosaicDirty = true
    move(x, z)
  }

  function move(x: number, z: number): void {
    if (
      !editing ||
      !currentState ||
      !pieces[selected] ||
      !Number.isFinite(x) ||
      !Number.isFinite(z)
    )
      return
    const piece = pieces[selected]
    const space = availableSpace(piece, currentState)
    const position = new THREE.Vector2(x / space.x, (z - space.centerZ) / space.z)
    if (position.length() > 1) position.normalize()
    piece.x = position.x
    piece.z = position.y
    update(currentState, 0)
  }

  function nudge(x: number, z: number): void {
    if (!pieces[selected]) return
    const position = pieces[selected].object.position
    move(position.x + x, position.z + z)
  }

  function pick(x: number, z: number, padding: number): number | null {
    if (!editing || !pieces.length) return null
    // 先命中实际轮廓；包围盒内接椭圆不能覆盖弯曲模型的外沿。
    // 即使开启模糊遮挡，也使用原网格判断，避免把透明平面的空白区域算进去。
    group.updateWorldMatrix(true, true)
    const top = Math.max(
      ...pieces.map((piece) => piece.object.position.y + piece.footprint * piece.size),
    )
    pickRaycaster.ray.origin.set(x, top, z)
    const [intersection] = pickRaycaster.intersectObjects(
      pieces.map((piece) => piece.mesh),
      false,
    )
    if (intersection) return pieces.findIndex((piece) => piece.mesh === intersection.object)
    // 轮廓附近仍保留屏幕像素余量，便于抓取较小物件。
    let nearest: number | null = null
    let distance = 1
    for (const [index, piece] of pieces.entries()) {
      const dx = x - piece.object.position.x
      const dz = z - piece.object.position.z
      const cos = Math.cos(piece.rotation)
      const sin = Math.sin(piece.rotation)
      const hit =
        ((dx * cos - dz * sin) / (piece.halfWidth * piece.size + padding)) ** 2 +
        ((dx * sin + dz * cos) / (piece.halfLength * piece.size + padding)) ** 2
      if (hit < distance) {
        nearest = index
        distance = hit
      }
    }
    return nearest
  }

  function setMosaic(enabled: boolean): void {
    mosaicEnabled = enabled
    for (const piece of pieces) {
      piece.mesh.visible = !enabled
      piece.mosaic.visible = enabled
    }
  }

  function prepareMosaic(renderer: THREE.WebGLRenderer): void {
    if (!pieces.some((piece) => piece.mosaicDirty)) return
    mosaicBaker ??= createExcrementMosaicBaker(renderer, material)
    // 将同一帧的修改合并，每段仅重烘焙一次；普通动画帧复用纹理。
    for (const piece of pieces) {
      if (!piece.mosaicDirty) continue
      const width = Math.max(0.24, piece.halfWidth * 2 + 0.15)
      const height = Math.max(0.26, piece.halfLength * 2 + 0.17)
      mosaicBaker.bake(piece.mesh.geometry, piece.mosaicTarget, width, height)
      piece.mosaic.scale.set(width, 1, height)
      piece.mosaic.position.y = piece.mesh.geometry.boundingBox!.max.y + 0.025
      piece.mosaicDirty = false
    }
  }

  return {
    group,
    marker,
    add,
    flush,
    setMosaic,
    prepareMosaic,
    update,
    placement: {
      count: () => pieces.length,
      setCount,
      addPiece,
      removeSelected,
      setEnabled: setEditing,
      select,
      selection,
      transform,
      reshape,
      move,
      nudge,
      pick,
      position: () => pieces[selected]?.object.position,
    },
    dispose: () => {
      for (const piece of pieces) disposePiece(piece)
      mosaicGeometry.dispose()
      marker.geometry.dispose()
      marker.material.dispose()
      material.bumpMap?.dispose()
      material.dispose()
      mosaicBaker?.dispose()
    },
  }
}
