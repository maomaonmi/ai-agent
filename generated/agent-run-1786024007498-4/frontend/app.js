const API = '/api';
let allProducts = [];
let allCategories = [];
let cartItems = [];
let currentCategory = 'all';
let currentPriceRange = 'all';
let searchQuery = '';

async function fetchCategories() {
  try {
    const res = await fetch(`${API}/categories`);
    allCategories = await res.json();
    renderCategories();
  } catch (e) {
    console.error('Failed to fetch categories:', e);
  }
}

function renderCategories() {
  const list = document.getElementById('categoryList');
  list.innerHTML = '<li class="category-item active" data-id="all" onclick="filterByCategory(\'all\', this)">全部商品</li>';
  allCategories.forEach(cat => {
    const li = document.createElement('li');
    li.className = 'category-item';
    li.dataset.id = cat.id;
    li.textContent = cat.name;
    li.onclick = function() { filterByCategory(cat.id, this); };
    list.appendChild(li);
  });
}

async function fetchProducts() {
  const spinner = document.getElementById('loadingSpinner');
  spinner.style.display = 'flex';
  try {
    const res = await fetch(`${API}/products`);
    allProducts = await res.json();
    filterAndRender();
  } catch (e) {
    console.error('Failed to fetch products:', e);
    showToast('加载商品失败，请刷新重试', 'warning');
  } finally {
    spinner.style.display = 'none';
  }
}

function filterAndRender() {
  let filtered = [...allProducts];
  if (currentCategory !== 'all') {
    filtered = filtered.filter(p => p.category_id === currentCategory);
  }
  if (currentPriceRange !== 'all') {
    const [min, max] = currentPriceRange.split('-').map(Number);
    filtered = filtered.filter(p => p.price >= min && p.price <= max);
  }
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );
  }
  renderProducts(filtered);
}

function renderProducts(products) {
  const grid = document.getElementById('productGrid');
  const empty = document.getElementById('emptyState');
  const count = document.getElementById('productCount');
  count.textContent = `共 ${products.length} 件商品`;
  if (products.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = products.map(p => {
    const cat = allCategories.find(c => c.id === p.category_id);
    const catName = cat ? cat.name : '';
    const stars = renderStars(p.rating);
    return `
      <div class="product-card" onclick="openProductModal(${p.id})">
        <img class="product-img" src="https://picsum.photos/seed/${p.id}/400/300" alt="${p.name}">
        <div class="product-info">
          <span class="product-category-tag">${catName}</span>
          <div class="product-name">${p.name}</div>
          <div class="product-rating">
            <span class="stars">${stars}</span>
            <span class="rating-num">${p.rating}</span>
          </div>
          <div class="product-bottom">
            <div class="product-price"><span>¥</span>${p.price}</div>
            <button class="add-cart-btn" onclick="event.stopPropagation(); addToCart(${p.id})" title="加入购物车">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderStars(rating) {
  let s = '';
  for (let i = 1; i <= 5; i++) {
    if (i <= Math.floor(rating)) {
      s += '★';
    } else if (i - rating < 1) {
      s += '★';
    } else {
      s += '☆';
    }
  }
  return s;
}

function filterByCategory(catId, el) {
  currentCategory = catId;
  document.querySelectorAll('#categoryList .category-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  const cat = allCategories.find(c => c.id === catId);
  document.getElementById('pageTitle').textContent = catId === 'all' ? '全部商品' : cat.name;
  filterAndRender();
}

function filterByPrice(range, el) {
  currentPriceRange = range;
  el.parentElement.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  filterAndRender();
}

function handleSearch() {
  searchQuery = document.getElementById('searchInput').value;
  filterAndRender();
}

function resetView() {
  currentCategory = 'all';
  currentPriceRange = 'all';
  searchQuery = '';
  document.getElementById('searchInput').value = '';
  document.getElementById('pageTitle').textContent = '全部商品';
  document.querySelectorAll('#categoryList .category-item').forEach(i => i.classList.remove('active'));
  document.querySelector('#categoryList .category-item[data-id="all"]').classList.add('active');
  document.querySelectorAll('[data-price]').forEach(i => i.classList.remove('active'));
  document.querySelector('[data-price="all"]').classList.add('active');
  const zone = document.querySelector('.category-zone');
  if (zone) zone.style.display = '';
  const backBtn = document.getElementById('backToZonesBtn');
  if (backBtn) backBtn.style.display = 'none';
  filterAndRender();
}

let modalQuantity = 1;

async function openProductModal(productId) {
  modalQuantity = 1;
  try {
    const res = await fetch(`${API}/products/${productId}`);
    const p = await res.json();
    const cat = allCategories.find(c => c.id === p.category_id);
    const catName = cat ? cat.name : '';
    const stars = renderStars(p.rating);
    const stockStatus = p.stock > 20 ? '充足' : p.stock > 0 ? `仅剩 ${p.stock} 件` : '已售罄';
    const stockClass = p.stock > 20 ? 'stock-ok' : p.stock > 0 ? 'stock-low' : 'stock-out';
    const relatedProducts = allProducts
      .filter(item => item.category_id === p.category_id && item.id !== p.id)
      .slice(0, 4);
    const features = generateFeatures(p);
    const specs = generateSpecs(p);
    document.getElementById('modalBody').innerHTML = `
      <div class="modal-gallery">
        <img class="modal-img" src="https://picsum.photos/seed/${p.id}/800/500" alt="${p.name}">
        <div class="modal-thumbnails">
          <div class="thumbnail active"><img src="https://picsum.photos/seed/${p.id}/100/100" alt="缩略图1"></div>
          <div class="thumbnail"><img src="https://picsum.photos/seed/${p.id + 100}/100/100" alt="缩略图2"></div>
          <div class="thumbnail"><img src="https://picsum.photos/seed/${p.id + 200}/100/100" alt="缩略图3"></div>
          <div class="thumbnail"><img src="https://picsum.photos/seed/${p.id + 300}/100/100" alt="缩略图4"></div>
        </div>
      </div>
      <div class="modal-content">
        <span class="modal-category">${catName}</span>
        <h2 class="modal-name">${p.name}</h2>
        <div class="modal-rating">
          <span class="modal-stars">${stars}</span>
          <span class="modal-rating-num">${p.rating} 分</span>
          <span class="rating-count">(${Math.floor(p.rating * 128)} 条评价)</span>
        </div>
        <div class="modal-price-row">
          <div class="modal-price"><span>¥</span>${p.price}</div>
          <span class="modal-original-price">¥${Math.floor(p.price * 1.3)}</span>
          <span class="discount-badge">${Math.round((1 - p.price / (p.price * 1.3)) * 100)}% OFF</span>
        </div>
        <p class="modal-desc">${p.description}</p>
        <div class="modal-stock ${stockClass}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"/><path d="m9 12 2 2 4-4"/></svg>
          <span>库存状态：${stockStatus}</span>
        </div>
        <div class="modal-features">
          <h4 class="section-title">商品亮点</h4>
          <div class="feature-tags">${features}</div>
        </div>
        <div class="modal-qty-section">
          <span class="qty-label">购买数量</span>
          <div class="qty-selector">
            <button class="qty-btn modal-qty-btn" onclick="changeModalQty(-1)">−</button>
            <input type="number" class="qty-input" id="modalQtyInput" value="1" min="1" max="${p.stock}" onchange="syncModalQty(this.value)">
            <button class="qty-btn modal-qty-btn" onclick="changeModalQty(1)">+</button>
          </div>
        </div>
        <div class="modal-specs">
          <h4 class="section-title">规格参数</h4>
          <div class="specs-grid">${specs}</div>
        </div>
        <div class="modal-services">
          <div class="service-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span>正品保障</span>
          </div>
          <div class="service-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/><path d="M9 12h6"/></svg>
            <span>7天无理由退换</span>
          </div>
          <div class="service-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            <span>顺丰包邮</span>
          </div>
        </div>
        <div class="modal-footer">
          <button class="modal-cart-btn" onclick="addToCartWithQty(${p.id})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            加入购物车
          </button>
          <button class="modal-buy-btn" onclick="buyNow(${p.id})">立即购买</button>
        </div>
        ${relatedProducts.length > 0 ? `
        <div class="related-section">
          <h4 class="section-title">相关推荐</h4>
          <div class="related-grid">
            ${relatedProducts.map(rp => `
              <div class="related-item" onclick="openProductModal(${rp.id})">
                <img src="https://picsum.photos/seed/${rp.id}/120/120" alt="${rp.name}">
                <div class="related-info">
                  <div class="related-name">${rp.name}</div>
                  <div class="related-price">¥${rp.price}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}
      </div>
    `;
    document.getElementById('modalOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  } catch (e) {
    console.error('Failed to fetch product:', e);
  }
}

function generateFeatures(product) {
  const allFeatures = {
    electronics: ['高清显示', '智能互联', '长续航', '轻薄便携', '专业音质'],
    fashion: ['优质面料', '经典设计', '舒适透气', '百搭时尚', '精细做工'],
    home: ['简约设计', '环保材质', '易于清洁', '耐用持久', '空间节省'],
    beauty: ['温和配方', '快速吸收', '持久效果', '天然成分', '敏感肌适用'],
    sports: ['专业级', '轻量化', '透气速干', '耐磨防滑', '人体工学'],
    food: ['天然原料', '无添加', '新鲜直供', '营养丰富', '口感醇厚']
  };
  const features = allFeatures[product.category_id] || ['品质保证', '精心挑选'];
  const selected = features.slice(0, 3);
  return selected.map(f => `<span class="feature-tag">${f}</span>`).join('');
}

function generateSpecs(product) {
  const baseSpecs = [
    { label: '商品编号', value: `LUXE-${product.id.toString().padStart(6, '0')}` },
    { label: '商品分类', value: product.category_id },
    { label: '用户评分', value: `${product.rating} 分` },
    { label: '库存数量', value: `${product.stock} 件` }
  ];
  return baseSpecs.map(s => `
    <div class="spec-item">
      <span class="spec-label">${s.label}</span>
      <span class="spec-value">${s.value}</span>
    </div>
  `).join('');
}

function changeModalQty(delta) {
  const input = document.getElementById('modalQtyInput');
  if (!input) return;
  let newVal = parseInt(input.value) + delta;
  const max = parseInt(input.max) || 99;
  const min = parseInt(input.min) || 1;
  newVal = Math.max(min, Math.min(max, newVal));
  input.value = newVal;
  modalQuantity = newVal;
}

function syncModalQty(val) {
  modalQuantity = parseInt(val) || 1;
}

async function addToCartWithQty(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product || product.stock < 1) {
    showToast('商品已售罄', 'warning');
    return;
  }
  try {
    const existing = cartItems.find(i => i.product_id === productId);
    if (existing) {
      await fetch(`${API}/cart/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: existing.quantity + modalQuantity })
      });
    } else {
      await fetch(`${API}/cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, quantity: modalQuantity })
      });
    }
    await fetchCart();
    showToast(`已添加 ${modalQuantity} 件「${product.name}」到购物车`, 'success');
    closeModal();
  } catch (e) {
    console.error('Failed to add to cart:', e);
    showToast('添加失败，请重试', 'warning');
  }
}

function buyNow(productId) {
  addToCartWithQty(productId);
  setTimeout(() => toggleCart(), 300);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

async function addToCart(productId) {
  try {
    const existing = cartItems.find(i => i.product_id === productId);
    if (existing) {
      await fetch(`${API}/cart/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: existing.quantity + 1 })
      });
    } else {
      await fetch(`${API}/cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, quantity: 1 })
      });
    }
    await fetchCart();
    const product = allProducts.find(p => p.id === productId);
    showToast(`已添加「${product ? product.name : '商品'}」到购物车`, 'success');
  } catch (e) {
    console.error('Failed to add to cart:', e);
    showToast('添加失败，请重试', 'warning');
  }
}

async function fetchCart() {
  try {
    const res = await fetch(`${API}/cart`);
    cartItems = await res.json();
    renderCart();
    updateCartBadge();
  } catch (e) {
    console.error('Failed to fetch cart:', e);
  }
}

function updateCartBadge() {
  const badge = document.getElementById('cartBadge');
  const total = cartItems.reduce((sum, i) => sum + i.quantity, 0);
  if (total > 0) {
    badge.style.display = 'flex';
    badge.textContent = total > 99 ? '99+' : total;
  } else {
    badge.style.display = 'none';
  }
}

function renderCart() {
  const empty = document.getElementById('cartEmpty');
  const items = document.getElementById('cartItems');
  const footer = document.getElementById('cartFooter');
  if (cartItems.length === 0) {
    empty.style.display = 'flex';
    items.innerHTML = '';
    footer.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  footer.style.display = 'block';
  let total = 0;
  items.innerHTML = cartItems.map(item => {
    const product = allProducts.find(p => p.id === item.product_id);
    if (!product) return '';
    const subtotal = product.price * item.quantity;
    total += subtotal;
    return `
      <div class="cart-item">
        <img class="cart-item-img" src="https://picsum.photos/seed/${product.id}/150/150" alt="${product.name}">
        <div class="cart-item-info">
          <div class="cart-item-name">${product.name}</div>
          <div class="cart-item-price">¥${subtotal}</div>
          <div class="cart-item-actions">
            <button class="qty-btn" onclick="updateQty(${item.id}, ${item.quantity - 1})">−</button>
            <span class="qty-value">${item.quantity}</span>
            <button class="qty-btn" onclick="updateQty(${item.id}, ${item.quantity + 1})">+</button>
          </div>
        </div>
        <button class="cart-item-remove" onclick="removeCartItem(${item.id})" title="移除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
    `;
  }).join('');
  document.getElementById('totalPrice').textContent = `¥${total}`;
}

async function updateQty(cartItemId, newQty) {
  if (newQty <= 0) {
    await removeCartItem(cartItemId);
    return;
  }
  try {
    await fetch(`${API}/cart/${cartItemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: newQty })
    });
    await fetchCart();
  } catch (e) {
    console.error('Failed to update quantity:', e);
  }
}

async function removeCartItem(cartItemId) {
  try {
    await fetch(`${API}/cart/${cartItemId}`, { method: 'DELETE' });
    await fetchCart();
    showToast('已从购物车移除', 'success');
  } catch (e) {
    console.error('Failed to remove item:', e);
  }
}

async function clearCart() {
  try {
    await fetch(`${API}/cart`, { method: 'DELETE' });
    await fetchCart();
    showToast('购物车已清空', 'success');
  } catch (e) {
    console.error('Failed to clear cart:', e);
  }
}

function handleCheckout() {
  const total = cartItems.reduce((sum, item) => {
    const p = allProducts.find(pr => pr.id === item.product_id);
    return sum + (p ? p.price * item.quantity : 0);
  }, 0);
  showToast(`订单提交成功！合计 ¥${total}`, 'success');
  clearCart();
  toggleCart();
}

function toggleCart() {
  const overlay = document.getElementById('cartOverlay');
  const drawer = document.getElementById('cartDrawer');
  const isOpen = drawer.classList.contains('open');
  if (isOpen) {
    overlay.classList.remove('open');
    drawer.classList.remove('open');
    document.body.style.overflow = '';
  } else {
    overlay.classList.add('open');
    drawer.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function showToast(message, type) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type || ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 2800);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    const drawer = document.getElementById('cartDrawer');
    if (drawer.classList.contains('open')) toggleCart();
  }
});

function filterBySubCategory(subName, catId) {
  currentCategory = catId;
  document.querySelectorAll('#categoryList .category-item').forEach(i => i.classList.remove('active'));
  const catEl = document.querySelector(`#categoryList .category-item[data-id="${catId}"]`);
  if (catEl) catEl.classList.add('active');

  document.getElementById('pageTitle').textContent = subName;

  const q = subName.toLowerCase();
  const filtered = allProducts.filter(p => {
    if (p.category_id !== catId) return false;
    return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
  });

  renderProducts(filtered);

  const zone = document.querySelector('.category-zone');
  if (zone) zone.style.display = 'none';

  const backBtn = document.getElementById('backToZonesBtn');
  if (backBtn) {
    backBtn.style.display = 'inline-flex';
    backBtn.onclick = function() {
      if (zone) zone.style.display = '';
      backBtn.style.display = 'none';
      resetView();
    };
  }

  const header = document.querySelector('.content-header');
  if (header) {
    header.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function init() {
  await fetchCategories();
  await fetchProducts();
  await fetchCart();
}

init();

let currentSlide = 0;
let slideInterval = null;

function switchSlide(index) {
  const slides = document.querySelectorAll('.hero-slide');
  const indicators = document.querySelectorAll('.indicator');
  slides.forEach(s => s.classList.remove('active'));
  indicators.forEach(i => i.classList.remove('active'));
  slides[index].classList.add('active');
  indicators[index].classList.add('active');
  currentSlide = index;
}

function nextSlide() {
  const slides = document.querySelectorAll('.hero-slide');
  const next = (currentSlide + 1) % slides.length;
  switchSlide(next);
}

function startSlideShow() {
  if (slideInterval) clearInterval(slideInterval);
  slideInterval = setInterval(nextSlide, 5000);
}

function scrollToProducts() {
  const header = document.querySelector('.content-header');
  if (header) {
    header.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

startSlideShow();
