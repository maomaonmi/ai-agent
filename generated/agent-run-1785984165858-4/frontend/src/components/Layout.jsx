import React from 'react';
import { Outlet, NavLink } from 'react-router-dom';

function Layout() {
  return (
    <div className="layout">
      {/* 顶部导航栏 */}
      <header className="top-nav">
        <div className="top-nav-inner">
          <NavLink to="/" className="top-nav-brand">
            智汇商场
          </NavLink>
          <nav className="top-nav-links">
            <NavLink
              to="/products"
              className={({ isActive }) =>
                isActive ? 'nav-link active' : 'nav-link'
              }
            >
              全部商品
            </NavLink>
            <NavLink
              to="/cart"
              className={({ isActive }) =>
                isActive ? 'nav-link active' : 'nav-link'
              }
            >
              购物车
            </NavLink>
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                isActive ? 'nav-link active' : 'nav-link'
              }
            >
              个人中心
            </NavLink>
          </nav>
        </div>
      </header>

      {/* 主内容区域 */}
      <main className="main-content">
        <Outlet />
      </main>

      {/* 底部栏 */}
      <footer className="bottom-bar">
        <div className="bottom-bar-inner">
          <span className="bottom-bar-copyright">
            © 2024 智汇商场 版权所有
          </span>
          <div className="bottom-bar-links">
            <a href="/about" className="bottom-link">关于我们</a>
            <a href="/contact" className="bottom-link">联系方式</a>
            <a href="/terms" className="bottom-link">用户协议</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Layout;
