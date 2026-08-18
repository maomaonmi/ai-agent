---
name: task-plus-dev
description: 根据业务需求自动生成符合规范的Plus插件代码
---

# task_plus_dev 插件开发任务技能说明

## 技能概述
根据业务需求自动生成符合规范的Plus插件代码，包括登记插件(REG)、完工插件(FINISH)、返销插件(UNDO)等不同类型。技能在生成代码时会自动读取 `templates/plus_templates.md` 文件中的常用代码参考，为开发者提供标准的代码模板和最佳实践参考。

## 使用方法

### 基本语法
```
/task_plus_dev <业务模块> <业务功能> <Plus名称> [选项参数]
```

### 参数说明
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| kind | string | 否 | 业务大类（PERSON/GROUP，默认：PERSON） |
| module_name | string | 是 | 业务模块名称（如：changeproduct） |
| biz_name | string | 是 | 具体业务名称（如：student、order） |
| plus_name | string | 是 | Plus插件名称（必须以Plus结尾） |
| trade-type | string | 否 | 业务类型编码（默认：110） |
| plus-type | string | 否 | Plus类型（REG/FINISH_FINAL等，默认：REG） |
| exec-no | int | 否 | 执行顺序（默认：100） |
| direction | string | 否 | 执行方向（FORWARD/REVERSE，默认：FORWARD） |
| generate_test | boolean | 否 | 是否生成单元测试（默认：false） |

### 使用示例

#### 基础用法
```
/task_plus_dev person student DeferredBillingRegPlus
```

#### 指定业务类型和执行顺序
```
/task_plus_dev enterprise order ProcessOrderFinishPlus --trade-type=240 --exec-no=200
```

#### 返销插件开发
```
/task_plus_dev person student UndoDeferredBillingPlus --direction=REVERSE --plus-type=BEFORE_ARCH
```

#### 不生成单元测试
```
/task_plus_dev person student DeferredBillingRegPlus --generate_test=false
```

#### 使用模板参考生成标准代码
```
/task_plus_dev person student StandardProcessPlus
```
生成的代码将自动包含来自 `templates/plus_templates.md` 的标准代码参考，如：
- 标准的台账数据操作
- 常用的UCA数据获取方法
- 服务调用的最佳实践
- Plus插件的标准结构

#### 生成返销插件并应用模板
```
/task_plus_dev person student UndoStandardProcessPlus --direction=REVERSE --plus-type=BEFORE_ARCH
```
返销插件同样会应用模板中的标准代码参考和结构。

## 支持的Plus类型

### 按执行阶段分类
| Plus类型 | 说明 | 执行时机 |
|----------|------|----------|
| REG | 登记插件 | 订单受理阶段 |
| BEFORE_REG_DB | 登记入库前插件 | 受理阶段数据入库前 |
| AFTER_REG_DB | 登记入库后插件 | 受理阶段数据入库后 |
| REG_FINAL | 登记最终插件 | 受理结束前执行 |
| BEFORE_ARCH | 归档前插件 | 完工阶段归档前 |
| AFTER_ARCH | 归档后插件 | 完工阶段归档后 |
| FINISH_FINAL | 完工最终插件 | 完工流程最后执行 |

### 按业务方向分类
| 方向 | 说明 | 适用场景 |
|------|------|----------|
| FORWARD | 正向业务 | 开户、变更等正常业务 |
| REVERSE | 返销业务 | 撤销已办理业务 |
| ABORT | 取消业务 | 终止在途工单 |

## 生成的文件结构

### Plus插件代码
```
svc/src/main/java/com/asiainfo/crm/order/svc/business/{module}/{biz}/plus/
├── reg/
│   └── {PlusName}.java              # 登记插件
├── finish/
│   └── {PlusName}.java              # 完工插件
└── undo/
    └── Undo{PlusName}.java          # 返销插件
```

### 单元测试代码
```
svc/src/test/java/com/asiainfo/crm/order/test/business/{domain}/{module}/
└── {PlusName}Test.java              # Plus插件单元测试（可通过--generate-test=false禁用）
```

## 代码生成规范

### Plus类规范
- 类名必须以Plus结尾（返销类以Undo开头）
- 实现IPlus接口
- 添加@Component、@Slf4j、@Plus注解
- 正确配置tradeTypeCode、kind、plusType等属性
- 实现execute(JobContext context)方法

### 注解配置规范
```java
@Plus(configs = {
        @PlusConfig(tradeTypeCode = "110", execNo = 100, kind = "PERSON")
}, type = Plus.PlusType.REG)
```

### 返销插件规范
```java
@Plus(direction = Direction.REVERSE, configs = {
        @PlusConfig(tradeTypeCode = "110", execNo = 100)
}, type = PlusType.BEFORE_ARCH)
public class Undo{PlusName} implements IPlus {
        // 返销逻辑实现
        }
```

## 占位符说明

| 占位符 | 说明 | 示例 | 约束 |
|-------|------|------|------|
| `{modulename}` | 业务模块名 | person | **必须全小写**，用于package/import路径 |
| `{bizname}` | 业务功能名 | student | **必须全小写**，用于package/import路径 |
| `{PlusName}` | Plus类名（PascalCase） | DeferredBillingRegPlus | 必须以`Plus`结尾 |
| `{plusName}` | Plus变量名（camelCase） | deferredBillingRegPlus | 首字母小写驼峰 |
| `{tradeTypeCode}` | 业务类型编码 | 110、240、8977 | 字符串，`-1`表示通配 |
| `{kind}` | 业务大类 | PERSON、GROUP | 个人或集团 |
| `{plusType}` | Plus类型 | REG、FINISH_FINAL、BEFORE_ARCH、AFTER_ARCH | 执行阶段 |
| `{execNo}` | 执行顺序 | 100、999 | 数值越小越先执行 |
| `{direction}` | 执行方向 | FORWARD、REVERSE | 正向或逆向（返销） |
| `{subDir}` | 子目录 | reg、finish、undo、sms | 根据Plus类型选择 |

## 开发流程

### 第一步：分析业务需求
1. 确定业务模块和功能
2. 明确Plus插件类型和执行时机
3. 确定业务类型编码和执行顺序

### 第二步：生成Plus类文件
1. 根据业务需求生成标准Plus模板
2. 自动读取并应用 `templates/plus_templates.md` 中的常用代码参考
3. 配置正确的注解参数
4. 实现业务逻辑代码

### 第三步：生成单元测试
1. 如果 {generate_test} 为 false 跳过这步
2. 创建标准测试类模板
3. 配置SpringBootTest环境
4. 编写测试用例

### 第四步：编译验证
- Linux/macOS: `./gradlew compileJava`
- Windows: `gradlew.bat compileJava`

## 注意事项

### 命名规范
- 模块名和业务名必须全小写
- Plus类名必须以Plus结尾
- 返销类名必须以Undo开头
- 包路径严格按照规范生成

### 依赖注入
- 使用@Autowired注入服务依赖
- 避免循环依赖
- 合理使用懒加载

### 日志记录
- 添加@Slf4j注解
- 关键业务逻辑添加日志
- 区分info/warn/error级别

### 异常处理
- 合理捕获和处理异常
- 使用UnifiedAsserts抛出业务异常
- 记录异常上下文信息

### 模板使用
- 生成的代码会自动包含 `templates/plus_templates.md` 中的标准代码参考
- 建议定期更新模板文件以保持最佳实践
- 可以根据具体业务需求修改模板中的代码片段

## 常见问题

### Q: Plus插件不执行怎么办？
A: 检查以下几点：
1. @Plus注解配置是否正确
2. tradeTypeCode是否匹配当前业务
3. kind和plusType是否配置正确
4. execNo执行顺序是否合理

### Q: 返销插件如何调试？
A: 返销插件调试要点：
1. 确保direction设置为REVERSE
2. 使用context.getCanceledLineData()获取被取消数据
3. 注意数据恢复的完整性和一致性

### Q: 如何处理复杂的业务逻辑？
A: 复杂业务逻辑处理建议：
1. 将复杂逻辑拆分为多个方法
2. 合理使用工具类和服务类
3. 添加详细的注释说明
4. 编写充分的单元测试

## 更新日志

### v1.0.0 (2024-03-18)
- 初始版本发布
- 支持标准Plus插件生成
- 支持返销插件生成
- 支持单元测试自动生成
- 集成完整的开发规范检查