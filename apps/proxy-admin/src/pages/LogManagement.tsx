import { Card, Empty } from 'antd';

const LogManagement = () => {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-text-primary">日志管理</h1>
        <p className="text-xs text-text-muted">查看系统操作日志和请求日志</p>
      </div>

      <Card className="glass text-center py-12">
        <Empty description="日志功能待后续设计补充" />
      </Card>
    </div>
  );
};

export default LogManagement;
