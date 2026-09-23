import { BOWL_SECTIONS } from '../constants'
import type { BowlSection } from '../types'

export function bowlAtHeight(height: number): BowlSection {
  const first = BOWL_SECTIONS[0]
  const last = BOWL_SECTIONS[BOWL_SECTIONS.length - 1]
  if (height <= first.height) return { ...first }
  if (height >= last.height) return { ...last }

  for (let index = 1; index < BOWL_SECTIONS.length; index++) {
    const upper = BOWL_SECTIONS[index]
    const lower = BOWL_SECTIONS[index - 1]
    if (height <= upper.height) {
      const weight = (height - lower.height) / (upper.height - lower.height)
      return {
        height,
        radiusX: lower.radiusX + (upper.radiusX - lower.radiusX) * weight,
        radiusZ: lower.radiusZ + (upper.radiusZ - lower.radiusZ) * weight,
        centerZ: lower.centerZ + (upper.centerZ - lower.centerZ) * weight,
      }
    }
  }
  return { ...last }
}
