import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import {
  App,
  Avatar,
  Breadcrumb,
  Button,
  Drawer,
  Dropdown,
  Flex,
  Grid,
  Layout,
  Menu,
  Typography,
  theme,
} from 'antd'
import {
  FileTextOutlined,
  HomeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SunOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '@/stores/auth-store'
import { useThemeStore } from '@/stores/theme-store'
import { NAV, activeNavKey, breadcrumbFor } from './nav'
import { signOut } from './sign-out'

const { Sider, Header, Content } = Layout

const ICONS: Record<string, React.ReactNode> = {
  '/': <HomeOutlined />,
  '/exams': <FileTextOutlined />,
  '/users': <TeamOutlined />,
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Flex align='center' gap={10} style={{ height: 56, padding: '0 20px', overflow: 'hidden' }}>
      <img src='/images/favicon.svg' alt='MINAO' width={24} height={24} />
      {collapsed ? null : (
        <Typography.Text strong style={{ fontSize: 16, whiteSpace: 'nowrap' }}>
          MINAO 管理端
        </Typography.Text>
      )}
    </Flex>
  )
}

function SideMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <Menu
      mode='inline'
      selectedKeys={[activeNavKey(pathname)]}
      style={{ borderInlineEnd: 'none', background: 'transparent' }}
      items={NAV.map((n) => ({ key: n.key, icon: ICONS[n.key], label: n.label }))}
      onClick={({ key }) => {
        const entry = NAV.find((n) => n.key === key)
        if (entry) navigate({ to: entry.path })
        onNavigate?.()
      }}
    />
  )
}

function UserMenu() {
  const admin = useAuthStore((s) => s.auth.user)
  const navigate = useNavigate()
  const location = useLocation()
  const { modal } = App.useApp()
  const confirmSignOut = () =>
    modal.confirm({
      title: '退出登录',
      content: '确定要退出登录吗？之后需要重新登录才能使用管理端。',
      okText: '退出登录',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        await signOut()
        navigate({ to: '/sign-in', search: { redirect: location.href }, replace: true })
      },
    })
  const name = admin?.displayName ?? '管理员'
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: [
          {
            key: 'who',
            disabled: true,
            label: (
              <div>
                <div style={{ fontWeight: 500 }}>{name}</div>
                <div style={{ fontSize: 12 }}>{admin?.username}</div>
              </div>
            ),
          },
          { type: 'divider' },
          { key: 'logout', danger: true, label: '退出登录', onClick: confirmSignOut },
        ],
      }}
    >
      <Button type='text' aria-label='账户菜单'>
        <Avatar size='small'>{name.slice(0, 1).toUpperCase()}</Avatar>
        <span>{name}</span>
      </Button>
    </Dropdown>
  )
}

function Crumbs() {
  const { pathname } = useLocation()
  return (
    <Breadcrumb
      items={breadcrumbFor(pathname).map((c) => ({
        title: c.to ? <Link to={c.to}>{c.label}</Link> : c.label,
      }))}
    />
  )
}

export function AuthenticatedLayout() {
  const { token } = theme.useToken()
  const screens = Grid.useBreakpoint()
  const isMobile = screens.lg === false
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const mode = useThemeStore((s) => s.mode)
  const toggleTheme = useThemeStore((s) => s.toggle)

  const toggleSide = () => (isMobile ? setDrawerOpen(true) : setCollapsed(!collapsed))

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {isMobile ? (
        <Drawer
          open={drawerOpen}
          placement='left'
          size={240}
          onClose={() => setDrawerOpen(false)}
          closable={false}
          styles={{ body: { padding: 0 }, header: { display: 'none' } }}
        >
          <Brand collapsed={false} />
          <SideMenu onNavigate={() => setDrawerOpen(false)} />
        </Drawer>
      ) : (
        <Sider
          theme='light'
          width={220}
          collapsedWidth={64}
          collapsed={collapsed}
          trigger={null}
          style={{ borderInlineEnd: `1px solid ${token.colorBorderSecondary}`, height: '100%', overflowY: 'auto' }}
        >
          <Brand collapsed={collapsed} />
          <SideMenu />
        </Sider>
      )}
      <Layout style={{ minWidth: 0, height: '100%', overflow: 'hidden' }}>
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 16px',
            height: 56,
            flex: 'none',
            lineHeight: '56px',
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Button
            type='text'
            aria-label='切换侧边栏'
            icon={collapsed && !isMobile ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={toggleSide}
          />
          <Crumbs />
          <Flex flex={1} />
          <Button
            type='text'
            aria-label={mode === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
            icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggleTheme}
          />
          <UserMenu />
        </Header>
        <Content style={{ padding: 24, minWidth: 0, flex: 1, overflowY: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
