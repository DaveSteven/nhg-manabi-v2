import { Logo } from '@/assets/logo'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className='flex min-h-svh w-full items-center justify-center'>
      <div className='mx-auto flex w-full max-w-lg flex-col justify-center space-y-2 px-4 py-8 sm:px-8'>
        <div className='mb-4 flex items-center justify-center'>
          <Logo className='me-2' />
          <h1 className='text-xl font-medium'>MINAO 管理端</h1>
        </div>
        {children}
      </div>
    </div>
  )
}
