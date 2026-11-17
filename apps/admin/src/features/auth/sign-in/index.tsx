import { useSearch } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })

  return (
    <AuthLayout>
      <Card className='w-full gap-5 py-8'>
        <CardHeader className='px-8'>
          <CardTitle className='text-lg tracking-tight'>登录</CardTitle>
          <CardDescription>MINAO 管理端，仅限管理员。</CardDescription>
        </CardHeader>
        <CardContent className='px-8'>
          <UserAuthForm redirectTo={redirect} />
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
