import { FileText, LayoutDashboard, Users } from 'lucide-react'
import { Logo } from '@/assets/logo'
import { type SidebarData } from '../types'

/** Static shell data. The signed-in admin is read from the auth store. */
export const sidebarData: Omit<SidebarData, 'user'> = {
  teams: [{ name: 'MINAO', logo: Logo, plan: '管理端' }],
  navGroups: [
    {
      title: '常规',
      items: [
        { title: '首页', url: '/', icon: LayoutDashboard },
        { title: '试卷管理', url: '/exams', icon: FileText },
        { title: '用户管理', url: '/users', icon: Users },
      ],
    },
  ],
}
