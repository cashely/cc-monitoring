import { Table, Button, Space, Card, Modal, Form, Input, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { getUserList, createUser } from '../services/api';
import { UserInfo } from '../types/auth';
import { ColumnType } from 'antd/es/table';

const UserManagement = () => {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();

  const columns: ColumnType<UserInfo>[] = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '昵称',
      dataIndex: 'nickname',
      key: 'nickname',
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
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

  const loadUserList = async () => {
    setLoading(true);
    try {
      const response = await getUserList();
      if (response.code === 0) {
        setUsers(response.data.list);
      }
    } catch (error) {
      console.error('Failed to load user list:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (values: Omit<UserInfo, 'id'>) => {
    try {
      const response = await createUser(values);
      if (response.code === 0) {
        message.success('创建成功');
        setModalVisible(false);
        form.resetFields();
        loadUserList();
      }
    } catch (error) {
      console.error('Failed to create user:', error);
    }
  };

  useEffect(() => {
    loadUserList();
  }, []);

  return (
    <div>
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-text-primary">用户管理</h1>
          <p className="text-xs text-text-muted">管理系统用户账号</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
          创建用户
        </Button>
      </div>

      <Card className="glass">
        <Table
          columns={columns}
          dataSource={users}
          rowKey="id"
          loading={loading}
          bordered={false}
          size="small"
        />
      </Card>

      <Modal
        title="创建用户"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreateUser}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>

          <Form.Item
            name="nickname"
            label="昵称"
            rules={[{ required: true, message: '请输入昵称' }]}
          >
            <Input placeholder="请输入昵称" />
          </Form.Item>

          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' }
            ]}
          >
            <Input placeholder="请输入邮箱" />
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

export default UserManagement;
