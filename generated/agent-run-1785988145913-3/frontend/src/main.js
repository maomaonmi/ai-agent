import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { RouterProvider } from './router';

// ==================== 全局 HTTP 请求拦截器 ====================

const TOKEN_KEY = 'mall_token';
const BASE_URL = '/api';

/**
 * 从 localStorage 获取 Token
 */
function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * 保存 Token 到 localStorage
 */
export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/**
 * 清除 Token（退出登录时调用）
 */
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * 判断用户是否已登录
 */
export function isAuthenticated() {
  return !!getToken();
}

/**
 * 通用请求拦截器
 * - 自动拼接 BASE_URL
 * - 自动携带 Bearer Token
 * - 统一处理 401 跳转登录
 * - 统一 JSON 解析与错误处理
 */
async function request(url, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // 如果有 Token 且不是注册/登录接口，自动携带
  if (token && !url.includes('/auth/login') && !url.includes('/auth/register')) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // 拼接完整 URL
  const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;

  const response = await fetch(fullUrl, {
    ...options,
    headers,
  });

  // 401 未授权：清除 Token 并跳转登录页
  if (response.status === 401) {
    clearToken();
    // 避免在登录页重复跳转
    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login';
    }
    const err = new Error('未登录或登录已过期');
    err.status = 401;
    throw err;
  }

  // 403 禁止访问
  if (response.status === 403) {
    const err = new Error('没有权限执行此操作');
    err.status = 403;
    throw err;
  }

  // 尝试解析 JSON
  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  }

  // 非 2xx 响应统一抛错
  if (!response.ok) {
    const message = data?.detail || data?.message || `请求失败 (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

/**
 * 封装 HTTP 方法
 */
export const http = {
  get(url, params) {
    let finalUrl = url;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, value);
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        finalUrl += `?${queryString}`;
      }
    }
    return request(finalUrl, { method: 'GET' });
  },

  post(url, body) {
    return request(url, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  put(url, body) {
    return request(url, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  delete(url) {
    return request(url, { method: 'DELETE' });
  },
};

// 挂载到全局，方便非模块文件使用
window.http = http;
window.setToken = setToken;
window.clearToken = clearToken;
window.isAuthenticated = isAuthenticated;

// ==================== 应用入口 ====================

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
