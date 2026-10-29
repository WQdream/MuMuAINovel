import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Space,
  Spin,
  Tabs,
  Typography,
  message,
  theme,
} from 'antd';
import {
  KeyOutlined,
  LockOutlined,
  MailOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { authApi } from '../services/api';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ThemeSwitch from '../components/ThemeSwitch';
import BrandMark from '../components/BrandMark';
import { BRAND_COPYRIGHT } from '../config/brand';

const { Title, Text } = Typography;

interface AuthConfig {
  local_auth_enabled: boolean;
  email_auth_enabled: boolean;
  email_login_enabled: boolean;
  email_register_enabled: boolean;
}

interface LocalLoginValues {
  username: string;
  password: string;
}

interface LocalRegisterValues {
  username: string;
  password: string;
  confirmPassword: string;
  invite_code: string;
}

interface EmailLoginValues {
  email: string;
  code: string;
}

interface EmailRegisterValues {
  email: string;
  code: string;
  password: string;
  confirmPassword: string;
  display_name?: string;
}

interface ResetPasswordValues {
  email: string;
  code: string;
  new_password: string;
  confirmNewPassword: string;
}

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authConfig, setAuthConfig] = useState<AuthConfig>({
    local_auth_enabled: false,
    email_auth_enabled: false,
    email_login_enabled: false,
    email_register_enabled: false,
  });
  const [localForm] = Form.useForm<LocalLoginValues>();
  const [localRegisterForm] = Form.useForm<LocalRegisterValues>();
  const [emailLoginForm] = Form.useForm<EmailLoginValues>();
  const [emailRegisterForm] = Form.useForm<EmailRegisterValues>();
  const [resetPasswordForm] = Form.useForm<ResetPasswordValues>();
  const { token } = theme.useToken();
  const [loginCodeSending, setLoginCodeSending] = useState(false);
  const [registerCodeSending, setRegisterCodeSending] = useState(false);
  const [resetCodeSending, setResetCodeSending] = useState(false);
  const [loginCountdown, setLoginCountdown] = useState(0);
  const [registerCountdown, setRegisterCountdown] = useState(0);
  const [resetCountdown, setResetCountdown] = useState(0);
  const [showResetPassword, setShowResetPassword] = useState(false);

  const localAuthEnabled = authConfig.local_auth_enabled;
  const emailAuthEnabled = authConfig.email_auth_enabled;
  const emailLoginEnabled = emailAuthEnabled && authConfig.email_login_enabled;
  const emailRegisterEnabled = emailAuthEnabled && authConfig.email_register_enabled;

  useEffect(() => {
    const timers = [
      { value: loginCountdown, setter: setLoginCountdown },
      { value: registerCountdown, setter: setRegisterCountdown },
      { value: resetCountdown, setter: setResetCountdown },
    ].map(({ value, setter }) => {
      if (value <= 0) {
        return null;
      }

      return window.setInterval(() => {
        setter((prev) => {
          if (prev <= 1) {
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    });

    return () => {
      timers.forEach((timer) => {
        if (timer) {
          window.clearInterval(timer);
        }
      });
    };
  }, [loginCountdown, registerCountdown, resetCountdown]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        await authApi.getCurrentUser();
        const redirect = searchParams.get('redirect') || '/';
        navigate(redirect);
      } catch {
        try {
          const config = await authApi.getAuthConfig();
          setAuthConfig(config);
        } catch (error) {
          console.error('获取认证配置失败:', error);
          setAuthConfig({
            local_auth_enabled: false,
            email_auth_enabled: false,
            email_login_enabled: false,
            email_register_enabled: false,
          });
        }
        setChecking(false);
      }
    };
    checkAuth();
  }, [navigate, searchParams]);

  const handleLoginSuccess = () => {
    message.success('登录成功！');
    navigate(searchParams.get('redirect') || '/');
  };

  const handleLocalLogin = async (values: LocalLoginValues) => {
    try {
      setLoading(true);
      const response = await authApi.localLogin(values.username, values.password);
      if (response.success) {
        handleLoginSuccess();
      }
    } catch (error) {
      console.error('本地登录失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLocalRegister = async (values: LocalRegisterValues) => {
    try {
      setLoading(true);
      const response = await authApi.registerLocal({
        username: values.username.trim(),
        password: values.password,
        invite_code: values.invite_code.trim(),
      });
      if (response.success) {
        message.success('注册成功，已自动登录');
        localRegisterForm.resetFields();
        handleLoginSuccess();
      }
    } catch (error) {
      console.error('邀请码注册失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (values: EmailLoginValues) => {
    try {
      setLoading(true);
      const response = await authApi.emailLogin({
        email: values.email,
        code: values.code,
      });
      if (response.success) {
        handleLoginSuccess();
      }
    } catch (error) {
      console.error('邮箱验证码登录失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const sendLoginCode = async () => {
    try {
      const values = await emailLoginForm.validateFields(['email']);
      setLoginCodeSending(true);
      const result = await authApi.sendEmailCode({ email: values.email, scene: 'login' });
      message.success(result.message || '验证码已发送');
      setLoginCountdown(result.resend_interval_seconds || 60);
    } catch (error) {
      console.error('发送 login 验证码失败:', error);
    } finally {
      setLoginCodeSending(false);
    }
  };

  const sendRegisterCode = async () => {
    try {
      const values = await emailRegisterForm.validateFields(['email']);
      setRegisterCodeSending(true);
      const result = await authApi.sendEmailCode({ email: values.email, scene: 'register' });
      message.success(result.message || '验证码已发送');
      setRegisterCountdown(result.resend_interval_seconds || 60);
    } catch (error) {
      console.error('发送 register 验证码失败:', error);
    } finally {
      setRegisterCodeSending(false);
    }
  };

  const sendResetCode = async () => {
    try {
      const values = await resetPasswordForm.validateFields(['email']);
      setResetCodeSending(true);
      const result = await authApi.sendEmailCode({ email: values.email, scene: 'reset_password' });
      message.success(result.message || '验证码已发送');
      setResetCountdown(result.resend_interval_seconds || 60);
    } catch (error) {
      console.error('发送 reset_password 验证码失败:', error);
    } finally {
      setResetCodeSending(false);
    }
  };

  const handleEmailRegister = async (values: EmailRegisterValues) => {
    try {
      setLoading(true);
      const response = await authApi.emailRegister({
        email: values.email,
        code: values.code,
        password: values.password,
        display_name: values.display_name?.trim() || undefined,
      });
      if (response.success) {
        message.success('注册成功，已自动登录');
        emailRegisterForm.resetFields(['code', 'password', 'confirmPassword']);
        setRegisterCountdown(0);
        handleLoginSuccess();
      }
    } catch (error) {
      console.error('邮箱注册失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (values: ResetPasswordValues) => {
    try {
      setLoading(true);
      const result = await authApi.resetEmailPassword({
        email: values.email,
        code: values.code,
        new_password: values.new_password,
      });
      message.success(result.message || '密码重置成功');
      resetPasswordForm.resetFields(['code', 'new_password', 'confirmNewPassword']);
      setResetCountdown(0);
      setShowResetPassword(false);
    } catch (error) {
      console.error('重置密码失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loginTip = localAuthEnabled
    ? '账号可通过管理员发放的邀请码注册；请勿在公共设备保存密码。'
    : emailLoginEnabled
      ? '忘记密码可使用邮箱验证码重置。'
      : '';

  const renderLocalLogin = () => (
    <>
      <Form
        form={localForm}
        layout="vertical"
        onFinish={handleLocalLogin}
        size="large"
        style={{ marginTop: 16 }}
      >
        <Form.Item
          name="username"
          label="账号"
          rules={[{ required: true, message: '请输入账号' }]}
        >
          <Input
            prefix={<UserOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder="请输入账号"
            autoComplete="username"
            style={{ height: 46, borderRadius: 4 }}
          />
        </Form.Item>
        <Form.Item
          name="password"
          label="登录密码"
          rules={[{ required: true, message: '请输入登录密码' }]}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder="请输入登录密码"
            autoComplete="current-password"
            style={{ height: 46, borderRadius: 4 }}
          />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            block
            style={{
              height: 46,
              fontSize: 16,
              fontWeight: 600,
              background: token.colorPrimary,
              border: 'none',
              borderRadius: 4,
            }}
          >
            进入创作台
          </Button>
        </Form.Item>
      </Form>
    </>
  );

  const renderLocalRegister = () => (
    <Form
      form={localRegisterForm}
      layout="vertical"
      onFinish={handleLocalRegister}
      size="large"
      style={{ marginTop: 16 }}
    >
      <Form.Item
        name="username"
        label="账号"
        rules={[
          { required: true, message: '请输入账号' },
          { min: 3, max: 32, message: '账号长度应为 3 到 32 个字符' },
          { pattern: /^[A-Za-z0-9_]+$/, message: '账号只能包含字母、数字和下划线' },
        ]}
      >
        <Input
          prefix={<UserOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="设置登录账号"
          autoComplete="username"
          style={{ height: 46, borderRadius: 4 }}
        />
      </Form.Item>

      <Form.Item
        name="password"
        label="密码"
        rules={[
          { required: true, message: '请输入密码' },
          { min: 6, message: '密码长度至少为 6 个字符' },
          { max: 128, message: '密码长度不能超过 128 个字符' },
        ]}
      >
        <Input.Password
          prefix={<LockOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="设置登录密码"
          autoComplete="new-password"
          style={{ height: 46, borderRadius: 4 }}
        />
      </Form.Item>

      <Form.Item
        name="confirmPassword"
        label="确认密码"
        dependencies={['password']}
        rules={[
          { required: true, message: '请再次输入密码' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) {
                return Promise.resolve();
              }
              return Promise.reject(new Error('两次输入的密码不一致'));
            },
          }),
        ]}
      >
        <Input.Password
          prefix={<LockOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="请再次输入密码"
          autoComplete="new-password"
          style={{ height: 46, borderRadius: 4 }}
        />
      </Form.Item>

      <Form.Item
        name="invite_code"
        label="邀请码"
        rules={[{ required: true, message: '请输入邀请码' }]}
      >
        <Input
          prefix={<KeyOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="请输入管理员发放的邀请码"
          autoComplete="off"
          style={{ height: 46, borderRadius: 4, textTransform: 'uppercase' }}
        />
      </Form.Item>

      <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
        <Button
          type="primary"
          htmlType="submit"
          loading={loading}
          block
          style={{
            height: 46,
            fontSize: 16,
            fontWeight: 600,
            background: token.colorPrimary,
            border: 'none',
            borderRadius: 4,
          }}
        >
          注册并登录
        </Button>
      </Form.Item>

      <Text type="secondary" style={{ marginTop: 12, display: 'block' }}>
        每个邀请码仅可使用一次。注册成功后将创建平台用户账号，并自动进入创作台。
      </Text>
    </Form>
  );

  const renderEmailLogin = () => {
    if (showResetPassword) {
      return (
        <div style={{ marginTop: 16 }}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Title level={5} style={{ margin: 0 }}>忘记密码 / 重置密码</Title>
              <Button type="link" style={{ paddingInline: 0 }} onClick={() => setShowResetPassword(false)}>
                返回验证码登录
              </Button>
            </Space>

            <Card size="small" bordered={false} style={{ borderRadius: 4, background: token.colorFillAlter }}>
              <Form
                form={resetPasswordForm}
                layout="vertical"
                onFinish={handleResetPassword}
                size="middle"
              >
                <Form.Item
                  name="email"
                  label="注册邮箱"
                  rules={[
                    { required: true, message: '请输入注册邮箱' },
                    { type: 'email', message: '请输入有效的邮箱地址' },
                  ]}
                >
                  <Input prefix={<MailOutlined />} placeholder="请输入注册邮箱" />
                </Form.Item>
                <Form.Item label="重置验证码" required style={{ marginBottom: 12 }}>
                  <Space.Compact style={{ width: '100%' }}>
                    <Form.Item
                      name="code"
                      noStyle
                      rules={[
                        { required: true, message: '请输入重置验证码' },
                        { len: 6, message: '验证码长度为 6 位' },
                      ]}
                    >
                      <Input placeholder="请输入重置验证码" maxLength={6} />
                    </Form.Item>
                    <Button
                      onClick={sendResetCode}
                      loading={resetCodeSending}
                      disabled={resetCountdown > 0}
                    >
                      {resetCountdown > 0 ? `${resetCountdown}s 后重发` : '发送验证码'}
                    </Button>
                  </Space.Compact>
                </Form.Item>
                <Form.Item
                  name="new_password"
                  label="新密码"
                  rules={[
                    { required: true, message: '请输入新密码' },
                    { min: 6, message: '密码长度至少为 6 个字符' },
                  ]}
                >
                  <Input.Password prefix={<LockOutlined />} placeholder="请输入新密码" />
                </Form.Item>
                <Form.Item
                  name="confirmNewPassword"
                  label="确认新密码"
                  dependencies={['new_password']}
                  rules={[
                    { required: true, message: '请再次输入新密码' },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        if (!value || getFieldValue('new_password') === value) {
                          return Promise.resolve();
                        }
                        return Promise.reject(new Error('两次输入的新密码不一致'));
                      },
                    }),
                  ]}
                >
                  <Input.Password prefix={<LockOutlined />} placeholder="请再次输入新密码" />
                </Form.Item>
                <Button type="default" htmlType="submit" loading={loading} block>
                  重置密码
                </Button>
              </Form>
            </Card>
          </Space>
        </div>
      );
    }

    return (
      <Form
        form={emailLoginForm}
        layout="vertical"
        onFinish={handleEmailLogin}
        size="large"
        style={{ marginTop: 16 }}
      >
        <Form.Item
          name="email"
          label="邮箱地址"
          rules={[
            { required: true, message: '请输入邮箱地址' },
            { type: 'email', message: '请输入有效的邮箱地址' },
          ]}
        >
          <Input
            prefix={<MailOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder="请输入已注册邮箱"
            autoComplete="email"
            style={{ height: 46, borderRadius: 4 }}
          />
        </Form.Item>

        <Form.Item label="登录验证码" required style={{ marginBottom: 24 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item
              name="code"
              noStyle
              rules={[
                { required: true, message: '请输入登录验证码' },
                { len: 6, message: '验证码长度为 6 位' },
              ]}
            >
              <Input
                prefix={<SafetyCertificateOutlined style={{ color: token.colorTextTertiary }} />}
                placeholder="请输入 6 位登录验证码"
                maxLength={6}
                style={{ height: 46, borderRadius: '4px 0 0 4px' }}
              />
            </Form.Item>
            <Button
              style={{ height: 46 }}
              onClick={sendLoginCode}
              loading={loginCodeSending}
              disabled={loginCountdown > 0}
            >
              {loginCountdown > 0 ? `${loginCountdown}s 后重发` : '发送验证码'}
            </Button>
          </Space.Compact>
        </Form.Item>

        <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            block
            style={{
              height: 46,
              fontSize: 16,
              fontWeight: 600,
              background: token.colorPrimary,
              border: 'none',
              borderRadius: 4,
            }}
          >
            验证码登录
          </Button>
        </Form.Item>

        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <Button type="link" style={{ paddingInline: 0 }} onClick={() => setShowResetPassword(true)}>
            忘记密码？点击重置
          </Button>
        </div>
      </Form>
    );
  };

  const renderEmailRegister = () => (
    <Form
      form={emailRegisterForm}
      layout="vertical"
      onFinish={handleEmailRegister}
      size="large"
      style={{ marginTop: 16 }}
    >
      <Form.Item
        name="email"
        label="注册邮箱"
        rules={[
          { required: true, message: '请输入注册邮箱' },
          { type: 'email', message: '请输入有效的邮箱地址' },
        ]}
      >
        <Input
          prefix={<MailOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="请输入注册邮箱"
          autoComplete="email"
          style={{ height: 46, borderRadius: 4 }}
        />
      </Form.Item>

      <Form.Item label="邮箱验证码" required style={{ marginBottom: 12 }}>
        <Space.Compact style={{ width: '100%' }}>
          <Form.Item
            name="code"
            noStyle
            rules={[
              { required: true, message: '请输入邮箱验证码' },
              { len: 6, message: '验证码长度为 6 位' },
            ]}
          >
            <Input
              prefix={<SafetyCertificateOutlined style={{ color: token.colorTextTertiary }} />}
              placeholder="请输入 6 位验证码"
              maxLength={6}
              style={{ height: 46, borderRadius: '4px 0 0 4px' }}
            />
          </Form.Item>
          <Button
            style={{ height: 46 }}
            onClick={sendRegisterCode}
            loading={registerCodeSending}
            disabled={registerCountdown > 0}
          >
            {registerCountdown > 0 ? `${registerCountdown}s 后重发` : '发送验证码'}
          </Button>
        </Space.Compact>
      </Form.Item>

      <Form.Item
        name="display_name"
        label="昵称"
        rules={[{ max: 50, message: '昵称长度不能超过 50 个字符' }]}
      >
        <Input
          prefix={<UserOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="选填，默认使用邮箱前缀"
          autoComplete="nickname"
          style={{ height: 46, borderRadius: 4 }}
        />
      </Form.Item>

      <Form.Item
        name="password"
        label="登录密码"
        rules={[
          { required: true, message: '请输入登录密码' },
          { min: 6, message: '密码长度至少为 6 个字符' },
        ]}
      >
        <Input.Password
          prefix={<LockOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="请输入登录密码"
          autoComplete="new-password"
          style={{ height: 46, borderRadius: 4 }}
        />
      </Form.Item>

      <Form.Item
        name="confirmPassword"
        label="确认密码"
        dependencies={['password']}
        rules={[
          { required: true, message: '请再次输入登录密码' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) {
                return Promise.resolve();
              }
              return Promise.reject(new Error('两次输入的密码不一致'));
            },
          }),
        ]}
      >
        <Input.Password
          prefix={<LockOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="请再次输入登录密码"
          autoComplete="new-password"
          style={{ height: 46, borderRadius: 4 }}
        />
      </Form.Item>

      <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
        <Button
          type="primary"
          htmlType="submit"
          loading={loading}
          block
          style={{
            height: 46,
            fontSize: 16,
            fontWeight: 600,
            background: token.colorPrimary,
            border: 'none',
            borderRadius: 4,
          }}
        >
          注册并登录
        </Button>
      </Form.Item>

      <Text type="secondary" style={{ marginTop: 12, display: 'block' }}>
        {emailLoginEnabled
          ? '验证码将发送到你填写的邮箱，若未收到请检查垃圾箱或稍后重试。注册后可通过邮箱验证码登录，也支持邮箱重置密码。'
          : '验证码将发送到你填写的邮箱，注册成功后会自动进入创作台。当前邮箱登录入口暂未开放。'}
      </Text>
    </Form>
  );

  const authTabs = [
    ...(localAuthEnabled
      ? [
          {
            key: 'local-login',
            label: '登录',
            children: renderLocalLogin(),
          },
          {
            key: 'local-register',
            label: '注册',
            children: renderLocalRegister(),
          },
        ]
      : []),
    ...(emailLoginEnabled
      ? [
          {
            key: 'email-login',
            label: '邮箱登录',
            children: renderEmailLogin(),
          },
        ]
      : []),
    ...(emailRegisterEnabled
      ? [
          {
            key: 'email-register',
            label: '邮箱注册',
            children: renderEmailRegister(),
          },
        ]
      : []),
  ];

  if (checking) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background: token.colorBgLayout,
        }}
      >
        <Spin size="large" style={{ color: token.colorPrimary }} />
      </div>
    );
  }

  return (
    <div className="lux-login">
      <section className="lux-login-stage" aria-hidden="false">
        <div className="lux-login-mark-row">
          <BrandMark size={32} textSize={16} color="var(--editorial-ink)" />
        </div>

        <div className="lux-login-stage-content">
          <div className="lux-login-hero">
            <h1 className="lux-login-title">
              把灵感
              <br />
              <em>写成故事</em>
            </h1>
            <div className="lux-login-rule" />
            <p className="lux-login-lead">
              人物、章节与伏笔，都在同一张书桌上。
            </p>
          </div>

          <div className="lux-login-desk">
            <article className="lux-login-manuscript" aria-label="创作稿纸示意">
              <div className="lux-login-manuscript-head">
                <span>CHAPTER 03</span>
                <span>草稿</span>
              </div>
              <h2>雨落在旧站台</h2>
              <p>
                林晚把那张蓝色车票压进书页，决定再等最后一班车。
              </p>
            </article>
          </div>
        </div>

        <div className="lux-login-copyright">{BRAND_COPYRIGHT}</div>
      </section>

      <section className="lux-login-panel">
        <div className="lux-login-theme">
          <ThemeSwitch size="small" />
        </div>

        <div className="lux-login-form">
          <div className="lux-login-mobile-brand">
            <BrandMark size={31} textSize={16} />
            <span>小说创作工作台</span>
          </div>
          <h2 className="lux-login-form-title">欢迎回来</h2>

          <div style={{ marginTop: 28 }}>
            {authTabs.length > 0 ? (
              <Tabs defaultActiveKey={authTabs[0].key} items={authTabs} />
            ) : null}

            {authTabs.length === 0 ? (
              <Alert
                type="warning"
                showIcon
                message="当前未启用可用登录方式"
                description="请联系管理员在系统配置中启用本地登录或邮箱认证。"
              />
            ) : null}

            {emailAuthEnabled && !emailLoginEnabled && emailRegisterEnabled ? (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 12 }}
                message="邮箱登录暂未开放"
                description="当前仅开放邮箱注册，注册成功后可先进入创作台。"
              />
            ) : null}

            {emailLoginEnabled && !emailRegisterEnabled ? (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 12 }}
                message="邮箱注册暂未开放"
                description="当前仅开放邮箱验证码登录与找回密码，如需注册请联系管理员。"
              />
            ) : null}

            {loginTip && (
              <div className="lux-login-note">
                <p>{loginTip}</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
