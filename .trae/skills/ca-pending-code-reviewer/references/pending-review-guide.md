# 待提交代码获取参考资料

## 1. Git Diff 命令参考

### 1.1 基础 Diff 命令

```bash
# 对比两个分支
git diff --name-status main..feature-branch

# 对比两个提交（默认使用 HEAD~5）
git diff --name-status HEAD~5..HEAD

# 查看未提交的变更（工作区）
git diff --name-status

# 查看已暂存的变更
git diff --name-status --cached

# 获取变更的具体行号
git diff -U0 --no-color file.java
```

**重要规则**：
- 当对比已提交的变更时，**必须使用 `HEAD~5..HEAD` 作为默认范围**
- 禁止使用 `HEAD~3` 或其他非标准范围

### 1.2 Diff 输出格式解析

**变更类型标记**：
- `A` - 新增文件（Added）
- `M` - 修改文件（Modified）
- `D` - 删除文件（Deleted）
- `R` - 重命名文件（Renamed）
- `C` - 复制文件（Copied）

**行号格式**：
```
@@ -15,0 +16,3 @@ class UserService {
```
- `-15,0`：原文件从第 15 行开始，删除 0 行
- `+16,3`：新文件从第 16 行开始，新增 3 行

### 1.3 高级 Diff 选项

```bash
# 仅显示文件名
git diff --name-only

# 显示文件状态和相似度（重命名）
git diff --name-status -M

# 忽略空白变更
git diff -w

# 仅统计变更
git diff --stat

# 输出为补丁格式
git diff --output=changes.patch
```

---

## 2. 变更获取策略参考

### 2.1 新增文件（A）- 记录路径

**处理方式**：
- 记录文件路径
- 统计数量

### 2.2 修改文件（M）- 行号定位

**处理方式**：
- 记录文件路径
- 提取变更行号范围（±10 行上下文）
- 统计数量

### 2.3 删除文件（D）- 记录路径

**处理方式**：
- 记录文件路径
- 统计数量

### 2.4 重命名文件（R）- 记录路径

**处理方式**：
- 记录新旧文件路径
- 统计数量

---

## 3. 依赖关系分析方法

### 3.1 Java 项目

**分析 import 语句**:
```bash
# 查找引用某类的文件
grep -r "import.*UserService" --include="*.java" src/main/java/

# 查找引用某包的文件
grep -r "import com.ai.im.web.msgapi.service" --include="*.java" src/
```

**分析工具**:
- `jdeps`:Java 依赖分析工具(JDK 自带)
- `Maven Dependency Plugin`:`mvn dependency:tree`
- `ArchUnit`:架构依赖测试框架

### 3.2 Python 项目

**分析 import 语句**:
```bash
# 查找引用某模块的文件
grep -rE "from.*user_service import|import user_service" --include="*.py" src/
```

**分析工具**:
- `pydeps`:Python 依赖可视化工具
- `importlab`:Google 开发的依赖分析工具
- `pipdeptree`:依赖树查看工具

### 3.3 Go 项目

**分析 import 语句**:
```bash
# 查找引用某包的文件
grep -r "\".*user_service\"" --include="*.go" src/
```

**分析工具**:
- `go mod graph`:模块依赖图
- `goda`:Go 依赖分析工具
- `depviz`:依赖可视化

### 3.4 Node.js 后端项目

**分析 require/import 语句**:
```bash
# 查找引用某模块的文件
grep -rE "require\(.*user-service|from.*user-service" --include="*.js" --include="*.ts" src/
```

**分析工具**:
- `madge`:依赖关系可视化工具
- `dependency-cruiser`:依赖验证工具
- `npm ls`:依赖树查看

### 3.5 Vue.js 项目

**分析组件引用**:
```bash
# 查找引用某组件的文件
grep -rE "import.*UserComponent|from.*UserComponent" --include="*.vue" --include="*.js" --include="*.ts" src/

# 查找使用某组件的模板
grep -rE "<UserComponent|<user-component" --include="*.vue" src/
```

**分析工具**:
- `madge`:依赖关系可视化
- `vue-dependency-graph`:Vue 依赖图生成器

### 3.6 React 项目

**分析组件引用**:
```bash
# 查找引用某组件的文件
grep -rE "import.*UserComponent|from.*UserComponent" --include="*.jsx" --include="*.tsx" --include="*.js" --include="*.ts" src/

# 查找使用某组件的 JSX
grep -rE "<UserComponent|<UserComponent\." --include="*.jsx" --include="*.tsx" src/
```

**分析工具**:
- `madge`:依赖关系可视化
- `dependency-cruiser`:依赖验证
- `react-cosmos`:组件依赖查看

### 3.7 Angular 项目

**分析模块引用**:
```bash
# 查找引用某模块的文件
grep -rE "import.*UserModule|from.*UserModule" --include="*.ts" src/

# 查找使用某组件的模板
grep -rE "<app-user|selector.*user" --include="*.ts" src/
```

**分析工具**:
- `ng dependencies`:Angular CLI 依赖查看
- `madge`:依赖关系可视化
- `compodoc`:文档和依赖生成

---

## 4. 白名单配置

### 5.1 排除目录

创建 `.scan-ignore` 文件：

```text
# 测试代码
src/test/**
*Test.java
*Test.py

# 自动生成代码
src/main/java/**/generated/**
**/target/**
**/build/**

# 第三方 SDK
src/main/java/**/sdk/**
node_modules/**
vendor/**

# 示例代码
example/**
demo/**
samples/**

# 文档
docs/**
README.md
```

### 5.2 排除规则

```bash
# 扫描时排除白名单
git diff --name-only | grep -vf .scan-ignore
```

---

## 5. CI/CD 集成参考

### 6.1 GitHub Actions

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
      
      - name: 执行待提交代码获取
        run: |
          # 调用 AI Skill 执行获取
          echo "执行待提交代码获取..."
      
      - name: 上传报告
        uses: actions/upload-artifact@v3
        with:
          name: pending-changes
          path: docs/pending-changes-*.md
```

### 6.2 GitLab CI

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

### 6.3 Jenkins Pipeline

```groovy
pipeline {
    agent any
    
    stages {
        stage('Pending Code Changes') {
            steps {
                sh '''
                    .qoder/skills/ca-pending-code-reviewer/scripts/pending-diff.sh \\
                        --base origin/main \\
                        --target HEAD \\
                        --output changes.txt
                    
                    .qoder/skills/ca-pending-code-reviewer/scripts/context-analyzer.sh \\
                        --changes-file changes.txt \\
                        --lang java
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'docs/pending-changes-*.md'
                }
            }
        }
    }
}
```

---

## 6. 常见问题（FAQ）

### Q1: 如何处理大型 PR（数百个文件变更）？

**A**: 使用分批处理策略：
1. 按模块分组变更文件
2. 优先获取核心模块（Service、Controller）
3. 配置文件、文档变更可延迟获取

### Q2: 如何避免遗漏变更？

**A**: 
1. 配置白名单（`.scan-ignore`）
2. 使用完整的 diff 命令
3. 检查所有变更类型（A/M/D/R）

### Q3: 如何与现有工具集成？

**A**: 
- 与 CI/CD 工具集成（GitHub Actions / GitLab CI）
- 与代码审查工具结合使用
- 自动化生成变更报告

### Q4: 如何处理跨分支的变更？

**A**: 
1. 始终以 `main` 为基准分支
2. 使用 `git merge-base` 查找共同祖先
3. 避免以最近提交为基准（可能遗漏变更）

---

## 7. 最佳实践

1. **提交前审核**：每次代码提交前自动获取待提交代码
2. **基线对比**：默认使用 `HEAD~5` 作为对比基准，而非 HEAD~3 或其他范围
3. **变更归因**：明确标注变更类型（新增/修改/删除/重命名）
4. **依赖分析**：分析变更文件的引用关系，识别影响范围
5. **自动化集成**：与 CI/CD 流水线集成
6. **定期审核**：每次重要提交前获取变更清单

---

## 8. 相关工具推荐

### 静态分析工具
- **SonarQube**：代码质量与安全扫描
- **Checkmarx**：企业级 SAST 工具
- **Fortify**：HP 安全扫描工具
- **Semgrep**：轻量级代码扫描工具

### 依赖分析工具
- **OWASP Dependency-Check**：依赖漏洞扫描
- **Snyk**：依赖安全与许可证检查
- **Renovate**：依赖自动更新

### 性能分析工具
- **JProfiler**：Java 性能分析
- **py-spy**：Python 性能分析
- **pprof**：Go 性能分析
- **Clinic.js**：Node.js 性能分析

### CI/CD 集成
- **GitHub Actions**：GitHub 原生 CI/CD
- **GitLab CI**：GitLab 原生 CI/CD
- **Jenkins**：开源 CI/CD 平台
- **CircleCI**：云原生 CI/CD

---

## 9. 扩展阅读

- [Git Diff 官方文档](https://git-scm.com/docs/git-diff)
- [OWASP Code Review Guide](https://owasp.org/www-project-code-review-guide/)
- [SonarQube Incremental Analysis](https://docs.sonarqube.org/latest/analysis/analysis-parameters/)
- [Semgrep CI Integration](https://semgrep.dev/docs/ci-integrations/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
