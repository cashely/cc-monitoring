import { Card, Statistic, Row, Col, ConfigProvider, theme } from 'antd'
import { UserOutlined, ShopOutlined, FileTextOutlined, RiseOutlined } from '@ant-design/icons'

const Dashboard = () => {
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
          borderRadius: 12,
          fontSize: 12,
        },
      }}
    >
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">看板</h1>
          <p className="text-text-muted">欢迎使用代理管理系统</p>
        </div>

        <Row gutter={16} className="mb-6">
          <Col span={6}>
            <Card className="glass">
              <Statistic
                title="用户总数"
                value={128}
                prefix={<UserOutlined className="text-secondary" />}
                valueStyle={{ color: '#3B82F6' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card className="glass">
              <Statistic
                title="供应商总数"
                value={8}
                prefix={<ShopOutlined className="text-success" />}
                valueStyle={{ color: '#10B981' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card className="glass">
              <Statistic
                title="今日请求量"
                value={12580}
                prefix={<RiseOutlined className="text-warning" />}
                valueStyle={{ color: '#F59E0B' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card className="glass">
              <Statistic
                title="日志总数"
                value={125800}
                prefix={<FileTextOutlined className="text-info" />}
                valueStyle={{ color: '#06B6D4' }}
              />
            </Card>
          </Col>
        </Row>

        <Card title="TODO" className="glass text-center py-12">
          <p className="text-text-muted">看板详细内容待后续设计补充</p>
        </Card>
      </div>
    </ConfigProvider>
  )
}

export default Dashboard
