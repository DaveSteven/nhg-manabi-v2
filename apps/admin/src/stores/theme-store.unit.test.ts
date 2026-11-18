import { beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore } from './theme-store'

describe('theme store', () => {
  beforeEach(() => useThemeStore.setState({ mode: 'light' }))

  it('toggles between light and dark', () => {
    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().mode).toBe('dark')
    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().mode).toBe('light')
  })
})
