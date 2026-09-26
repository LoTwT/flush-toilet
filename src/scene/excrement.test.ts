import { afterEach, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  CYCLE_DURATION,
  FLUSH_END_TIME,
  MAX_EXCREMENT_PIECES,
  REST_WATER_HEIGHT,
} from '../constants'
import { FlushCycle, sampleFlush } from '../simulation/flush-cycle'
import { createExcrement } from './excrement'
import { bowlAtHeight } from './bowl-profile'
import * as mosaicBaker from './excrement-mosaic'

afterEach(() => vi.restoreAllMocks())

it.each(['gentle', 'standard', 'strong'] as const)('%s 档将排泄物带向排水口并清空', (strength) => {
  const excrement = createExcrement()
  excrement.add(sampleFlush(CYCLE_DURATION))
  excrement.update(sampleFlush(CYCLE_DURATION), 1)
  const initial = excrement.group.children.map((piece) => piece.position.clone())
  excrement.flush()
  excrement.update(sampleFlush(2.6, strength), 2.6)
  expect(excrement.group.visible).toBe(true)
  for (const [index, piece] of excrement.group.children.entries()) {
    expect(piece.position.distanceTo(initial[index])).toBeGreaterThan(0.05)
  }
  excrement.update(sampleFlush(4.9, strength), 2.3)
  for (const piece of excrement.group.children) {
    expect(Math.abs(piece.position.x)).toBeLessThan(0.12)
    expect(Math.abs(piece.position.z + 0.19)).toBeLessThan(0.12)
    expect(piece.position.y).toBeLessThan(-0.2)
  }
  // 清空时使折射背景失效一次，下一帧恢复复用背景。
  expect(excrement.update(sampleFlush(FLUSH_END_TIME, strength), 0.1)).toBe(true)
  expect(excrement.group.visible).toBe(false)
  expect(excrement.update(sampleFlush(CYCLE_DURATION, strength), 7)).toBe(false)
})

it('Boost 补水期间放入的一份保留到下一次冲水，并贴合当前水位', () => {
  const excrement = createExcrement()
  const refilling = sampleFlush(5.2)
  excrement.add(refilling)
  excrement.update(refilling, 1)
  expect(excrement.group.visible).toBe(true)
  for (const piece of excrement.group.children) {
    expect(piece.position.y).toBeLessThan(REST_WATER_HEIGHT)
    expect(Math.abs(piece.position.y - refilling.bowlHeight)).toBeLessThan(0.03)
  }
  excrement.update(sampleFlush(CYCLE_DURATION), 7)
  expect(excrement.group.visible).toBe(true)
  excrement.flush()
  excrement.update(sampleFlush(FLUSH_END_TIME), FLUSH_END_TIME)
  expect(excrement.group.visible).toBe(false)
  excrement.add(sampleFlush(5.2))
  excrement.update(sampleFlush(5.3), 0.1)
  expect(excrement.group.visible).toBe(true)
})

it.each([1 / 30, 1 / 144, 1.5, 12])('帧间隔 %s 秒时都能完成清空，不遗漏跨阶段的长帧', (delta) => {
  const cycle = new FlushCycle()
  const excrement = createExcrement()
  excrement.add(cycle.state)
  cycle.start('standard')
  excrement.flush()
  while (cycle.state.phase !== 'ready') excrement.update(cycle.advance(delta), delta)
  expect(excrement.group.visible).toBe(false)
})

it('切换马赛克保留运动位置，冲走后切换也不会让物件重新出现', () => {
  const excrement = createExcrement()
  excrement.add(sampleFlush(CYCLE_DURATION))
  excrement.flush()
  excrement.update(sampleFlush(2.6), 2.6)
  const positions = excrement.group.children.map((piece) => piece.position.clone())
  for (const piece of excrement.group.children) {
    const [original, mosaic] = piece.children
    expect(original.visible).toBe(false)
    expect(mosaic.visible).toBe(true)
  }
  excrement.setMosaic(false)
  for (const [index, piece] of excrement.group.children.entries()) {
    const [original, mosaic] = piece.children
    expect(original.visible).toBe(true)
    expect(mosaic.visible).toBe(false)
    expect(piece.position.equals(positions[index])).toBe(true)
  }
  excrement.update(sampleFlush(FLUSH_END_TIME), FLUSH_END_TIME - 2.6)
  excrement.setMosaic(true)
  expect(excrement.group.visible).toBe(false)
})

it('每段可独立摆放，切换遮挡和退出编辑不重置，冲水从自定位置连续开始', () => {
  const excrement = createExcrement()
  const rest = sampleFlush(CYCLE_DURATION)
  excrement.add(rest)
  excrement.update(rest, 1)
  const untouched = excrement.group.children[0].position.clone()
  excrement.placement.setEnabled(true)
  excrement.placement.select(1)
  excrement.placement.transform({ rotation: 85, size: 1.2 })
  excrement.placement.move(0.05, 0.08)
  const moved = excrement.group.children[1].position.clone()
  expect(moved.x).toBeCloseTo(0.05)
  expect(moved.z).toBeCloseTo(0.08)
  expect(excrement.group.children[0].position.equals(untouched)).toBe(true)
  excrement.setMosaic(false)
  excrement.placement.setEnabled(false)
  excrement.flush()
  excrement.update(sampleFlush(0), 0)
  expect(excrement.group.children[1].position.distanceTo(moved)).toBeLessThan(1e-6)
  expect(excrement.group.children[1].rotation.y).toBeCloseTo((85 * Math.PI) / 180)
  expect(excrement.marker.visible).toBe(false)
  excrement.placement.move(-0.1, -0.1)
  expect(excrement.group.children[1].position.distanceTo(moved)).toBeLessThan(1e-6)
})

it.each([CYCLE_DURATION, 5.2])('在时间点 %s，极端拖动与放大仍限制在当前便池内', (elapsed) => {
  const excrement = createExcrement()
  const state = sampleFlush(elapsed)
  excrement.add(state)
  excrement.update(state, 1)
  excrement.placement.setEnabled(true)
  const section = bowlAtHeight(state.bowlHeight)
  for (let index = 0; index < 3; index++) {
    excrement.placement.select(index)
    excrement.placement.transform({ size: 5 })
    expect(excrement.placement.selection()!.size).toBe(1.3)
    excrement.placement.move(20, -30)
    const position = excrement.group.children[index].position
    expect(
      (position.x / section.radiusX) ** 2 + ((position.z - section.centerZ) / section.radiusZ) ** 2,
    ).toBeLessThan(1)
    expect(excrement.placement.pick(position.x, position.z, 0)).not.toBeNull()
    const before = position.clone()
    excrement.placement.move(NaN, Infinity)
    expect(position.equals(before)).toBe(true)
  }
})

it('放大弯曲模型的可见外沿可以命中，旋转和遮挡切换后仍然有效', () => {
  const excrement = createExcrement()
  const state = sampleFlush(CYCLE_DURATION)
  excrement.add(state)
  excrement.update(state, 1)
  excrement.placement.setEnabled(true)
  excrement.placement.setCount(1)
  excrement.placement.reshape({ kind: 'curved', curvature: 1, thickness: 1.45 })
  excrement.placement.transform({ rotation: 0, size: 1.3 })
  excrement.placement.move(0, 0)
  const mesh = excrement.group.children[0].children[0] as THREE.Mesh
  const vertices = mesh.geometry.getAttribute('position')
  const indices = mesh.geometry.index!
  const triangle = new THREE.Triangle()
  const normal = new THREE.Vector3()
  const center = new THREE.Vector3()
  // 与 1920 × 1080 画面相同的 8 CSS px 余量。
  const padding = 8 / 207.67123287671234
  for (const mosaic of [false, true]) {
    excrement.setMosaic(mosaic)
    for (const rotation of [0, 90, -135]) {
      excrement.placement.transform({ rotation })
      excrement.group.updateMatrixWorld(true)
      // 从实际朝上的三角面取四个对角方向的外沿点，跟随浮动、旋转和缩放。
      const directions = [
        new THREE.Vector2(1, 1),
        new THREE.Vector2(-1, 1),
        new THREE.Vector2(1, -1),
        new THREE.Vector2(-1, -1),
      ]
      const edges = directions.map(() => ({ distance: -Infinity, point: new THREE.Vector3() }))
      for (let index = 0; index < indices.count; index += 3) {
        for (const [offset, vertex] of [triangle.a, triangle.b, triangle.c].entries())
          vertex
            .fromBufferAttribute(vertices, indices.getX(index + offset))
            .applyMatrix4(mesh.matrixWorld)
        if (triangle.getNormal(normal).y <= 0) continue
        triangle.getMidpoint(center)
        for (const [index, direction] of directions.entries()) {
          const distance = center.x * direction.x + center.z * direction.y
          if (distance > edges[index].distance) {
            edges[index].distance = distance
            edges[index].point.copy(center)
          }
        }
      }
      for (const { point } of edges)
        expect(
          excrement.placement.pick(point.x, point.z, padding),
          `rotation=${rotation}, mosaic=${mosaic}`,
        ).toBe(0)
    }
  }
  expect(excrement.placement.pick(2, 2, padding)).toBeNull()
  excrement.placement.setEnabled(false)
  expect(excrement.placement.pick(0, 0, padding)).toBeNull()
  excrement.dispose()
})

it('形状仅改变选中段，释放旧网格并保留摆放，冲走后再放入仍沿用', () => {
  const excrement = createExcrement()
  const state = sampleFlush(CYCLE_DURATION)
  excrement.add(state)
  excrement.update(state, 1)
  excrement.placement.setEnabled(true)
  excrement.placement.select(1)
  excrement.placement.transform({ rotation: 90, size: 1.1 })
  excrement.placement.move(0, 0.05)
  const mesh = excrement.group.children[1].children[0] as THREE.Mesh
  const untouched = (excrement.group.children[0].children[0] as THREE.Mesh).geometry
  const oldGeometry = mesh.geometry
  const dispose = vi.spyOn(oldGeometry, 'dispose')
  excrement.placement.reshape({ kind: 'clump', curvature: -0.6, thickness: 1.3 })
  expect(mesh.geometry).not.toBe(oldGeometry)
  expect(dispose).toHaveBeenCalledOnce()
  expect((excrement.group.children[0].children[0] as THREE.Mesh).geometry).toBe(untouched)
  expect(excrement.group.children[1].position.x).toBeCloseTo(0)
  expect(excrement.group.children[1].position.z).toBeCloseTo(0.05)
  expect(excrement.placement.selection()).toEqual({
    index: 1,
    rotation: 90,
    size: 1.1,
    shape: { kind: 'clump', curvature: -0.6, thickness: 1.3 },
  })
  const geometry = mesh.geometry
  excrement.setMosaic(false)
  excrement.flush()
  excrement.placement.reshape({ kind: 'log' })
  expect(mesh.geometry).toBe(geometry)
  excrement.update(sampleFlush(FLUSH_END_TIME), FLUSH_END_TIME)
  excrement.add(state)
  excrement.placement.setEnabled(true)
  expect(excrement.placement.selection()!.shape).toEqual({
    kind: 'clump',
    curvature: -0.6,
    thickness: 1.3,
  })
})

it('形状预设确实改变轮廓，极端弯曲和粗细仍生成有限网格', () => {
  const excrement = createExcrement()
  excrement.add(sampleFlush(CYCLE_DURATION))
  excrement.placement.setEnabled(true)
  const mesh = excrement.group.children[0].children[0] as THREE.Mesh
  excrement.placement.reshape({ kind: 'log', curvature: 0 })
  const straightWidth = mesh.geometry.boundingBox!.max.x - mesh.geometry.boundingBox!.min.x
  excrement.placement.reshape({ kind: 'curved', curvature: 1 })
  expect(mesh.geometry.boundingBox!.max.x - mesh.geometry.boundingBox!.min.x).toBeGreaterThan(
    straightWidth * 1.25,
  )
  for (const kind of ['log', 'curved', 'clump'] as const) {
    for (const curvature of [-10, 10]) {
      excrement.placement.reshape({ kind, curvature, thickness: 10 })
      expect(Math.abs(excrement.placement.selection()!.shape.curvature)).toBe(1)
      expect(excrement.placement.selection()!.shape.thickness).toBe(1.45)
      for (const attribute of ['position', 'normal']) {
        expect(Array.from(mesh.geometry.getAttribute(attribute).array).every(Number.isFinite)).toBe(
          true,
        )
      }
    }
  }
})

it('马赛克合并同帧形状修改，复用烘焙器，只刷新改变的段落且覆盖新轮廓', () => {
  type Baker = ReturnType<typeof mosaicBaker.createExcrementMosaicBaker>
  const baker = { bake: vi.fn<Baker['bake']>(), dispose: vi.fn<Baker['dispose']>() }
  const createBaker = vi.spyOn(mosaicBaker, 'createExcrementMosaicBaker').mockReturnValue(baker)
  const excrement = createExcrement()
  const renderer = {} as THREE.WebGLRenderer
  excrement.prepareMosaic(renderer)
  expect(baker.bake).toHaveBeenCalledTimes(3)
  const target = baker.bake.mock.calls[0][1]
  excrement.prepareMosaic(renderer)
  expect(baker.bake).toHaveBeenCalledTimes(3)
  excrement.add(sampleFlush(CYCLE_DURATION))
  excrement.placement.setEnabled(true)
  excrement.placement.reshape({ kind: 'clump', thickness: 1.2 })
  excrement.placement.reshape({ thickness: 1.4 })
  excrement.prepareMosaic(renderer)
  expect(createBaker).toHaveBeenCalledOnce()
  expect(baker.bake).toHaveBeenCalledTimes(4)
  expect(baker.bake.mock.lastCall![1]).toBe(target)
  const [model, mosaic] = excrement.group.children[0].children as THREE.Mesh[]
  const bounds = model.geometry.boundingBox!
  expect(mosaic.scale.x).toBeGreaterThan(bounds.max.x - bounds.min.x)
  expect(mosaic.scale.z).toBeGreaterThan(bounds.max.z - bounds.min.z)
  excrement.dispose()
  expect(baker.dispose).toHaveBeenCalledOnce()
})

it('增删只改变目标段，剩余段保留位置、形状种子与浮动相位', () => {
  const excrement = createExcrement()
  const state = sampleFlush(CYCLE_DURATION)
  excrement.add(state)
  excrement.update(state, 1)
  excrement.placement.setEnabled(true)
  const survivor = excrement.group.children[1]
  const position = survivor.position.clone()
  const originalGeometry = (survivor.children[0] as THREE.Mesh).geometry
  const originalVertices = Array.from(originalGeometry.getAttribute('position').array)
  excrement.placement.addPiece()
  expect(excrement.placement.count()).toBe(4)
  expect(excrement.placement.selection()!.index).toBe(3)
  expect(survivor.position.equals(position)).toBe(true)
  excrement.placement.select(0)
  excrement.placement.removeSelected()
  expect(excrement.placement.count()).toBe(3)
  expect(excrement.group.children[0]).toBe(survivor)
  expect(survivor.position.equals(position)).toBe(true)
  excrement.placement.reshape({ kind: 'clump' })
  excrement.placement.reshape({ kind: 'log' })
  expect(
    Array.from((survivor.children[0] as THREE.Mesh).geometry.getAttribute('position').array),
  ).toEqual(originalVertices)
})

it('批量调整数量保留已有摆放与形状，沿用马赛克并释放多余段', () => {
  const excrement = createExcrement()
  const state = sampleFlush(CYCLE_DURATION)
  excrement.add(state)
  excrement.update(state, 1)
  excrement.placement.setEnabled(true)
  excrement.placement.reshape({ kind: 'curved', curvature: -0.5 })
  excrement.placement.transform({ rotation: 42, size: 1.1 })
  excrement.placement.move(0.06, 0.1)
  const survivor = excrement.group.children[0]
  const position = survivor.position.clone()
  const geometry = (survivor.children[0] as THREE.Mesh).geometry
  const selection = excrement.placement.selection()
  excrement.setMosaic(false)
  excrement.placement.setCount(6)
  expect(excrement.placement.count()).toBe(6)
  expect(survivor.position.equals(position)).toBe(true)
  for (const piece of excrement.group.children) {
    expect(piece.children[0].visible).toBe(true)
    expect(piece.children[1].visible).toBe(false)
  }
  const removed = excrement.group.children.slice(1).map((piece) => {
    const [model, mosaic] = piece.children as THREE.Mesh[]
    return [
      vi.spyOn(model.geometry, 'dispose'),
      vi.spyOn(mosaic.material as THREE.Material, 'dispose'),
    ]
  })
  excrement.placement.select(5)
  excrement.placement.setCount(1)
  for (const disposals of removed)
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce()
  expect(excrement.placement.selection()).toEqual(selection)
  expect(survivor.position.equals(position)).toBe(true)
  expect((survivor.children[0] as THREE.Mesh).geometry).toBe(geometry)
  excrement.placement.setCount(1)
  expect(excrement.group.children).toEqual([survivor])
  excrement.placement.setCount(3)
  excrement.flush()
  excrement.update(sampleFlush(FLUSH_END_TIME), FLUSH_END_TIME)
  excrement.add(state)
  excrement.placement.setEnabled(true)
  expect(excrement.placement.count()).toBe(3)
  expect(excrement.placement.selection()).toEqual(selection)
})

it('批量数量遵守编辑与数值限制，清空后刷新背景并允许重新添加', () => {
  const excrement = createExcrement()
  const state = sampleFlush(CYCLE_DURATION)
  excrement.add(state)
  excrement.placement.setCount(6)
  expect(excrement.placement.count()).toBe(3)
  excrement.placement.setEnabled(true)
  for (const count of [NaN, Infinity, -1, 1.5, MAX_EXCREMENT_PIECES + 1]) {
    excrement.placement.setCount(count)
    expect(excrement.placement.count()).toBe(3)
  }
  excrement.placement.setCount(0)
  expect(excrement.group.visible).toBe(false)
  expect(excrement.marker.visible).toBe(false)
  expect(excrement.placement.selection()).toBeNull()
  expect(excrement.update(state, 0)).toBe(true)
  const refilling = sampleFlush(5.2)
  expect(excrement.update(refilling, 0)).toBe(false)
  excrement.placement.setCount(6)
  excrement.update(refilling, 1)
  expect(excrement.group.visible).toBe(true)
  expect(excrement.marker.visible).toBe(true)
  for (const piece of excrement.group.children)
    expect(Math.abs(piece.position.y - refilling.bowlHeight)).toBeLessThan(0.03)
  excrement.flush()
  excrement.placement.setCount(1)
  expect(excrement.placement.count()).toBe(6)
})

it('删除最后一段释放专用资源并清除折射残影，随后可在当前水位添加', () => {
  const excrement = createExcrement()
  const state = sampleFlush(CYCLE_DURATION)
  excrement.add(state)
  excrement.update(state, 1)
  excrement.placement.setEnabled(true)
  excrement.placement.removeSelected()
  excrement.placement.removeSelected()
  const [model, mosaic] = excrement.group.children[0].children as THREE.Mesh[]
  const geometryDisposed = vi.spyOn(model.geometry, 'dispose')
  const maskDisposed = vi.spyOn(mosaic.material as THREE.Material, 'dispose')
  const sharedDisposed = vi.spyOn(model.material as THREE.Material, 'dispose')
  excrement.placement.removeSelected()
  expect(excrement.placement.count()).toBe(0)
  expect(excrement.placement.selection()).toBeNull()
  expect(excrement.group.visible).toBe(false)
  expect(excrement.marker.visible).toBe(false)
  expect(geometryDisposed).toHaveBeenCalledOnce()
  expect(maskDisposed).toHaveBeenCalledOnce()
  expect(sharedDisposed).not.toHaveBeenCalled()
  expect(excrement.update(state, 0)).toBe(true)
  expect(excrement.update(sampleFlush(5.2), 0)).toBe(false)
  excrement.placement.nudge(0.1, 0.1)
  excrement.placement.reshape({ kind: 'log' })
  excrement.setMosaic(false)
  excrement.placement.addPiece()
  expect(excrement.placement.count()).toBe(1)
  expect(excrement.group.visible).toBe(true)
  excrement.update(sampleFlush(5.2), 1)
  expect(excrement.group.children[0].position.y).toBeLessThan(REST_WATER_HEIGHT)
  expect(excrement.group.children[0].children[0].visible).toBe(true)
  expect(excrement.group.children[0].children[1].visible).toBe(false)
})

it('支持数量上限并限制冲水中增删，重复增删后的网格有效，再放入沿用数量', () => {
  const excrement = createExcrement()
  const state = sampleFlush(CYCLE_DURATION)
  excrement.add(state)
  excrement.placement.setEnabled(true)
  for (let index = 0; index < MAX_EXCREMENT_PIECES + 2; index++) excrement.placement.addPiece()
  expect(excrement.placement.count()).toBe(MAX_EXCREMENT_PIECES)
  for (let index = 0; index < 24; index++) {
    excrement.placement.removeSelected()
    excrement.placement.addPiece()
  }
  for (const piece of excrement.group.children) {
    const geometry = (piece.children[0] as THREE.Mesh).geometry
    expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true)
    expect(geometry.boundingBox!.max.z - geometry.boundingBox!.min.z).toBeGreaterThan(0.05)
  }
  excrement.flush()
  excrement.placement.removeSelected()
  excrement.placement.addPiece()
  expect(excrement.placement.count()).toBe(MAX_EXCREMENT_PIECES)
  excrement.update(sampleFlush(FLUSH_END_TIME), FLUSH_END_TIME)
  expect(excrement.group.visible).toBe(false)
  excrement.add(state)
  expect(excrement.group.visible).toBe(true)
  expect(excrement.placement.count()).toBe(MAX_EXCREMENT_PIECES)
})
