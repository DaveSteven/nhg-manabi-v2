import { Command, LayoutDashboard } from 'lucide-react'
import { type SidebarData } from '../types'

/** Static shell data. The signed-in admin is read from the auth store. */
export const sidebarData: Omit<SidebarData, 'user'> = {
  teams: [{ name: 'JLPT GO', logo: Command, plan: '管理端' }],
  navGroups: [
    {
      title: '常规',
      items: [{ title: '首页', url: '/', icon: LayoutDashboard }],
    },
  ],
}
