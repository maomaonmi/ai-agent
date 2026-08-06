import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { http, setToken } from '../main';

// ==================== 样式常量 ====================

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '20px',
    position: 'relative',
    overflow: 'hidden',
  },
  // 背景装饰圆
  bgCircle1: {
    position: 'absolute',
    width: '400px',
    height: '400px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.06)',
    top: '-100px',
    right: '-100px',
  },
  bgCircle2: {
    position: 'absolute',
    width: '300px',
    height: '300px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.04)',
    bottom: '-80px',
    left: '-80px',
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    background: '#fff',
    borderRadius: '20px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
    padding: '48px 40px 40px',
    position: 'relative',
    zIndex: 1,
    animation: 'slideUp 0.5s ease-out',
  },
  logoArea: {
    textAlign: 'center',
    marginBottom: '36px',
  },
  logoIcon: {
    width: '64px',
    height: '64px',
    borderRadius: '16px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '16px',
    boxShadow: '0 8px 24px rgba(102,126,234,0.35)',
  },
  logoText: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#1a1a2e',
    margin: 0,
    letterSpacing: '-0.5px',
  },
  logoSubtext: {
    fontSize: '14px',
    color: '#8e8ea0',
    marginTop: '6px',
  },
  formGroup: {
    marginBottom: '20px',
  },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '600',
    color: '#4a4a68',
    marginBottom: '8px',
    letterSpacing: '0.3px',
  },
  inputWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: '14px',
    color: '#b0b0c8',
    fontSize: '16px',
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'center',
  },
  input: {
    width: '100%',
    height: '48px',
    padding: '0 14px 0 42px',
    border: '2px solid #e8e8f0',
    borderRadius: '12px',
    fontSize: '15px',
    color: '#1a1a2e',
    background: '#fafafe',
    outline: 'none',
    transition: 'all 0.25s ease',
    boxSizing: 'border-box',
  },
  inputFocus: {
    borderColor: '#667eea',
    background: '#fff',
    boxShadow: '0 0 0 4px rgba(102,126,234,0.1)',
  },
  inputError: {
    borderColor: '#ff6b6b',
    background: '#fff5f5',
  },
  togglePassword: {
    position: 'absolute',
    right: '14px',
    background: 'none',
    border: 'none',
    color: '#b0b0c8',
    cursor: 'pointer',
    fontSize: '16px',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    transition: 'color 0.2s',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '28px',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    color: '#6b6b80',
    cursor: 'pointer',
    userSelect: 'none',
  },
  checkbox: {
    width: '18px',
    height: '18px',
    accentColor: '#667eea',
    cursor: 'pointer',
  },
  forgotLink: {
    fontSize: '13px',
    color: '#667eea',
    textDecoration: 'none',
    fontWeight: '500',
    transition: 'color 0.2s',
  },
  submitBtn: {
    width: '100%',
    height: '50px',
    border: 'none',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: '#fff',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    boxShadow: '0 4px 16px rgba(102,126,234,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    letterSpacing: '0.5px',
  },
  submitBtnDisabled: {
    opacity: '0.7',
    cursor: 'not-allowed',
  },
  submitBtnHover: {
    transform: 'translateY(-1px)',
    boxShadow: '0 6px 24px rgba(102,126,234,0.45)',
  },
  spinner: {
    width: '20px',
    height: '20px',
    border: '2.5px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
  errorBox: {
    background: '#fff5f5',
    border: '1px solid #ffd6d6',
    borderRadius: '10px',
    padding: '12px 16px',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '13px',
    color: '#d63031',
    animation: 'shake 0.4s ease',
  },
  errorIcon: {
    fontSize: '18px',
    flexShrink: 0,
  },
  footer: {
    textAlign: 'center',
    marginTop: '28px',
    fontSize: '14px',
    color: '#8e8ea0',
  },
  footerLink: {
    color: '#667eea',
    textDecoration: 'none',
    fontWeight: '600',
    marginLeft: '4px',
    transition: 'color 0.2s',
  },
  fieldError: {
    fontSize: '12px',
    color: '#d63031',
    marginTop: '6px',
    paddingLeft: '2px',
  },
};

// ==================== SVG 图标组件 ====================

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

// ==================== 登录页组件 ====================

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get('redirect') || '/';

  // 表单状态
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  // 字段聚焦状态
  const [focusedField, setFocusedField] = useState(null);

  // 字段错误状态
  const [fieldErrors, setFieldErrors] = useState({});

  // 输入框引用
  const usernameRef = useRef(null);

  // 初始化：自动聚焦用户名输入框
  useEffect(() => {
    if (usernameRef.current) {
      usernameRef.current.focus();
    }
  }, []);

  // 清除字段错误
  const clearFieldError = (field) => {
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  // 表单验证
  const validate = () => {
    const errors = {};

    if (!username.trim()) {
      errors.username = '请输入用户名或手机号';
    }

    if (!password) {
      errors.password = '请输入密码';
    } else if (password.length < 6) {
      errors.password = '密码长度不能少于6位';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // 提交登录
  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError('');

    if (!validate()) return;

    setLoading(true);

    try {
      const res = await http.post('/auth/login', {
        username: username.trim(),
        password,
      });

      if (res.success && res.data) {
        // 存储 Token
        setToken(res.data.token);

        // 如果勾选记住我，额外存储用户名
        if (rememberMe) {
          localStorage.setItem('mall_remember_username', username.trim());
        } else {
          localStorage.removeItem('mall_remember_username');
        }

        // 跳转到目标页面
        navigate(decodeURIComponent(redirectUrl), { replace: true });
      }
    } catch (err) {
      // 处理不同类型的错误
      if (err.status === 401) {
        setServerError('用户名或密码错误，请重新输入');
      } else if (err.status === 403) {
        setServerError(err.message || '账户已被禁用，请联系管理员');
      } else if (err.status === 409) {
        setServerError(err.message || '登录冲突，请稍后重试');
      } else {
        setServerError(err.message || '登录失败，请稍后重试');
      }
    } finally {
      setLoading(false);
    }
  };

  // 读取记住的用户名
  useEffect(() => {
    const saved = localStorage.getItem('mall_remember_username');
    if (saved) {
      setUsername(saved);
      setRememberMe(true);
    }
  }, []);

  // 获取输入框样式
  const getInputStyle = (fieldName) => {
    let base = { ...styles.input };
    if (focusedField === fieldName) {
      base = { ...base, ...styles.inputFocus };
    }
    if (fieldErrors[fieldName]) {
      base = { ...base, ...styles.inputError };
    }
    return base;
  };

  return (
    <div style={styles.page}>
      {/* 背景装饰 */}
      <div style={styles.bgCircle1} />
      <div style={styles.bgCircle2} />

      {/* 全局动画样式 */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
      `}</style>

      {/* 登录卡片 */}
      <div style={styles.card}>
        {/* Logo 区域 */}
        <div style={styles.logoArea}>
          <div style={styles.logoIcon}>
            <StoreIcon />
          </div>
          <h1 style={styles.logoText}>欢迎回来</h1>
          <p style={styles.logoSubtext}>登录您的账户，畅享购物体验</p>
        </div>

        {/* 服务器错误提示 */}
        {serverError && (
          <div style={styles.errorBox}>
            <span style={styles.errorIcon}><AlertIcon /></span>
            <span>{serverError}</span>
          </div>
        )}

        {/* 登录表单 */}
        <form onSubmit={handleSubmit} noValidate>
          {/* 用户名 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>用户名 / 手机号</label>
            <div style={styles.inputWrapper}>
              <span style={styles.inputIcon}><UserIcon /></span>
              <input
                ref={usernameRef}
                type="text"
                placeholder="请输入用户名或手机号"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  clearFieldError('username');
                  setServerError('');
                }}
                onFocus={() => setFocusedField('username')}
                onBlur={() => setFocusedField(null)}
                style={getInputStyle('username')}
                autoComplete="username"
                disabled={loading}
              />
            </div>
            {fieldErrors.username && (
              <div style={styles.fieldError}>{fieldErrors.username}</div>
            )}
          </div>

          {/* 密码 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>密码</label>
            <div style={styles.inputWrapper}>
              <span style={styles.inputIcon}><LockIcon /></span>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="请输入密码"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearFieldError('password');
                  setServerError('');
                }}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                style={getInputStyle('password')}
                autoComplete="current-password"
                disabled={loading}
              />
              <button
                type="button"
                style={styles.togglePassword}
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                onMouseEnter={(e) => (e.target.style.color = '#667eea')}
                onMouseLeave={(e) => (e.target.style.color = '#b0b0c8')}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            {fieldErrors.password && (
              <div style={styles.fieldError}>{fieldErrors.password}</div>
            )}
          </div>

          {/* 记住我 & 忘记密码 */}
          <div style={styles.row}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                style={styles.checkbox}
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={loading}
              />
              记住我
            </label>
            <a href="#" style={styles.forgotLink}
              onMouseEnter={(e) => (e.target.style.color = '#764ba2')}
              onMouseLeave={(e) => (e.target.style.color = '#667eea')}
            >
              忘记密码？
            </a>
          </div>

          {/* 登录按钮 */}
          <button
            type="submit"
            style={{
              ...styles.submitBtn,
              ...(loading ? styles.submitBtnDisabled : {}),
            }}
            disabled={loading}
            onMouseEnter={(e) => {
              if (!loading) e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {loading && <div style={styles.spinner} />}
            {loading ? '登录中...' : '登 录'}
          </button>
        </form>

        {/* 底部注册链接 */}
        <div style={styles.footer}>
          还没有账户？
          <Link
            to={redirectUrl !== '/' ? `/register?redirect=${redirectUrl}` : '/register'}
            style={styles.footerLink}
            onMouseEnter={(e) => (e.target.style.color = '#764ba2')}
            onMouseLeave={(e) => (e.target.style.color = '#667eea')}
          >
            立即注册
          </Link>
        </div>
      </div>
    </div>
  );
}
