import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readRememberedSound, rememberSound } from './sound-preference'

describe('声音选择的本地保存', () => {
  beforeEach(() => {
    const entries = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('没有记录时需要询问，不能误认为已允许声音', () => {
    expect(readRememberedSound()).toBeNull()
  })

  it.each([false, true])('记住 %s，并在后续读取时恢复选择', (enabled) => {
    rememberSound(enabled)
    expect(readRememberedSound()).toBe(enabled)
  })

  it('无效记录不能当作允许声音或跳过询问', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'unexpected-value' })
    expect(readRememberedSound()).toBeNull()
  })

  it('存储不可用时仍可继续使用页面', () => {
    const unavailable = (): never => {
      throw new Error('Storage unavailable')
    }
    vi.stubGlobal('localStorage', { getItem: unavailable, setItem: unavailable })
    expect(readRememberedSound()).toBeNull()
    expect(() => rememberSound(true)).not.toThrow()
  })
})
