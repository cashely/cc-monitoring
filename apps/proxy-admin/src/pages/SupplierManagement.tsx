import { Table, Button, Space, Card, Tag, Modal, Form, Input, Select, Switch, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { getSupplierList, createSupplier, Supplier } from '../services/api';
import { ColumnType } from 'antd/es/table';

const { Option } = Select;

const SupplierManagement = () => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();

  const columns: ColumnType<Supplier>[] = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '供应商名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type) => <Tag color="blue">{type}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => (
        <Tag color={status === 'active' ? 'green' : 'red'}>
          {status === 'active' ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: () => (
        <Space size="small">
          <Button type="link" icon={<EditOutlined />} size="small">
            编辑
          </Button>
          <Button type="link" danger icon={<DeleteOutlined />} size="small">
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const loadSupplierList = async () => {
    setLoading(true);
    try {
      const response = await getSupplierList();
      if (response.code === 0) {
        setSuppliers(response.data.list);
      }
    } catch (error) {
      console.error('Failed to load supplier list:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSupplier = async (values: Omit<Supplier, 'id' | 'createdAt'>) => {
    try {
      const response = await createSupplier(values);
      if (response.code === 0) {
        message.success('创建成功');
        setModalVisible(false);
        form.resetFields();
        loadSupplierList();
      }
    } catch (error) {
      console.error('Failed to create supplier:', error);
    }
  };

  useEffect(() => {
    loadSupplierList();
  }, []);

  return (
    <div>
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-text-primary">供应商管理</h1>
          <p className="text-xs text-text-muted">管理AI服务供应商配置</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
          添加供应商
        </Button>
      </div>

      <Card className="glass">
        <Table
          columns={columns}
          dataSource={suppliers}
          rowKey="id"
          loading={loading}
          bordered={false}
          size="small"
        />
      </Card>

      <Modal
        title="添加供应商"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreateSupplier}
          initialValues={{ status: 'active' }}
        >
          <Form.Item
            name="name"
            label="供应商名称"
            rules={[{ required: true, message: '请输入供应商名称' }]}
          >
            <Input placeholder="例如: OpenAI" />
          </Form.Item>

          <Form.Item
            name="type"
            label="供应商类型"
            rules={[{ required: true, message: '请选择供应商类型' }]}
          >
            <Select placeholder="请选择类型">
              <Option value="llm">大语言模型</Option>
              <Option value="embedding">嵌入模型</Option>
              <Option value="image">图像生成</Option>
              <Option value="audio">音频处理</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="status"
            label="状态"
            valuePropName="checked"
          >
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>

          <Form.Item
            name={['config', 'apiKey']}
            label="API Key"
            rules={[{ required: true, message: '请输入API Key' }]}
          >
            <Input.Password placeholder="请输入API密钥" />
          </Form.Item>

          <Form.Item
            name={['config', 'baseURL']}
            label="API地址"
          >
            <Input placeholder="请输入API基础地址，留空使用默认" />
          </Form.Item>

          <Form.Item
            name={['config', 'models']}
            label="支持模型"
            help="多个模型用英文逗号分隔"
          >
            <Input placeholder="例如: gpt-3.5-turbo,gpt-4" />
          </Form.Item>

          <Form.Item className="text-right mb-0">
            <Space>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit">创建</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SupplierManagement;
