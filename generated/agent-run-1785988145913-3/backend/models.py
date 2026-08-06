"""
商场管理系统 - 数据库模型定义
包含：用户(会员)、商铺、商品分类、商品、购物车、订单、订单明细
"""

from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime,
    ForeignKey, Text, Enum as SAEnum
)
from sqlalchemy.orm import relationship, declarative_base
import enum

Base = declarative_base()


# ==================== 枚举类型 ====================

class OrderStatus(str, enum.Enum):
    """订单状态"""
    PENDING = "pending"          # 待支付
    PAID = "paid"                # 已支付
    SHIPPED = "shipped"          # 已发货
    DELIVERED = "delivered"      # 已送达
    CANCELLED = "cancelled"      # 已取消
    REFUNDED = "refunded"        # 已退款


class PaymentMethod(str, enum.Enum):
    """支付方式"""
    WECHAT = "wechat"            # 微信支付
    ALIPAY = "alipay"            # 支付宝
    CASH = "cash"                # 现金
    CARD = "card"                # 银行卡


# ==================== 用户/会员模型 ====================

class Member(Base):
    """会员（用户）表"""
    __tablename__ = "members"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="会员ID")
    username = Column(String(50), unique=True, nullable=False, comment="用户名")
    password_hash = Column(String(255), nullable=False, comment="密码哈希")
    nickname = Column(String(50), comment="昵称")
    avatar = Column(String(500), comment="头像URL")
    phone = Column(String(20), unique=True, comment="手机号")
    email = Column(String(100), unique=True, comment="邮箱")
    gender = Column(String(10), default="unknown", comment="性别: male/female/unknown")
    birthday = Column(DateTime, comment="生日")
    points = Column(Integer, default=0, comment="积分余额")
    level = Column(Integer, default=1, comment="会员等级")
    is_active = Column(Boolean, default=True, comment="是否启用")
    is_admin = Column(Boolean, default=False, comment="是否管理员")
    created_at = Column(DateTime, default=datetime.utcnow, comment="注册时间")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")

    # 关联关系
    cart_items = relationship("CartItem", back_populates="member", cascade="all, delete-orphan")
    orders = relationship("Order", back_populates="member", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Member(id={self.id}, username='{self.username}')>"


# ==================== 商铺模型 ====================

class Shop(Base):
    """商铺表"""
    __tablename__ = "shops"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="商铺ID")
    name = Column(String(100), nullable=False, comment="商铺名称")
    description = Column(Text, comment="商铺描述")
    logo = Column(String(500), comment="商铺Logo URL")
    cover_image = Column(String(500), comment="封面图URL")
    owner_id = Column(Integer, ForeignKey("members.id"), comment="店主ID")
    contact_phone = Column(String(20), comment="联系电话")
    address = Column(String(255), comment="商铺地址")
    rating = Column(Float, default=0.0, comment="评分(0-5)")
    sales_count = Column(Integer, default=0, comment="总销量")
    is_active = Column(Boolean, default=True, comment="是否营业中")
    created_at = Column(DateTime, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")

    # 关联关系
    owner = relationship("Member", foreign_keys=[owner_id])
    products = relationship("Product", back_populates="shop", cascade="all, delete-orphan")
    categories = relationship("ProductCategory", back_populates="shop", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Shop(id={self.id}, name='{self.name}')>"


# ==================== 商品分类模型 ====================

class ProductCategory(Base):
    """商品分类表 - 支持层级结构"""
    __tablename__ = "product_categories"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="分类ID")
    name = Column(String(50), nullable=False, comment="分类名称")
    icon = Column(String(500), comment="分类图标URL")
    parent_id = Column(Integer, ForeignKey("product_categories.id"), nullable=True, comment="父分类ID")
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=True, comment="所属商铺ID(空则为全局分类)")
    sort_order = Column(Integer, default=0, comment="排序权重")
    is_active = Column(Boolean, default=True, comment="是否启用")
    created_at = Column(DateTime, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")

    # 关联关系
    parent = relationship("ProductCategory", remote_side=[id], backref="children")
    shop = relationship("Shop", back_populates="categories")
    products = relationship("Product", back_populates="category")

    def __repr__(self):
        return f"<ProductCategory(id={self.id}, name='{self.name}')>"


# ==================== 商品模型 ====================

class Product(Base):
    """商品表"""
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="商品ID")
    name = Column(String(200), nullable=False, comment="商品名称")
    description = Column(Text, comment="商品描述")
    main_image = Column(String(500), comment="主图URL")
    images = Column(Text, comment="商品图片列表(JSON数组)")
    price = Column(Float, nullable=False, comment="销售价格")
    original_price = Column(Float, comment="原价(划线价)")
    cost_price = Column(Float, comment="成本价")
    stock = Column(Integer, default=0, comment="库存数量")
    sales_count = Column(Integer, default=0, comment="销量")
    unit = Column(String(20), default="件", comment="计量单位")
    barcode = Column(String(50), comment="条形码")
    weight = Column(Float, comment="重量(kg)")
    is_on_sale = Column(Boolean, default=True, comment="是否上架")
    is_recommend = Column(Boolean, default=False, comment="是否推荐")
    category_id = Column(Integer, ForeignKey("product_categories.id"), comment="所属分类ID")
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=False, comment="所属商铺ID")
    created_at = Column(DateTime, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")

    # 关联关系
    category = relationship("ProductCategory", back_populates="products")
    shop = relationship("Shop", back_populates="products")
    cart_items = relationship("CartItem", back_populates="product", cascade="all, delete-orphan")
    order_items = relationship("OrderItem", back_populates="product")

    def __repr__(self):
        return f"<Product(id={self.id}, name='{self.name}', price={self.price})>"


# ==================== 购物车模型 ====================

class CartItem(Base):
    """购物车明细表"""
    __tablename__ = "cart_items"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="购物车项ID")
    member_id = Column(Integer, ForeignKey("members.id"), nullable=False, comment="会员ID")
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, comment="商品ID")
    quantity = Column(Integer, default=1, nullable=False, comment="购买数量")
    checked = Column(Boolean, default=True, comment="是否选中")
    created_at = Column(DateTime, default=datetime.utcnow, comment="加入时间")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")

    # 关联关系
    member = relationship("Member", back_populates="cart_items")
    product = relationship("Product", back_populates="cart_items")

    def __repr__(self):
        return f"<CartItem(id={self.id}, member_id={self.member_id}, product_id={self.product_id}, qty={self.quantity})>"


# ==================== 订单模型 ====================

class Order(Base):
    """订单主表"""
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="订单ID")
    order_no = Column(String(32), unique=True, nullable=False, comment="订单编号")
    member_id = Column(Integer, ForeignKey("members.id"), nullable=False, comment="下单会员ID")
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=False, comment="所属商铺ID")
    status = Column(SAEnum(OrderStatus), default=OrderStatus.PENDING, comment="订单状态")
    payment_method = Column(SAEnum(PaymentMethod), nullable=True, comment="支付方式")
    payment_time = Column(DateTime, nullable=True, comment="支付时间")
    total_amount = Column(Float, nullable=False, default=0.0, comment="订单总金额")
    discount_amount = Column(Float, default=0.0, comment="优惠金额")
    pay_amount = Column(Float, default=0.0, comment="实付金额")
    points_used = Column(Integer, default=0, comment="使用积分")
    points_earned = Column(Integer, default=0, comment="获得积分")
    receiver_name = Column(String(50), comment="收货人姓名")
    receiver_phone = Column(String(20), comment="收货人电话")
    receiver_address = Column(String(255), comment="收货地址")
    remark = Column(Text, comment="订单备注")
    paid_at = Column(DateTime, nullable=True, comment="支付时间")
    shipped_at = Column(DateTime, nullable=True, comment="发货时间")
    delivered_at = Column(DateTime, nullable=True, comment="送达时间")
    cancelled_at = Column(DateTime, nullable=True, comment="取消时间")
    created_at = Column(DateTime, default=datetime.utcnow, comment="下单时间")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")

    # 关联关系
    member = relationship("Member", back_populates="orders")
    shop = relationship("Shop")
    order_items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Order(id={self.id}, order_no='{self.order_no}', status={self.status})>"


class OrderItem(Base):
    """订单明细表"""
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="明细ID")
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, comment="订单ID")
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, comment="商品ID")
    product_name = Column(String(200), nullable=False, comment="商品名称(快照)")
    product_image = Column(String(500), comment="商品图片(快照)")
    price = Column(Float, nullable=False, comment="单价(快照)")
    quantity = Column(Integer, nullable=False, comment="购买数量")
    subtotal = Column(Float, nullable=False, comment="小计金额")

    # 关联关系
    order = relationship("Order", back_populates="order_items")
    product = relationship("Product", back_populates="order_items")

    def __repr__(self):
        return f"<OrderItem(id={self.id}, order_id={self.order_id}, product='{self.product_name}', qty={self.quantity})>"
