# 常用常量类参考

## 1. 网关接口编码 (Gateway Interface Code)
- **类名**: `com.asiainfo.esopBusi.server.common.constants.GWInterFaceCode`
- **说明**: 
  - 存放网关接口的编码，新增网关接口时需要在此类中定义对应的常量。
  - 包含 `Version` 和 `ESOP_CLIENT_APP_CODE` 等全局常量。

- **常用字段示例**:
  ```java
  public static final String Version = "1.0.0";
  public static final String ESOP_CLIENT_APP_CODE = "sys_esbesop01";
  public static final String GW_JSON_SUCCESS_CODE = "00";
  public static final String GW_JSON_ERR_CODE = "01";
  ```

## 2. ESB 接口编码 (ESB Interface Code)
- **类名**: `com.asiainfo.esopBusi.server.common.constants.ESBInterFaceCode`
- **说明**:
  - 存放 ESB 接口的服务编码，新增 ESB 接口时需要在此类中维护。
  - 包含 `ESB_URL` 等基础配置。

- **常用字段示例**:
  ```java
  public static final String SRV_ESB_CS_QRY_MULTI_GRPQRY_001 = "ESB_CS_QRY_MULTI_GRPQRY_001";
  public static final String MN_ESB_CS_QRY_MULTI_GRPQRY_001 = ESB_URL + SRV_ESB_CS_QRY_MULTI_GRPQRY_001;
  ```

## 3. 其他常用常量
- **CommConstants**: `com.asiainfo.esopBusi.server.common.constants.CommConstants`
  - 存放通用的业务常量，如状态码、默认值等。
