---
name: create-api-doc
description: 分析项目日志并自动生成后端接口文档。当用户说"生成接口文档"时自动激活，扫描指定模块的Controller代码，提取所有接口信息，生成包含完整接口列表、接口规范的Markdown文档，并保存到对应模块的docs目录下。
---

# 创建后端接口文档

## 触发条件

当用户说出以下关键词时自动激活：
- "生成接口文档"
- "创建接口文档"
- "分析模块接口"

## 执行步骤

### 1. 确定目标模块

从用户输入或日志内容中识别目标模块名称，如果未找到模块，直接返回提示“模块未找到”，扫描发现有xxx1、xxx2。。。这些模块；如：
- dbInspection
- exceptionLog
- demo01
- 其他业务模块

### 2. 扫描Controller代码

查找目标模块下的所有Controller类：
```
{模块名}/src/main/java/com/ai/sh/{模块名}/controller/*.java
```

### 3. 提取接口信息

对每个Controller类，提取以下信息：

#### 类级别信息
- Controller类名
- 基础路径（@RequestMapping值）
- 类级别注解（@RestController, @RequestMapping等）

#### 方法级别信息
- 方法名
- HTTP方法（GET/POST/PUT/DELETE等）
- 请求路径
- 方法参数（@RequestParam, @PathVariable, @RequestBody等）
- 返回类型
- 方法注解（@ResponseWrapper, @GetMapping等）

### 4. 生成接口文档

#### 文档结构

```markdown
# {模块名} 接口文档

## 目录
- [接口列表](#接口列表)
- [接口详情](#接口详情)
- [请求/响应规范](#请求响应规范)

## 接口列表

| 序号 | 接口名称 | 请求方式 | 接口路径 | 说明 |
|------|----------|----------|----------|------|
| 1 | {方法名} | {HTTP方法} | {路径} | {功能说明} |

## 接口详情

### 1. {接口名称}

**接口地址**: `{完整路径}`

**请求方式**: `{HTTP方法}`

**接口说明**: {功能描述}

#### 请求参数

**路径参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| {参数名} | {类型} | {是/否} | {说明} |

**查询参数**:
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| {参数名} | {类型} | {是/否} | {说明} |

**请求体**:
```json
{
    "字段名": "类型",
    "...": "..."
}
```

#### 响应参数

**成功响应**:
```json
{
    "success": true,
    "message": "操作成功",
    "data": { ... },
    "timestamp": 1710583200000
}
```

**失败响应**:
```json
{
    "success": false,
    "message": "错误信息",
    "errorCode": "ERROR_CODE",
    "timestamp": 1710583200000
}
```

## 请求/响应规范

### 统一响应格式

所有接口统一返回 `OperationResult<T>` 格式：

| 字段 | 类型 | 说明 |
|------|------|------|
| success | boolean | 是否成功 |
| message | string | 响应消息 |
| data | T | 业务数据 |
| errorCode | string | 错误码（失败时） |
| timestamp | long | 时间戳 |

### HTTP状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 403 | 无权限 |
| 500 | 服务器内部错误 |

### 认证方式

- 使用CAS统一认证
- 请求需携带有效的Session或Token
```

### 5. 保存文档

将生成的文档保存到：
```
{模块名}/docs/{模块名}-接口文档.md
```

## 代码分析规则

### Controller识别

查找包含以下注解的类：
- `@RestController`
- `@Controller`

### HTTP方法识别

| 注解 | HTTP方法 |
|------|----------|
| `@GetMapping` | GET |
| `@PostMapping` | POST |
| `@PutMapping` | PUT |
| `@DeleteMapping` | DELETE |
| `@PatchMapping` | PATCH |
| `@RequestMapping` | 根据method属性确定 |

### 参数识别

| 注解 | 参数类型 | 说明 |
|------|----------|------|
| `@PathVariable` | 路径参数 | URL路径中的变量 |
| `@RequestParam` | 查询参数 | URL查询字符串 |
| `@RequestBody` | 请求体 | JSON/XML请求体 |
| `@RequestHeader` | 请求头 | HTTP Header |

### 响应包装识别

- 方法上有 `@ResponseWrapper` 注解：返回数据会被包装为 `OperationResult`
- 方法返回类型为 `String`：自动忽略包装

## 示例

### 输入

用户说："分析exceptionLog模块的接口"

### 处理过程

1. 识别模块名：exceptionLog
2. 扫描目录：exceptionLog/src/main/java/com/ai/sh/exceptionLog/controller/
3. 找到Controller：ErrorLogController.java
4. 提取接口信息：
   - getExceptionList
   - getExceptionDetail
   - exportExceptions
   - ...
5. 生成文档：exceptionLog/docs/exceptionLog-接口文档.md

### 输出

生成完整的接口文档，包含：
- 接口列表表格
- 每个接口的详细信息
- 请求/响应示例
- 规范说明

## 注意事项

1. **文档覆盖**：如果文档已存在，询问用户是否覆盖
2. **参数解析**：对于复杂的请求/响应对象，提取其字段信息
3. **注释优先**：优先使用方法注释作为接口说明
4. **路径拼接**：正确处理类级别和方法级别的路径拼接
5. **统一规范**：确保生成的文档符合项目规范
