---
name: csf-service-registration
description: CSF服务注册，同时注册完生成脚本
---
# CSF服务注册脚本生成

## 概述

根据Java CSV接口代码生成Oracle SQL脚本，用于注册CSF（云服务框架）服务。脚本会操作以下3张表：

| 表名 | 用途 |
|------|------|
| `BASE.CSF_SRV_SERVICE_INFO` | 服务基本信息 |
| `BASE.CSF_SRV_SERVICE_PARAM` | 服务参数定义 |
| `BASE.CSF_REGISTERBYCODE_INFO` | 服务XML配置 |

## 脚本命名规范

```
{序号}_{SCHEMA}_DML_{N}_CSF_SRV_SERVICE_INFO_{日期}_{nt账号}.sql
```

示例：`005_BASE_DML_N_CSF_SRV_SERVICE_INFO_20260304_xxx.sql`

## 生成规则

### 1. 提取服务信息

从CSV接口和实现类中提取：

```java
// 接口定义
public interface ICreditScoreCSV {
    Response<AuthAmountVO> queryAuthAmount(AuthAmountRequest request) throws Exception;
}

// 实现类
public class CreditScoreCSVImpl implements ICreditScoreCSV {
    public Response<AuthAmountVO> queryAuthAmount(AuthAmountRequest request) throws Exception { ... }
}
```

### 2. 构建SERVICE_CODE

格式：`{center_code}_{接口名}_{方法名}`

- `center_code`：中心编码，如 `mks`（营销中心）、`lcp`（低代码中心）
- 接口名：保留完整的接口名，如 `ICreditScoreCSV`
- 方法名：实际方法名，如 `queryAuthAmount`

示例：`mks_ICreditScoreCSV_queryAuthAmount`

### 3. SQL脚本结构

```sql
-- 1. 先删除已存在的数据（避免重复插入）
delete from base.CSF_SRV_SERVICE_PARAM a where a.SERVICE_CODE = '{service_code}';
delete from base.CSF_SRV_SERVICE_INFO a where a.SERVICE_CODE = '{service_code}';
delete from base.CSF_REGISTERBYCODE_INFO a where a.SERVICE_CODE = '{service_code}';

-- 2. 插入服务参数（入参定义）
INSERT INTO BASE.CSF_SRV_SERVICE_PARAM (
    PARAM_ID, SERVICE_CODE, PARAM_KEY, PARAM_NAME, PARAM_TYPE,
    PARENT_PARAM_KEY, PARAM_INOUT, ISNULL, PARAM_INDEX,
    DEFALUT_VAL, STATUS, REMARKS, VALID_DATE, EXPIRE_DATE
) VALUES (
    BASE.CSF_SRV_SERVICE_PARAM$SEQ.NEXTVAL, -- 使用序列生成主键
    '{service_code}',
    'request',                              -- 固定值
    '{param_name}',                         -- 参数中文名（可为null）
    '{request_class}',                      -- 请求类全路径
    null,                                   -- PARENT_PARAM_KEY
    'IN',                                   -- 入参固定为IN
    null,                                   -- ISNULL
    0,                                      -- PARAM_INDEX固定0
    null,                                   -- DEFALUT_VAL
    'U',                                    -- STATUS固定U
    '{remark}',                             -- 备注
    null, null                              -- VALID_DATE, EXPIRE_DATE
);

-- 3. 插入服务基本信息
INSERT INTO BASE.CSF_SRV_SERVICE_INFO (
    SERVICE_ID, SERVICE_CODE, SERVICE_AUTH_ID, CENTER_CODE,
    SERVICE_NAME, DESCRIPTION, SERVICE_TYPE, SERVICE_EXTEND_TYPE,
    RELATED_TEMPLATE_TAG, SRV_INTERFACE, SRV_IMPL_CLASS,
    SRV_METHOD, SRV_RETURN, PROTOCOL, VERSION, STATUS, OP_ID,
    CREATE_DATE, VALID_DATE, EXPIRE_DATE, EXT_A, EXT_B, EXT_C, REMARKS
) VALUES (
    BASE.CSF_SRV_SERVICE_INFO$SEQ.NEXTVAL,  -- 使用序列生成主键
    '{service_code}',
    null,                                   -- SERVICE_AUTH_ID
    '{center_code}',                        -- 中心编码
    '{method_name}',                        -- 方法名
    null,                                   -- DESCRIPTION
    '1',                                    -- SERVICE_TYPE固定1
    '2',                                    -- SERVICE_EXTEND_TYPE固定2
    null,                                   -- RELATED_TEMPLATE_TAG
    '{interface_class}',                    -- 接口全路径
    null,                                   -- SRV_IMPL_CLASS（CSV层为null）
    '{method_name}',                        -- 方法名
    'com.cmi.common.domain.Response',       -- 返回类型固定
    'socket',                               -- PROTOCOL固定socket
    '0.1',                                  -- VERSION固定0.1
    'U',                                    -- STATUS固定U
    0,                                      -- OP_ID固定0
    TIMESTAMP '{create_time}',              -- 创建时间
    TIMESTAMP '{valid_time}',               -- 生效时间
    TIMESTAMP '2099-12-31 23:59:59',        -- 过期时间固定
    null, null, null, null                  -- EXT_A/B/C, REMARKS
);

-- 4. 插入XML配置（注意：XML_CONTENT2到XML_CONTENT25共24列，需要24个null）
INSERT INTO BASE.CSF_REGISTERBYCODE_INFO (
    ID, SERVICE_CODE, XML_CONTENT1, XML_CONTENT2, XML_CONTENT3, XML_CONTENT4, XML_CONTENT5,
    XML_CONTENT6, XML_CONTENT7, XML_CONTENT8, XML_CONTENT9, XML_CONTENT10, XML_CONTENT11,
    XML_CONTENT12, XML_CONTENT13, XML_CONTENT14, XML_CONTENT15, XML_CONTENT16, XML_CONTENT17,
    XML_CONTENT18, XML_CONTENT19, XML_CONTENT20, XML_CONTENT21, XML_CONTENT22, XML_CONTENT23,
    XML_CONTENT24, XML_CONTENT25, FLAG
) VALUES (
    BASE.CSF_REGISTERBYCODE_INFO$SEQ.NEXTVAL, -- 使用序列生成主键
    '{service_code}',
    '{xml_content}',                        -- XML配置内容（见下方格式）
    null, null, null, null,                 -- XML_CONTENT2-5 (4个)
    null, null, null, null,                 -- XML_CONTENT6-9 (4个)
    null, null, null, null,                 -- XML_CONTENT10-13 (4个)
    null, null, null, null,                 -- XML_CONTENT14-17 (4个)
    null, null, null, null,                 -- XML_CONTENT18-21 (4个)
    null, null, null, null,                 -- XML_CONTENT22-25 (4个)
    ''                                      -- FLAG固定空字符串
);
```

### 4. XML_CONTENT1格式

```xml
<?xml version="1.0" encoding="UTF-8"?>
<method name="{method_name}" 
        interface="{interface_class}" 
        implClass="{impl_class}" 
        extendType="2" 
        desc="" 
        signature="{random_hash}">
    <inparam>
        <request type="{request_class}" desc="{param_desc}">
            <field1 type="{type1}"/>
            <field2 type="{type2}"/>
            <!-- 复杂类型：List -->
            <listField type="java.util.List">
                <item type="{item_type}"/>
            </listField>
        </request>
    </inparam>
    <return type="com.cmi.common.domain.Response">
        <result type="java.lang.Object"/>
        <resultCode type="java.lang.String"/>
        <resultMessage type="java.lang.String"/>
        <info type="java.lang.Object"/>
    </return>
</method>
```

### 5. 字段类型映射

| Java类型 | XML中的type属性 |
|----------|-----------------|
| `String` | `java.lang.String` |
| `Long` | `java.lang.Long` |
| `Integer` | `java.lang.Integer` |
| `Date` | `java.util.Date` |
| `List<T>` | `java.util.List` + `<item type="T"/>` |
| `Boolean` | `java.lang.Boolean` |
| `BigDecimal` | `java.math.BigDecimal` |

## 使用步骤

1. **分析Java代码**：读取CSV接口和实现类，提取方法签名、参数类型、返回类型
2. **生成SQL脚本**：按照上述规则生成完整的INSERT语句
3. **提醒注意事项**：
   - 脚本只能用于**DEV环境**插入
   - **UAT环境**需要手动导出DEV刚插入的数据，保持主键一致
   - 主键必须使用序列生成：`BASE.CSF_SRV_SERVICE_INFO$.nextval()`等

## 示例

**输入**：`ICreditScoreCSV.queryAuthAmount(AuthAmountRequest request)`

**输出SQL**：

```sql
delete from base.CSF_SRV_SERVICE_PARAM a where a.SERVICE_CODE = 'mks_ICreditScoreCSV_queryAuthAmount';
delete from base.CSF_SRV_SERVICE_INFO a where a.SERVICE_CODE = 'mks_ICreditScoreCSV_queryAuthAmount';
delete from base.CSF_REGISTERBYCODE_INFO a where a.SERVICE_CODE = 'mks_ICreditScoreCSV_queryAuthAmount';

INSERT INTO BASE.CSF_SRV_SERVICE_PARAM (PARAM_ID, SERVICE_CODE, PARAM_KEY, PARAM_NAME, PARAM_TYPE, PARENT_PARAM_KEY, PARAM_INOUT, ISNULL, PARAM_INDEX, DEFALUT_VAL, STATUS, REMARKS, VALID_DATE, EXPIRE_DATE) VALUES (BASE.CSF_SRV_SERVICE_PARAM$.nextval(), 'mks_ICreditScoreCSV_queryAuthAmount', 'request', '查询请求', 'com.cmi.mks.domain.creditScore.AuthAmountRequest', null, 'IN', null, 0, null, 'U', '查询请求', null, null);

INSERT INTO BASE.CSF_SRV_SERVICE_INFO (SERVICE_ID, SERVICE_CODE, SERVICE_AUTH_ID, CENTER_CODE, SERVICE_NAME, DESCRIPTION, SERVICE_TYPE, SERVICE_EXTEND_TYPE, RELATED_TEMPLATE_TAG, SRV_INTERFACE, SRV_IMPL_CLASS, SRV_METHOD, SRV_RETURN, PROTOCOL, VERSION, STATUS, OP_ID, CREATE_DATE, VALID_DATE, EXPIRE_DATE, EXT_A, EXT_B, EXT_C, REMARKS) VALUES (BASE.CSF_SRV_SERVICE_INFO$.nextval(), 'mks_ICreditScoreCSV_queryAuthAmount', null, 'mks', 'queryAuthAmount', null, '1', '2', null, 'com.cmi.mks.csf.interfaces.ICreditScoreCSV', null, 'queryAuthAmount', 'com.cmi.common.domain.Response', 'socket', '0.1', 'U', 0, TIMESTAMP '2026-03-04 17:11:22', TIMESTAMP '2026-03-04 17:13:11', TIMESTAMP '2099-12-31 23:59:59', null, null, null, null);

INSERT INTO BASE.CSF_REGISTERBYCODE_INFO (ID, SERVICE_CODE, XML_CONTENT1, XML_CONTENT2, ..., FLAG) VALUES (BASE.CSF_REGISTERBYCODE_INFO$.nextval(), 'mks_ICreditScoreCSV_queryAuthAmount', '<?xml version="1.0" encoding="UTF-8"?>
<method name="queryAuthAmount" interface="com.cmi.mks.csf.interfaces.ICreditScoreCSV" implClass="com.cmi.mks.csf.impl.CreditScoreCSVImpl" extendType="2" desc="" signature="9b7d8fcb9ce0dc66"><inparam>
	<request type="com.cmi.mks.domain.creditScore.AuthAmountRequest" desc="查询请求">
<salesUnitId type="java.lang.String"/>
<projectCode type="java.lang.String"/>
<type type="java.lang.String"/>
	</request>
	</inparam>
	<return type="com.cmi.common.domain.Response">
<result type="java.lang.Object"/>
<resultCode type="java.lang.String"/>
<resultMessage type="java.lang.String"/>
<info type="java.lang.Object"/>
	</return>
</method>', null, ..., '');
```

## 注意事项

1. **主键生成**：使用Oracle序列生成主键
   - `BASE.CSF_SRV_SERVICE_PARAM$SEQ.NEXTVAL`
   - `BASE.CSF_SRV_SERVICE_INFO$SEQ.NEXTVAL`
   - `BASE.CSF_REGISTERBYCODE_INFO$SEQ.NEXTVAL`

2. **查询序列语法**：
   ```sql
   SELECT BASE.CSF_SRV_SERVICE_INFO$SEQ.NEXTVAL FROM DUAL;
   ```

3. **环境限制**：生成的脚本**只能用于DEV环境**直接插入

4. **UAT/生产环境部署流程**：
   - 先在DEV环境执行脚本
   - 从DEV数据库导出刚插入的数据
   - 将导出的数据用于UAT和生产环境部署

5. **时间戳格式**：使用 `TIMESTAMP 'YYYY-MM-DD HH24:MI:SS'` 格式

6. **XML转义**：XML内容中的特殊字符需要正确处理
