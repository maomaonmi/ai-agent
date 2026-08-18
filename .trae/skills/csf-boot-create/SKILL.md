---
name: csf-boot-create
description: 专用于指导 AI 完成基于 Spring Boot 的 CSF (Cloud Service Framework) 接口开发，涵盖目录结构、命名规范、参数校验、业务逻辑实现及异常处理。
---

# CSF Boot 接口开发

## 1、技能概述
本技能用于指导开发者在 CSF (Cloud Service Framework) Boot 版本框架下开发后端接口。CSF 是公司自研的云化服务开发框架，其 CSF 层类似于 Spring MVC 的 Controller 层，负责对外暴露服务。本技能涵盖了从工程结构理解、接口定义、参数校验到业务逻辑实现的完整开发流程。

## 2、使用场景
*   **新增业务接口**：当需要开发新的业务功能（如查询、办理、校验等）时。
*   **接口维护与重构**：当需要修改现有接口逻辑或优化代码结构时。
*   **系统集成**：当需要通过 CSF 层封装对网关或 ESB 接口的调用时。

# 二、工作流程

## 1、工作思路
开发 CSF 接口应遵循以下步骤：
1.  **需求分析**：明确接口的功能、输入参数（Input）和输出参数（Output）。
2.  **定位目录**：根据业务模块分类，找到对应的 `csf/interfaces`, `csf/impl`, `csf/pojo` 目录。
*   **{项目编码}Busi/common目录**：src/main/java/com/asiainfo/{项目编码}Busi/common/util/
    存放公共的业务方法组件类。当用户输入的接口开发设计要求中，需要调用公共方法时，先根据方法类或名称搜索查找此目录下是否已有存在实现，如果有则直接引用，如果没有则可以在此目录下创建公共组件类。
    要求：请严格按照如下目录结构生成代码。

*   **{项目编码}Busi/server/common目录**：src/main/java/com/asiainfo/{项目编码}Busi/server/
    *   `common/constants`：存放常量类。
    *   `common/util`：存放工具类。
    *   `common/pojo`：存公共pojo类。
    *   `common/baseData`：存放基础数据类。
    *   `common/security`：存放安全相关类。
    存放公共的业务方法组件类。当用户输入的接口开发设计要求中，需要调用公共方法时，先根据方法类或名称搜索查找此目录下是否已有存在实现，如果有则直接引用，如果没有则可以在此目录下创建公共组件类。
*   **{项目编码}Busi/server/module下的POJO目录**：
    *   `src/main/java/com/asiainfo/{项目编码}Busi/server/module/{业务模块}/pojo/input/`：存放接口输入类。
    *   `src/main/java/com/asiainfo/{项目编码}Busi/server/module/{业务模块}/pojo/output/`：存放接口输出类。
*   **{项目编码}Busi/server/module下的csf目录**：
    *   `src/main/java/com/asiainfo/{项目编码}Busi/server/module/{业务模块}/csf/impl/`：存放接口定义类。
    *   `src/main/java/com/asiainfo/{项目编码}Busi/server/module/{业务模块}/csf/interfaces/`：存放接口实现类。
3.  **定义 POJO**：在 `pojo` 包下定义 Input 和 Output 对象。
    *   `src/main/java/com/asiainfo/{项目编码}Busi/server/module/{业务模块}/pojo/input/`：存放接口输入类。
    *   `src/main/java/com/asiainfo/{项目编码}Busi/server/module/{业务模块}/pojo/output/`：存放接口输出类。
4.  **定义接口**：在 `interfaces` 包下创建或修改接口文件 (`I{Model}CSV.java`)。
    *   `src/main/java/com/asiainfo/{项目编码}Busi/server/module/{业务模块}/csf/interfaces/`：存放接口实现类。
5.  **实现逻辑**：在 `impl` 包下实现接口 (`{Model}CSVImpl.java`)，处理参数校验、Session 获取、Service 调用等。
    *   `src/main/java/com/asiainfo/{项目编码}Busi/server/module/{业务模块}/csf/impl/`：存放接口定义类。
6.  **异常处理**：规范化处理业务异常和系统异常。

## 2、代码生成（输入、输出）
在生成代码前，必须明确以下要素：
*   **业务模块路径**：
    *   在开发前，请先确定业务模块所在的包路径。
    *   > **Tips**: 使用脚本快速查找模块路径。
    *   > 命令：`CSF_SKILL/scripts/search_module.sh <keyword>`，keyword 可以是 中文模块名或模块名
    *   > 示例：`CSF_SKILL/scripts/search_module.sh group` -> 查找集团客户模块路径
*   **输入 (Input)**：
    *   **单参数**：统一命名为 `input`。
    *   **多参数**：根据业务含义命名（如 `orderId`, `customerInfo`）。
    *   包含哪些字段？（如 `orderId`, `custId`）
    *   哪些是必填项？
    *   是否需要从 Session 中获取用户信息（如 `RegionId`, `OperatorId`）？
*   **输出 (Output)**：
    *   返回的数据结构是什么？
    *   成功/失败的标准返回格式。
*   **业务逻辑 (Process)**：
    *   参数校验逻辑。
    *   是否需要调用底层 Service？
    *   是否需要调用外部接口（网关/ESB）？

# 三、检查点

## 1、代码任务完整性检查
*   [ ] **POJO 类**：输入/输出对象是否已定义且字段完整（包含 getter/setter）。
*   [ ] **接口定义**：`I{ModelName}CSV` 接口是否包含所需方法。
*   [ ] **接口实现**：`{ModelName}CSVImpl` 是否实现了接口，并添加了 `@Service` 注解。
*   [ ] **依赖注入**：引用的 Service 是否通过 `@Autowired` 正确注入。

## 2、代码规范检查
*   [ ] **命名规范**：类名是否符合 `I{ModelName}CSV` / `{ModelName}CSVImpl` 格式？方法名是否以 `qry`, `deal`, `save` 等动词开头？
*   [ ] **参数规范**：
    *   单参数：统一使用 `input`。
    *   多参数：根据业务含义命名，避免使用 `input1`, `input2`。
*   [ ] **参数校验**：是否对关键入参进行了非空校验？
*   [ ] **Session 处理**：是否正确获取并使用了 SessionUserInfo（如需）。
*   [ ] **异常处理**：是否使用了 `BaseException` 抛出业务异常？
*   [ ] **日志记录**：关键路径是否有日志记录。

# 四、规范参考
*   [工程目录结构](references/project_structure.md)
*   [常用常量类参考](references/common_constants.md)
*   [常用工具类说明](references/common_utils.md)

## 1. 异常处理规范
统一使用 `com.asiainfo.{项目编码}Busi.server.common.util.exception.BaseException`。常用构造函数说明：
- `BaseException(String message)`：最常用，仅抛出错误提示信息。
- `BaseException(String message, Throwable throwable)`：包装原始异常，保留堆栈信息。
- `BaseException(String message, int code)`：指定业务错误码。
- `BaseException(String message, int code, int httpCode)`：指定业务错误码和 HTTP 状态码。

# 五、使用示例

以下是一个标准的 CSF 接口实现示例，展示了参数校验、Session 获取和 Service 调用：

```java
package com.asiainfo.{项目编码}Busi.server.module.{业务模块}.csf.impl;

// 导入必要的appframe工具包
import com.ai.aif.csf.common.utils.StringUtils;
import com.ai.appframe2.common.SessionManager;
import com.ai.appframe2.privilege.UserInfoInterface;
import com.ai.common.ivalues.IBOBsDistrictValue;
import com.ai.secframe.orgmodel.ivalues.IQBOSecOpStationOrgValue;
import com.ai.secframe.orgmodel.ivalues.IQBOSecOrgStaffOperValue;
import com.asiainfo.appframe.ext.exeframe.remote.client.ClientProxy;
import com.asiainfo.comm.util.DistrictUtil;
import com.asiainfo.comm.util.NcrmBsDistrictUtils;
import com.asiainfo.crm.sec.exe.remote.interfaces.ISec4PublicRemote;
//导入必要的业务模块包
import com.asiainfo.{项目编码}Busi.server.common.constants.CommConstants;
import com.asiainfo.{项目编码}Busi.server.common.constants.GWInterFaceCode;
import com.asiainfo.{项目编码}Busi.server.common.util.tool.ServiceTool;
import com.asiainfo.{项目编码}Busi.server.common.pojo.OutputSessionUserInfo;
import com.asiainfo.{项目编码}Busi.server.common.util.tool.SessionUserUtil;
import com.asiainfo.{项目编码}Busi.server.common.util.tool.StringUtil;
import com.asiainfo.{项目编码}Busi.server.common.util.exception.BaseException;
//导入必要的接口和POJO包
import com.asiainfo.{项目编码}Busi.server.module.{业务模块}.csf.interfaces.IOrderCSV;
import com.asiainfo.{项目编码}Busi.server.module.{业务模块}.csf.pojo.input.QryOrderInput;
import com.asiainfo.{项目编码}Busi.server.module.{业务模块}.csf.pojo.output.QryOrderOutput;
import com.asiainfo.{项目编码}Busi.server.module.{业务模块}.service.interfaces.IOrderSV;
//导入必要的日志包
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
//导入必要的Spring注解包
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class OrderCSVImpl implements IOrderCSV {

    private static final Logger logger = LoggerFactory.getLogger(OrderCSVImpl.class);

    @Autowired
    private IOrderSV iOrderSV;

    @Override
    public QryOrderOutput qryOrderInfo(QryOrderInput input) throws Exception {
        // 1. 参数校验
        if (input == null) {
            throw new BaseException("请求参数不能为空");
        }
        if (StringUtil.isEmpty(input.getOrderId())) {
            throw new BaseException("订单ID不能为空");
        }

        // 2. 获取 Session 用户信息 (如果业务需要)
        OutputSessionUserInfo userSession = SessionUserUtil.getUserSession();
        if (userSession != null) {
            input.setOpId(userSession.getOpId());
            input.setOrgId(userSession.getOrgId());
            input.setRegionId(userSession.getCurRegionId());
        }

        // 3. 业务逻辑处理 (调用 Service)
        try {
            logger.info("开始查询订单信息, OrderId: {}", input.getOrderId());
            String apiCode = GWInterFaceCode.GW_DEAL_ESOP_ATTACK_SAVE;
            String apiVersion = GWInterFaceCode.Version;
            String appCode=GWInterFaceCode.ESOP_CLIENT_APP_CODE;
            String resp= ServiceTool.getJsonDataFromGW2(appCode,apiCode,apiVersion,input);
            log.error("GW_DEAL_ESOP_ATTACK_SAVE output："+resp);
            logger.info("查询订单信息结束");
            return resp;
        } catch (BaseException e) {
            // 已经是业务异常，直接透传
            throw e;
        } catch (Exception e) {
            logger.error("查询订单失败", e);
            // 包装为 BaseException
            throw new BaseException("查询订单系统内部异常", e);
        }
    }
}
```

