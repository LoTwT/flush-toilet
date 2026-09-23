import * as THREE from 'three'
import type { BowlSection } from '../types'

export function createBowlGeometry(
  sections: readonly BowlSection[],
  inside = true,
): THREE.BufferGeometry {
  const segments = 128
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (const [row, section] of sections.entries()) {
    for (let segment = 0; segment <= segments; segment++) {
      const angle = (segment / segments) * Math.PI * 2
      positions.push(
        Math.sin(angle) * section.radiusX,
        section.height,
        Math.cos(angle) * section.radiusZ + section.centerZ,
      )
      uvs.push(segment / segments, row / (sections.length - 1))
      if (row < sections.length - 1 && segment < segments) {
        const current = row * (segments + 1) + segment
        const next = current + segments + 1
        if (inside) {
          indices.push(current, next, current + 1, current + 1, next, next + 1)
        } else {
          indices.push(current, current + 1, next, current + 1, next + 1, next)
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function createOvalRing(
  radiusX: number,
  radiusZ: number,
  width: number,
  thickness: number,
): THREE.BufferGeometry {
  const segments = 128
  const profileSegments = 24
  const positions: number[] = []
  const indices: number[] = []

  for (let segment = 0; segment <= segments; segment++) {
    const angle = (segment / segments) * Math.PI * 2
    for (let profile = 0; profile <= profileSegments; profile++) {
      const crossAngle = (profile / profileSegments) * Math.PI * 2
      positions.push(
        Math.sin(angle) * (radiusX + Math.cos(crossAngle) * width),
        Math.sin(crossAngle) * thickness,
        Math.cos(angle) * (radiusZ + Math.cos(crossAngle) * width),
      )
      if (segment < segments && profile < profileSegments) {
        const current = segment * (profileSegments + 1) + profile
        const next = current + profileSegments + 1
        indices.push(current, next, current + 1, current + 1, next, next + 1)
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function createWaterGeometry(): THREE.BufferGeometry {
  const segments = 128
  const rings = 36
  const positions: number[] = []
  const indices: number[] = []
  for (let ring = 0; ring <= rings; ring++) {
    const radius = ring / rings
    for (let segment = 0; segment <= segments; segment++) {
      const angle = (segment / segments) * Math.PI * 2
      positions.push(Math.sin(angle) * radius, 0, Math.cos(angle) * radius)
      if (ring < rings && segment < segments) {
        const current = ring * (segments + 1) + segment
        const next = current + segments + 1
        indices.push(current, next, current + 1, current + 1, next, next + 1)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  return geometry
}

export function createSeatGeometry(): THREE.BufferGeometry {
  const segments = 192
  const profileSegments = 40
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  for (let segment = 0; segment <= segments; segment++) {
    const angle = (segment / segments) * Math.PI * 2
    for (let profile = 0; profile <= profileSegments; profile++) {
      const cross = (profile / profileSegments) * Math.PI * 2
      // 宽而略拱的坐面、圆角和收窄的底壳，区别于陶瓷边沿的圆管截面。
      const radial = Math.sign(Math.cos(cross)) * Math.pow(Math.abs(Math.cos(cross)), 0.55)
      const vertical = Math.sign(Math.sin(cross)) * Math.pow(Math.abs(Math.sin(cross)), 0.7)
      positions.push(
        Math.sin(angle) * (0.68 + radial * 0.135),
        vertical * 0.045,
        Math.cos(angle) * (0.938 + radial * 0.152),
      )
      const shade = 0.67 + 0.33 * Math.pow(Math.max(0, vertical), 0.45)
      colors.push(shade, shade, shade)
      if (segment < segments && profile < profileSegments) {
        const current = segment * (profileSegments + 1) + profile
        const next = current + profileSegments + 1
        indices.push(current, next, current + 1, current + 1, next, next + 1)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function createOvalLid(radiusX: number, radiusZ: number): THREE.BufferGeometry {
  const outline = new THREE.Shape()
  outline.absellipse(0, 0, radiusX, radiusZ, 0, Math.PI * 2, false, 0)
  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth: 0.04,
    bevelEnabled: true,
    bevelThickness: 0.014,
    bevelSize: 0.018,
    bevelSegments: 4,
    steps: 1,
    curveSegments: 64,
  })
  geometry.rotateX(Math.PI / 2)
  geometry.translate(0, 0.02, 0)
  return geometry
}
