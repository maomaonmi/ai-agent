---
name: ddl-to-java-generator
description: 根据数据库表结构（DDL）自动生成完整的 Java 代码，包括 Entity、Mapper、Service、ServiceImpl、DTO、OpenService 等类。
---

# DDL转Java代码生成技能

## 技能概述
根据数据库表结构（DDL）自动生成完整的Java代码，包括Entity、Mapper、Service、ServiceImpl、DTO、OpenService等类。

## 使用场景
- 根据数据库表结构快速生成对应的Java实体类和相关组件
- 自动创建数据访问层、业务逻辑层和API接口层代码
- 生成符合项目规范的代码结构

## 输入参数
- 数据库表结构信息（建表语句）
- 表名和字段信息
- 数据库用户名（用于确定数据源）

## 输出结果
- Entity实体类
- Mapper接口及XML文件
- Service接口及实现类
- DTO数据传输对象
- OpenService接口及实现类

## 代码生成规则

### 1. 全局配置
- apiPath = "项目根目录/api"           # API模块路径
- svcPath = "项目根目录/svc"           # SVC模块路径
- dtoPackageName = "com.asiainfo.crm.order.api.cell.dto"   # DTO包路径
- packageName = "com.asiainfo.crm.order.svc.cell"          # 服务层包路径
- apiPackageName = "com.asiainfo.crm.order.api.business"   # API包路径

### 2. 建表语句解析规则
**格式**: `{数据库用户名}.{表名}`

**解析规则**：
- 数据库用户名 = `.`前的部分 
- 数据源：根据数据库用户名和数据源的对应关系获取数据源

| 数据库用户名 | 数据源 |
|---------|---------|
|ucr_base |  base   |
|ucr_sys  |  sys  |
|ucr_cp   |  cp   |
|ucr_cen1 |  cen1  |
|ucr_cen2 |  cen2 |
|ucr_rule |  rule |
|ucr_upc |  upc |
|ucr_res |  res |
|uop_crmg |  crmg |
|uop_crm数字 |  crm{route} |
|uop_jourg |  jourg |
|uop_jour数字 |  jour{route} |

- 表名 = `.`后的部分,去除后缀年份（`_2025`/`_2026`等）
- ClassName = 表名去除前缀（`TF_B_`/`TF_F_`/`TD_S_`/`TI_O_`/`TI_B_`）后转PascalCase

**示例**:

| 建表语句 | 数据源 | 表名 | ClassName |
|---------|--------|------|----------|
| `UCR_BASE.TD_S_STATIC` | `base` | `TD_S_STATIC` | `Static` |
| `UCR_CRM11.TF_F_USER_DISCNT` | `crm{route}` | `TF_F_USER_DISCNT` | `UserDiscnt` |
| `UCR_JOUR0.TF_B_TRADE` | `jourg` | `TF_B_TRADE` | `Trade` |
| `UCR_CRMG.TI_O_GROUPCUSTSMS` | `crmg` | `TI_O_GROUPCUSTSMS` | `Groupcustsms` |
| `UCR_CEN2.TD_AEE_GTM_TRIGGER` | `cen2` | `TD_AEE_GTM_TRIGGER` | `aeeGtmTrigger` |

### 3. 字段标识检测
根据表中是否存在以下字段设置标识：
- `userIdFlag`: 存在`USER_ID`字段时为"1"
- `tradeIdFlag`: 存在`TRADE_ID`字段时为"1"
- `partitionIdFlag`: 存在`PARTITION_ID`字段时为"1"
- `endDateFlag`: 存在`END_DATE`字段时为"1"
- `acceptMonth`: 存在`ACCEPT_MONTH`字段时为"1"
- `userTableFlag`: 表名为`TF_F_USER`时为"1"
- `bakFlag`: 表名以`_BAK`结尾时为"1"
- `yearFlag`: 表名以`年份`（`_2025`/`_2026`等）结尾时为"1"

### 4. 字段命名转换
数据库字段名 → Java属性名：下划线大写 → 小驼峰
- `USER_ID` → `userId`
- `TRADE_ID` → `tradeId`
- `PARTITION_ID` → `partitionId`

## 代码模板

### 1. Entity实体类模板
```java
package {packageName}.entity;

// 导入语句
import com.baomidou.mybatisplus.annotation.*;
import com.asiainfo.bits.core.data.BaseEntity;
import lombok.*;

/**
 * {表注释}({ClassName})实体对象
 */
@Getter
@Setter
@ToString
@Builder
@NoArgsConstructor
@AllArgsConstructor
@TableName("{表名}")
public class {ClassName} extends BaseEntity {

    private static final long serialVersionUID = 1L;
    
    // 主键字段（仅当DDL中定义了PRIMARY KEY时生成）
    /** {字段注释} */
    @TableId(value = "{DB_COLUMN_NAME}", type = IdType.{AUTO|INPUT})
    private {JavaType} {fieldName};
    
    // 普通字段
    /** {字段注释} */
    @TableField(value = "{DB_COLUMN_NAME}")
    private {JavaType} {fieldName};
    
    // 特殊自动填充字段
    @TableField(value = "UPDATE_STAFF_ID", fill = FieldFill.INSERT_UPDATE)
    private String updateStaffId;
    
    @TableField(value = "UPDATE_DEPART_ID", fill = FieldFill.INSERT_UPDATE)
    private String updateDepartId;
    
    @TableField(value = "UPDATE_TIME", fill = FieldFill.INSERT_UPDATE)
    private Timestamp updateTime;
}
```

### 2. Mapper接口模板
```java
package {packageName}.mapper;

import com.asiainfo.bits.skeleton.database.annotation.Storage;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import {packageName}.entity.{ClassName};

/**
 * {表注释}({ClassName})数据访问对象
 */
@Storage
public interface {ClassName}Mapper extends BaseMapper<{ClassName}> {

}
```

### 3. Service接口模板
根据数据源类型和表特性生成不同的接口方法：

**普通表（无路由、不分表）**：
```java
public interface I{ClassName}Service extends ICoreService<{ClassName}> {

    boolean save({ClassName} entity);
    
    boolean saveBatch(List<{ClassName}> entities);
    
    List<{ClassName}> queryAny({ClassName}ServiceDTO request);

    IPage<{ClassName}> pageAny({ClassName}ServiceDTO dto);
    
    boolean updateById({ClassName} entity);

    {ClassName} queryById(Long id);
    
    boolean removeById(Long id);
}
```

**地市路由表**（数据源包含{route}）：
```java
public interface I{ClassName}Service extends ICoreService<{ClassName}> {

    boolean save({ClassName} entity, String route);

    boolean saveBatch(List<{ClassName}> entities, String route);

    List<{ClassName}> queryAny({ClassName}ServiceDTO request, String route);

    IPage<{ClassName}> pageAny({ClassName}ServiceDTO dto, String route);

    boolean updateById({ClassName} entity, String route);

    {ClassName} queryById(Long id, String route);

    boolean removeById(Long id, String route);
}
```

**分表表**（yearFlag=1）：
```java
public interface I{ClassName}Service extends ICoreService<{ClassName}> {

    boolean save({ClassName} entity, String year);

    boolean saveBatch(List<{ClassName}> entities, String year);

    List<{ClassName}> queryAny({ClassName}ServiceDTO request, String year);

    IPage<{ClassName}> pageAny({ClassName}ServiceDTO dto, String year);

    boolean updateById({ClassName} entity, String year);

    {ClassName} queryById(Long id, String year);

    boolean removeById(Long id, String year);    
}
```

**地市路由+分表**（数据源包含{route}和yearFlag=1）：
```java
public interface I{ClassName}Service extends ICoreService<{ClassName}> {

    boolean save({ClassName} entity, String year, String route);

    boolean saveBatch(List<{ClassName}> entities, String year, String route);

    List<{ClassName}> queryAny({ClassName}ServiceDTO request, String year, String route);

    IPage<{ClassName}> pageAny({ClassName}ServiceDTO dto, String year, String route);

    boolean updateById({ClassName} entity, String year, String route);

    {ClassName} queryById(Long id, String year, String route);

    boolean removeById(Long id, String year, String route);
}
```

### 4. ServiceImpl实现类模板
根据数据源类型和表特性生成不同的实现方法：

**普通表（无路由、不分表）**：
```java
@Service
@DataSource("{数据源}")  // 固定数据源
public class {ClassName}ServiceImpl extends CoreServiceImpl<{ClassName}Mapper, {ClassName}> implements I{ClassName}Service{

    @Autowired
    private {ClassName}Mapper {className}Mapper;

    @Override
    public boolean save({ClassName} entity) {
        return super.save(entity);
    }
    
    @Override
    public boolean saveBatch(List<{ClassName}> entities) {
        return super.saveBatch(entities);
    }
    
    @Override
    public List<{ClassName}> queryAny({ClassName}ServiceDTO request) {
        return this.list(new QueryWrapper<{ClassName}>()
            .allEq(QueryWrapperUtils.transDTO2ColumnMap(request)));
    }

    @Override
    public IPage<{ClassName}> pageAny({ClassName}ServiceDTO dto){
        return this.page(new Page(dto.getCurrent(),dto.getPageSize()),new QueryWrapper<{ClassName}>()
        .allEq(QueryWrapperUtils.transDTO2ColumnMap(dto)));
    }
    
    @Override
    public boolean updateById({ClassName} entity) {
        return super.updateById(entity);
    }

    @Override
    public {ClassName} queryById(Long id) {
        return super.getById(id);
    }

    @Override
    public boolean removeById(Long id) {
        return super.removeById(id);
    }
}
```

**地市路由表**（数据源包含{route}）：
```java
@Service
public class {ClassName}ServiceImpl extends CoreServiceImpl<{ClassName}Mapper, {ClassName}> implements I{ClassName}Service {

    @Autowired
    private {ClassName}Mapper {className}Mapper;

    @DataSource(value = "{数据源}", policy = EparchyPolicy.class)
    @Override
    public boolean save({ClassName} entity, String route) {
        return super.save(entity);
    }

    @DataSource(value = "{数据源}", policy = EparchyPolicy.class)
    @Override
    public boolean saveBatch(List<{ClassName}> entities, String route) {
        return super.saveBatch(entities);
    }

    @DataSource(value = "{数据源}", policy = EparchyPolicy.class)
    @Override
    public List<{ClassName}> queryAny({ClassName}ServiceDTO request, String route) {
        return this.list(new QueryWrapper<{ClassName}>()
            .allEq(QueryWrapperUtils.transDTO2ColumnMap(request)));
    }

    @DataSource(value = "{数据源}", policy = EparchyPolicy.class)
    @Override
    public IPage<{ClassName}> pageAny({ClassName}ServiceDTO dto, String route){
        return this.page(new Page(dto.getCurrent(),dto.getPageSize()),new QueryWrapper<{ClassName}>()
        .allEq(QueryWrapperUtils.transDTO2ColumnMap(dto)));
    }

    @DataSource(value = "{数据源}", policy = EparchyPolicy.class)
    @Override
    public boolean updateById({ClassName} entity, String route) {
        return super.updateById(entity);
    }

    @DataSource(value = "{数据源}", policy = EparchyPolicy.class)
    @Override
    public {ClassName} queryById(Long id, String route) {
        return super.getById(id);
    }

    @DataSource(value = "{数据源}", policy = EparchyPolicy.class)
    @Override
    public boolean removeById(Long id, String route) {
        return super.removeById(id);
    }
}
```

**分表表**（yearFlag=1）：
```java
@Service
public class {ClassName}ServiceImpl extends CoreServiceImpl<{ClassName}Mapper, {ClassName}> implements I{ClassName}Service {

    @Shard(value = "{year}", policy = ShardTableAppointYearPolicy.class)
    @Override
    public boolean save({ClassName} entity, String year) {
        return super.save(entity);
    }

    @Shard(value = "{year}", policy = ShardTableAppointYearPolicy.class)
    @Override
    public boolean saveBatch(List<{ClassName}> entities, String year) {
        return super.saveBatch(entities);
    }

    @Shard(value = "{year}", policy = ShardTableAppointYearPolicy.class)
    @Override
    public List<{ClassName}> queryAny({ClassName}ServiceDTO request, String year) {
        return this.list(new QueryWrapper<{ClassName}>()
            .allEq(QueryWrapperUtils.transDTO2ColumnMap(request)));
    }

    @Shard(value = "{year}", policy = ShardTableAppointYearPolicy.class)
    @Override
    public IPage<{ClassName}> pageAny({ClassName}ServiceDTO dto, String year){
        return this.page(new Page(dto.getCurrent(),dto.getPageSize()),new QueryWrapper<{ClassName}>()
        .allEq(QueryWrapperUtils.transDTO2ColumnMap(dto)));
    }

    @Shard(value = "{year}", policy = ShardTableAppointYearPolicy.class)
    @Override
    public boolean updateById({ClassName} entity, String year) {
        return super.updateById(entity);
    }

    @Shard(value = "{year}", policy = ShardTableAppointYearPolicy.class)
    @Override
    public {ClassName} queryById(Long id, String year) {
        return super.getById(id);
    }

    @Shard(value = "{year}", policy = ShardTableAppointYearPolicy.class)
    @Override
    public boolean removeById(Long id, String year) {
        return super.removeById(id);
    }    
}
```

### 5. DTO类模板
```java
package {dtoPackageName};

import com.asiainfo.bits.core.data.PageDTO;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;
import lombok.*;
import lombok.experimental.SuperBuilder;

@Data
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode(callSuper = false)
@JsonIgnoreProperties(ignoreUnknown = true)
@ApiModel(value = "{原始表名}数据传输对象", description = "请求/响应参数")
public class {ClassName}ServiceDTO extends PageDTO {

    private static final long serialVersionUID = 1L;
    
    // 主键字段
    private {JavaType} {fieldName};
    
    // 其他字段
    private {JavaType} {fieldName};
}
```

### 6. OpenService接口模板
```java
public interface I{ClassName}OpenService {

    @ApiOperation(value = "查询{表注释}", notes = "查询{表注释}")
    List<{ClassName}ServiceDTO> queryAny({ClassName}ServiceDTO request);

    @ApiOperation(value = "分页查询{表注释}", notes = "分页查询{表注释}")
    Paging<{ClassName}ServiceDTO> pageAny({ClassName}ServiceDTO request);

    @ApiOperation(value = "保存{表注释}", notes = "保存{表注释}")
    Map<String,String> save({ClassName}ServiceDTO request);

    @ApiOperation(value = "删除{表注释}", notes = "删除{表注释}")
    Map<String,String> removeById(Long id);
}
```

### 7. OpenServiceImpl实现类模板
```java
@Service
@Slf4j
public class {ClassName}OpenServiceImpl implements I{ClassName}OpenService{

    @Autowired
    I{ClassName}Service {className}Service;
    @Autowired
    IOrderSequenceService orderSequenceService;
    
    @Override
    public List<{ClassName}ServiceDTO> queryAny({ClassName}ServiceDTO request){
        List<{ClassName}> list = {className}Service.queryAny(request);
        return CopyUtils.copyList(list, {ClassName}ServiceDTO.class);
    }

    @Override
    public Paging<{ClassName}ServiceDTO> pageAny({ClassName}ServiceDTO request){
        IPage<{ClassName}> page = new Page<>(request.getCurrent(), request.getPageSize());
        IPage<{ClassName}> res = {className}Service.pageAny(request, page);
        List<{ClassName}ServiceDTO> list = CopyUtils.copyList(res.getRecords(), {ClassName}ServiceDTO.class);
        Paging<{ClassName}ServiceDTO> resPage = new Paging<{ClassName}ServiceDTO>(list, request.getPageSize(), request.getCurrent());
        resPage.setTotalCount(res.getTotal());
        return resPage;
    }

    @Override
    public Map<String,String> save({ClassName}ServiceDTO request){
        Map<String,String> resp = new HashMap<>();
        resp.put("RESULT_CODE", "0");
        resp.put("RESULT_INFO", "ok");

        {ClassName} entity = new {ClassName}();
        CopyUtils.copy(request, entity);

        if(entity.get{PrimaryKey}() == null){
            entity.set{PrimaryKey}(orderSequenceService.getLogId());
            {className}Service.save(entity);
        }else{
            {className}Service.updateById(entity);
        }
        return resp;
    }

    @Override
    public Map<String,String> removeById(Long id){
        Map<String,String> resp = new HashMap<>();
        resp.put("RESULT_CODE", "0");
        resp.put("RESULT_INFO", "ok");

        {className}Service.removeById(id);

        return resp;
    }
}
```

## 字段类型映射
| 数据库类型 | Java类型 |
|-----------|----------|
| VARCHAR/CHAR | String |
| NUMBER/INTEGER | Long/Integer |
| DATE/TIMESTAMP | java.sql.Timestamp |
| DECIMAL | java.math.BigDecimal |

## 命名规范
| 类型 | 命名规则 | 示例 |
|-----|---------|------|
| Entity类名 | 表名转PascalCase | `UserDiscnt` |
| Mapper接口 | {ClassName}Mapper | `UserDiscntMapper` |
| Service接口 | I{ClassName}Service | `IUserDiscntService` |
| Service实现 | {ClassName}ServiceImpl | `UserDiscntServiceImpl` |
| OpenService接口 | I{ClassName}OpenService| `IUserDiscntOpenService` |
| OpenService实现 | {ClassName}OpenServiceImpl | `UserDiscntOpenServiceImpl` |
| DTO类 | {ClassName}ServiceDTO | `UserDiscntServiceDTO` |
| 变量名(小驼峰) | 首字母小写 | `userDiscnt` |
| 数据库字段 | 下划线大写 | `USER_ID` |
| Java属性 | 小驼峰 | `userId` |

## 使用步骤
1. 分析数据库表结构（建表语句）
2. 解析表名、字段名、字段类型等信息
3. 根据表名确定数据源和类名
4. 根据表特性确定是否需要路由或分表
5. 按照模板生成各个层级的代码文件
6. 检查生成的代码是否符合规范