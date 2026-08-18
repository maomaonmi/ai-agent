# 常用工具类说明

## 1. 网关接口调用工具
- **类名**: `com.asiainfo.esopBusi.server.common.util.tool.http.GatewayHttpUtil`
- **主要方法**:
    - `invokeHttpXMLServiceByPost(String appCode, String apiCode, String apiVersion, Object obj)`: 
      - **说明**: 发起 POST 请求调用 XML 格式的网关接口。
      - **参数**:
          - `appCode`: 应用编码 (常量类 `GWInterFaceCode` 中定义)。
          - `apiCode`: 接口编码 (常量类 `GWInterFaceCode` 中定义)。
          - `apiVersion`: 接口版本 (通常为 `GWInterFaceCode.Version`)。
          - `obj`: 请求体对象。
      - **返回值**: `RespParam` (响应结果)。

## 2. ESB/Service 调用工具
- **类名**: `com.asiainfo.esopBusi.server.common.util.tool.ServiceTool`
- **主要方法**:
    - `getDataFromEsb(String serviceName, String methodName, Object busiInfo)`:
      - **说明**: 通过 ESB 客户端获取数据，底层调用网关接口。
      - **参数**:
          - `serviceName`: 服务名称。
          - `methodName`: 方法名称。
          - `busiInfo`: 业务信息对象。
      - **返回值**: `Map<String, Object>` (返回数据 Map)。

    - `getDataFromEsb(String serviceName, String methodName, Object busiInfo, OutputSessionUserInfo sessionUserInfo)`:
      - **说明**: 带会话用户信息的 ESB 数据获取。

    - `getEsbErrMsg(Exception e)`:
      - **说明**: 获取异常信息，处理嵌套异常。

    - `throwBaseExceptionAndLog(String str, Log log)`:
      - **说明**: 抛出 `BaseException` 并记录错误日志。

## 3. 会话用户信息工具
- **类名**: `com.asiainfo.esopBusi.server.common.util.tool.SessionUserUtil`
- **主要方法**:
    - `getUserSession()`:
      - **说明**: 获取当前会话的用户信息，包括操作员ID、组织ID、地市ID等。
      - **返回值**: `OutputSessionUserInfo` 对象。
      - **常用字段**:
          - `getOpId()`: 操作员ID
          - `getOpName()`: 操作员名称
          - `getOrgId()`: 组织ID
          - `getCurRegionId()`: 当前地市ID
          - `getOpPhone()`: 操作员手机号码

## 4. 其它常用工具
- **JSON处理**: `com.alibaba.fastjson.JSON` 或 `net.sf.json.JSONObject`
- **字符串处理**: `com.asiainfo.esopBusi.server.common.util.tool.StringUtil`
- **日期处理**: `com.asiainfo.esopBusi.server.common.util.tool.DateTimeUtil`
