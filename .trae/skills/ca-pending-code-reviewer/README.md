# 待提交代码审查 Skill (ca-pending-code-reviewer)

## 📋 概述

智能识别代码变更，获取待提交代码和文件列表，提供精确的行号定位和变更类型分析，生成标准化的变更报告。支持 Java、Python、Go、Node.js、PHP、Vue.js、React、Angular 等主流技术栈。

**核心定位**：作为代码分析智能体的默认入口，负责获取待提交代码变更，为后续代码审查提供变更清单。

## 🎯 核心能力

### 1. 待提交代码识别
- ✅ **基于 Git Diff**：自动识别新增(A)、修改(M)、删除(D)、重命名(R)的文件
- ✅ **精确行号定位**：提取变更的具体行号范围，实现精准定位（格式：`L15-L30`）
- ✅ **变更类型分析**：根据文件变更类型采用不同处理策略
- ✅ **依赖关系追踪**：分析变更文件的引用关系，识别关联文件和影响范围
- ✅ **包含未提交代码**：
  - **暂存区变更**：已 `git add` 但未 commit 的代码（`git diff --cached`）
  - **工作区变更**：已修改但未 `git add` 的代码（`git diff`）
  - **已提交变更**：两个分支或提交之间的差异（`git diff branch1..branch2`）

### 2. 变更统计与分析

| 变更类型 | 标记 | 处理策略 | 说明 |
|---------|------|---------|------|
| 新增文件 | A | 记录路径 | 记录文件路径和数量 |
| 修改文件 | M | 行号定位 | 记录文件路径和变更行号（±10 行上下文） |
| 删除文件 | D | 记录路径 | 记录文件路径和数量 |
| 重命名文件 | R | 记录路径 | 记录新旧文件路径 |

### 3. 变更报告生成
- ✅ **变更概览**：项目信息、对比基准、变更统计、技术栈识别
- ✅ **变更详情**：文件路径、变更类型、行号范围、变更内容片段
- ✅ **依赖分析**：变更文件的引用关系和关联文件列表
- ✅ **自动保存**：自动生成报告文件至 `openspec/sdlc-agent/代码分析分身/reports` 目录

## 📁 目录结构

```
ca-pending-code-reviewer/
├── SKILL.md                          # 技能定义文件（核心）
├── README.md                         # 使用说明文档（本文件）
├── assets/                           # 技能资源文件
│   ├── .scan-ignore                  # 白名单配置（排除测试/自动生成/第三方代码）
│   └── sample-report.md              # 示例报告模板
├── references/                       # 技能参考资料
│   └── pending-review-guide.md       # 待提交代码获取指南（Git 命令/依赖分析/CI-CD集成）
└── scripts/                          # 技能脚本
    ├── README.md                     # 脚本使用说明
    ├── pending-diff.sh               # 获取待提交代码变更（支持分支对比/暂存区/工作区）
    └── context-analyzer.sh           # 依赖关系分析器（支持多语言）
```

**文件职责说明**：
- **SKILL.md**：Skill 的核心定义文件，包含触发场景、执行流程、报告格式等完整规范
- **references/**：提供 Git Diff 命令参考、依赖分析方法、CI/CD 集成示例等详细资料
- **scripts/**：可执行的 Shell 脚本，自动化代码变更检测和依赖分析

## 🚀 快速开始

### 1. 调用方

本 Skill 是"代码分析分身"编排器的内部子调用，由编排器在标准执行流程第1步显式调用，不响应"代码审查/代码变更"等用户层通用词，也不因自身 description 中的关键词自触发。详见 `代码分析分身.md`。

### 2. 执行流程

```
第1步：获取待提交代码变更
  ├─ 已提交变更：git diff branch1..branch2
  ├─ 暂存区变更：git diff --cached
  └─ 工作区变更：git diff

第2步：解析变更文件与行号范围
  ├─ 使用 git diff -U0 提取精确行号
  └─ 解析 @@ 标记获取变更范围

第3步：分类统计变更
  ├─ 新增文件 (A)：记录路径和数量
  ├─ 修改文件 (M)：记录路径、数量和变更行号
  ├─ 删除文件 (D)：记录路径和数量
  └─ 重命名文件 (R)：记录新旧文件路径

第4步：分析依赖关系，扩大获取范围
  ├─ Java：分析 import 语句
  ├─ Python：分析 from/import 语句
  ├─ Vue/React：分析组件引用
  └─ 其他语言：使用对应语言的依赖分析方法

第5步：整理变更结果
  └─ 按照标准格式组织变更报告

第6步：使用 Write 创建报告文件
  ├─ 文件命名：pending-changes-{project_name}-{YYYYMMDD}.md
  ├─ 保存位置：openspec/sdlc-agent/代码分析分身/reports 目录（如不存在则先创建）
  └─ 包含首尾标识：---START_PENDING_CHANGES--- / ---END_PENDING_CHANGES---

第7步：向用户确认报告已生成并告知文件路径
```

### 3. 辅助脚本使用

**前置准备**：
```bash
chmod +x scripts/*.sh  # 首次使用需赋予执行权限
```

**脚本示例**：
```bash
# 获取待提交代码变更（分支对比）
./scripts/pending-diff.sh --base main --target feature-branch

# 获取未提交变更（推荐：包含暂存区+工作区）
./scripts/pending-diff.sh --all

# 分析 Java 文件依赖关系
./scripts/context-analyzer.sh --file UserServiceImpl.java --lang java

# 分析批量变更文件的依赖关系
./scripts/context-analyzer.sh --changes-file changes.txt --lang java
```

详细说明请参考：[scripts/README.md](scripts/README.md)

## 📝 报告格式

### 文件命名规范
```
pending-changes-{project_name}-{YYYYMMDD}.md
```
**示例**：`pending-changes-ai_im_message_api-20260620.md`

### 保存位置
项目根目录的 `openspec/sdlc-agent/代码分析分身/reports` 文件夹下（如不存在则自动创建）

### 报告结构
报告必须包含以下章节，并使用标准 Markdown 格式：

1. **变更概览**
   - 项目名称、获取时间、获取工具、报告版本
   - 目标技术栈（自动识别）
   - 对比基准（分支/提交）
   - 变更文件统计（新增/修改/删除/重命名）

2. **变更文件详细列表**
   - 2.1 新增文件（列出路径）
   - 2.2 修改文件（列出路径 + 变更行号 + 变更内容片段）
   - 2.3 删除文件（列出路径）
   - 2.4 重命名文件（列出新旧路径）

3. **变更影响分析**
   - 3.1 依赖关系分析（受影响的关联文件）
   - 3.2 变更统计（按文件类型分类统计表）

### 报告标识
```markdown
---START_PENDING_CHANGES---
# 待提交代码变更报告
...
---END_PENDING_CHANGES---
```

**重要说明**：
- 必须使用 `Write` 工具创建报告文件，禁止仅在对话中输出
- 必须自动生成，禁止询问用户"是否需要生成文件"
- 必须保存在 `openspec/sdlc-agent/代码分析分身/reports` 目录，禁止保存到其他位置

## 🛠️ 支持的技术栈

Skill 会自动检测项目技术栈并调整获取策略，支持以下主流技术栈：

### 后端技术栈

| 技术栈 | 框架 | 构建工具 | 数据访问 | 配置文件 |
|--------|------|----------|----------|----------|
| **Java** | Spring Boot, Spring MVC, Play, Micronaut, Quarkus | Maven, Gradle | MyBatis, Hibernate, JPA | application.yml/properties |
| **Python** | Django, Flask, FastAPI, Tornado | pip, Poetry, Conda | Django ORM, SQLAlchemy | .env, config.py |
| **Go** | Gin, Echo, Beego, Fiber | Go Modules | GORM, sqlx | .env, config.yaml |
| **Node.js** | Express, Koa, NestJS, Fastify | npm, yarn, pnpm | Prisma, Sequelize, TypeORM | .env, config.js |
| **PHP** | Laravel, Symfony, CodeIgniter | Composer | Eloquent, Doctrine | .env, config/*.php |

### 前端技术栈

| 技术栈 | 框架 | 构建工具 | 状态管理 | UI 框架 |
|--------|------|----------|----------|----------|
| **Vue.js** | Vue 2/3, Nuxt.js | Vite, Webpack, Vue CLI | Vuex, Pinia | Element UI, Vuetify |
| **React** | React, Next.js, Gatsby | CRA, Vite, Webpack | Redux, MobX, Zustand | Ant Design, Material-UI |
| **Angular** | Angular | Angular CLI, Webpack | NgRx, Akita | Angular Material |
| **原生前端** | HTML5, CSS3, JavaScript | Webpack, Rollup, Parcel | - | - |

### 自动识别的文件类型

**通用文件**：
- 配置文件：`.env`, `.env.*`, `*.yml`, `*.yaml`, `*.json`, `*.xml`, `*.ini`, `*.conf`
- 构建文件：`Dockerfile`, `docker-compose.yml`, `k8s/*.yaml`, `Makefile`
- 依赖文件：`pom.xml`, `build.gradle`, `package.json`, `requirements.txt`, `go.mod`

**按技术栈分类**：
- **Java**：`.java`, `.kt`, `.groovy`, `*Mapper.xml`, `application*.yml`
- **Python**：`.py`, `.html`, `.jinja2`, `requirements.txt`, `pyproject.toml`
- **Go**：`.go`, `go.mod`, `go.sum`, `config.yaml`
- **Node.js**：`.js`, `.ts`, `package.json`, `.env`
- **Vue.js**：`.vue`, `.js`, `.ts`, `.css`, `.scss`, `vue.config.js`
- **React**：`.jsx`, `.tsx`, `.js`, `.ts`, `.styled.js`
- **Angular**：`.ts`, `.html`, `.css`, `.scss`, `angular.json`

详细文件类型列表请参考：[SKILL.md](SKILL.md) 的"获取范围"章节

## 🔧 CI/CD 集成

Skill 提供完整的 CI/CD 集成支持，可在 Pull Request/Merge Request 时自动获取代码变更。

### GitHub Actions 示例

```yaml
name: Pending Code Changes

on:
  pull_request:
    branches: [main, develop]

jobs:
  pending-changes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0  # 获取完整 Git 历史
      
      - name: 获取待提交代码
        run: |
          .qoder/skills/ca-pending-code-reviewer/scripts/pending-diff.sh \
            --base ${{ github.event.pull_request.base.sha }} \
            --target HEAD \
            --output changes.txt
      
      - name: 分析依赖关系
        run: |
          .qoder/skills/ca-pending-code-reviewer/scripts/context-analyzer.sh \
            --changes-file changes.txt \
            --lang java
      
      - name: 上传报告
        uses: actions/upload-artifact@v3
        with:
          name: pending-code-changes
          path: openspec/sdlc-agent/代码分析分身/reports/pending-changes-*.md
```

### GitLab CI 示例

```yaml
pending_changes:
  stage: test
  script:
    - .qoder/skills/ca-pending-code-reviewer/scripts/pending-diff.sh \
        --base $CI_MERGE_REQUEST_TARGET_BRANCH_SHA \
        --target $CI_COMMIT_SHA \
        --output changes.txt
    - .qoder/skills/ca-pending-code-reviewer/scripts/context-analyzer.sh \
        --changes-file changes.txt \
        --lang java
  artifacts:
    paths:
      - openspec/sdlc-agent/代码分析分身/reports/pending-changes-*.md
    when: always
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

**更多集成示例**：请参考 [references/pending-review-guide.md](references/pending-review-guide.md) 的"CI/CD 集成参考"章节（包含 Jenkins Pipeline 示例）

## 📖 参考资料

| 文件 | 说明 |
|------|------|
| [SKILL.md](SKILL.md) | Skill 核心定义文件（触发场景、执行流程、报告格式、注意事项） |
| [references/pending-review-guide.md](references/pending-review-guide.md) | 待提交代码获取指南（Git 命令参考、依赖分析方法、CI/CD 集成、FAQ） |
| [scripts/README.md](scripts/README.md) | 脚本使用说明（pending-diff.sh、context-analyzer.sh 的用法和示例） |
| [assets/.scan-ignore](assets/.scan-ignore) | 白名单配置（排除测试代码、自动生成代码、第三方 SDK） |

**推荐阅读顺序**：
1. 先阅读本文件了解整体功能和使用方法
2. 查看 [SKILL.md](SKILL.md) 了解完整的执行规范和报告格式
3. 参考 [references/pending-review-guide.md](references/pending-review-guide.md) 学习 Git Diff 命令和依赖分析技术
4. 查看 [scripts/README.md](scripts/README.md) 了解脚本的具体用法

## ⚙️ 配置

### 白名单配置

通过 `assets/.scan-ignore` 文件配置需要排除的文件和目录：

```text
# 测试代码
src/test/**
*Test.java
*Test.py

# 自动生成代码
**/generated/**
**/target/**
**/build/**

# 第三方 SDK
node_modules/**
vendor/**
.venv/**

# 示例代码和文档
example/**
demo/**
docs/**
```

**使用说明**：
```bash
# 扫描时排除白名单中的文件
git diff --name-only | grep -vf assets/.scan-ignore
```

### 排除范围（默认）

**目录排除**：
- 测试目录：`test/`, `tests/`, `src/test/`, `__tests__/`
- 构建目录：`dist/`, `build/`, `target/`
- IDE 配置：`.idea/`, `.vscode/`
- 依赖目录：`node_modules/`, `vendor/`, `.venv/`, `venv/`
- 版本控制：`.git/`

**文件排除**：
- 二进制文件：`.jar`, `.war`, `.class`, `.exe`, `.so`, `.dll`
- 非文本资源：图片、字体、压缩包

**注意事项**：
- 白名单机制确保只扫描业务代码，避免误报
- 可根据项目实际情况调整 `.scan-ignore` 文件

## 🎓 最佳实践

### 1. 变更获取策略
- **提交前审核**：每次代码提交前自动获取待提交代码，提前发现问题
- **基线对比**：与 `main` 分支对比，而非最近提交（避免遗漏变更）
- **共同祖先**：使用 `git merge-base` 查找共同祖先，确保对比准确性
- **全量覆盖**：包含已提交 + 暂存区 + 工作区的所有变更

### 2. 变更分析方法
- **变更归因**：明确标注变更类型（新增/修改/删除/重命名）
- **行号定位**：提供精确的文件路径与变更行号范围（格式：`/path/to/file.ext:L15-L30`）
- **依赖分析**：分析变更文件的引用关系，识别影响范围和关联文件
- **分批处理**：大型 PR（数百个文件）按模块分组，优先获取核心模块

### 3. 自动化集成
- **CI/CD 流水线**：与 GitHub Actions / GitLab CI / Jenkins 集成
- **定期审核**：每次重要提交前获取变更清单
- **报告归档**：自动生成报告并上传为 CI/CD 产物

### 4. 跨分支处理
- **始终以 main 为基准**：避免以最近提交为基准
- **使用 merge-base**：查找共同祖先节点
- **避免遗漏**：检查所有变更类型（A/M/D/R）

### 5. 全栈项目处理
- **分别分析**：前后端分离项目建议分别分析后端和前端依赖
- **多语言支持**：使用不同的依赖分析方法（Java import / Python from-import / Vue component）
- **统一报告**：将前后端变更整合到同一份报告中

## 🤝 扩展开发

### 添加新的文件类型支持

在 [SKILL.md](SKILL.md) 的"获取范围"章节添加新的文件类型：

```markdown
#### 新技术栈项目
- **源码文件**: `.ext1`, `.ext2`
- **配置文件**: `config.ext`, `.env`
- **构建文件**: `build.ext`, `package.json`
```

### 添加新的语言依赖分析支持

在 `scripts/context-analyzer.sh` 中添加新的语言处理函数：

```bash
# 查找引用该组件的其他文件（新技术栈）
find_newtech_dependencies() {
    local component_name=$1
    local src_dir=$2
    
    echo "正在搜索引用组件 '$component_name' 的文件..."
    
    # 查找 import/require 语句
    grep -rE "import.*${component_name}|from.*${component_name}|require.*${component_name}" \
        --include="*.ext" "$src_dir" 2>/dev/null || true
}
```

然后在 `analyze_file_dependencies` 函数中添加分支：

```bash
case $language in
    java) find_java_dependencies "$class_name" "$SRC_DIR" ;;
    python) find_python_dependencies "$class_name" "$SRC_DIR" ;;
    newtech) find_newtech_dependencies "$class_name" "$SRC_DIR" ;;
esac
```

### 自定义报告格式

修改 [SKILL.md](SKILL.md) 的"报告输出格式"章节，调整报告结构和内容。

### 添加 CI/CD 模板

在 [references/pending-review-guide.md](references/pending-review-guide.md) 中添加新的 CI/CD 平台集成示例。

## ❓ 常见问题（FAQ）

### Q1: 如何处理大型 PR（数百个文件变更）？

**A**: 使用分批处理策略：
1. 按模块分组变更文件
2. 优先获取核心模块（Service、Controller）
3. 配置文件、文档变更可延后处理
4. 依赖分析时可设置深度限制

### Q2: 如何避免遗漏变更？

**A**：
1. 配置白名单（`assets/.scan-ignore`）排除无关文件
2. 使用完整的 diff 命令（包含已提交 + 暂存区 + 工作区）
3. 检查所有变更类型（A/M/D/R）
4. 以 `main` 分支为基准，而非最近提交

### Q3: 如何与现有代码审查工具集成？

**A**：
- 与 SonarQube、Checkmarx 等静态分析工具结合使用
- 在 CI/CD 流水线中作为前置步骤
- 生成的报告可作为代码审查的输入

### Q4: 如何处理跨分支的变更？

**A**：
1. 始终以 `main` 为基准分支
2. 使用 `git merge-base` 查找共同祖先
3. 避免以最近提交为基准（可能遗漏变更）

### Q5: 脚本执行失败怎么办？

**A**：
1. 检查脚本权限：`chmod +x scripts/*.sh`
2. 确认在 Git 仓库根目录执行
3. 检查依赖工具：`git`, `grep`, `sed`, `awk` 是否已安装
4. 查看详细错误日志，参考 [scripts/README.md](scripts/README.md)

## 📄 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-06-17 | 初始版本，支持 Git Diff 变更检测和多语言依赖分析 |
| v1.1 | 2026-06-20 | 优化文档结构，完善技术栈支持，补充 CI/CD 集成示例 |

## 👥 维护者

- **Skill 创建者**：AI Assistant
- **创建日期**：2026-06-17
- **最后更新**：2026-06-20
- **当前版本**：v1.1

---

**相关资源**：
- [SKILL.md](SKILL.md) - 完整的技术规范和执行流程
- [references/pending-review-guide.md](references/pending-review-guide.md) - Git 命令和依赖分析指南
- [scripts/README.md](scripts/README.md) - 脚本使用说明

**许可证**：本项目遵循项目整体的许可证协议。
