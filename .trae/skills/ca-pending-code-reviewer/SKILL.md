---
name: ca-pending-code-reviewer
description: >
  获取待提交代码和文件变更,支持基于 Git Diff 的变更检测、变更类型分析、依赖关系追踪,
  以及变更行号精准定位。支持 Java、Python、Go、Node.js、PHP 等主流技术栈。
  **本 Skill 是"代码分析分身"编排器（项目根 代码分析分身.md）的内部子调用，
  仅在被编排器在第1步和第1.7步显式调用时执行；不响应"代码审查/代码变更"等用户层通用词，
  也不因自身 description 中的关键词自触发。**
---

# 待提交代码和文件获取

智能识别代码变更,获取待提交代码和文件列表,提供精确的行号定位和变更类型分析,返回结构化结果（可选写文件留痕）。

## 调用约定

**调用方**：仅由 `代码分析分身.md` 编排器在标准执行流程第1步（获取变更范围）和第1.7步（生成索引快照）显式调用。
**禁止行为**：
- 禁止因用户提到"代码审查"、"代码变更"等通用词而自触发
- 禁止在自身执行过程中再次调用自己（防止死循环）
- 禁止在 git diff 为空时反复重试或更换 base 范围（应返回 `empty:true` 由编排器处理）

**输入参数**（由编排器透传）：
- `scope`：`pending`（默认，git diff）| `path:<路径>` | `module:<模块>` | `project` | `range:HEAD~N..HEAD` | `branch:base..target`
- `write_file`：`true`（默认，写 .md 留痕）| `false`（仅返回 JSON，不写文件）
- `files`：可选；恢复模式（编排器 `resume_point=snapshot`）下由编排器从 state 取出 `scope.files` 注入，skill 跳过所有 git 命令，直接基于该列表生成索引快照；非恢复模式忽略此参数

**输出协议**：
```json
{
  "empty": false,
  "stats": {"added": 2, "modified": 3, "deleted": 1, "renamed": 0, "total": 6},
  "files": [
    {"path": "src/.../UserService.java", "type": "M", "lines": "L45-L67", "lang": "java"},
    {"path": "src/.../NewController.java", "type": "A", "lines": null, "lang": "java"}
  ],
  "deps": ["UserController.java", "AuthService.java"],
  "report_file": "openspec/sdlc-agent/代码分析分身/reports/pending-changes-xxx-YYYYMMDD.md",
  "snapshot_index_file": "openspec/sdlc-agent/代码分析分身/reports/snapshot-index-YYYYMMDD.yaml"
}
```
- `empty:true` 时其余字段省略，编排器进入"无变更兜底"
- `report_file` 仅在 `write_file:true` 时存在
- `snapshot_index_file`：索引式快照（只含文件路径、变更类型、风险等级、变更摘要，**不复制文件内容**），供后续维度 skill 按需读取源文件；删除文件(D)不写入索引

## 核心能力

### 1. 待提交代码识别
- **基于 Git Diff**:自动识别新增、修改、删除、重命名的文件
- **精确行号定位**:提取变更的具体行号范围,实现精准定位
- **变更类型分析**:根据文件变更类型(A/M/D/R)进行分类统计
- **依赖关系追踪**:分析变更文件的引用关系,识别关联文件
- **包含未提交代码**（默认通过 `git status --porcelain` 一次性获取，写入文件供 agent 读取）:
  - **暂存区变更**:已 `git add` 但未 commit 的代码（porcelain 第一列状态码）
  - **工作区变更**:已修改但未 `git add` 的代码（porcelain 第二列状态码）
  - **未跟踪文件**:新创建未 add 的文件（porcelain `??` 标记）
  - **已提交变更**:两个分支或提交之间的差异（仅指定 branch/range 范围时用 `git diff`）

### 2. 变更统计与分析
- **新增文件(A)**:统计新增文件列表及数量
- **修改文件(M)**:统计修改文件列表、数量及变更行号
- **删除文件(D)**:统计删除文件列表及数量
- **重命名文件(R)**:统计重命名文件列表及新旧路径

### 3. 变更报告生成
- **变更概览**:项目信息、对比基准、变更统计
- **变更详情**:文件路径、变更类型、行号范围
- **依赖分析**:变更文件的引用关系和关联文件

## 支持的技术栈

### 自动识别
扫描器会自动检测项目技术栈并调整扫描策略,支持:

#### 后端技术栈

##### Java 生态
- **框架**: Spring Boot, Spring MVC, Play Framework, Micronaut, Quarkus
- **构建工具**: Maven (pom.xml), Gradle (build.gradle)
- **数据访问**: MyBatis, Hibernate, JPA, JDBC
- **配置管理**: application.properties/yml, bootstrap.yml

##### Python 生态
- **框架**: Django, Flask, FastAPI, Tornado, Pyramid
- **包管理**: pip (requirements.txt), Poetry (pyproject.toml), Conda
- **ORM**: Django ORM, SQLAlchemy, Peewee
- **配置管理**: .env, config.py, settings.py

##### Go 生态
- **框架**: Gin, Echo, Beego, Fiber, Chi
- **包管理**: Go Modules (go.mod, go.sum)
- **ORM**: GORM, sqlx, database/sql
- **配置管理**: Viper, envconfig, .env

##### Node.js 后端生态
- **框架**: Express, Koa, NestJS, Fastify, Hapi
- **包管理**: npm (package.json), yarn, pnpm
- **ORM**: Prisma, Sequelize, TypeORM, Mongoose
- **配置管理**: .env, config.js, .env.local

##### PHP 生态
- **框架**: Laravel, Symfony, CodeIgniter, Yii, ThinkPHP
- **包管理**: Composer (composer.json)
- **ORM**: Eloquent, Doctrine, PDO
- **配置管理**: .env, config/*.php

#### 前端技术栈

##### Vue.js 生态
- **框架**: Vue 2/3, Nuxt.js
- **构建工具**: Vite, Webpack, Vue CLI
- **状态管理**: Vuex, Pinia
- **UI 框架**: Element UI/Plus, Vuetify, Ant Design Vue
- **配置管理**: vue.config.js, vite.config.js, .env

##### React 生态
- **框架**: React, Next.js, Gatsby, Remix
- **构建工具**: Create React App, Vite, Webpack
- **状态管理**: Redux, MobX, Zustand, Recoil
- **UI 框架**: Ant Design, Material-UI, Chakra UI
- **配置管理**: craco.config.js, vite.config.js, .env

##### Angular 生态
- **框架**: Angular
- **构建工具**: Angular CLI, Webpack
- **状态管理**: NgRx, Akita
- **UI 框架**: Angular Material, NG-ZORRO
- **配置管理**: angular.json, tsconfig.json, .env

##### 原生前端
- **技术**: HTML5, CSS3, JavaScript (ES6+)
- **构建工具**: Webpack, Rollup, Parcel
- **CSS 预处理**: Sass, Less, Stylus
- **配置管理**: webpack.config.js, .babelrc, .env

## 获取范围

### 包含范围(按技术栈自动适配)

#### 通用文件
- **配置文件**: `.env`, `.env.*`, `*.yml`, `*.yaml`, `*.json`, `*.xml`, `*.ini`, `*.conf`
- **构建文件**: `Dockerfile`, `docker-compose.yml`, `k8s/*.yaml`, `helm/*`, `Makefile`
- **依赖文件**: `pom.xml`, `build.gradle`, `package.json`, `requirements.txt`, `go.mod`, `composer.json`, `Gemfile`

#### 后端项目

##### Java 项目
- **源码文件**: `.java`, `.kt`, `.groovy`
- **配置文件**: `application*.yml`, `application*.properties`, `log4j2.xml`, `mybatis-config.xml`
- **构建文件**: `pom.xml`, `build.gradle`, `gradle.properties`
- **映射文件**: `*Mapper.xml`

##### Python 项目
- **源码文件**: `.py`
- **配置文件**: `.env`, `config.py`, `settings.py`, `requirements.txt`, `pyproject.toml`
- **模板文件**: `.html`, `.jinja2`, `.j2`

##### Go 项目
- **源码文件**: `.go`
- **配置文件**: `.env`, `config.yaml`, `config.json`
- **构建文件**: `go.mod`, `go.sum`, `Makefile`

##### Node.js 后端项目
- **源码文件**: `.js`, `.ts`
- **配置文件**: `.env`, `.env.local`, `config/*`, `package.json`
- **构建文件**: `package.json`, `yarn.lock`, `pnpm-lock.yaml`

##### PHP 项目
- **源码文件**: `.php`
- **配置文件**: `.env`, `config/*.php`, `.htaccess`
- **构建文件**: `composer.json`, `composer.lock`

#### 前端项目

##### Vue.js 项目
- **源码文件**: `.vue`, `.js`, `.ts`
- **样式文件**: `.css`, `.scss`, `.less`, `.sass`
- **配置文件**: `vue.config.js`, `vite.config.js`, `.env`, `.env.*`
- **构建文件**: `package.json`, `yarn.lock`, `pnpm-lock.yaml`

##### React 项目
- **源码文件**: `.jsx`, `.tsx`, `.js`, `.ts`
- **样式文件**: `.css`, `.scss`, `.less`, `.sass`, `.styled.js`
- **配置文件**: `craco.config.js`, `vite.config.js`, `.env`, `.env.*`
- **构建文件**: `package.json`, `yarn.lock`, `pnpm-lock.yaml`

##### Angular 项目
- **源码文件**: `.ts`, `.html`
- **样式文件**: `.css`, `.scss`, `.less`, `.sass`
- **配置文件**: `angular.json`, `tsconfig.json`, `.env`
- **构建文件**: `package.json`, `yarn.lock`, `pnpm-lock.yaml`

##### 原生前端项目
- **源码文件**: `.html`, `.htm`
- **样式文件**: `.css`, `.scss`, `.less`, `.sass`
- **脚本文件**: `.js`, `.mjs`
- **配置文件**: `webpack.config.js`, `.babelrc`, `.env`

### 排除范围
- `test/`, `tests/`, `src/test/`, `__tests__/`, `example/`, `examples/`, `docs/`, `dist/`, `build/`, `target/`, `.idea/`, `.vscode/`
- `node_modules/`, `vendor/`, `.venv/`, `venv/`, `__pycache__/`, `.git/`
- 二进制文件（`.jar`, `.war`, `.class`, `.exe`, `.so`, `.dll`）
- 图片、字体、压缩包等非文本资源

## 变更识别清单

### 第一层:变更文件快速过滤(CHANGE-FILTER)

| ID | 检查项 | 判断逻辑 | 处理策略 |
|----|--------|----------|----------|
| CF-01 | 识别新增文件 | Git Diff 标记为 `A` 的文件 | 记录文件路径 |
| CF-02 | 识别修改文件 | Git Diff 标记为 `M` 的文件 | 记录文件路径和变更行号 |
| CF-03 | 识别删除文件 | Git Diff 标记为 `D` 的文件 | 记录文件路径 |
| CF-04 | 识别重命名文件 | Git Diff 标记为 `R` 的文件 | 记录新旧文件路径 |
| CF-05 | 提取变更行号 | `git diff -U0` 解析 `@@` 标记 | 精准定位变更范围 |
| CF-06 | 识别依赖文件 | 分析 import/require 语句 | 扩大获取范围到关联文件 |



## 执行流程

### 步骤 1:获取待提交代码

**稳定性约束**：
1. 所有 git 命令必须加 `-c core.safecrlf=false -c core.quotepath=false` 抑制 CRLF 警告和中文路径转义
2. **禁止使用 `Out-File` / `>` 重定向写文件**（PowerShell 管道处理 git 多行输出存在 bug，685 行只写 1 行）
3. **必须用 `[System.IO.File]::WriteAllLines()` 写入文件**（直接调用 .NET API，绕开 PowerShell 管道）
4. 默认范围结果**必须写入文件**供 agent 用 Read 工具读取，避免终端输出截断

```powershell
# 必须先设置控制台编码为 UTF-8（每个命令前执行一次）
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 默认（未指定范围）：git status --porcelain 一次性获取工作区+暂存区+未跟踪文件，写入文件
# 优势：比 git diff 更快、无 CRLF 警告、中文文件名正常显示、一次调用覆盖三种状态
$output = git -c core.safecrlf=false -c core.quotepath=false status --porcelain 2>$null
[System.IO.File]::WriteAllLines("c:\path\to\reports\changes-list.txt", $output, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Written lines: $($output.Count)"

# porcelain v1 输出格式：XY filename
#   X=暂存区状态（A/M/D/R），Y=工作区状态（M/D），?? = 未跟踪
#   示例：
#    M src/Service.java     （工作区已修改，未 add）
#   M  src/Service.java     （暂存区已修改）
#   A  src/NewFile.java     （暂存区新增）
#   ?? src/NewDoc.md        （未跟踪）

# 对比分支(仅当编排器显式传 scope=branch:base..target 时使用)
$output = git -c core.safecrlf=false -c core.quotepath=false diff --name-status base..target 2>$null
[System.IO.File]::WriteAllLines("c:\path\to\reports\changes-list.txt", $output, (New-Object System.Text.UTF8Encoding $false))

# 对比提交(仅当编排器显式传 scope=range:HEAD~N..HEAD 时使用)
$output = git -c core.safecrlf=false -c core.quotepath=false diff --name-status HEAD~N..HEAD 2>$null
[System.IO.File]::WriteAllLines("c:\path\to\reports\changes-list.txt", $output, (New-Object System.Text.UTF8Encoding $false))
```

**⚠️ 关键避坑**：`Out-File -Encoding utf8` 和 `>` 重定向在处理 git 多行输出时会丢失数据（实测 685 行只写 1 行），**必须使用 `[System.IO.File]::WriteAllLines()`**。

**结果读取方式**：agent 用 Read 工具读取 `changes-list.txt`（UTF-8 编码，无 BOM），解析 porcelain 格式（XY 两列状态码 + 文件路径），转换为结构化 JSON。

**输出文件路径**：写入 `openspec/sdlc-agent/代码分析分身/reports/changes-list.txt`（与最终报告同目录，属中间产物）。

**范围选择规则（按优先级）**：
1. 编排器显式指定范围（`path:<路径>` / `module:<模块>` / `project` / `range:HEAD~N..HEAD` / `branch:base..target`）→ **严格使用该范围**，不做任何 fallback
2. 未指定范围（`scope=pending`，默认）→ **使用 `git status --porcelain` 一次性获取**：
   - 同时覆盖工作区变更 + 暂存区变更 + 未跟踪文件（无需分别调用 git diff 和 git diff --cached）
   - 结果非空 → 直接使用，**不再尝试 HEAD~N**
   - 结果为空 → 返回 `empty:true`，**不再自动尝试任何 HEAD~N**，由编排器进入"无变更兜底"询问用户
3. **禁止行为**：
   - **禁止在未指定范围时自动尝试 HEAD~5/HEAD~3/HEAD~1**（自动降级策略已废弃）
   - 禁止在所有 git 命令都返回空时反复更换 base 范围重试
   - 禁止在 shallow clone、detached HEAD、无 commit 历史的仓库中无限尝试
   - 一旦确定 `empty:true`，立即返回结构化结果退出，HEAD~N 由编排器通过兜底选项让用户选择后再传入

### 步骤 1.7:生成索引式快照

**⭐ 必执行步骤**（用户确认范围后）：生成**只含元信息的索引文件**（文件路径、变更类型、风险等级、变更摘要），**不复制文件内容**。后续维度 skill（ca-code-quality / ca-performance-analyzer / ca-security-scanner / ca-architecture-review）根据索引按需读取源文件。

**恢复模式**：当编排器因 `resume_point=snapshot` 重入本步时，会通过 `files` 入参注入上轮已确认的文件列表；此时**禁止执行任何 git 命令**，直接基于 `files` 列表生成索引快照（变更类型可标记为 `M`，风险分级与摘要仍按规则推断）。若 `files` 为空或缺失，回退到正常 git 流程并返回 `empty:true`。

**索引文件路径**：`openspec/sdlc-agent/代码分析分身/reports/snapshot-index-{YYYYMMDD}.yaml`

**索引文件格式**：
```yaml
# === 元数据 ===
schema_version: "1.0"
created_at: 2026-07-04 22:00:00
project: <项目名>
total_files: 38

# === 风险分级规则 ===
# high:   配置文件、入口文件、API层、鉴权相关 → 必须完整 Read
# medium: 业务组件、页面、store → 按需 Read（先 Grep 关键词，命中后读相关行）
# low:    样式、类型声明、自动生成文件 → 跳过或仅 Grep 扫描

# === 文件索引 ===
files:
  - path: frontend/vite.config.ts
    change: M              # M=修改, N=新增, D=删除
    risk: high
    reason: 构建配置，影响全局安全和性能
    summary: CORS 配置变更，新增代理规则

  - path: frontend/src/api/request.ts
    change: M
    risk: high
    reason: 核心请求层，涉及 SSO 重定向和错误处理
    summary: 新增响应归一化拦截器，SSO 重定向逻辑

  - path: frontend/src/pages/AvatarCenterPage.vue
    change: N
    risk: medium
    reason: 主页面，含业务逻辑和状态管理
    summary: 新增数字分身中心页面

  - path: frontend/src/types/auto-imports.d.ts
    change: M
    risk: low
    reason: 自动生成，无需分析
    summary: 自动更新的类型声明

# === 读取策略 ===
# high:   完整 Read（3-5 个文件，约 500-2000 行）
# medium: 分析时按需 Read，遇到具体问题再深入（10-20 个文件）
# low:    跳过或 Grep 扫描关键词（5-10 个文件）
```

**执行规则**：
1. 仅索引用户确认范围内的**新增(A)和修改(M)**文件；**删除(D)文件不索引**（无内容可分析）
2. 每个文件记录：`path`（路径，带仓库前缀）、`change`（M/N）、`risk`（high/medium/low）、`reason`（风险理由）、`summary`（一句话变更摘要）
3. **风险分级标准**：
   - **high**：配置文件（vite.config、.env）、入口文件（main.ts、App.vue）、API 层（request.ts、api/*）、鉴权相关、store
   - **medium**：业务页面（pages/*）、业务组件（components/*）、路由、布局
   - **low**：样式文件、类型声明（.d.ts）、自动生成文件、lock 文件
4. **变更摘要**（summary）：根据 git diff --stat 或文件名快速判断，一句话描述变更内容
5. 索引文件写入后，在结构化 JSON 输出中填充 `snapshot_index_file` 字段

**维度 skill 读取策略**：
1. 先读索引文件，了解所有变更文件的风险分级
2. 高风险文件 → 完整 `Read`（配置、入口、API 层）
3. 中风险文件 → 分析时按需 `Read`，遇到具体问题再深入
4. 低风险文件 → 跳过，或用 `Grep` 快速扫描关键词
5. 跨文件关联 → 用 `Grep`/`SearchCodebase` 查关联代码
6. 需要更多上下文 → `Read` 带行号范围，只读相关部分

**优化效果**：索引文件仅几十行，不占用上下文空间。维度 skill 按需读取源文件，避免一次性加载全部代码内容。适用于任意规模的代码库。

### 步骤 2:解析变更文件
```powershell
# 获取具体变更行号（加参数抑制 CRLF 警告，设置 UTF-8 避免中文乱码）
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$output = git -c core.safecrlf=false -c core.quotepath=false diff -U0 --no-color file.java 2>$null
# 如需写文件，同样使用 [System.IO.File]::WriteAllLines()，禁止用 Out-File

# 输出示例:
# @@ -15,0 +16,3 @@ class UserService {
# +public void newUserMethod() {
# +    // 新增代码
# +}
```

### 步骤 3:分类统计变更
- **新增文件(A)**:记录文件路径和数量
- **修改文件(M)**:记录文件路径、数量和变更行号
- **删除文件(D)**:记录文件路径和数量
- **重命名文件(R)**:记录新旧文件路径

### 步骤 4:分析依赖关系
```bash
# Java 项目:查找引用该类的其他文件
grep -r "import.*ChangedClass" --include="*.java" src/main/java/

# Python 项目:查找导入该模块的其他文件
grep -r "from.*changed_module import\|import changed_module" --include="*.py" src/

# Vue.js 项目:查找引用该组件的其他文件
grep -r "import.*ChangedComponent" --include="*.vue" --include="*.js" src/

# React 项目:查找引用该组件的其他文件
grep -r "import.*ChangedComponent" --include="*.jsx" --include="*.tsx" --include="*.js" src/

# Angular 项目:查找引用该模块的其他文件
grep -r "import.*ChangedModule" --include="*.ts" src/
```

### 步骤 5:生成变更报告
按照下方“报告输出格式”生成标准化报告

**重要说明**:
- 待提交代码包括:**已提交变更** + **暂存区变更** + **工作区变更**
- 如果所有区域都没有变更,返回 `empty:true` 结构化结果,**由编排器决定后续流程**（进入"无变更兜底"），skill 内部不重试、不询问用户

## 报告输出格式

### 文件命名建议：
```
pending-changes-{project_name}-{date}.md
```
示例：`pending-changes-user-center-20260617.md`
- 日期为当前日期，格式为 `YYYYMMDD`

### 输出格式头部标识：
```
---START_PENDING_CHANGES---
```

### 报告正文格式如下：

```
# 待提交代码变更报告

## 1. 变更概览
- **项目名称**：{请用户提供或自动推断}
- **获取时间**：{当前日期，格式 YYYY-MM-DD HH:mm}
- **获取工具**：AI-Based Incremental Changes Fetcher (基于大模型)
- **报告版本**：v1.0
- **目标技术栈**：{自动识别，如 Java + Spring Boot / Python + FastAPI 等}
- **对比基准**：`{由编排器透传：pending 时为"工作区+暂存区"，range 时为 HEAD~N，branch 时为 base 分支}` (commit: {commit_hash})
- **目标分支**：`{当前分支/HEAD}` (commit: {commit_hash})
- **变更文件统计**：
  - 新增文件：5 个
  - 修改文件：3 个
  - 删除文件：1 个
  - 重命名文件：0 个
  - 总计：9 个文件

## 2. 变更文件详细列表

### 2.1 新增文件
- `src/main/java/com/ai/im/web/msgapi/service/NewService.java`
- `src/main/java/com/ai/im/web/msgapi/controller/NewController.java`

### 2.2 修改文件
- `src/main/java/com/ai/im/web/msgapi/service/UserServiceImpl.java`
  - 变更行号：L45-L67
  - 变更内容：
    ```text
    +public void newUserMethod() {
    +    // 新增方法实现
    +}
    ```
  
- `src/main/resources/mapping/UserMapper.xml`
  - 变更行号：L23-L30
  - 变更内容：
    ```text
    +<select id="selectNewData" resultType="User">
    +    SELECT * FROM user WHERE status = #{status}
    +</select>
    ```

### 2.3 删除文件
- `src/main/java/com/ai/im/web/msgapi/service/OldService.java`

### 2.4 重命名文件
- 无

## 3. 变更影响分析

### 3.1 依赖关系分析
- **受影响的关联文件**（需人工确认）：
  - `UserController.java` - 调用了变更的 Service 方法
  - `AuthService.java` - 依赖变更的实体类

### 3.2 变更统计
| 文件类型 | 新增 | 修改 | 删除 | 重命名 | 总计 |
|---------|------|------|------|--------|------|
| Java 源文件 | 2 | 1 | 1 | 0 | 4 |
| XML 配置 | 0 | 1 | 0 | 0 | 1 |
| 配置文件 | 0 | 0 | 0 | 0 | 0 |
| 其他 | 0 | 0 | 0 | 0 | 0 |
| **总计** | **2** | **2** | **1** | **0** | **5** |
```

### 输出格式尾部标识：
```
---END_PENDING_CHANGES---
```

**注意事项（模型必遵）**

1. **范围规则**：未指定范围时**使用 `git status --porcelain` 一次性获取工作区+暂存区+未跟踪文件**，**不自动尝试 HEAD~N**；为空时返回 `empty:true`，由编排器通过"无变更兜底"询问用户后再决定是否用 `range:HEAD~N..HEAD` 重调本 skill
2. **PowerShell 写文件约束**：**禁止使用 `Out-File` / `>` 重定向写 git 命令输出**（实测 685 行只写 1 行），**必须使用 `[System.IO.File]::WriteAllLines()` 写入 UTF-8 文件**
3. **精准定位变更行号**：必须提供精确的文件路径与变更行号范围（格式：`/path/to/file.ext:L15-L30`）；
4. **区分变更类型**：明确标注每个文件是"新增文件"、"修改文件（LXX-LXX）"、"删除文件"还是"重命名文件"；
5. **仅报告增量变更**：只列出本次变更的文件，不包含历史变更；
6. **关联依赖分析**：分析变更文件的引用关系，列出可能受影响的关联文件；
7. **提供变更内容**：尽量提供变更的代码片段（新增/删除行）；
8. **不要添加总结、致谢或其他无关内容**；
9. **正文使用标准 Markdown 格式**，确保可渲染为文档；
10. **根据项目技术栈调整获取策略**，仅报告适用的文件类型；
11. **白名单机制**：排除测试代码、自动生成代码、第三方 SDK。

## 报告文件生成要求（可选执行）

**写文件行为受 `write_file` 参数控制，默认 `true`（留痕），编排器可传 `false` 跳过：**

1. **生成报告文件**（仅当 `write_file:true` 时）：
   - 使用 `Write` 工具创建独立的待提交代码变更报告 Markdown 文件
   - 文件命名格式：`pending-changes-{project_name}-{YYYYMMDD}.md`
   - 保存位置:项目根目录的 `openspec/sdlc-agent/代码分析分身/reports` 文件夹下(如不存在则先创建)
   - 示例:`openspec/sdlc-agent/代码分析分身/reports/pending-changes-ai_im_message_api-20260617.md`

2. **报告内容要求**：
   - 文件内容必须以 `---START_PENDING_CHANGES---` 开始
   - 文件内容必须以 `---END_PENDING_CHANGES---` 结束
   - 中间包含完整的待提交代码变更报告（按照上方"报告输出格式"规范）

3. **执行顺序与分工**：
   ```
   【本 skill 执行】
   第1步：根据 scope 参数获取待提交代码变更（默认 pending：git status --porcelain 一次性获取工作区+暂存区+未跟踪文件，不做 HEAD~N 自动降级）
   第2步：解析变更文件与行号范围
   第3步：分类统计变更（新增/修改/删除/重命名/未跟踪）
   第4步：分析依赖关系，扩大获取范围
   第5步：组装结构化 JSON 结果（必产出）
   第6步：write_file=true 时使用 Write 创建报告文件；write_file=false 时跳过
   第7步：向编排器返回结构化 JSON（含 report_file 路径或 null）

   【编排器执行，本 skill 不处理】
   第8步（编排器执行）：展示变更统计+前N文件预览，用 AskUserQuestion 询问用户确认范围（已显式指定范围时跳过）
   第9步（编排器执行）：ca-state-manager.init() 持久化范围到 scope-state.yaml
   第10步（本 skill 执行）：生成索引式快照文件（只含路径+风险等级+变更摘要，不复制文件内容）→ 编排器调 ca-state-manager.update_artifact() 登记路径
   ```
   **分工原则**：第1-7步、第10步为本 skill 职责（数据获取、结构化、快照生成），第8-9步为编排器职责（用户交互、state 持久化委托 ca-state-manager）；本 skill 不写 `scope-state.yaml`，不调用 `AskUserQuestion`。

4. **文件生成示例**：
   ```
   文件名：openspec/sdlc-agent/代码分析分身/reports/pending-changes-ai_im_message_api-20260617.md
   内容结构：
   ---START_PENDING_CHANGES---
   # 待提交代码变更报告
   ## 1. 变更概览
   ...
   ## 3. 变更影响分析
   ...
   ---END_PENDING_CHANGES---
   ```

5. **关键规则**：
   - **结构化 JSON 是必产出**，写文件是可选留痕
   - 编排器依赖 JSON 结果驱动后续 skill，不依赖重新读取 .md 文件
   - 当 `empty:true` 时直接返回精简 JSON，**不写文件、不询问用户**
   - 禁止将报告保存到 `openspec/sdlc-agent/代码分析分身/reports` 之外的位置
   - 状态管理（`scope-state.yaml` 的恢复、持久化、进度更新）由编排器委托 `ca-state-manager` 处理，本 skill 不读写 state 文件

## 辅助脚本使用说明

本 Skill 提供以下辅助脚本（位于 `scripts/` 目录）：

### 1. `pending-diff.sh` - 获取待提交代码变更
```bash
# 对比分支
./scripts/pending-diff.sh --base main --target feature-branch

# 对比提交（仅当编排器通过"无变更兜底"询问后用户选择 N 次提交时使用）
./scripts/pending-diff.sh --base HEAD~N --target HEAD

# 未提交的变更
./scripts/pending-diff.sh --staged
```

### 2. `context-analyzer.sh` - 依赖关系分析
```bash
# 分析变更文件的依赖关系
./scripts/context-analyzer.sh --file UserServiceImpl.java --lang java

# 输出：引用该类的其他文件列表
```

## 最佳实践

1. **提交前审核**：每次代码提交前自动获取待提交代码
2. **基线对比**：与 `main` 分支对比，而非最近提交
3. **变更归因**：明确标注变更类型（新增/修改/删除/重命名）
4. **依赖分析**：分析变更文件的引用关系，识别影响范围
5. **自动化集成**：与 CI/CD 流水线集成（GitHub Actions / GitLab CI）
6. **定期审核**：每次重要提交前获取变更清单
