# 变量命名规范

> 本文档定义代码生成时使用的变量值，供 `数据驱动层_spec.md`、`接口页面层_spec.md`、`单元测试模板_spec.md` 等文档引用。

## 核心变量

| 变量名                  | 变量值             | 说明       | 示例路径                                                                                              |
|----------------------|-----------------|----------|---------------------------------------------------------------------------------------------------|
| **{businessCenter}** | `pa-mks-center` | 业务中心工程名  | `pa-mks-center/src/...`                                                                          |
| **{domain}**         | `mks`           | 中心简称/业务域 | `com.cmi.mks.demo...`                                                                           |
| **{domainLabel}**    | `demo`          | 业务域标识    | `com.cmi.mks.demo...`                                                                          |
| **{module}**         | `atom`          | 模块名（小写）  | `.../task[变量命名_spec.md](../../../aicoding/%E5%8F%98%E9%87%8F%E5%91%BD%E5%90%8D_spec.md)ai/bo/...` |
| **{EntityName}**     | `TaskAi`        | 实体名（驼峰）  | `TaskAiBean.java`                                                                                 |

## 辅助变量

| 变量名 | 变量值      | 说明 |
|--------|----------|------|
| **{author}** | `zhuangrs` | 作者Git账号 |
| **{datasource}** | `PARTY`  | 数据源名称（用于BO文件） |
| **{REQUIRED_PARAM}** | `ID`     | 必填参数/主键字段 |

## 生成路径示例

### 数据驱动层（crm_6x_core）
```
{businessCenter}/
├── src/main/java/com/cmi/{domain}/{module}/bo/
│   └── BO{EntityName}.bo              → BOTaskAi.bo
└── src/main/java/com/cmi/{domain}/{module}/
    ├── bo/BO{EntityName}Bean.java     → BOTaskAiBean.java
    ├── bo/BO{EntityName}Engine.java   → BOTaskAiEngine.java
    ├── ivalues/IBO{EntityName}Value.java → IBOTaskAiValue.java
    ├── dao/interfaces/I{EntityName}DAO.java → ITaskAiDAO.java
    ├── dao/impl/{EntityName}DAOImpl.java → TaskAiDAOImpl.java
    ├── service/interfaces/I{EntityName}SV.java → ITaskAiSV.java
    └── service/impl/{EntityName}SVImpl.java → TaskAiSVImpl.java
```

### 接口页面层（{businessCenter}）
```
{businessCenter}/src/main/java/com/cmi/{domain}/csf/
├── interfaces/I{EntityName}CSV.java  → ITaskAiCSV.java
└── impl/{EntityName}CSVImpl.java      → TaskAiCSVImpl.java
```

### 单元测试
```
{businessCenter}/src/test/java/com/cmi/{domain}/demo/interfaces/
└── {EntityName}CSVImplTest.java       → TaskAiCSVImplTest.java
```
