import { beforeEach, expect, it, vi } from 'vitest'

const renderer = vi.hoisted(() => ({
  extensions: { has: vi.fn<(name: string) => boolean>(() => false) },
  dispose: vi.fn<() => void>(),
}))

vi.mock('three', async (importOriginal) => ({
  ...(await importOriginal<typeof import('three')>()),
  WebGLRenderer: vi.fn<() => typeof renderer>(function () {
    return renderer
  }),
}))

import { createScene } from './create-scene'

beforeEach(() => {
  vi.clearAllMocks()
})

it('没有浮点颜色附件扩展时拒绝初始化并释放渲染器', async () => {
  await expect(createScene({} as HTMLCanvasElement)).rejects.toThrow(
    'Floating-point render targets are not supported',
  )
  expect(renderer.dispose).toHaveBeenCalledOnce()
})
