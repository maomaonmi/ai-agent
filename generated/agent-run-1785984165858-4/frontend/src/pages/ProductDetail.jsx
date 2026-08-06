import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [addingToCart, setAddingToCart] = useState(false);
  const [cartMessage, setCartMessage] = useState('');

  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const carouselRef = useRef(null);

  useEffect(() => {
    const fetchProduct = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/products/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || '获取商品详情失败');
        setProduct(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchProduct();
    window.scrollTo(0, 0);
  }, [id]);

  const images = product?.images?.length
    ? product.images
    : product?.image
      ? [product.image]
      : ['https://via.placeholder.com/600?text=No+Image'];

  const finalPrice = product?.discount && product.discount < 1
    ? (product.price * product.discount).toFixed(2)
    : product?.price?.toFixed(2);

  const handlePrevImage = () => {
    setCurrentImageIndex(prev => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const handleNextImage = () => {
    setCurrentImageIndex(prev => (prev === images.length - 1 ? 0 : prev + 1));
  };

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        handleNextImage();
      } else {
        handlePrevImage();
      }
    }
  };

  const handleAddToCart = async () => {
    if (!product || product.stock <= 0) return;
    setAddingToCart(true);
    setCartMessage('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/cart/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          product_id: product.id,
          quantity: quantity,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || '加入购物车失败');
      setCartMessage('已加入购物车 ✓');
      setTimeout(() => setCartMessage(''), 2000);
    } catch (err) {
      setCartMessage(err.message);
      setTimeout(() => setCartMessage(''), 3000);
    } finally {
      setAddingToCart(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
        <p className="text-red-500">{error}</p>
        <button
          onClick={() => navigate(-1)}
          className="mt-4 rounded-lg bg-blue-500 px-6 py-2 text-white hover:bg-blue-600"
        >
          返回
        </button>
      </div>
    );
  }

  if (!product) return null;

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      {/* 顶部导航 */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-white/90 px-4 py-3 backdrop-blur-sm">
        <button
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200"
        >
          <svg className="h-5 w-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-medium text-gray-800">商品详情</span>
        <div className="w-9" />
      </div>

      {/* 图片轮播 */}
      <div
        ref={carouselRef}
        className="relative overflow-hidden bg-white"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${currentImageIndex * 100}%)` }}
        >
          {images.map((img, idx) => (
            <div key={idx} className="w-full shrink-0">
              <img
                src={img}
                alt={`${product.name} - ${idx + 1}`}
                className="aspect-square w-full object-cover"
              />
            </div>
          ))}
        </div>

        {/* 左右箭头（桌面端） */}
        {images.length > 1 && (
          <>
            <button
              onClick={handlePrevImage}
              className="absolute left-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/30 p-2 text-white hover:bg-black/50 sm:block"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={handleNextImage}
              className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/30 p-2 text-white hover:bg-black/50 sm:block"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}

        {/* 指示器 */}
        {images.length > 1 && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {images.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentImageIndex(idx)}
                className={`h-2 rounded-full transition-all ${
                  idx === currentImageIndex
                    ? 'w-5 bg-white'
                    : 'w-2 bg-white/50'
                }`}
              />
            ))}
          </div>
        )}

        {/* 折扣标签 */}
        {product.discount && product.discount < 1 && (
          <span className="absolute left-3 top-3 rounded-lg bg-red-500 px-2.5 py-1 text-sm font-bold text-white shadow">
            {Math.round((1 - product.discount) * 100)}% OFF
          </span>
        )}
      </div>

      {/* 商品信息 */}
      <div className="bg-white px-4 pt-4 pb-5">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-red-500">¥{finalPrice}</span>
          {product.discount && product.discount < 1 && (
            <span className="text-base text-gray-400 line-through">
              ¥{product.price?.toFixed(2)}
            </span>
          )}
        </div>
        <h1 className="mt-2 text-lg font-semibold text-gray-900 leading-snug">
          {product.name}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          已售 {product.sales_count || 0} 件
        </p>
      </div>

      {/* 规格选择区 */}
      <div className="mt-2 bg-white px-4 py-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">数量</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQuantity(q => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              −
            </button>
            <span className="w-8 text-center text-sm font-medium">{quantity}</span>
            <button
              onClick={() => setQuantity(q => Math.min(product.stock || 99, q + 1))}
              disabled={quantity >= (product.stock || 99)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-gray-600">库存</span>
          <span className={`text-sm ${product.stock > 0 ? 'text-green-600' : 'text-red-500'}`}>
            {product.stock > 0 ? `剩余 ${product.stock} 件` : '已售罄'}
          </span>
        </div>
        {product.category && (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-gray-600">分类</span>
            <span className="text-sm text-gray-800">{product.category}</span>
          </div>
        )}
      </div>

      {/* 商品详情 */}
      <div className="mt-2 bg-white px-4 py-4">
        <h2 className="mb-3 text-base font-semibold text-gray-900">商品详情</h2>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-600">
          {product.description || '暂无详细描述'}
        </p>
      </div>

      {/* 底部操作栏 */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex flex-col items-center gap-0.5 px-3"
          >
            <svg className="h-5 w-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
            </svg>
            <span className="text-[10px] text-gray-500">首页</span>
          </button>
          <button
            onClick={() => navigate('/cart')}
            className="relative flex flex-col items-center gap-0.5 px-3"
          >
            <svg className="h-5 w-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
            </svg>
            <span className="text-[10px] text-gray-500">购物车</span>
          </button>
          <button
            onClick={handleAddToCart}
            disabled={addingToCart || !product.stock || product.stock <= 0}
            className="flex-1 rounded-full bg-orange-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:bg-gray-300"
          >
            {addingToCart ? '加入中...' : '加入购物车'}
          </button>
          <button
            onClick={handleAddToCart}
            disabled={addingToCart || !product.stock || product.stock <= 0}
            className="flex-1 rounded-full bg-red-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:bg-gray-300"
          >
            立即购买
          </button>
        </div>

        {/* 加入购物车提示 */}
        {cartMessage && (
          <div
            className={`absolute -top-10 left-1/2 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-medium shadow-lg transition-all ${
              cartMessage.includes('✓')
                ? 'bg-green-500 text-white'
                : 'bg-red-500 text-white'
            }`}
          >
            {cartMessage}
          </div>
        )}
      </div>
    </div>
  );
}
