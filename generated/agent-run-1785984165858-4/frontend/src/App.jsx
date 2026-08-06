import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';

// 页面占位组件，后续子任务会替换为真实页面
const Home = () => <div className="page-placeholder">首页</div>;
const Products = () => <div className="page-placeholder">商品列表</div>;
const Cart = () => <div className="page-placeholder">购物车</div>;
const Profile = () => <div className="page-placeholder">个人中心</div>;
const Login = () => <div className="page-placeholder">登录</div>;
const Register = () => <div className="page-placeholder">注册</div>;

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 带布局的页面 */}
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="products" element={<Products />} />
          <Route path="cart" element={<Cart />} />
          <Route path="profile" element={<Profile />} />
        </Route>
        {/* 不带布局的页面 */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
