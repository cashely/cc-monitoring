import { Layout, Menu, Dropdown, Avatar, Button, Space } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  ShopOutlined,
  FileTextOutlined,
  SettingOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { logout as logoutApi } from '../services/api';
import { message } from 'antd';

const { Header, Sider, Content } = Layout;

const MainLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await logoutApi();
      logout();
      message.success('退出成功');
      navigate('/login');
    } catch (error) {
      // Already handled by interceptor, just call logout
      logout();
      navigate('/login');
    }
  };

  const userMenuItems = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ];

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
  ];

  return (
    <Layout className="min-h-screen">
      <Sider width={200} className="bg-white shadow-md">
        <div className="h-16 flex items-center justify-center text-xl font-bold text-blue-600 border-b">
          Proxy Admin
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          className="border-none"
        />
      </Sider>
      <Layout>
        <Header className="bg-white shadow-sm px-6 flex justify-between items-center">
          <div></div>
          <div className="flex items-center">
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <Space className="cursor-pointer">
                <Avatar src={user?.avatar} size="small" />
                <span className="text-sm">{user?.nickname}</span>
              </Space>
            </Dropdown>
          </div>
        </Header>
        <Content className="p-6 bg-gray-50 min-h-[calc(100vh-64px)]">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;