---
name: task-rule-dev
description: 根据业务需求自动生成符合规范的Rule规则代码
---

# task_rule_dev 规则开发任务技能说明

## 技能概述
根据业务需求自动生成符合规范的Rule规则代码，包括业务规则判断、数据校验、条件控制等各类规则实现。

## 使用方法

### 基本语法
```
/task_rule_dev <业务模块> <业务功能> <Rule名称> [选项参数]
```

### 参数说明
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| kind | string | 否 | 业务大类（PERSON/GROUP，默认：PERSON） |
| module_name | string | 是 | 业务模块名称（如：person、enterprise） |
| rule_name | string | 是 | Rule规则名称（首字母大写驼峰） |
| generate_test | boolean | 否 | 是否生成单元测试（默认：false） |

### 使用示例

#### 基础用法
```
/task_rule_dev person student CheckUserEligibilityRule
```

#### 指定业务大类
```
/task_rule_dev enterprise order ValidateEnterpriseOrderRule --kind=GROUP
```

#### 指定请求事实类
```
/task_rule_dev person student ProcessUserDataRule 
```

## 支持的Rule类型

### 按业务领域分类
| Rule类型 | 说明 | 应用场景 |
|----------|------|----------|
| 数据校验规则 | 验证业务数据合法性 | 用户资料校验、订单数据检查 |
| 业务判断规则 | 执行业务逻辑判断 | 资格审查、条件判定 |
| 流程控制规则 | 控制业务流程走向 | 流程分支、状态检查 |
| 依赖检查规则 | 检查业务依赖关系 | 关联数据验证、约束检查 |

### 按执行时机分类
| 时机 | 说明 | 特点 |
|------|------|------|
| 实时规则 | 订单处理过程中执行 | 响应速度快，影响处理效率 |
| 批量规则 | 定时或批量执行 | 处理大量数据，可容忍延迟 |
| 条件规则 | 满足特定条件时执行 | 灵活性高，按需触发 |

## 生成的文件结构

### Rule规则代码
```
rule/src/main/java/com/asiainfo/rule/rule/{kind}/{modulename}/
└── {RuleName}.java                  # Rule规则实现类
```

### 单元测试代码
```
rule/src/test/java/com/asiainfo/rule/test/{kind}/{modulename}/
└── {RuleName}Test.java              # Rule规则单元测试（可通过--generate-test=false禁用）
```

## 代码生成规范

### Rule类规范
- 类名采用PascalCase命名（首字母大写驼峰）
- 继承AbstractJudgeRule基类
- 添加@Slf4j日志注解
- 添加@INPARAM注解配置请求事实
- 实现executeExt方法

### 注解配置规范
```java
@INPARAM(allParams = {
    @RULEOBJ(
        ruleObjClass = TradeUserFact.class,
        attrs = {
            @ATTR(attrName = "userId"),
            @ATTR(attrName = "eparchyCode")
        },
        desc = "用户资料对象"
    )
})
public class {RuleName} extends AbstractJudgeRule {
    
    @Override
    public IRuleMsg executeExt(AbstractRule rule, IRequestFact requestFact) throws Exception {
        // 业务逻辑实现
    }
}
```

### 常用ruleObjClass类型
| 类名 | 用途 | 描述 |
|------|------|------|
| TradeFact | 业务台帐主表 | 订单主信息 |
| TradeUserFact | 用户资料 | 用户基本信息 |
| TradeDiscntFact | 资费信息 | 用户资费数据 |
| TradeProductFact | 产品信息 | 用户产品数据 |
| UserFact | 用户事实 | 用户相关数据 |
| OriginUserFact | 原始用户资料 | 变更前的用户数据 |

## 占位符说明

| 占位符 | 说明 | 示例 | 约束 |
|-------|------|------|------|
| `{modulename}` | 业务模块名 | person | **必须全小写**，用于package/import路径 |
| `{bizname}` | 业务功能名 | student | **必须全小写**，用于package/import路径 |
| `{RuleName}` | Rule类名（PascalCase） | CheckUserEligibilityRule | 首字母大写驼峰 |
| `{ruleName}` | Rule变量名（camelCase） | checkUserEligibilityRule | 首字母小写驼峰 |
| `{kind}` | 业务大类 | PERSON、GROUP | 个人或集团 |
| `{ruleObjClass}` | 请求事实类 | TradeUserFact | Rule框架中的事实类 |

## 开发流程

### 第一步：分析业务需求
1. 确定业务模块和功能
2. 明确Rule规则的业务目的
3. 确定需要的请求事实类型(ruleObjClass)
4. 分析规则执行条件和判断逻辑

### 第二步：生成Rule类文件
1. 根据业务需求生成标准Rule模板
2. 配置正确的@INPARAM注解
3. 声明所需的属性(attrs)
4. 实现具体的业务逻辑

### 第三步：生成单元测试
1. 如果 {generate_test} 为 false 跳过这步
2. 创建标准测试类模板
3. 配置必要的Mock对象
4. 编写测试用例覆盖各种场景
5. 验证规则执行结果

### 第四步：编译验证
- Linux/macOS: `./gradlew compileJava`
- Windows: `gradlew.bat compileJava`

## 注意事项

### 命名规范
- 模块名和业务名必须全小写
- Rule类名采用PascalCase命名
- 包路径严格按照规范生成

### 注解使用
- 必须添加@INPARAM注解声明所需数据
- ruleObjClass必须在attrs中声明具体属性
- 禁止通过OpenService调用，应使用ruleObjClass获取

### 日志记录
- 添加@Slf4j注解
- 关键业务逻辑添加详细日志
- 区分info/debug/warn/error级别

### 异常处理
- 合理捕获和处理异常
- 使用统一的异常处理机制
- 记录异常上下文信息

## 常见问题

### Q: Rule规则不执行怎么办？
A: 检查以下几点：
1. @INPARAM注解配置是否正确
2. ruleObjClass和attrs声明是否完整
3. Rule是否被正确注册到规则引擎
4. 触发条件是否满足

### Q: 如何调试Rule规则？
A: Rule调试要点：
1. 添加详细的日志输出
2. 使用单元测试验证逻辑
3. 检查请求事实数据是否正确
4. 验证属性声明是否完整

### Q: ruleObjClass属性获取为null怎么办？
A: 常见原因及解决方案：
1. 属性未在attrs中声明 → 在@ATTR中添加对应属性
2. 请求事实类型不匹配 → 检查ruleObjClass是否正确
3. 数据未正确传递 → 检查上游数据构造

### Q: 如何处理复杂的业务规则？
A: 复杂规则处理建议：
1. 将复杂逻辑拆分为多个简单规则
2. 合理使用规则组合和嵌套
3. 添加详细的注释说明
4. 编写充分的测试用例

## 更新日志

### v1.0.0 (2024-03-18)
- 初始版本发布
- 支持标准Rule规则生成
- 支持多种ruleObjClass类型
- 支持单元测试自动生成
- 集成完整的开发规范检查