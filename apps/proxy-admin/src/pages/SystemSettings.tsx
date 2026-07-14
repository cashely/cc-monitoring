import { Card, Form, Input, InputNumber, Switch, Button, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { getSystemSettings, saveSystemSettings } from '../services/api';
import type { SystemSettings } from '../services/api';

const SystemSettings = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const response = await getSystemSettings();
      if (response.code === 0) {
        form.setFieldsValue(response.data);
      }
    } catch (error) {
      console.error('Failed to load system settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (values: SystemSettings) => {
    setSaving(true);
    try {
      const response = await saveSystemSettings(values);
      if (response.code === 0) {
        message.success('保存成功');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  return (
    <div>
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-text-primary">系统设置</h1>
          <p className="text-xs text-text-muted">配置系统基础参数</p>
        </div>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={() => form.submit()}
          loading={saving}
        >
          保存设置
        </Button>
      </div>

      <Card className="glass" loading={loading}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          className="max-w-2xl"
        >
          <Form.Item
            name="siteName"
            label="站点名称"
            rules={[{ required: true, message: '请输入站点名称' }]}
          >
            <Input placeholder="请输入站点名称" />
          </Form.Item>

          <Form.Item
            name="siteDescription"
            label="站点描述"
          >
            <Input.TextArea rows={3} placeholder="请输入站点描述" />
          </Form.Item>

          <Form.Item
            name="maxUploadSize"
            label="最大上传大小 (MB)"
            rules={[{ required: true, message: '请输入最大上传大小' }]}
          >
            <InputNumber min={1} max={1024} className="w-full" />
          </Form.Item>

          <Form.Item
            name="enableRegistration"
            label="开放注册"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default SystemSettings;
