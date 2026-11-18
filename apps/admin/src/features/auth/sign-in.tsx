import { useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { App, Alert, Button, Card, Flex, Form, Input, Typography } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { adminLogin, describeLoginError } from '@/lib/api'
import { safeRedirect } from '@/lib/safe-redirect'
import { useAuthStore } from '@/stores/auth-store'

interface FormValues {
  username: string
  password: string
}

/** The credential form. Exported separately from the page for tests. */
export function SignInForm({ redirectTo }: { redirectTo?: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { auth } = useAuthStore()

  async function onFinish(values: FormValues) {
    setLoading(true)
    setError(null)
    try {
      const res = await adminLogin(values.username.trim().toLowerCase(), values.password)
      auth.setAccessToken(res.token)
      auth.setUser({
        id: res.admin.id,
        username: res.admin.username,
        displayName: res.admin.display_name,
        role: res.admin.role,
      })
      message.success(`欢迎回来，${res.admin.display_name}`)
      navigate({ to: safeRedirect(redirectTo), replace: true })
    } catch (e) {
      setError(describeLoginError(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Form<FormValues> layout='vertical' onFinish={onFinish} requiredMark={false} autoComplete='on'>
      <Form.Item
        label='用户名'
        name='username'
        rules={[{ required: true, whitespace: true, message: '请输入用户名' }]}
      >
        <Input prefix={<UserOutlined />} autoComplete='username' autoFocus />
      </Form.Item>
      <Form.Item label='密码' name='password' rules={[{ required: true, message: '请输入密码' }]}>
        <Input.Password prefix={<LockOutlined />} autoComplete='current-password' />
      </Form.Item>
      {error ? <Alert type='error' showIcon title={error} role='alert' style={{ marginBottom: 16 }} /> : null}
      <Button type='primary' htmlType='submit' block loading={loading}>
        登录
      </Button>
    </Form>
  )
}

export function SignIn() {
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  return (
    <Flex align='center' justify='center' style={{ minHeight: '100vh', padding: 16 }}>
      <Card style={{ width: 400, maxWidth: '100%' }}>
        <Flex align='center' gap={10} style={{ marginBottom: 8 }}>
          <img src='/images/favicon.svg' alt='MINAO' width={28} height={28} />
          <Typography.Title level={4} style={{ margin: 0 }}>
            登录
          </Typography.Title>
        </Flex>
        <Typography.Paragraph type='secondary'>MINAO 管理端，仅限管理员。</Typography.Paragraph>
        <SignInForm redirectTo={redirect} />
      </Card>
    </Flex>
  )
}
