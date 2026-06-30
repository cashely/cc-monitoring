import { Card, Statistic, Row, Col } from 'antd';
import { UserOutlined, ShopOutlined, FileTextOutlined, RiseOutlined } from '@ant-design/icons';

const Dashboard = () => {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">看板</h1>
        <p className="text-gray-500">欢迎使用代理管理系统</p>
      </div>

      <Row gutter={16} className="mb-6">
        <Col span={6}>
          <Card>
            <Statistic
              title="用户总数"
              value={128}
              prefix={<UserOutlined className="text-blue-500" />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="供应商总数"
              value={8}
              prefix={<ShopOutlined className="text-green-500" />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="今日请求量"
              value={12580}
              prefix={<RiseOutlined className="text-orange-500" />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="日志总数"
              value={125800}
              prefix={<FileTextOutlined className="text-purple-500" />}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="TODO" className="text-center py-12">
        <p className="text-gray-500">看板详细内容待后续设计补充</p>
      </Card>
    </div>
  );
};

export default Dashboard;