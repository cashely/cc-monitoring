import { Form, Input, Button, Card, message } from 'antd'
import {
  UserOutlined,
  LockOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { login as loginApi } from '../services/api'
import { LoginParams } from '../types/auth'
import { useState } from 'react'

const Login = () => {
  const [form] = Form.useForm()
  const navigate = useNavigate()
  const { login } = useAuth()
  const [loading, setLoading] = useState(false)

  const handleLogin = async (values: LoginParams) => {
    setLoading(true)
    try {
      const response = await loginApi(values)
      if (response.code === 0) {
        const { token, user } = response.data
        login(token, user)
        message.success('登录成功')
        navigate('/dashboard')
      }
    } catch (error) {
      console.error('Login failed:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <style>{`
        .ant-card {
          background-color: rgba(15, 23, 42, 0.4) !important;
          backdrop-filter: blur(24px) !important;
          border-color: rgba(148, 163, 184, 0.2) !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.05),
            0 0 40px rgba(59, 130, 246, 0.05),
            0 8px 32px rgba(0, 0, 0, 0.2) !important;
          animation: pulse-glass 6s ease-in-out infinite !important;
          transition: all 0.3s ease !important;
        }

        .ant-card:hover {
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.07),
            0 0 60px rgba(59, 130, 246, 0.12),
            0 8px 32px rgba(0, 0, 0, 0.25) !important;
        }

        @keyframes pulse-glass {
          0%, 100% {
            background-color: rgba(15, 23, 42, 0.38);
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.05),
              0 0 40px rgba(59, 130, 246, 0.05),
              0 8px 32px rgba(0, 0, 0, 0.2);
          }
          50% {
            background-color: rgba(15, 23, 42, 0.45);
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.07),
              0 0 50px rgba(59, 130, 246, 0.1),
              0 8px 32px rgba(0, 0, 0, 0.25);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .ant-card {
            animation: none !important;
          }
        }

        .ant-input-affix-wrapper {
          background-color: rgba(30, 41, 59, 0.4) !important;
          border-color: rgba(148, 163, 184, 0.2) !important;
          backdrop-filter: blur(4px) !important;
          transition: all 0.2s ease !important;
          padding-inline: 11px !important;
        }
        .ant-input-affix-wrapper:hover {
          background-color: rgba(30, 41, 59, 0.4) !important;
          border-color: rgba(148, 163, 184, 0.3) !important;
        }
        .ant-input-affix-wrapper-focused,
        .ant-input-affix-wrapper:focus,
        .ant-input-affix-wrapper:active {
          background-color: rgba(30, 41, 59, 0.4) !important;
          border-color: #3B82F6 !important;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2) !important;
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
          color: #94A3B8 !important;
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
      `}</style>

      <div className="min-h-dvh bg-bg-primary flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-bg-secondary/40 via-transparent to-accent/10 pointer-events-none" />

        <div className="ambient-blob blob-1" style={{ top: '25%', left: '-4rem' }} />
        <div className="ambient-blob blob-2" style={{ bottom: '25%', right: '-4rem' }} />

        <Card className="w-full max-w-md glass" styles={{ body: { padding: '2.5rem' } }}>
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-secondary/10 rounded-full mb-4">
              <LockOutlined className="text-2xl text-secondary" />
            </div>
            <h1 className="text-3xl font-bold text-text-primary mb-2 tracking-tight">
              <span className="text-secondary">Proxy</span>
              <span className="text-accent">Admin</span>
            </h1>
            <p className="text-text-muted text-sm">欢迎登录管理系统</p>
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
              label={<span className="text-text-primary font-medium">用户名</span>}
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
              label={<span className="text-text-primary font-medium">密码</span>}
              rules={[{ required: true, message: '请输入密码' }]}
              className="mb-6"
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="请输入密码"
                defaultValue="123456"
                className="h-12 transition-all duration-200"
                iconRender={(visible) =>
                  visible ? (
                    <EyeInvisibleOutlined className="text-text-muted hover:text-text-primary cursor-pointer transition-colors" />
                  ) : (
                    <EyeOutlined className="text-text-muted hover:text-text-primary cursor-pointer transition-colors" />
                  )
                }
              />
            </Form.Item>

            <Form.Item className="mb-8">
              <Button
                type="primary"
                htmlType="submit"
                className="w-full h-12 bg-secondary hover:bg-primary text-white font-medium text-sm transition-all duration-200 shadow-lg shadow-secondary/20 hover:shadow-secondary/30 active:scale-98"
                loading={loading}
              >
                {loading ? '登录中...' : '登录'}
              </Button>
            </Form.Item>
          </Form>

          <div className="text-center text-sm text-text-muted bg-bg-card/30 rounded-lg py-3 border border-border">
            <p>
              默认账号: <span className="text-text-secondary font-mono">admin</span> /{' '}
              <span className="text-text-secondary font-mono">123456</span>
            </p>
          </div>
        </Card>
      </div>
    </>
  )
}

export default Login
