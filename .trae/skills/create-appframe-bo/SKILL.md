---
name: create-appframe-bo
description: 根据表名和字段描述生成完整的BO配套文件（包括.bo配置文件、Bean类、Engine类、IValue接口以及建表SQL）。支持指定数据库类型，可自动推测或默认使用Oracle。
---

# 一、技能介绍

## 1、技能概述

本skill用于根据数据库表名和字段描述，自动生成完整的BO（Business Object）配套文件。BO是AppFrame2框架中的核心数据对象，包含配置文件、Java类文件和建表SQL。

生成的文件包括：
- `.bo` 配置文件：定义表结构和字段映射
- `Bean` 类文件：数据实体类，实现IValue接口
- `Engine` 类文件：业务逻辑处理类
- `IValue` 接口文件：定义数据访问接口
- 建表SQL文件：数据库表创建语句

## 2、使用场景

- 新建数据库表时需要生成对应的Java BO类
- 数据库表结构变更后需要同步更新BO文件
- 快速原型开发时批量生成数据对象
- 遗留系统迁移时重建BO层代码

触发条件：
- 用户描述包含"生成BO"、"BO文件"、"Bean类"、"Engine类"、"建表SQL"等关键词
- 用户直接请求生成BO文件或Business Object


# 二、工作流程

## 1、工作思路

1. **解析输入参数**
   - 提取表名（必需）
   - 解析字段描述（必需）
   - 确定命名空间（可选，自动推测）
   - 确定输出目录（可选，默认当前目录）

2. **分析字段信息**
   - 识别字段名、数据类型、注释
   - 自动推测Java类型和数据库类型
   - 识别主键字段（标记"主键"或"PK"）

3. **生成BO名称**
   - 将表名转换为驼峰命名
   - `user_info` → `UserInfo`
   - `order_detail` → `OrderDetail`

4. **生成配套文件**
   - 生成.bo配置文件
   - 生成Bean类
   - 生成Engine类
   - 生成IValue接口
   - 生成建表SQL

5. **输出结果**
   - 按目录结构组织文件
   - 对源文件的缩进进行调整，确保代码易于阅读
   - 返回生成文件列表

## 2、代码生成（输入、输出）

### 输入参数

| 参数 | 必需 | 说明                                                                          |
|------|------|-----------------------------------------------------------------------------|
| 表名 | 是 | 数据库表名，如 `user_info`、`order_detail`                                          |
| 字段描述 | 是 | 表的字段描述，支持多种格式                                                               |
| 命名空间 | 否 | Java包名，如 `com.ai.appframe2.bo.user`，默认自动推测                                  |
| 输出目录 | 否 | 生成文件的输出目录，默认自动推测                                                            |
| 数据库类型 | 否 | 数据库类型，支持：Oracle、MySQL、DB2、Sybase、AntDB、Panwei、GoldenDB。默认自动推测，无法推测时使用Oracle |

### 数据库类型说明

系统按照以下顺序确定数据库类型：
1. **用户显式指定**：优先使用用户指定的数据库类型
2. **自动推测**：从项目配置文件（如`config/AIConfig.xml`）中读取`DATABASE_DIALECT`配置并判断数据库类型
3. **默认值**：如果无法推测，默认使用Oracle

| 数据库类型     | 特点                       |
|-----------|--------------------------|
| Oracle    | 默认值，使用Oracle语法           |
| MySQL     | 使用MySQL语法（ENGINE=InnoDB） |
| DB2       | 使用DB2语法                  |
| Sybase    | 使用Sybase语法               |
| AntDB     | 使用PostgreSQL语法           |
| Panwei    | 使用PostgreSQL语法           |
| GoldenDB  | 使用MySQL语法                |

### 字段描述格式

**格式1：字段名:字段注释:字段类型**
```
user_id:用户ID:主键
balance:余额:DECIMAL(18,2)
create_time:创建时间:TIMESTAMP
```

**格式2：字段名:字段类型:字段注释**
```
user_id:VARCHAR(32):用户ID
balance:DECIMAL(18,2):余额
create_time:TIMESTAMP:创建时间
```

### 数据类型映射

| Java类型 | 数据库类型 | 识别关键词 |
|----------|-----------|-----------|
| String | VARCHAR | 默认 |
| Integer | INT/NUMBER | 计数、数量、状态 |
| Long | BIGINT/NUMBER | 金额、ID（大范围）|
| Double | DECIMAL | 金额、价格、比例 |
| DateTime | TIMESTAMP | 时间、日期 |

### 输出文件结构

```
output/
├── com/ai/appframe2/{模块名}/bo/
│   ├── {BO名}.bo              # BO配置文件
│   ├── {BO名}Bean.java          # Bean类
│   └── {BO名}Engine.java        # Engine类
├── com/ai/appframe2/{模块名}/ivalues/
│   └── I{BO名}Value.java        # IValue接口
└── sql/
    └── {表名}.sql                 # 建表SQL
```

### 生成示例

**输入：**
```
表名: user_info
字段描述:
user_id:用户ID:主键
user_name:用户姓名
balance:余额:DECIMAL(18,2)
create_time:创建时间:TIMESTAMP
```

**输出：**
- `UserInfo.bo` - BO配置文件
- `UserInfoBean.java` - Bean类
- `UserInfoEngine.java` - Engine类
- `IUserInfoValue.java` - IValue接口
- `user_info.sql` - 建表SQL


# 三、执行指令

## 1、执行方式

### 方式一：Python脚本调用（命令行模式）

**基本命令格式：**
```bash
python3 scripts/skill.py <表名> <字段描述> [命名空间] [输出目录] [数据库类型]
```

**参数说明：**
| 参数 | 必需 | 说明 |
|------|------|------|
| `表名` | 是 | 数据库表名，如 `user_info` |
| `字段描述` | 是 | 字段描述字符串，多个字段用空格分隔 |
| `命名空间` | 否 | Java包名，默认 `com.ai.appframe2.bo` |
| `输出目录` | 否 | 输出路径，默认 `./output` |
| `数据库类型` | 否 | 数据库类型（Oracle/MySQL/DB2/Sybase/AntDB/Panwei/GoldenDB），默认自动推测 |

**执行示例：**

```bash
# 简单用法
python3 scripts/skill.py user_info 'user_id:用户ID:主键 user_name:用户姓名'

# 完整用法（指定命名空间、输出目录和数据库类型）
python3 scripts/skill.py order_info \
  'order_id:订单ID:主键:VARCHAR(32) order_amount:订单金额:DECIMAL(18,2)' \
  'com.ai.appframe2.bo.order' \
  './output' \
  'MySQL'

# 使用Oracle语法生成
python3 scripts/skill.py order_info \
  'order_id:订单ID:主键:VARCHAR2(32) order_amount:订单金额:NUMBER(18,2)' \
  'com.ai.appframe2.bo.order' \
  './output' \
  'Oracle'
```

### 方式二：交互式模式

不带参数运行脚本进入交互式模式：

```bash
python3 scripts/skill.py
```

**交互流程：**
1. 输入表名
2. 逐行输入字段描述（每行一个字段，空行结束）
3. 是否指定命名空间（可选）
4. 是否指定输出目录（可选）
5. 确认数据库类型（可选）
6. 执行生成并输出结果

### 方式三：Python API调用

```python
import sys
sys.path.insert(0, 'scripts')
from skill import BOGeneratorSkill

skill = BOGeneratorSkill()

# 准备字段描述
field_descriptions = [
    'user_id:用户ID:主键:VARCHAR(32)',
    'user_name:用户姓名:VARCHAR(100)',
    'create_time:创建时间:TIMESTAMP'
]

# 执行生成（自动推测数据库类型）
skill.process_input(
    table_name='user_info',
    field_descriptions=field_descriptions,
    namespace='com.ai.appframe2.bo.user',
    output_dir='./output'
)

# 执行生成（显式指定数据库类型）
skill.process_input(
    table_name='user_info',
    field_descriptions=field_descriptions,
    namespace='com.ai.appframe2.bo.user',
    output_dir='./output',
    db_type='MySQL'
)
```

## 2、Python环境检测

脚本执行前会自动检测Python环境：

| 操作系统 | 检测路径 |
|---------|---------|
| macOS | `/usr/bin/python3` 或 `/usr/local/bin/python3` |
| Linux | `/usr/bin/python3` 或 `/usr/bin/python` |
| Windows | `python` 或 `python3` 命令 |

如果未检测到Python，脚本会提示安装方法。


# 四、检查点

## 1、代码任务完整性检查

- [ ] 是否生成了全部5个配套文件
- [ ] .bo配置文件是否包含完整的字段定义
- [ ] Bean类是否实现了正确的IValue接口
- [ ] Engine类是否继承了正确的基类
- [ ] IValue接口是否定义了所有字段的getter/setter
- [ ] 建表SQL是否包含主键约束

## 2、代码规范检查

- [ ] 表名使用小写字母和下划线（snake_case）
- [ ] Java类名使用驼峰命名（CamelCase）
- [ ] 包名符合Java命名规范（小写，点分隔）
- [ ] 字段注释清晰完整
- [ ] 主键字段正确标记
- [ ] SQL语句语法正确

# 五、规范参考

命名规范：
- 表名：`{模块}_{实体}`，如 `user_info`、`order_detail`
- 主键：`{表名}_id`，如 `user_id`、`order_id`
- 时间字段：`create_time`、`update_time`
- 状态字段：`status` 或 `{表名}_status`


# 六、使用示例

### 示例1：简单用法

**用户输入：**
```
表名: user_info
字段描述:
user_id:用户ID:主键
user_name:用户姓名
create_time:创建时间
```

**Skill执行：**
1. 解析表名 `user_info`，生成BO名称 `UserInfo`
2. 识别字段：`user_id`（主键）、`user_name`、`create_time`
3. 自动推测类型：String、String、DateTime
4. 生成5个配套文件

**输出文件：**
```
output/
├── com/ai/appframe2/bo/
│   ├── UserInfo.bo
│   ├── UserInfoBean.java
│   └── UserInfoEngine.java
├── com/ai/appframe2/ivalues/
│   └── IUserInfoValue.java
└── sql/
    └── user_info.sql
```

### 示例2：完整用法（指定参数）

**用户输入：**
```
表名: order_info
字段描述:
order_id:订单ID:主键:VARCHAR(32)
order_amount:订单金额:DECIMAL(18,2)
customer_name:客户姓名:VARCHAR(100)
order_status:订单状态:INTEGER
create_time:创建时间:TIMESTAMP

命名空间: com.ai.appframe2.bo.order
输出目录: /path/to/output
```

**Skill执行：**
1. 解析表名 `order_info`，生成BO名称 `OrderInfo`
2. 识别字段：`order_id`（主键）、`order_amount`、`customer_name`、`order_status`、`create_time`
3. 自动推测类型：String、Double、String、Integer、DateTime
4. 在 /path/to/output 中创建 com.ai.appframe2.bo.order
5. 在对应的包目录下生成5个配套文件
