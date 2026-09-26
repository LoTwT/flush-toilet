import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  build: { target: 'es2022' },
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
        },
      },
      {
        test: {
          include: ['src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              // CI 没有物理 GPU，仍需执行真实 WebGL Shader。
              launchOptions: { args: ['--enable-unsafe-swiftshader'] },
            }),
            instances: [{ browser: 'chromium', name: 'webgl' }],
          },
        },
      },
    ],
  },
})
