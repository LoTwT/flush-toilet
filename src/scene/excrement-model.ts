import * as THREE from 'three'
import type { ExcrementShape, ExcrementShapeSettings } from '../types'

export const EXCREMENT_SHAPE_PRESETS: Record<ExcrementShape, ExcrementShapeSettings> = {
  log: { kind: 'log', curvature: 0.05, thickness: 1 },
  curved: { kind: 'curved', curvature: 0.75, thickness: 1 },
  clump: { kind: 'clump', curvature: 0, thickness: 1 },
}

export function defaultExcrementShape(index: number): ExcrementShapeSettings {
  const kinds: ExcrementShape[] = ['curved', 'log', 'clump']
  return { ...EXCREMENT_SHAPE_PRESETS[kinds[index % kinds.length]] }
}

function noise(x: number, y: number, seed = 0): number {
  const hash = (a: number, b: number): number => {
    const value = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453
    return value - Math.floor(value)
  }
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = THREE.MathUtils.smoothstep(x - ix, 0, 1)
  const fy = THREE.MathUtils.smoothstep(y - iy, 0, 1)
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), fx),
    THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx),
    fy,
  )
}

export function createExcrementMaterial(): THREE.MeshPhysicalMaterial {
  const size = 128
  const data = new Uint8Array(size * size * 4)
  const roughnessData = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 多层颗粒加零散的小凹坑，让高光碎开，不像整块光滑的黏土。
      const grain =
        noise(x / 9, y / 9) * 0.45 +
        noise(x / 3.5, y / 3.5, 3) * 0.33 +
        noise(x / 1.3, y / 1.3, 5) * 0.22
      const pit = THREE.MathUtils.smoothstep(noise(x / 2.6, y / 2.6, 7), 0.74, 0.9)
      const value = Math.round(70 + grain * 165 - pit * 70)
      const offset = (y * size + x) * 4
      data.set([value, value, value, 255], offset)
      // 粗糙度不含凹坑，否则坑点会变成闪亮的糖粒；低频的湿润斑块稍光滑。
      const wet = noise(x / 14, y / 14, 9)
      const rough = Math.round(255 * (0.4 + wet * 0.3 + grain * 0.14))
      roughnessData.set([rough, rough, rough, 255], offset)
    }
  }
  const [texture, roughnessTexture] = [data, roughnessData].map((pixels) => {
    const map = new THREE.DataTexture(pixels, size, size)
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.magFilter = THREE.LinearFilter
    map.minFilter = THREE.LinearMipmapLinearFilter
    map.generateMipmaps = true
    map.needsUpdate = true
    return map
  })
  // 整体偏哑光，只有低频的湿润斑块保留柔和光泽。
  return new THREE.MeshPhysicalMaterial({
    color: '#4f3625',
    vertexColors: true,
    roughness: 1,
    roughnessMap: roughnessTexture,
    bumpMap: texture,
    // 当前 Three.js 的凹凸强度按屏幕空间导数计算，需取个位数才能看见颗粒与凹坑。
    bumpScale: 4.5,
    clearcoat: 0.12,
    clearcoatRoughness: 0.42,
  })
}

function saturate(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function createExcrementGeometry(
  variant: number,
  settings = defaultExcrementShape(variant),
): THREE.BufferGeometry {
  // 长条与弯曲是带节段收缩、两端圆钝的不规则柱体；团块是几颗融合在一起的硬块。
  const clump = settings.kind === 'clump'
  const thickness = THREE.MathUtils.clamp(settings.thickness, 0.65, 1.45)
  const bodyRadius = (clump ? 0.058 : 0.047) * thickness
  const variation = 1 - (variant % 3) * 0.06
  // 团块的长度随粗细同步变化，几颗硬块始终保持接近球形。
  const length = (clump ? bodyRadius * 3.7 : 0.34) * variation
  // 团块越粗，内侧弯曲半径越容易小于截面半径，需同步收小弯曲以免自交出折痕。
  const arc = THREE.MathUtils.clamp(settings.curvature, -1, 1) * (clump ? 0.8 / thickness : 3.4)
  const phase = variant * 1.7 + 0.4
  const curve = new THREE.CatmullRomCurve3(
    Array.from({ length: 17 }, (_, index) => {
      const t = index / 16
      const angle = (t - 0.5) * arc
      // 整体弧线上叠加不规则的侧向摆动与轻微起伏，避免完美的圆弧中轴。
      // 团块的各块彼此错开，不排成同轴的一串。
      const wobble = clump
        ? (noise(t * 2.4, 0.5, variant + 21) - 0.5) * bodyRadius * 0.7
        : (noise(t * 3.2, 0.5, variant + 21) - 0.5) * length * 0.14
      return new THREE.Vector3(
        (Math.abs(arc) < 0.001 ? 0 : ((Math.cos(angle) - Math.cos(arc / 2)) * length) / arc) +
          wobble,
        (noise(t * 2.5, 1.5, variant + 23) - 0.5) * bodyRadius * 0.5,
        Math.abs(arc) < 0.001 ? (t - 0.5) * length : (Math.sin(angle) * length) / arc,
      )
    }),
  )
  // 节段之间的收缩：团块是两道深缢痕分出的三块，长条有两三处深浅不一的浅缢痕。
  const neckCount = clump ? 2 : 2 + (variant % 2)
  const necks = Array.from({ length: neckCount }, (_, index) => ({
    at:
      (index + 1) / (neckCount + 1) +
      (noise(index * 2.1, variant, 35) - 0.5) * (clump ? 0.08 : 0.16),
    depth: clump
      ? 0.36 + noise(index * 1.7, variant, 37) * 0.14
      : 0.08 + noise(index * 1.7, variant, 37) * 0.16,
    width: clump ? 0.11 : 0.02 + noise(index * 3.1, variant, 39) * 0.02,
    side: noise(index * 4.3, variant, 41) * Math.PI * 2,
  }))
  const headCap = clump ? 0.3 : Math.min(0.22, (bodyRadius * 1.25) / length)
  const tailCap = clump ? 0.3 : headCap * 1.6
  const rings = 80
  const sides = 32
  const positions: number[] = []
  const colors: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const color = new THREE.Color()
  // 每段的整体色调略有深浅与偏黄差异，避免几段颜色完全一致。
  const tone = 0.84 + noise(variant * 3.1, 1.7, 11) * 0.28
  for (let ring = 0; ring <= rings; ring++) {
    // 两端加密，圆钝的端盖也有足够的环数。
    const t = 0.5 - 0.5 * Math.cos((ring / rings) * Math.PI)
    const along = t * length
    const center = curve.getPoint(t)
    const tangent = curve.getTangent(t)
    const side = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize()
    const up = new THREE.Vector3().crossVectors(tangent, side).normalize()
    // 圆形端盖：前端饱满，尾端略长略细，不收成尖头。
    const head = saturate(t / headCap)
    const tail = saturate((1 - t) / tailCap)
    const profile =
      Math.sqrt(head * (2 - head)) * Math.sqrt(tail * (2 - tail)) * (clump ? 1 : 1 - t * 0.16)
    const lumps = noise(along * (clump ? 22 : 9), 0.5, variant + 13)
    for (let segment = 0; segment <= sides; segment++) {
      const angle = (segment / sides) * Math.PI * 2
      const around = [Math.cos(angle), Math.sin(angle)] as const
      // 用圆周上的二维坐标取噪声，首尾相接且左右不对称。
      const surface = (scale: number, frequency: number, seed: number): number =>
        (noise(along * frequency, around[0] * scale + 3, variant + seed) +
          noise(along * frequency + 17, around[1] * scale + 5, variant + seed)) /
        2
      let neck = 0
      for (const item of necks) {
        const distance = (t - item.at) / item.width
        // 缢痕在一侧更深，不是绕一圈的均匀凹槽。
        neck +=
          item.depth * Math.exp(-distance * distance) * (0.65 + 0.35 * Math.cos(angle - item.side))
      }
      // 不规则的横向裂纹：沿长度方向高频、绕圆周低频的脊线噪声，只覆盖部分圆周。
      // 频率按实际显示尺寸选择：一段长条约有五六道可辨认的裂纹。
      const ridge = 1 - Math.abs(surface(1.2, 17, 0) * 2 - 1)
      const crack = Math.pow(ridge, 7) * THREE.MathUtils.smoothstep(surface(1.6, 6, 4), 0.34, 0.6)
      const grain = surface(3, 34, 1)
      const bulges = surface(clump ? 2 : 1, clump ? 16 : 8, 7)
      // 截面带不规则的二、三次起伏，不是正椭圆。
      const lobes =
        1 +
        (noise(along * 6, 0.3, variant + 43) - 0.5) * 0.18 * Math.cos(2 * angle + phase) +
        (noise(along * 5, 0.7, variant + 45) - 0.5) * 0.14 * Math.cos(3 * angle + phase * 1.3)
      const radius =
        bodyRadius *
        profile *
        lobes *
        (1 - neck) *
        (0.86 +
          bulges * (clump ? 0.2 : 0.14) +
          lumps * (clump ? 0.18 : 0.06) +
          grain * 0.06 -
          crack * 0.2)
      // 下半部更扁，表现贴着水面和自身重量的压扁感。
      const vertical = around[1] * radius * (around[1] < 0 ? 0.72 : 0.86)
      const point = center
        .clone()
        .addScaledVector(side, around[0] * radius)
        .addScaledVector(up, vertical)
      positions.push(point.x, point.y, point.z)
      // 裂纹、缢痕与凹处明显更暗；低频斑块在深褐、浅赭和略偏橄榄的褐色之间变化。
      // 斑块频率按长度选择：一段长条上有数块深浅不同的区域。
      const patch = surface(1.4, 16, 9)
      const olive = surface(1.1, 9, 15)
      const shade = tone * (0.5 + patch * 0.9 + grain * 0.14 - crack * 0.45 - neck * 0.9)
      color.setRGB(shade, shade * (0.82 + olive * 0.16), shade * (0.6 + olive * 0.18))
      colors.push(color.r, color.g, color.b)
      // 沿长度的纹理密度与绕圆周一致，颗粒不被拉成横纹。
      uvs.push(segment / sides, along / (5.3 * bodyRadius))
      if (ring < rings && segment < sides) {
        const a = ring * (sides + 1) + segment
        const b = a + sides + 1
        indices.push(a, a + 1, b, b, a + 1, b + 1)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingBox()
  const center = geometry.boundingBox!.getCenter(new THREE.Vector3())
  // 改变曲率时以物件中心为基准，避免物件随着弯曲整体漂移。
  geometry.translate(-center.x, 0, -center.z)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
