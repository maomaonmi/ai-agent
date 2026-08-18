# CSF 工程目录结构参考

## 根目录
`com.asiainfo.{项目编码}Busi`

## 模块结构
工程采用模块化设计，每个业务功能通常包含以下包结构：

### 1. 业务模块根目录
`com.asiainfo.{项目编码}Busi.server.module.{业务模块}`

### 2. Client 层 (外部接口调用)
负责调用其他系统接口（如网关接口、ESB接口），在本工程中视为 Service。

- **实现包**: `com.asiainfo.{项目编码}Busi.server.module.{业务模块}.client.impl`
- **接口包**: `com.asiainfo.{项目编码}Busi.server.module.{业务模块}.client.interfaces`
- **ESB/网关输入输出类**: `com.asiainfo.{项目编码}Busi.server.module.{业务模块}.client.xbeans/{接口编码}`

### 3. CSF 层 (Controller 层)
类似于 Spring MVC 的 Controller 层，负责对外提供服务接口。

- **实现包**: `com.asiainfo.{项目编码}Busi.server.module.{业务模块}.csf.impl`
- **接口包**: `com.asiainfo.{项目编码}Busi.server.module.{业务模块}.csf.interfaces`
- **POJO 包**: `com.asiainfo.{项目编码}Busi.server.module.{业务模块}.csf.pojo` (接口输入输出定义)

### 4. Service 层 (可选)
负责复杂的业务逻辑处理。

- **实现包**: `com.asiainfo.{项目编码}Busi.server.module.{业务模块}.service.impl`
- **接口包**: `com.asiainfo.{项目编码}Busi.server.module.{业务模块}.service.interfaces`
- **POJO 包**: `com.asiainfo.{项目编码}Busi.server.module.{业务模块}.service.pojo`

## 常用公共目录
- **常量**: `com.asiainfo.{项目编码}Busi.server.common.constants`
- **工具类**: `com.asiainfo.{项目编码}Busi.server.common.util.tool`
