---
name: csf-production
description: CSF服务生成专家，提供完整的CSF服务生成能力，包含csf，busi，atom服务相关代码生成
---
# 表模型定义之后，通过此技能生成csf，busi，atom服务相关代码

## 资源目录说明


技能包提供的文档资源位于 `.lingma/skills/csf-production/references` 目录下：


### 🧩 refrence/ - CSF技能
CSF服务生成核心技能，优先加载变量命名_spec,其它技能基于这个变量名模块生成对应的功能。
- [变量命名_spec.md](./references/csf-production/变量命名_spec.md) - 定义变量名
- [接口页面层_spec.md](./references/csf-production/接口页面层_spec.md) - 生成csf，busi,atom服务相关
- [数据驱动层_spec.md](./references/csf-production/数据驱动层_spec.md) - 生成BO数据驱动模板
- [单元测试模板_spec.md](./references/csf-production/单元测试模板_spec.md) - 单元测试模板
