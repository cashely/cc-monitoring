import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined, EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { login as loginApi } from '../services/api';
import { LoginParams } from '../types/auth';
import { useState } from 'react';

const Login = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleLogin = async (values: LoginParams) => {
    setLoading(true);
    try {
      const response = await loginApi(values);
      if (response.code === 0) {
        const { token, user } = response.data;
        login(token, user);
        message.success('登录成功');
        navigate('/dashboard');
      }
    } catch (error) {
      // Error already handled by interceptor
      console.error('Login failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Global style overrides */}
      <style>
        {`
          /* Glass card with breathing animation */
          .ant-card {
            background-color: rgba(15, 23, 42, 0.4) !important;
            backdrop-filter: blur(24px) !important;
            border-color: rgba(51, 65, 85, 0.6) !important;
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.05),
              0 0 40px rgba(34, 197, 94, 0.05),
              0 8px 32px rgba(0, 0, 0, 0.2) !important;
            animation: pulse-glass 6s ease-in-out infinite !important;
            transition: all 0.3s ease !important;
          }

          .ant-card:hover {
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.07),
              0 0 60px rgba(34, 197, 94, 0.12),
              0 8px 32px rgba(0, 0, 0, 0.25) !important;
          }

          @keyframes pulse-glass {
            0%, 100% {
              background-color: rgba(15, 23, 42, 0.38);
              box-shadow:
                inset 0 1px 0 rgba(255, 255, 255, 0.05),
                0 0 40px rgba(34, 197, 94, 0.05),
                0 8px 32px rgba(0, 0, 0, 0.2);
            }
            50% {
              background-color: rgba(15, 23, 42, 0.45);
              box-shadow:
                inset 0 1px 0 rgba(255, 255, 255, 0.07),
                0 0 50px rgba(34, 197, 94, 0.1),
                0 8px 32px rgba(0, 0, 0, 0.25);
            }
          }

          /* Respect reduced motion preference */
          @media (prefers-reduced-motion: reduce) {
            .ant-card {
              animation: none !important;
            }
          }

          /* Input styles */
          .ant-input-affix-wrapper {
            background-color: rgba(30, 41, 59, 0.4) !important;
            border-color: rgba(51, 65, 85, 0.7) !important;
            backdrop-filter: blur(4px) !important;
            transition: all 0.2s ease !important;
            padding-inline: 11px !important;
          }
          .ant-input-affix-wrapper:hover {
            background-color: rgba(30, 41, 59, 0.4) !important;
            border-color: #475569 !important;
          }
          .ant-input-affix-wrapper-focused,
          .ant-input-affix-wrapper:focus,
          .ant-input-affix-wrapper:active {
            background-color: rgba(30, 41, 59, 0.4) !important;
            border-color: #22C55E !important;
            box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2) !important;
          }

          .ant-input, .ant-input-password {
            background-color: transparent !important;
            color: #F8FAFC !important;
            border: none !important;
            box-shadow: none !important;
          }
          .ant-input:hover, .ant-input-password:hover,
          .ant-input:focus, .ant-input-password:focus,
          .ant-input:active, .ant-input-password:active {
            background-color: transparent !important;
            border: none !important;
            box-shadow: none !important;
          }

          .ant-input::placeholder, .ant-input-password::placeholder {
            color: #64748B !important;
          }
          .ant-input-prefix {
            color: #94A3B8 !important;
          }
          .ant-input-suffix {
            color: #94A3B8 !important;
          }
          .ant-input-suffix svg {
            color: inherit !important;
            transition: color 0.2s ease !important;
          }
          .ant-input-suffix:hover {
            color: #F8FAFC !important;
          }
        `}
      </style>

      <div className="min-h-dvh bg-[#020617] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background gradient effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0F172A]/40 via-transparent to-[#22C55E]/10 pointer-events-none" />

      {/* Animated background orbs */}
      <div className="absolute top-1/4 -left-16 w-64 h-64 bg-[#22C55E]/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 -right-16 w-64 h-64 bg-[#3B82F6]/20 rounded-full blur-3xl animate-pulse delay-1000" />

      <Card
        className="w-full max-w-md bg-[#0F172A]/30 backdrop-blur-2xl border border-[#334155]/30 shadow-2xl hover:shadow-[#22C55E]/10 transition-all duration-300"
        styles={{ body: { padding: '2.5rem' } }}
      >
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-[#22C55E]/10 rounded-full mb-4">
            <LockOutlined className="text-2xl text-[#22C55E]" />
          </div>
          <h1 className="text-3xl font-bold text-[#F8FAFC] mb-2 tracking-tight">Proxy Admin</h1>
          <p className="text-[#94A3B8] text-base">欢迎登录管理系统</p>
        </div>

        <Form
          form={form}
          name="login"
          onFinish={handleLogin}
          autoComplete="off"
          size="large"
          layout="vertical"
        >
          <Form.Item
            name="username"
            label={<span className="text-[#F8FAFC] font-medium">用户名</span>}
            rules={[{ required: true, message: '请输入用户名' }]}
            className="mb-5"
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="请输入用户名"
              defaultValue="admin"
              className="h-12 transition-all duration-200"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label={<span className="text-[#F8FAFC] font-medium">密码</span>}
            rules={[{ required: true, message: '请输入密码' }]}
            className="mb-6"
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="请输入密码"
              defaultValue="123456"
              className="h-12 transition-all duration-200"
              iconRender={(visible) => (
                visible ?
                <EyeInvisibleOutlined className="text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer transition-colors" /> :
                <EyeOutlined className="text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer transition-colors" />
              )}
            />
          </Form.Item>

          <Form.Item className="mb-8">
            <Button
              type="primary"
              htmlType="submit"
              className="w-full h-12 bg-[#22C55E] hover:bg-[#16A34A] text-white font-medium text-base transition-all duration-200 shadow-lg shadow-[#22C55E]/20 hover:shadow-[#22C55E]/30 active:scale-98"
              loading={loading}
            >
              {loading ? '登录中...' : '登录'}
            </Button>
          </Form.Item>
        </Form>

        <div className="text-center text-sm text-[#64748B] bg-[#1E293B]/30 rounded-lg py-3 border border-[#334155]/30">
          <p>默认账号: <span className="text-[#94A3B8] font-mono">admin</span> / <span className="text-[#94A3B8] font-mono">123456</span></p>
        </div>
      </Card>
    </div>
    </>
  );
};

export default Login;