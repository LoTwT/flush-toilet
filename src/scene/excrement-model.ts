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
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain = noise(x / 8, y / 8) * 0.6 + noise(x / 2, y / 2, 3) * 0.4
      const value = Math.round(80 + grain * 140)
      const offset = (y * size + x) * 4
      data.set([value, value, value, 255], offset)
    }
  }
  const texture = new THREE.DataTexture(data, size, size)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return new THREE.MeshPhysicalMaterial({
    color: '#62442e',
    vertexColors: true,
    roughness: 0.74,
    bumpMap: texture,
    bumpScale: 0.0035,
    clearcoat: 0.14,
    clearcoatRoughness: 0.48,
  })
}

export function createExcrementGeometry(
  variant: number,
  settings = defaultExcrementShape(variant),
): THREE.BufferGeometry {
  // 各段有独立的弯曲中轴；沿中轴的截面渐细，并带不规则褶皱。
  const clump = settings.kind === 'clump'
  const length = (clump ? 0.135 : 0.34) * (1 - (variant % 3) * 0.06)
  const thickness = THREE.MathUtils.clamp(settings.thickness, 0.65, 1.45)
  const bodyRadius = (clump ? 0.079 : 0.049) * thickness
  const arc = THREE.MathUtils.clamp(settings.curvature, -1, 1) * (clump ? 0.8 : 3.4)
  const phase = variant * 1.7 + 0.4
  const curve = new THREE.CatmullRomCurve3(
    Array.from({ length: 17 }, (_, index) => {
      const t = index / 16
      const angle = (t - 0.5) * arc
      return new THREE.Vector3(
        Math.abs(arc) < 0.001 ? 0 : ((Math.cos(angle) - Math.cos(arc / 2)) * length) / arc,
        Math.sin(t * Math.PI * 2 + phase) * 0.006,
        Math.abs(arc) < 0.001 ? (t - 0.5) * length : (Math.sin(angle) * length) / arc,
      )
    }),
  )
  const rings = 64
  const sides = 32
  const positions: number[] = []
  const colors: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const color = new THREE.Color()
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings
    const center = curve.getPoint(t)
    const tangent = curve.getTangent(t)
    const side = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize()
    const up = new THREE.Vector3().crossVectors(tangent, side).normalize()
    const taper = Math.pow(Math.sin(Math.PI * t), clump ? 0.62 : 0.34)
    for (let segment = 0; segment <= sides; segment++) {
      const angle = (segment / sides) * Math.PI * 2
      const folds = Math.sin(
        t * 41 + noise(t * 8, Math.cos(angle) * 2 + 3, variant) * 4 + Math.sin(angle * 3) + phase,
      )
      const grain = noise(t * 19, Math.cos(angle) * 3 + 4, variant)
      const bulges = noise(t * 7, Math.cos(angle) + 2, variant + 7)
      const radius = bodyRadius * taper * (0.85 + folds * 0.035 + grain * 0.1 + bulges * 0.23)
      const point = center
        .clone()
        .addScaledVector(side, Math.cos(angle) * radius)
        .addScaledVector(up, Math.sin(angle) * radius * 0.83)
      positions.push(point.x, point.y, point.z)
      const shade = 0.81 + grain * 0.16 + folds * 0.035
      color.setRGB(shade, shade * 0.94, shade * 0.83)
      colors.push(color.r, color.g, color.b)
      uvs.push(segment / sides, t * 2.4)
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
