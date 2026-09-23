import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { BOWL_SECTIONS } from '../constants'
import { createBowlGeometry, createOvalLid, createOvalRing, createSeatGeometry } from './geometry'

export const OPEN_LID_ANGLE = (-Math.PI * 112) / 180

export function createToilet(): {
  group: THREE.Group
  button: THREE.Mesh
  buttonRestHeight: number
  lid: THREE.Group
  innerGeometry: THREE.BufferGeometry
} {
  const group = new THREE.Group()
  const ceramic = new THREE.MeshPhysicalMaterial({
    color: '#faf9f3',
    roughness: 0.36,
    metalness: 0,
    clearcoat: 0.24,
    clearcoatRoughness: 0.36,
    envMapIntensity: 0.38,
    side: THREE.DoubleSide,
  })
  const seatMaterial = new THREE.MeshPhysicalMaterial({
    color: '#fffffa',
    roughness: 0.4,
    clearcoat: 0.18,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.35,
    side: THREE.DoubleSide,
  })
  const chrome = new THREE.MeshStandardMaterial({
    color: '#d3d8d4',
    roughness: 0.19,
    metalness: 0.9,
  })
  const dark = new THREE.MeshStandardMaterial({ color: '#626861', roughness: 0.4 })

  function addMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }

  const outer = createBowlGeometry(
    [
      { height: -0.15, radiusX: 0.55, radiusZ: 0.75, centerZ: 0.14 },
      { height: 0.05, radiusX: 0.62, radiusZ: 0.86, centerZ: 0.17 },
      { height: 0.4, radiusX: 0.73, radiusZ: 0.98, centerZ: 0.19 },
      { height: 0.65, radiusX: 0.83, radiusZ: 1.1, centerZ: 0.2 },
      { height: 0.8, radiusX: 0.86, radiusZ: 1.13, centerZ: 0.2 },
    ],
    false,
  )
  addMesh(outer, ceramic)

  const innerGeometry = createBowlGeometry(BOWL_SECTIONS)
  const innerPositions = innerGeometry.getAttribute('position')
  const innerColors = new Float32Array(innerPositions.count * 3)
  for (let index = 0; index < innerPositions.count; index++) {
    const height = innerPositions.getY(index)
    // 固定内腔的柔和遮蔽补足环境光，避免白色陶瓷失去深度。
    const openness = Math.max(0, Math.min(1, (height + 0.1) / 0.9))
    const shade = 0.42 + Math.pow(openness, 0.65) * 0.58
    innerColors[index * 3] = shade * 0.98
    innerColors[index * 3 + 1] = shade
    innerColors[index * 3 + 2] = shade * 0.99
  }
  innerGeometry.setAttribute('color', new THREE.BufferAttribute(innerColors, 3))
  const innerMaterial = ceramic.clone()
  innerMaterial.vertexColors = true
  addMesh(innerGeometry, innerMaterial)
  addMesh(createOvalRing(0.735, 1, 0.125, 0.043), ceramic, 0, 0.8, 0.2)
  const seatSurface = seatMaterial.clone()
  seatSurface.color.set('#e8eade')
  seatSurface.roughness = 0.42
  seatSurface.vertexColors = true
  seatSurface.side = THREE.FrontSide
  seatSurface.shadowSide = THREE.BackSide
  addMesh(createSeatGeometry(), seatSurface, 0, 0.947, 0.2)
  // 底壳与支撑垫留出空气间隙，俯视也能分辨座圈和下方露出的陶瓷边沿。
  const seatBase = addMesh(
    createSeatGeometry(),
    new THREE.MeshStandardMaterial({ color: '#a6aca3', roughness: 0.65 }),
    0,
    0.9,
    0.2,
  )
  seatBase.scale.set(1.012, 0.24, 1.009)
  for (const x of [-0.68, 0.68]) {
    addMesh(new RoundedBoxGeometry(0.09, 0.06, 0.18, 3, 0.018), seatMaterial, x, 0.873, 0.4)
  }

  // 水封下的陶瓷喉口保持可见的深度；排水时不会露出一个平面贴片。
  const throat = addMesh(
    new THREE.CylinderGeometry(0.125, 0.095, 0.1, 64, 1, true),
    new THREE.MeshStandardMaterial({ color: '#737e79', roughness: 0.28, side: THREE.BackSide }),
    0,
    -0.151,
    -0.19,
  )
  throat.scale.z = 1.1
  const drainFloor = addMesh(
    new THREE.CircleGeometry(0.096, 64),
    new THREE.MeshBasicMaterial({ color: '#293c3e' }),
    0,
    -0.203,
    -0.19,
  )
  drainFloor.rotation.x = -Math.PI / 2
  drainFloor.scale.y = 1.1

  addMesh(new RoundedBoxGeometry(1.32, 0.22, 0.55, 4, 0.06), ceramic, 0, 0.75, -1.1)
  addMesh(new RoundedBoxGeometry(1.48, 1.67, 0.7, 6, 0.12), ceramic, 0, 0.685, -1.67)
  addMesh(new RoundedBoxGeometry(1.53, 0.1, 0.74, 6, 0.047), seatMaterial, 0, 1.57, -1.685)

  for (const x of [-0.39, 0.39]) {
    addMesh(new RoundedBoxGeometry(0.18, 0.1, 0.2, 3, 0.025), chrome, x, 0.91, -0.85)
    const hinge = addMesh(
      new THREE.CylinderGeometry(0.046, 0.046, 0.2, 32),
      chrome,
      x,
      1.065,
      -0.85,
    )
    hinge.rotation.z = Math.PI / 2
  }

  const lid = new THREE.Group()
  lid.position.set(0, 1.065, -0.85)
  lid.rotation.x = OPEN_LID_ANGLE
  group.add(lid)
  const lidShell = new THREE.Mesh(createOvalLid(0.835, 1.095), seatMaterial)
  lidShell.position.z = 1.05
  lidShell.castShadow = true
  lidShell.receiveShadow = true
  lid.add(lidShell)
  const inset = new THREE.Mesh(
    createOvalLid(0.73, 0.98),
    new THREE.MeshPhysicalMaterial({ color: '#e2e6df', roughness: 0.42, clearcoat: 0.15 }),
  )
  inset.position.set(0, -0.045, 1.05)
  inset.scale.y = 0.25
  inset.receiveShadow = true
  lid.add(inset)
  for (const x of [-0.53, 0.53]) {
    const bumper = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.035, 0.18, 3, 0.016), seatMaterial)
    bumper.position.set(x, -0.058, 1.23)
    lid.add(bumper)
  }

  const buttonRestHeight = 1.654
  addMesh(new THREE.CylinderGeometry(0.133, 0.133, 0.015, 64), dark, 0.45, 1.631, -1.8)
  addMesh(new THREE.CylinderGeometry(0.124, 0.124, 0.019, 64), chrome, 0.45, 1.64, -1.8)
  const button = addMesh(
    new THREE.CylinderGeometry(0.106, 0.106, 0.022, 64),
    new THREE.MeshStandardMaterial({ color: '#e3e6e0', roughness: 0.31, metalness: 0.76 }),
    0.45,
    buttonRestHeight,
    -1.8,
  )

  const buttonMark = new THREE.Mesh(
    new THREE.TorusGeometry(0.032, 0.0018, 6, 36, Math.PI * 1.65),
    dark,
  )
  buttonMark.rotation.x = -Math.PI / 2
  buttonMark.position.y = 0.012
  button.add(buttonMark)

  return { group, button, buttonRestHeight, lid, innerGeometry }
}
