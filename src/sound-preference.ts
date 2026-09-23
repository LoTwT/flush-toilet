const STORAGE_KEY = 'flush-toilet:sound-enabled'

// 只有明确勾选“不再提示”才保存；没有有效记录时继续询问，并默认静音。
export function readRememberedSound(): boolean | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'true') return true
    if (value === 'false') return false
  } catch {
    // 存储被禁用时仍能完成本次声音选择。
  }
  return null
}

export function rememberSound(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled))
  } catch {
    // 存储失败不能阻止使用页面或切换声音。
  }
}
