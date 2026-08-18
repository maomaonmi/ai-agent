# 待提交代码获取辅助脚本使用说明

本目录包含待提交代码获取 Skill 的辅助脚本,用于自动化执行代码变更检测和依赖分析。

## 脚本清单

### 1. pending-diff.sh - 获取待提交代码变更

**功能**:基于 Git Diff 获取新增、修改、删除、重命名的文件列表及变更行号

**文件过滤策略**:
- ✅ **自动包含**：代码文件（*.java|*.py|*.go|*.js|*.ts|*.vue 等）
- ✅ **自动排除**：文档文件（*.md|*.txt|*.doc|*.pdf 等）
- ✅ **自动排除**：二进制文件（*.jar|*.war|*.class|*.exe 等）
- ✅ **自动排除**：测试/构建/IDE目录（test/|target/|.idea/ 等）

**用法**:

```bash
# 对比分支
./scripts/pending-diff.sh --base main --target feature-branch

# 对比提交
./scripts/pending-diff.sh --base HEAD~5 --target HEAD

# 未提交的变更(暂存区)
./scripts/pending-diff.sh --staged

# 未提交的变更(工作区)
./scripts/pending-diff.sh --unstaged

# 获取所有待提交代码（暂存区 + 工作区）⭐ 推荐
./scripts/pending-diff.sh --all

# 输出到文件
./scripts/pending-diff.sh --base main --target feature-branch --output changes.txt

# 自定义文件扩展名
./scripts/pending-diff.sh --base main --target feature-branch --extensions "java|vue|tsx"
```

**输出示例**:

```
========================================
  待提交代码变更检测工具
========================================

[1/3] 获取变更文件列表...
=== 执行命令: git diff --name-status main..feature-branch ===

[2/3] 变更统计:
新增文件 (A): 5
修改文件 (M): 3
删除文件 (D): 1
重命名文件 (R): 0

[3/3] 变更详情:

  [新增] src/main/java/com/ai/im/web/msgapi/service/NewService.java
  [修改] src/main/java/com/ai/im/web/msgapi/service/UserServiceImpl.java
    变更行号: 45,3
              67,5
  [删除] src/main/java/com/ai/im/web/msgapi/service/OldService.java

========================================
  检测完成
========================================
```

---

### 2. context-analyzer.sh - 依赖关系分析器

**功能**:分析变更文件的依赖关系,找出引用该文件的其他文件

**支持的语言**:
- **后端**: Java, Python, Go, Node.js, PHP
- **前端**: Vue.js, React, Angular

**用法**:

```bash
# 分析后端文件
./scripts/context-analyzer.sh --file UserServiceImpl.java --lang java

# 分析前端 Vue 组件
./scripts/context-analyzer.sh --file UserComponent.vue --lang vue

# 分析前端 React 组件
./scripts/context-analyzer.sh --file UserComponent.tsx --lang react

# 分析前端 Angular 模块
./scripts/context-analyzer.sh --file UserModule.ts --lang angular

# 分析批量文件
./scripts/context-analyzer.sh --changes-file changes.txt --lang java

# 输出依赖关系图(Mermaid 格式)
./scripts/context-analyzer.sh --file UserServiceImpl.java --lang java --graph

# 自定义源码目录
./scripts/context-analyzer.sh --file UserServiceImpl.java --lang java --src-dir src/main/java
```

**输出示例**:

```
========================================
  依赖关系分析器
========================================

========================================
  文件: UserServiceImpl.java
========================================
类名/模块名: UserServiceImpl

正在搜索引用类 'UserServiceImpl' 的 Java 文件...

  - src/main/java/com/ai/im/web/msgapi/controller/UserController.java
  - src/main/java/com/ai/im/web/msgapi/service/AuthService.java
```

---

## 完整工作流示例

### 场景 1: 获取后端项目代码变更

```bash
# 步骤 1: 获取待提交代码变更
./scripts/pending-diff.sh \
  --base main \
  --target feature/user-auth \
  --output changes.txt

# 步骤 2: 分析变更文件的依赖关系
./scripts/context-analyzer.sh \
  --changes-file changes.txt \
  --lang java \
  --src-dir src/main/java

# 步骤 3: 生成变更报告(由 AI Skill 自动完成)
# 报告将保存到 docs/pending-changes-{project}-{date}.md
```

### 场景 2: 获取前端项目代码变更

```bash
# 步骤 1: 获取待提交代码变更
./scripts/pending-diff.sh \
  --base main \
  --target feature/new-component \
  --output changes.txt

# 步骤 2: 分析 Vue 组件依赖关系
./scripts/context-analyzer.sh \
  --changes-file changes.txt \
  --lang vue \
  --src-dir src

# 步骤 3: 生成变更报告(由 AI Skill 自动完成)
```

### 场景 3: 获取全栈项目代码变更

```bash
# 步骤 1: 获取所有变更
./scripts/pending-diff.sh \
  --base main \
  --target feature/fullstack-update \
  --output changes.txt

# 步骤 2: 分析后端依赖(Java)
./scripts/context-analyzer.sh \
  --changes-file changes.txt \
  --lang java \
  --src-dir backend/src/main/java

# 步骤 3: 分析前端依赖(Vue)
./scripts/context-analyzer.sh \
  --changes-file changes.txt \
  --lang vue \
  --src-dir frontend/src

# 步骤 4: 生成变更报告(由 AI Skill 自动完成)
```

---

## 集成到 CI/CD

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
          fetch-depth: 0
      
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
      - docs/pending-changes-*.md
    when: always
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

---

## 注意事项

1. **脚本权限**:首次使用前需执行 `chmod +x scripts/*.sh`
2. **Git 仓库**:所有脚本必须在 Git 仓库根目录执行
3. **依赖工具**:需要安装 `git`, `grep`, `sed`, `awk`
4. **语言支持**:依赖分析器支持 Java/Python/Go/Node.js/PHP/Vue.js/React/Angular
5. **全栈项目**:对于前后端分离项目,建议分别分析后端和前端依赖

---

## 扩展开发

### 添加新的语言支持

在 `context-analyzer.sh` 中添加新的语言处理函数:

```bash
# 查找引用该组件的其他文件(Vue 3 Composition API)
find_vue3_dependencies() {
    local component_name=$1
    local src_dir=$2
    
    echo -e "${BLUE}正在搜索引用组件 '$component_name' 的 Vue 文件...${NC}"
    
    # 查找 import 语句
    local import_results=$(grep -rE "import.*${component_name}|from.*${component_name}" \
        --include="*.vue" --include="*.js" --include="*.ts" "$src_dir" 2>/dev/null || true)
    
    # 查找模板中的组件使用
    local template_results=$(grep -rE "<${component_name}|<$(echo $component_name | sed 's/\([A-Z]\)/-\L\1/g' | sed 's/^-//')" \
        --include="*.vue" "$src_dir" 2>/dev/null || true)
    
    local results="${import_results}\n${template_results}"
    
    if [ -z "$(echo -e "$results" | tr -d '[:space:]')" ]; then
        echo -e "${YELLOW}未找到引用该组件的文件${NC}"
        return
    fi
    
    echo -e "$results" | grep -v '^$' | cut -d: -f1 | sort -u | while read -r file; do
        echo "  - $file"
    done
}
```

然后在 `analyze_file_dependencies` 函数中添加分支:

```bash
case $language in
    java)
        find_java_dependencies "$class_name" "$SRC_DIR"
        ;;
    vue)
        find_vue3_dependencies "$class_name" "$SRC_DIR"
        ;;
    react)
        find_react_dependencies "$class_name" "$SRC_DIR"
        ;;
    # ...
esac
```

---

## 问题反馈

如有问题或建议,请联系 Skill 维护者。
