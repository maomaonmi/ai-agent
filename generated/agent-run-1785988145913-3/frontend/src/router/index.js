import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { isAuthenticated } from '../main';

// ==================== 路由懒加载占位组件 ====================

// 首页
function HomePage() {
  return (
    <div className="page-home">
      <h1>商场首页</h1>
      <p>欢迎来到现代化商场系统</p>
    </div>
  );
}

// 商品列表页
function ProductListPage() {
  return (
    <div className="page-product-list">
      <h1>商品列表</h1>
    </div>
  );
}

// 商品详情页
function ProductDetailPage() {
  return (
    <div className="page-product-detail">
      <h1>商品详情</h1>
    </div>
  );
}

// 购物车页
function CartPage() {
  return (
    <div className="page-cart">
      <h1>购物车</h1>
    </div>
  );
}

// 登录页
function LoginPage() {
  return (
    <div className="page-login">
      <h1>用户登录</h1>
    </div>
  );
}

// 注册页
function RegisterPage() {
  return (
    <div className="page-register">
      <h1>用户注册</h1>
    </div>
  );
}

// 订单列表页
function OrderListPage() {
  return (
    <div className="page-order-list">
      <h1>我的订单</h1>
    </div>
  );
}

// 订单详情页
function OrderDetailPage() {
  return (
    <div className="page-order-detail">
      <h1>订单详情</h1>
    </div>
  );
}

// 个人中心页
function ProfilePage() {
  return (
    <div className="page-profile">
      <h1>个人中心</h1>
    </div>
  );
}

// 404 页面
function NotFoundPage() {
  return (
    <div className="page-not-found">
      <h1>404 - 页面不存在</h1>
      <p>您访问的页面不存在或已被移除</p>
    </div>
  );
}

// ==================== 路由守卫组件 ====================

/**
 * 需要登录才能访问的路由守卫
 * 未登录时自动跳转到登录页，登录后返回原页面
 */
function AuthGuard({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated()) {
      // 保存当前路径，登录后可跳回
      const redirect = encodeURIComponent(location.pathname + location.search);
      navigate(`/login?redirect=${redirect}`, { replace: true });
    }
  }, [location, navigate]);

  if (!isAuthenticated()) {
    return null;
  }

  return children;
}

/**
 * 已登录用户访问的路由守卫（如登录页、注册页）
 * 已登录时自动跳转到首页
 */
function GuestGuard({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated()) {
      // 如果有 redirect 参数，跳转到指定页面
      const params = new URLSearchParams(location.search);
      const redirect = params.get('redirect');
      if (redirect) {
        navigate(decodeURIComponent(redirect), { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    }
  }, [location, navigate]);

  if (isAuthenticated()) {
    return null;
  }

  return children;
}

// ==================== 路由配置 ====================

/**
 * 路由配置表
 * - path: 路由路径
 * - component: 对应组件
 * - auth: 是否需要登录
 * - guest: 是否仅限未登录用户
 */
const routeConfig = [
  { path: '/', component: HomePage, auth: false },
  { path: '/products', component: ProductListPage, auth: false },
  { path: '/products/:id', component: ProductDetailPage, auth: false },
  { path: '/cart', component: CartPage, auth: true },
  { path: '/login', component: LoginPage, guest: true },
  { path: '/register', component: RegisterPage, guest: true },
  { path: '/orders', component: OrderListPage, auth: true },
  { path: '/orders/:id', component: OrderDetailPage, auth: true },
  { path: '/profile', component: ProfilePage, auth: true },
  { path: '*', component: NotFoundPage, auth: false },
];

/**
 * RouterProvider 组件
 * 根据路由配置表渲染 Routes
 */
export function RouterProvider() {
  return (
    <Routes>
      {routeConfig.map((route) => {
        const Element = route.component;

        // 需要登录的路由
        if (route.auth) {
          return (
            <Route
              key={route.path}
              path={route.path}
              element={
                <AuthGuard>
                  <Element />
                </AuthGuard>
              }
            />
          );
        }

        // 仅限未登录的路由（登录/注册）
        if (route.guest) {
          return (
            <Route
              key={route.path}
              path={route.path}
              element={
                <GuestGuard>
                  <Element />
                </GuestGuard>
              }
            />
          );
        }

        // 公开路由
        return (
          <Route key={route.path} path={route.path} element={<Element />} />
        );
      })}
    </Routes>
  );
}

export default routeConfig;
