import { Layout, Menu, Dropdown, Avatar, Space, ConfigProvider, theme } from 'antd'
import {
  DashboardOutlined,
  UserOutlined,
  ShopOutlined,
  FileTextOutlined,
  SettingOutlined,
  LogoutOutlined,
} from '@ant-design/icons'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { logout as logoutApi } from '../services/api'
import { message } from 'antd'

const { Header, Sider, Content } = Layout

const MainLayout = () => {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = async () => {
    try {
      await logoutApi()
      logout()
      message.success('退出成功')
      navigate('/login')
    } catch (error) {
      logout()
      navigate('/login')
    }
  }

  const userMenuItems = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ]

  const menuItems = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: '看板',
      onClick: () => navigate('/dashboard'),
    },
    {
      key: '/user',
      icon: <UserOutlined />,
      label: '用户管理',
      onClick: () => navigate('/user'),
    },
    {
      key: '/supplier',
      icon: <ShopOutlined />,
      label: '供应商管理',
      onClick: () => navigate('/supplier'),
    },
    {
      key: '/log',
      icon: <FileTextOutlined />,
      label: '日志管理',
      onClick: () => navigate('/log'),
    },
    {
      key: '/system',
      icon: <SettingOutlined />,
      label: '系统设置',
      onClick: () => navigate('/system'),
    },
  ]

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#3B82F6',
          colorSuccess: '#10B981',
          colorWarning: '#F59E0B',
          colorError: '#EF4444',
          colorInfo: '#06B6D4',
          colorBgBase: '#020617',
          colorBgContainer: 'rgba(15, 23, 42, 0.6)',
          colorBorder: 'rgba(148, 163, 184, 0.2)',
          colorText: '#F8FAFC',
          colorTextSecondary: '#CBD5E1',
          colorTextTertiary: '#94A3B8',
          borderRadius: 8,
          fontSize: 12,
        },
        components: {
          Layout: {
            headerBg: 'rgba(15, 23, 42, 0.7)',
            siderBg: 'rgba(15, 23, 42, 0.6)',
          },
          Menu: {
            darkItemBg: 'transparent',
            darkItemSelectedBg: 'rgba(59, 130, 246, 0.2)',
            darkItemSelectedColor: '#3B82F6',
          },
        },
      }}
    >
      <Layout className="min-h-screen relative overflow-hidden">
        {/* Ambient background blobs */}
        <div className="ambient-blob blob-1" />
        <div className="ambient-blob blob-2" />
        <div className="ambient-blob blob-3" />

        <div className="content-layer flex min-h-screen">
          <Sider
            width={200}
            className="backdrop-blur-xl border-r border-border"
            style={{
              background: 'rgba(15, 23, 42, 0.6)',
              borderRight: '1px solid rgba(148, 163, 184, 0.2)',
            }}
          >
            <div className="h-16 flex items-center justify-center text-xl font-bold border-b border-border">
              <span className="text-secondary">Proxy</span>
              <span className="text-accent">Admin</span>
            </div>
            <Menu
              mode="inline"
              selectedKeys={[location.pathname]}
              items={menuItems}
              className="border-none"
            />
          </Sider>
          <Layout className="flex flex-col">
            <Header
              className="backdrop-blur-xl px-6 flex justify-between items-center border-b border-border"
              style={{
                background: 'rgba(15, 23, 42, 0.7)',
                borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
              }}
            >
              <div />
              <div className="flex items-center">
                <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
                  <Space className="cursor-pointer">
                    <Avatar src={user?.avatar} size="small" />
                    <span className="text-xs text-text-secondary">{user?.nickname}</span>
                  </Space>
                </Dropdown>
              </div>
            </Header>
            <Content className="p-6 min-h-[calc(100vh-64px)] overflow-y-auto">
              <Outlet />
            </Content>
          </Layout>
        </div>
      </Layout>
    </ConfigProvider>
  )
}

export default MainLayout
