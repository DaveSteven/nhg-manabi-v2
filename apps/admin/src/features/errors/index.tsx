import { useNavigate, useRouter } from '@tanstack/react-router'
import { Button, Result } from 'antd'

export function NotFoundError() {
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <Result
      status='404'
      title='404'
      subTitle='页面不存在或已被移动。'
      extra={[
        <Button key='back' onClick={() => history.go(-1)}>
          返回上一页
        </Button>,
        <Button key='home' type='primary' onClick={() => navigate({ to: '/' })}>
          回到首页
        </Button>,
      ]}
    />
  )
}

export function GeneralError() {
  const navigate = useNavigate()
  return (
    <Result
      status='500'
      title='出错了'
      subTitle='页面加载失败。如果后端未启动，请先启动后再重试。'
      extra={
        <Button type='primary' onClick={() => navigate({ to: '/' })}>
          回到首页
        </Button>
      }
    />
  )
}
