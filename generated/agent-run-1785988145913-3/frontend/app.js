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
  filterAndRender();
}

async function openProductModal(productId) {
  try {
    const res = await fetch(`${API}/products/${productId}`);
    const p = await res.json();
    const cat = allCategories.find(c => c.id === p.category_id);
    const catName = cat ? cat.name : '';
    const stars = renderStars(p.rating);
    document.getElementById('modalBody').innerHTML = `
      <img class="modal-img" src="https://picsum.photos/seed/${p.id}/800/500" alt="${p.name}">
      <div class="modal-content">
        <span class="modal-category">${catName}</span>
        <h2 class="modal-name">${p.name}</h2>
        <div class="modal-rating">
          <span class="modal-stars">${stars}</span>
          <span class="modal-rating-num">${p.rating} 分</span>
        </div>
        <p class="modal-desc">${p.description}</p>
        <div class="modal-footer">
          <div class="modal-price"><span>¥</span>${p.price}</div>
          <button class="modal-add-btn" onclick="addToCart(${p.id}); closeModal();">加入购物车</button>
        </div>
      </div>
    `;
    document.getElementById('modalOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  } catch (e) {
    console.error('Failed to fetch product:', e);
  }
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

async function init() {
  await fetchCategories();
  await fetchProducts();
  await fetchCart();
}

init();
