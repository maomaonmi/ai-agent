import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

const CATEGORY_OPTIONS = ['全部', '服装', '电子产品', '食品', '家居', '美妆', '运动'];
const SORT_OPTIONS = [
  { label: '默认排序', value: 'default' },
  { label: '价格从低到高', value: 'price_asc' },
  { label: '价格从高到低', value: 'price_desc' },
  { label: '最新上架', value: 'newest' },
];

export default function ProductList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const keyword = searchParams.get('keyword') || '';
  const category = searchParams.get('category') || '全部';
  const sort = searchParams.get('sort') || 'default';

  const [inputKeyword, setInputKeyword] = useState(keyword);

  const observerRef = useRef(null);
  const lastItemRef = useRef(null);

  const fetchProducts = useCallback(async (pageNum, isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else if (pageNum === 1) {
      setLoading(true);
    }
    try {
      const params = new URLSearchParams();
      params.set('page', pageNum);
      params.set('page_size', pageSize);
      if (keyword) params.set('keyword', keyword);
      if (category && category !== '全部') params.set('category', category);
      if (sort && sort !== 'default') params.set('sort', sort);

      const res = await fetch(`/api/products?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.detail || '获取商品失败');

      const items = data.items || data.products || [];
      const total = data.total || 0;

      if (isRefresh) {
        setProducts(items);
        setPage(2);
      } else if (pageNum === 1) {
        setProducts(items);
        setPage(2);
      } else {
        setProducts(prev => [...prev, ...items]);
        setPage(prev => prev + 1);
      }

      setHasMore(products.length + items.length < total);
    } catch (err) {
      console.error('获取商品失败:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [keyword, category, sort, products.length]);

  useEffect(() => {
    setInputKeyword(keyword);
    fetchProducts(1);
  }, [keyword, category, sort]);

  useEffect(() => {
    if (loading) return;
    if (!hasMore) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          fetchProducts(page);
        }
      },
      { threshold: 0.1 }
    );

    if (lastItemRef.current) {
      observer.observe(lastItemRef.current);
    }
    observerRef.current = observer;

    return () => observer.disconnect();
  }, [loading, hasMore, page, fetchProducts]);

  const handleSearch = (e) => {
    e.preventDefault();
    const newParams = new URLSearchParams(searchParams);
    if (inputKeyword.trim()) {
      newParams.set('keyword', inputKeyword.trim());
    } else {
      newParams.delete('keyword');
    }
    setSearchParams(newParams);
  };

  const handleCategoryChange = (cat) => {
    const newParams = new URLSearchParams(searchParams);
    if (cat === '全部') {
      newParams.delete('category');
    } else {
      newParams.set('category', cat);
    }
    setSearchParams(newParams);
  };

  const handleSortChange = (e) => {
    const newParams = new URLSearchParams(searchParams);
    if (e.target.value === 'default') {
      newParams.delete('sort');
    } else {
      newParams.set('sort', e.target.value);
    }
    setSearchParams(newParams);
  };

  const handlePullRefresh = async (e) => {
    e.preventDefault();
    await fetchProducts(1, true);
  };

  let touchStartY = 0;
  const handleTouchStart = (e) => {
    touchStartY = e.touches[0].clientY;
  };
  const handleTouchEnd = (e) => {
    const touchEndY = e.changedTouches[0].clientY;
    const diff = touchEndY - touchStartY;
    if (diff > 80 && window.scrollY <= 0) {
      fetchProducts(1, true);
    }
  };

  return (
    <div
      className="min-h-screen bg-gray-50"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 顶部搜索栏 */}
      <div className="sticky top-0 z-30 bg-white shadow-sm">
        <form onSubmit={handleSearch} className="flex items-center gap-2 px-4 py-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={inputKeyword}
              onChange={(e) => setInputKeyword(e.target.value)}
              placeholder="搜索商品..."
              className="w-full rounded-full border border-gray-300 bg-gray-100 px-4 py-2 pr-10 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />\n            <button
              type="submit"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-500"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </form>

        {/* 分类标签 */}
        <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide">
          {CATEGORY_OPTIONS.map(cat => (
            <button
              key={cat}
              onClick={() => handleCategoryChange(cat)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                category === cat
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* 排序栏 */}
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2">
          <span className="text-xs text-gray-400">
            共 {products.length} 件商品
          </span>
          <select
            value={sort}
            onChange={handleSortChange}
            className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 outline-none focus:border-blue-400"
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 下拉刷新提示 */}
      {refreshing && (
        <div className="flex items-center justify-center py-4">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <span className="ml-2 text-sm text-gray-500">刷新中...</span>
        </div>
      )}

      {/* 商品网格 */}
      <div className="columns-2 gap-3 px-3 pt-3 sm:columns-3 lg:columns-4">
        {products.map((product, idx) => (
          <div
            key={product.id}
            ref={idx === products.length - 1 ? lastItemRef : null}
            onClick={() => navigate(`/products/${product.id}`)}
            className="mb-3 break-inside-avoid cursor-pointer overflow-hidden rounded-xl bg-white shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="relative">
              <img
                src={product.image || product.images?.[0] || 'https://via.placeholder.com/300?text=No+Image'}
                alt={product.name}
                className="w-full object-cover"
                loading="lazy"
              />
              {product.discount && product.discount < 1 && (
                <span className="absolute left-2 top-2 rounded bg-red-500 px-1.5 py-0.5 text-xs font-bold text-white">
                  {Math.round((1 - product.discount) * 100)}% OFF
                </span>
              )}
            </div>
            <div className="p-2.5">
              <h3 className="line-clamp-2 text-sm font-medium text-gray-800 leading-tight">
                {product.name}
              </h3>
              {product.category && (
                <span className="mt-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                  {product.category}
                </span>
              )}
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-base font-bold text-red-500">
                  ¥{(product.discount && product.discount < 1
                    ? (product.price * product.discount).toFixed(2)
                    : product.price?.toFixed(2)
                  )}
                </span>
                {product.discount && product.discount < 1 && (
                  <span className="text-xs text-gray-400 line-through">
                    ¥{product.price?.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 加载状态 */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-3 border-blue-500 border-t-transparent" />
        </div>
      )}

      {/* 没有更多 */}
      {!loading && !hasMore && products.length > 0 && (
        <div className="py-8 text-center text-sm text-gray-400">
          — 没有更多商品了 —
        </div>
      )}

      {/* 空状态 */}
      {!loading && products.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <svg className="h-20 w-20 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <p className="mt-4 text-gray-400">暂无商品</p>
          <button
            onClick={() => {
              const newParams = new URLSearchParams();
              setSearchParams(newParams);
              setInputKeyword('');
            }}
            className="mt-2 text-sm text-blue-500 hover:underline"
          >
            清除筛选条件
          </button>
        </div>
      )}
    </div>
  );
}
