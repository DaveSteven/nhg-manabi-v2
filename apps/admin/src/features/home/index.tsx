import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { useAuthStore } from '@/stores/auth-store'

export function Home() {
  const user = useAuthStore((s) => s.auth.user)
  return (
    <>
      <Header>
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <h1 className='mb-2 text-2xl font-bold tracking-tight'>
          你好，{user?.displayName ?? '管理员'}
        </h1>
        <p className='text-muted-foreground'>
          已登录 JLPT GO 管理端（{user?.role}）。管理功能将在后续逐步加入。
        </p>
      </Main>
    </>
  )
}
