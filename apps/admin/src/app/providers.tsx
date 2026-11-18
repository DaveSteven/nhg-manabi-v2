import type { ReactNode } from 'react'
import { App as AntApp, ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useThemeStore } from '@/stores/theme-store'

// Chinese-first stack (macOS / Windows / Linux), then the system default.
const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "Helvetica Neue", Arial, sans-serif'

/** antd theme + zh-CN locale + App context (message / modal hooks). */
export function AppProviders({ children }: { children: ReactNode }) {
  const mode = useThemeStore((s) => s.mode)
  return (
    <ConfigProvider
      locale={zhCN}
      // antd's default inserts a space between two CJK characters ("取 消").
      button={{ autoInsertSpace: false }}
      theme={{
        algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { fontFamily: FONT_FAMILY, borderRadius: 8 },
      }}
    >
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  )
}
