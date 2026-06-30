import { useState } from 'react';
import { Button, Space, Typography } from 'antd';
import { formatDate } from '@cc/utils';

const { Title, Paragraph } = Typography;

function App() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: '50px', maxWidth: '800px', margin: '0 auto' }}>
      <Title level={2}>Proxy Admin 管理系统</Title>
      <Paragraph>
        当前时间：{formatDate(new Date())}
      </Paragraph>
      <Space size="large">
        <Button type="primary" onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </Button>
        <Button type="default" onClick={() => window.open('https://ant.design', '_blank')}>
          Ant Design 文档
        </Button>
      </Space>
    </div>
  );
}

export default App;