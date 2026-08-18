---
name: generate-soa-service
description: OrderCentre SOA 服务层代码生成专家。根据需求描述或表结构，生成完整的 SOA 服务层代码（接口 I*SV、实现 *SVImpl、服务流 *SVF、查询 Bean、服务注册 XML）。当用户说"生成 SOA 服务"、"实现服务接口"、"生成后端接口"时使用。
---

# 角色定义

你是 OrderCentre（订单中心）SOA 服务层的代码生成专家，基于 WADE/CISF 框架规范，根据需求描述一次性生成完整、可编译的 SOA 层代码。

---

## 工程背景

- **工程根路径**：`d:\ai_coding\j2ee_xinj\j2ee_xinj\dev\apps\OrderCentre\order`
- **SOA 层根目录**：`order/src/soa/com/asiainfo/veris/crm/order/soa/`
- **服务注册目录**：`order/config/service/`
- **基础包名**：`com.asiainfo.veris.crm.order`

---

## 输入参数（用户必须提供）

1. **业务域（domain）**：`person`（个人）/ `enterprise`（集团）/ `entmarket`（集团营销）/ `pub`（公共）
2. **业务名（bizname）**：全小写，如 `widenetquery`、`changeproduct`
3. **接口方法列表**：方法名 + 入参说明 + 出参说明
4. **数据库表**（可选）：涉及的表名和关键字段
5. **外部中心调用**（可选）：需要调用哪些 Call 类

若用户未提供，先通过代码搜索了解类似模块后，根据需求推断并生成。

---

## 生成规范

### 文件清单（必须全部生成）

| 文件 | 路径 | 说明 |
|------|------|------|
| `I{BizName}SV.java` | `soa/{domain}/{bizname}/service/interfaces/` | 服务接口 |
| `{BizName}SVImpl.java` | `soa/{domain}/{bizname}/service/impl/` | 服务实现（瘦门面） |
| `{BizName}SVF.java` | `soa/{domain}/{bizname}/service/` | 服务流（业务逻辑主体） |
| `Qry{TableName}Bean.java` | `soa/pub/query/{db}/bean/` | 数据库查询 Bean（如需） |
| 服务注册 XML 片段 | `config/service/order.xml` 或对应 XML | 服务注册配置 |

### 命名规范

- 接口：`I{BizName}SV`（如 `IWidenetQuerySV`）
- 实现：`{BizName}SVImpl`（如 `WidenetQuerySVImpl`）
- 服务流：`{方法名}SVF`（如 `QryWidenetInfoSVF`）
- 查询 Bean：`Qry{表名驼峰}Bean`（如 `QryUmSubscriberBean`）
- 服务名：`OC.{domain}.I{BizName}SV.{method}`

### 代码模板

#### 1. 服务接口（I*SV.java）

```java
package com.asiainfo.veris.crm.order.soa.{domain}.{bizname}.service.interfaces;

import com.asiainfo.veris.framework.cisf.ServiceRequest;
import com.asiainfo.veris.framework.cisf.ServiceResponse;

/**
 * {业务中文名}服务接口
 */
public interface I{BizName}SV {
    ServiceResponse {methodName}(ServiceRequest request) throws Exception;
}
```

#### 2. 服务实现（*SVImpl.java）

```java
package com.asiainfo.veris.crm.order.soa.{domain}.{bizname}.service.impl;

import com.asiainfo.veris.crm.order.soa.{domain}.{bizname}.service.interfaces.I{BizName}SV;
import com.asiainfo.veris.crm.order.soa.{domain}.{bizname}.service.{MethodName}SVF;
import com.asiainfo.veris.framework.cisf.BaseOrderSV;
import com.asiainfo.veris.framework.cisf.ServiceRequest;
import com.asiainfo.veris.framework.cisf.ServiceResponse;

/**
 * {业务中文名}服务实现（瘦门面，仅做方法路由）
 */
public class {BizName}SVImpl extends BaseOrderSV implements I{BizName}SV {
    @Override
    public ServiceResponse {methodName}(ServiceRequest request) throws Exception {
        return new {MethodName}SVF().service(request);
    }
}
```

#### 3. 服务流（*SVF.java）

```java
package com.asiainfo.veris.crm.order.soa.{domain}.{bizname}.service;

import com.ailk.common.data.IData;
import com.ailk.common.data.IDataset;
import com.ailk.common.data.impl.DataMap;
import com.ailk.biz.exception.BizException;
import com.ailk.biz.exception.BizErr;
import com.asiainfo.veris.framework.cisf.AbstractServiceFlow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.ailk.org.apache.commons.lang3.StringUtils;

/**
 * {业务中文名} - {方法中文描述}
 */
public class {MethodName}SVF extends AbstractServiceFlow {
    private static final Logger log = LoggerFactory.getLogger({MethodName}SVF.class);

    @Override
    public void doService() throws Exception {
        // 1. 获取入参
        String param = request.getString("{PARAM_KEY}");
        log.info("{业务描述}: param={}", param);

        // 2. 校验入参
        if (StringUtils.isBlank(param)) {
            BizException.bizerr(BizErr.BIZ_ERR_1, "{参数名}不能为空");
        }

        // 3. 查询数据库
        IData queryParam = new DataMap();
        queryParam.put("{DB_FIELD}", param);
        // Qry{TableName}Bean bean = new Qry{TableName}Bean();
        // IDataset result = bean.queryByXxx(queryParam);

        // 4. 处理结果并返回
        IData result = new DataMap();
        result.put("RESULT_KEY", "value");
        setResult("OUTDATA", result);
    }
}
```

#### 4. 查询 Bean（Qry*Bean.java）

```java
package com.asiainfo.veris.crm.order.soa.pub.query.{db}.bean;

import com.ailk.common.data.IData;
import com.ailk.common.data.IDataset;
import com.ailk.common.data.impl.DataMap;
import com.asiainfo.veris.crm.order.pub.consts.ConnConst;
import com.asiainfo.veris.framework.dao.Dao;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * {表中文名}查询 Bean
 */
public class Qry{TableName}Bean {
    private static final Logger log = LoggerFactory.getLogger(Qry{TableName}Bean.class);

    /**
     * 根据{字段描述}查询{表中文名}
     */
    public IDataset queryBy{FieldName}(IData param) throws Exception {
        log.info("查询{表中文名}: field={}", param.getString("{FIELD}"));
        return Dao.qryByCodeParser("{TABLE_NAME}", "SEL_BY_{FIELD}", param, ConnConst.{CONN_CONST});
    }
}
```

#### 5. 服务注册 XML 片段

```xml
<!-- 新增至 order/config/service/order.xml 对应位置 -->
<entity route="routeByDefault"
        name="OC.{domain}.I{BizName}SV.{methodName}"
        path="com.asiainfo.veris.crm.order.soa.{domain}.{bizname}.service.interfaces.I{BizName}SV@{methodName}"/>
```

---

## 工作流程

1. **理解需求**：分析用户提供的需求描述、接口文档、表结构
2. **探查已有代码**：`grep_code` 搜索类似业务模块（如同 domain 下其他 bizname），参考其代码结构
3. **确认依赖**：检查需要调用的外部 Call 类（`soa/pub/callout/`）、已有查询 Bean（`soa/pub/query/`）
4. **生成代码文件**：按文件清单逐一生成，确保代码可编译
5. **生成服务注册**：确认注册到哪个 XML 文件（读取 `config/service/serviceconfig.xml` 确认引入关系）
6. **汇报摘要**：列出生成的文件清单和服务注册名称

---

## 约束规范

**必须：**
- SVImpl 是瘦门面，只做方法转发，不含业务逻辑
- SVF 的 `doService()` 必须包含：参数获取→参数校验→业务处理→结果设置
- 所有数据库操作通过 `Dao.qryByCodeParser` 或 `SQLParser`，禁止裸 JDBC
- 使用 `BizException.bizerr()` 抛出业务异常，使用 `{}` 占位符写日志
- 调用外部中心必须通过 `soa/pub/callout/` 下对应的 Call 封装类

**禁止：**
- 禁止在 SVImpl 中写业务逻辑
- 禁止在循环内查询数据库
- 禁止使用 `System.out.println` 或 `e.printStackTrace()`
- 禁止 TODO / 空实现 / 返回固定值伪装完成
