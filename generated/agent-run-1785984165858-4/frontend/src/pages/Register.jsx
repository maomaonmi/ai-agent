import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '', confirmPassword: '', email: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);

  const validate = () => {
    const errs = {};
    if (!form.username.trim()) {
      errs.username = '请输入用户名';
    } else if (form.username.trim().length < 3) {
      errs.username = '用户名至少3个字符';
    }
    if (!form.email.trim()) {
      errs.email = '请输入邮箱';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errs.email = '邮箱格式不正确';
    }
    if (!form.password) {
      errs.password = '请输入密码';
    } else if (form.password.length < 6) {
      errs.password = '密码至少6位';
    }
    if (!form.confirmPassword) {
      errs.confirmPassword = '请确认密码';
    } else if (form.password !== form.confirmPassword) {
      errs.confirmPassword = '两次密码不一致';
    }
    return errs;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError('');
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const { confirmPassword, ...body } = form;
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setServerError(data.detail || '注册失败，请稍后重试');
        return;
      }
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.dispatchEvent(new Event('auth-change'));
      navigate('/');
    } catch (err) {
      setServerError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.title}>创建账户</h1>
          <p style={styles.subtitle}>注册成为商场会员</p>
        </div>

        {serverError && <div style={styles.serverError}>{serverError}</div>}

        <form onSubmit={handleSubmit} style={styles.form} noValidate>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="reg-username">用户名</label>
            <input
              id="reg-username"
              name="username"
              type="text"
              autoComplete="username"
              placeholder="请输入用户名"
              value={form.username}
              onChange={handleChange}
              style={errors.username ? { ...styles.input, ...styles.inputError } : styles.input}
            />
            {errors.username && <span style={styles.errorText}>{errors.username}</span>}
          </div>

          <div style={styles.field}>
            <label style={styles.label} htmlFor="reg-email">邮箱</label>
            <input
              id="reg-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="请输入邮箱地址"
              value={form.email}
              onChange={handleChange}
              style={errors.email ? { ...styles.input, ...styles.inputError } : styles.input}
            />
            {errors.email && <span style={styles.errorText}>{errors.email}</span>}
          </div>

          <div style={styles.field}>
            <label style={styles.label} htmlFor="reg-password">密码</label>
            <input
              id="reg-password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="请输入密码（至少6位）"
              value={form.password}
              onChange={handleChange}
              style={errors.password ? { ...styles.input, ...styles.inputError } : styles.input}
            />
            {errors.password && <span style={styles.errorText}>{errors.password}</span>}
          </div>

          <div style={styles.field}>
            <label style={styles.label} htmlFor="reg-confirm">确认密码</label>
            <input
              id="reg-confirm"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="请再次输入密码"
              value={form.confirmPassword}
              onChange={handleChange}
              style={errors.confirmPassword ? { ...styles.input, ...styles.inputError } : styles.input}
            />
            {errors.confirmPassword && <span style={styles.errorText}>{errors.confirmPassword}</span>}
          </div>

          <button
            type="submit"
            disabled={loading}
            style={loading ? { ...styles.btn, ...styles.btnDisabled } : styles.btn}
          >
            {loading ? '注册中...' : '注 册'}
          </button>
        </form>

        <p style={styles.footer}>
          已有账户？
          <Link to="/login" style={styles.link}>立即登录</Link>
        </p>
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '24px',
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    background: '#fff',
    borderRadius: '16px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
    padding: '40px 36px 32px',
  },
  header: {
    textAlign: 'center',
    marginBottom: '28px',
  },
  title: {
    margin: '0 0 8px',
    fontSize: '28px',
    fontWeight: '700',
    color: '#1a1a2e',
  },
  subtitle: {
    margin: '0',
    fontSize: '14px',
    color: '#888',
  },
  serverError: {
    background: '#fff2f0',
    border: '1px solid #ffccc7',
    color: '#cf1322',
    borderRadius: '8px',
    padding: '10px 14px',
    fontSize: '13px',
    marginBottom: '20px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#333',
  },
  input: {
    height: '44px',
    padding: '0 14px',
    fontSize: '14px',
    border: '1.5px solid #d9d9d9',
    borderRadius: '10px',
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    boxSizing: 'border-box',
  },
  inputError: {
    borderColor: '#ff4d4f',
    boxShadow: '0 0 0 2px rgba(255,77,79,0.1)',
  },
  errorText: {
    fontSize: '12px',
    color: '#ff4d4f',
  },
  btn: {
    height: '46px',
    marginTop: '4px',
    border: 'none',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: '#fff',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'opacity 0.2s, transform 0.1s',
  },
  btnDisabled: {
    opacity: '0.6',
    cursor: 'not-allowed',
  },
  footer: {
    textAlign: 'center',
    marginTop: '24px',
    fontSize: '13px',
    color: '#888',
  },
  link: {
    color: '#667eea',
    textDecoration: 'none',
    fontWeight: '600',
    marginLeft: '4px',
  },
};