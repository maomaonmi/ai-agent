---
trigger: always_on
---

# 常用代码参考

## 判断当前台账是否添加参数组的优惠
- 参数组 5G-A_SCENE_PKG (PARA_CODE1优惠编码)
```java
    List<TradeDicnt> additions = new ArrayList<>();
    for (TradeDiscnt tradeDiscnt : tradeDiscnts){
        List<CommparaResponseDTO> commparas=ParamInfoUtil.getCommpara("CSM",2024L,"5G-A_SCENE_PKG",String.valueOf(tradeDiscnt.getDiscntCode()),"ZZZZ");
        if(ArrayUtils.isNotEmpty(commparas)){
            if(StringUtils.equals(HarleyConst.MODIFY_TAG_ADD,tradeDiscnt.getModifyTag()){
                //do something
            }
        }
    }
```

## 根据userId获取亲情关系，再根据userIdA获取所有亲情关系
- A用户标识：对应关系类型参数表中的A角，通常为一集团用户或虚拟用户
- B用户标识：对应关系类型参数表中的B角，通常为普通用户
```java
List<RelationUu> relationUus = context.getUca().getRelationUus();
relationUus = relationUus.stream().filter(x->StringUtils.equals(x.getRelationTypeCode(),"84")).collect(Collectors.toList());
if(ArrayUtils.isEmpty(tradeDiscnts) || ArrayUtils.isEmpty(relationUus)){
    return;
}
List<RelationUu> relationUusAll = relationUuService.qryRelaUUByUserIdA(relationUus.get(0).getUserIdA(), "84", eparchyCode);
```

## 常用台账数据操作
### 3.1 获取指定类型的台账数据
```java
// 获取所有优惠台账
List<TradeDiscnt> tradeDiscnts = context.getOrderItems(TradeDiscnt.class);

// 获取所有产品台账
List<TradeProduct> tradeProducts = context.getOrderItems(TradeProduct.class);

// 获取所有服务台账
List<TradeSvc> tradeSvcs = context.getOrderItems(TradeSvc.class);
```

### 3.2 添加新的台账数据
```java
// 添加优惠台账
TradeDiscnt newDiscnt = new TradeDiscnt();
newDiscnt.setUserId(userId);
newDiscnt.setDiscntCode(discntCode);
newDiscnt.setStartDate(TimeTool.now());
newDiscnt.setEndDate(TimeTool.getLastSecondMonth(12));
newDiscnt.setModifyTag(HarleyConst.MODIFY_TAG_ADD);
newDiscnt.setInstId(SequenceUtil.getInstId(context));
context.add(newDiscnt);
```

### 3.3 修改现有台账数据
```java
// 修改优惠结束时间
TradeDiscnt updateDiscnt = CopyUtils.copy(originDiscnt, TradeDiscnt.class);
updateDiscnt.setEndDate(TimeTool.now());
updateDiscnt.setModifyTag(HarleyConst.MODIFY_TAG_DEL);
context.add(updateDiscnt);
```

## 常用UCA数据获取
### 4.1 获取用户基本信息
```java
UcaData uca = context.getUca();
User user = uca.getUser();
Customer customer = uca.getCustomer();
Account account = uca.getAccount();
```

### 4.2 获取用户商品信息
```java
// 获取用户所有优惠
List<UserDiscnt> userDiscnts = uca.getDiscounts();

// 获取用户所有产品
List<UserProduct> userProducts = uca.getProducts();

// 获取用户所有服务
List<UserSvc> userSvcs = uca.getServices();
```

## 常用服务调用
### 5.1 调用产品中心服务
```java
@Autowired
private UpcAppCall.IQueryOfferOpenServiceCall queryOfferOpenServiceCall;

// 查询产品信息
OfferDTO offerDto = queryOfferOpenServiceCall.getOfferByOfferTypeAndOfferCode(
    discntCode, HarleyConst.OFFER_TYPE_DISCOUNT);
```

### 5.2 调用资源中心服务
```java
@Autowired
private ResCall.IResQueryServiceCall resQueryServiceCall;

// 查询号码资源
List<ResNumberDTO> numbers = resQueryServiceCall.queryAvailNumbers(
    eparchyCode, "MOBILE", 10);
```

### 5.3 调用客户系统服务
```java
@Autowired
private CustAppCall.ICustomerQueryServiceCall customerQueryServiceCall;

// 查询客户信息
CustomerDTO customer = customerQueryServiceCall.queryCustomerById(customerId);
```

## 常用工具类调用
### 6.1 时间工具类
```java
// 当前时间
LocalDateTime now = TimeTool.now();

// 永久时间
LocalDateTime forever = TimeTool.foreverTime();

// 获取月份最后一天
LocalDateTime monthEnd = TimeTool.getLastSecondMonth(12);
```

### 6.2 序列号生成
```java
// 获取实例ID
Long instId = SequenceUtil.getInstId(context);

// 获取日志ID
Long logId = SequenceUtil.getLogId();
```

### 6.3 参数配置获取
```java
// 获取系统参数
List<CommparaResponseDTO> params = ParamInfoUtil.getCommpara(
    "CSM", 9008L, "PARAM_NAME", "1", "ZZZZ");

// 获取静态数据
Map<String, String> staticData = StaticUtil.getStaticData(
    "STATIC_TYPE", "KEY_VALUE");
```

## 常用业务判断逻辑
### 7.1 业务类型判断
```java
Long tradeTypeCode = context.getTradeTypeCode();
if (tradeTypeCode == 110L) {
    // 开户业务
} else if (tradeTypeCode == 111L) {
    // 销户业务
}
```

### 7.2 修改标识判断
```java
if (StringUtils.equals(modifyTag, HarleyConst.MODIFY_TAG_ADD)) {
    // 新增操作
} else if (StringUtils.equals(modifyTag, HarleyConst.MODIFY_TAG_DEL)) {
    // 删除操作
} else if (StringUtils.equals(modifyTag, HarleyConst.MODIFY_TAG_MOD)) {
    // 修改操作
}
```

### 7.3 空值判断
```java
// 判断集合是否为空
if (ArrayUtils.isEmpty(list)) {
    return;
}

// 判断字符串是否为空
if (StringUtils.isBlank(str)) {
    // 处理空值情况
}
```

## 标准Plus插件结构
### 8.1 标准登记插件
```java
@Slf4j
@Component
@Plus(configs = {
    @PlusConfig(tradeTypeCode = "{tradeTypeCode}", execNo = {execNo}, kind = "{kind}")
}, type = Plus.PlusType.{plusType})
public class {PlusName} implements IPlus {
    
    @Autowired
    private IXXXService xxxService;
    
    @Override
    public void execute(JobContext context) {
        try {
            log.info("开始执行{PlusName}: tradeId={}", context.getTrade().getTradeId());
            
            // 业务逻辑处理
            processBusinessLogic(context);
            
            log.info("{PlusName}执行完成");
        } catch (Exception e) {
            log.error("{PlusName}执行异常: {}", e.getMessage(), e);
            throw new RuntimeException(e);
        }
    }
    
    private void processBusinessLogic(JobContext context) {
        // 具体业务逻辑实现
    }
}
```

### 8.2 返销插件
```java
@Slf4j
@Component
@Plus(direction = Direction.REVERSE, configs = {
    @PlusConfig(tradeTypeCode = "{tradeTypeCode}", execNo = {execNo})
}, type = PlusType.{plusType})
public class Undo{PlusName} implements IPlus {

    @Override
    public void execute(JobContext context) {
        try {
            log.info("开始执行返销插件Undo{PlusName}");
            
            // 获取被取消的订单数据
            Trade canceledTrade = context.getCanceledLineData().getTrade();
            
            // 返销业务逻辑
            processReverseLogic(context, canceledTrade);
            
            log.info("返销插件Undo{PlusName}执行完成");
        } catch (Exception e) {
            log.error("返销插件Undo{PlusName}执行异常: {}", e.getMessage(), e);
            throw new RuntimeException(e);
        }
    }
    
    private void processReverseLogic(JobContext context, Trade canceledTrade) {
        // 返销逻辑实现
        // 通常是恢复数据状态或清理相关数据
    }
}
```

