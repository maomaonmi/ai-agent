# 代码审查报告 - {{FILENAME}}

## 文件基本信息

| 属性 | 值 |
|------|-----|
| 文件名 | {{FILENAME}} |
| 文件路径 | {{FILEPATH}} |
| 总行数 | {{TOTAL_LINES}} |
| 类名 | {{CLASS_NAME}} |
| 实现接口 | {{INTERFACE_NAME}} |

---

## 问题清单

### 高优先级问题

| 问题类型 | 规则ID | 严重程度 | 文件路径 | 具体位置 | 代码片段 | 建议改进措施 |
|---------|--------|----------|----------|----------|----------|-------------|
{{HIGH_PRIORITY_ISSUES}}

### 中优先级问题

| 问题类型 | 规则ID | 严重程度 | 文件路径 | 具体位置 | 代码片段 | 建议改进措施 |
|---------|--------|----------|----------|----------|----------|-------------|
{{MEDIUM_PRIORITY_ISSUES}}

### 低优先级问题

| 问题类型 | 规则ID | 严重程度 | 文件路径 | 具体位置 | 代码片段 | 建议改进措施 |
|---------|--------|----------|----------|----------|----------|-------------|
{{LOW_PRIORITY_ISSUES}}

---

## 合规性统计

| 规则类别 | 规则数量 | 违规次数 | 合规率 |
|---------|----------|----------|--------|
| CSV层规范 | {{CSV_RULE_COUNT}} | {{CSV_VIOLATION_COUNT}} | {{CSV_COMPLIANCE_RATE}} |
| JavaDoc规范 | {{JAVADOC_RULE_COUNT}} | {{JAVADOC_VIOLATION_COUNT}} | {{JAVADOC_COMPLIANCE_RATE}} |
| 硬编码检查 | {{HARDCODE_RULE_COUNT}} | {{HARDCODE_VIOLATION_COUNT}} | {{HARDCODE_COMPLIANCE_RATE}} |
| 异常处理规范 | {{EXCEPTION_RULE_COUNT}} | {{EXCEPTION_VIOLATION_COUNT}} | {{EXCEPTION_COMPLIANCE_RATE}} |
| 日志规范 | {{LOG_RULE_COUNT}} | {{LOG_VIOLATION_COUNT}} | {{LOG_COMPLIANCE_RATE}} |
| 安全规范 | {{SECURITY_RULE_COUNT}} | {{SECURITY_VIOLATION_COUNT}} | {{SECURITY_COMPLIANCE_RATE}} |
| **总计** | **{{TOTAL_RULE_COUNT}}** | **{{TOTAL_VIOLATION_COUNT}}** | **{{TOTAL_COMPLIANCE_RATE}}** |

---

## 验收标准

| 检查项 | 验证方法 | 预期结果 |
|--------|----------|----------|
| JavaDoc完整性 | 检查方法注释 | 包含所有必需标签 |
| 硬编码清理 | 搜索硬编码字符串 | 无业务相关硬编码 |
| 异常处理规范 | 检查catch块 | 使用预定义异常常量 |
| 日志规范 | 检查日志语句 | 使用占位符方式 |
| 参数校验 | 检查方法入口 | 使用CheckUtil.checkParam() |

---

*报告生成时间: {{GENERATE_TIME}}*  
*审查依据: code-review.md v2.5*
