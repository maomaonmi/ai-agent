#!/bin/bash

###############################################################################
# pending-diff.sh - 获取待提交代码变更
# 
# 功能：基于 Git Diff 获取新增、修改、删除、重命名的文件列表及变更行号
# 
# 使用场景：
#   - 对比分支：获取两个分支之间的代码变更
#   - 对比提交：获取两个提交之间的代码变更
#   - 未提交变更：获取工作区或暂存区的变更
# 
# 用法：
#   ./pending-diff.sh --base <base_commit> --target <target_commit>
#   ./pending-diff.sh --base main --target feature-branch
#   ./pending-diff.sh --staged
#   ./pending-diff.sh --unstaged
# 
# 输出：
#   - 变更文件列表（带变更类型标记：A/M/D/R）
#   - 每个文件的变更行号范围
#   - 变更统计信息
###############################################################################

set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 参数初始化
BASE_COMMIT="HEAD~5"  # 默认使用 HEAD~5 作为基准
TARGET_COMMIT="HEAD"
STAGED=false
UNSTAGED=false
ALL_PENDING=false
OUTPUT_FILE=""
# 包含的文件扩展名（代码、配置、脚本等）
FILE_EXTENSIONS="java|py|go|js|ts|php|yml|yaml|xml|properties|json|vue|jsx|tsx|html|css|scss|less|kt|groovy|sql|sh|gradle|pom|conf|ini|env|proto|graphql"
# 排除的文件扩展名（文档、图片、二进制等）
EXCLUDE_EXTENSIONS="md|txt|doc|docx|pdf|xls|xlsx|ppt|pptx|rst|log|png|jpg|jpeg|gif|svg|ico|bmp|webp|tiff|raw|psd|ai|sketch|jar|war|class|exe|so|dll|zip|tar|gz"
# 排除的目录（测试、构建、IDE配置等）
EXCLUDE_DIRS="test|tests|__tests__|target|build|dist|node_modules|vendor|\.idea|\.vscode|\.git|__pycache__|\.venv|venv|example|examples|docs|coverage"

# 帮助信息
usage() {
    cat << EOF
用法: $0 [选项]

选项:
  --base <commit>       基准提交/分支(如 main, HEAD~5)
  --target <commit>     目标提交/分支（默认 HEAD）
  --staged              获取暂存区的变更
  --unstaged            获取工作区的变更（未暂存）
  --all                 获取所有待提交代码（暂存区 + 工作区）
  --output <file>       输出到文件
  --extensions <ext>    文件扩展名过滤（默认：java|py|go|js|vue 等）
  -h, --help            显示帮助信息

注意：
  - 自动排除文档类型文件（*.md|*.txt|*.doc|*.pdf 等）
  - 自动排除二进制文件（*.jar|*.war|*.class|*.exe 等）
  - 自动排除测试/构建/IDE目录（test/|target/|.idea/ 等）

示例:
  # 对比分支
  $0 --base main --target feature-branch

  # 对比提交（默认 HEAD~5）
  $0
  $0 --base HEAD~5 --target HEAD

  # 未提交的变更（暂存区）
  $0 --staged

  # 未提交的变更（工作区）
  $0 --unstaged

  # 获取所有待提交代码（暂存区 + 工作区）⭐ 推荐
  $0 --all

  # 输出到文件
  $0 --base main --target feature-branch --output changes.txt
EOF
    exit 1
}

# 参数解析
while [[ $# -gt 0 ]]; do
    case $1 in
        --base)
            BASE_COMMIT="$2"
            shift 2
            ;;
        --target)
            TARGET_COMMIT="$2"
            shift 2
            ;;
        --staged)
            STAGED=true
            shift
            ;;
        --unstaged)
            UNSTAGED=true
            shift
            ;;
        --all)
            ALL_PENDING=true
            shift
            ;;
        --output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        --extensions)
            FILE_EXTENSIONS="$2"
            shift 2
            ;;
        --exclude-dirs)
            EXCLUDE_DIRS="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo -e "${RED}错误: 未知参数 $1${NC}"
            usage
            ;;
    esac
done

# 验证参数
if [ "$STAGED" = false ] && [ "$UNSTAGED" = false ] && [ "$ALL_PENDING" = false ] && [ -z "$BASE_COMMIT" ]; then
    # 如果未指定任何参数，使用默认的 HEAD~5..HEAD
    BASE_COMMIT="HEAD~5"
    TARGET_COMMIT="HEAD"
fi

# 获取变更文件列表
get_changed_files() {
    local diff_cmd=""
    
    if [ "$ALL_PENDING" = true ]; then
        # 综合获取：暂存区 + 工作区
        echo "=== 获取暂存区变更 ==="
        local staged_changes=$(git diff --name-status --cached -M 2>/dev/null || true)
        echo "=== 获取工作区变更 ==="
        local unstaged_changes=$(git diff --name-status -M 2>/dev/null || true)
        
        # 合并并去重
        echo -e "${staged_changes}\n${unstaged_changes}" | grep -v '^$' | sort -t$'\t' -k2,2 -u
        return
    fi
    
    if [ "$STAGED" = true ]; then
        # 暂存区变更
        diff_cmd="git diff --name-status --cached -M"
    elif [ "$UNSTAGED" = true ]; then
        # 工作区变更
        diff_cmd="git diff --name-status -M"
    else
        # 分支/提交对比
        diff_cmd="git diff --name-status -M ${BASE_COMMIT}..${TARGET_COMMIT}"
    fi
    
    echo "=== 执行命令: $diff_cmd ==="
    eval "$diff_cmd"
}

# 获取文件的变更行号
get_changed_lines() {
    local file="$1"
    
    local diff_cmd=""
    if [ "$ALL_PENDING" = true ]; then
        # 综合模式：优先使用暂存区，如无则使用工作区
        local staged_lines=$(git diff --cached -U0 --no-color -- "$file" 2>/dev/null | grep '^@@' | sed -E 's/@@ -[0-9,]+ \+([0-9]+),([0-9]+) @@.*/\1,\2/' || true)
        if [ -n "$staged_lines" ]; then
            echo "$staged_lines"
            return
        fi
        diff_cmd="git diff -U0 --no-color -- \"$file\""
    elif [ "$STAGED" = true ]; then
        diff_cmd="git diff --cached -U0 --no-color -- \"$file\""
    elif [ "$UNSTAGED" = true ]; then
        diff_cmd="git diff -U0 --no-color -- \"$file\""
    else
        diff_cmd="git diff -U0 --no-color ${BASE_COMMIT}..${TARGET_COMMIT} -- \"$file\""
    fi
    
    # 解析 @@ 标记，提取行号
    eval "$diff_cmd" | grep '^@@' | sed -E 's/@@ -[0-9,]+ \+([0-9]+),([0-9]+) @@.*/\1,\2/'
}

# 统计变更类型
count_changes() {
    local changes="$1"
    
    local added=$(echo "$changes" | grep '^A' | wc -l | tr -d ' ')
    local modified=$(echo "$changes" | grep '^M' | wc -l | tr -d ' ')
    local deleted=$(echo "$changes" | grep '^D' | wc -l | tr -d ' ')
    local renamed=$(echo "$changes" | grep '^R' | wc -l | tr -d ' ')
    
    echo -e "${GREEN}新增文件 (A):${NC} $added"
    echo -e "${BLUE}修改文件 (M):${NC} $modified"
    echo -e "${RED}删除文件 (D):${NC} $deleted"
    echo -e "${YELLOW}重命名文件 (R):${NC} $renamed"
    echo ""
}

# 主流程
main() {
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  待提交代码变更检测工具${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    
    # 检查是否在 Git 仓库中
    if ! git rev-parse --is-inside-work-tree &>/dev/null; then
        echo -e "${RED}错误: 当前目录不是 Git 仓库${NC}"
        exit 1
    fi
    
    # 获取变更文件
    echo -e "${BLUE}[1/3] 获取变更文件列表...${NC}"
    local changes=$(get_changed_files)
    
    if [ -z "$changes" ]; then
        echo -e "${YELLOW}未检测到代码变更${NC}"
        exit 0
    fi
    
    # 过滤文件类型：先包含，后排除
    # 1. 按扩展名包含
    local filtered_changes=$(echo "$changes" | grep -E "\.(${FILE_EXTENSIONS})$" || true)
    
    if [ -z "$filtered_changes" ]; then
        echo -e "${YELLOW}未检测到匹配的源文件变更${NC}"
        exit 0
    fi
    
    # 2. 排除文档/二进制文件扩展名
    if [ -n "$EXCLUDE_EXTENSIONS" ]; then
        filtered_changes=$(echo "$filtered_changes" | grep -vE "\.(${EXCLUDE_EXTENSIONS})$" || true)
    fi
    
    # 3. 排除特定目录
    if [ -n "$filtered_changes" ] && [ -n "$EXCLUDE_DIRS" ]; then
        filtered_changes=$(echo "$filtered_changes" | grep -vE "(^|/)(${EXCLUDE_DIRS})(/|$)" || true)
    fi
    
    if [ -z "$filtered_changes" ]; then
        echo -e "${YELLOW}未检测到匹配的源文件变更${NC}"
        echo -e "${YELLOW}（已自动排除文档、二进制文件及测试/构建目录）${NC}"
        exit 0
    fi
    
    # 统计变更类型
    echo ""
    echo -e "${BLUE}[2/3] 变更统计:${NC}"
    count_changes "$filtered_changes"
    
    # 详细输出
    echo -e "${BLUE}[3/3] 变更详情:${NC}"
    echo ""
    
    local output_content=""
    local total_added=0
    local total_deleted=0
    
    while IFS=$'\t' read -r change_type file_path; do
        local status_text=""
        case $change_type in
            A) status_text="新增" ;;
            M) status_text="修改" ;;
            D) status_text="删除" ;;
            R*) status_text="重命名" ;;
            *) status_text="未知" ;;
        esac
        
        # 处理重命名文件：提取新旧路径
        if [[ "$change_type" == R* ]]; then
            # R100表示100%相似度的重命名，格式为: R100\told_path\tnew_path
            local old_path="$file_path"
            local new_path=""
            # 尝试读取下一列作为新路径
            IFS=$'\t' read -r -a path_parts <<< "$change_type $file_path"
            if [ ${#path_parts[@]} -ge 3 ]; then
                old_path="${path_parts[1]}"
                new_path="${path_parts[2]}"
                echo -e "  ${YELLOW}[$status_text]${NC} $old_path -> $new_path"
            else
                echo -e "  ${YELLOW}[$status_text]${NC} $file_path"
            fi
        else
            echo -e "  ${YELLOW}[$status_text]${NC} $file_path"
        fi
        
        # 获取变更行号（仅对修改文件）
        local lines=""
        if [ "$change_type" = "M" ]; then
            lines=$(get_changed_lines "$file_path")
            if [ -n "$lines" ]; then
                echo -e "    ${GREEN}变更行号:${NC} $lines"
            fi
        fi
        
        # 统计代码行数变化
        if [ "$change_type" = "M" ] || [ "$change_type" = "A" ]; then
            local diff_output=$(git diff --cached -U0 --no-color -- "$file_path" 2>/dev/null || git diff -U0 --no-color -- "$file_path" 2>/dev/null || true)
            if [ -n "$diff_output" ]; then
                local added=$(echo "$diff_output" | grep '^+' | grep -v '^+++' | wc -l | tr -d ' ')
                local deleted=$(echo "$diff_output" | grep '^-' | grep -v '^---' | wc -l | tr -d ' ')
                total_added=$((total_added + added))
                total_deleted=$((total_deleted + deleted))
                if [ "$added" -gt 0 ] || [ "$deleted" -gt 0 ]; then
                    echo -e "    ${BLUE}代码变化:${NC} +${added} -${deleted} 行"
                fi
            fi
        fi
        
        # 构建输出内容
        output_content+="${change_type}\t${file_path}"
        if [ -n "$lines" ]; then
            output_content+="\t$lines"
        fi
        output_content+="\n"
        
    done <<< "$filtered_changes"
    
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  检测完成${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "${BLUE}变更汇总:${NC}"
    echo -e "  ${GREEN}新增代码行数:${NC} +${total_added} 行"
    echo -e "  ${RED}删除代码行数:${NC} -${total_deleted} 行"
    echo -e "  ${BLUE}净变化:${NC} $((total_added - total_deleted)) 行"
    
    # 输出到文件
    if [ -n "$OUTPUT_FILE" ]; then
        echo -e "$output_content" > "$OUTPUT_FILE"
        echo -e "${BLUE}结果已保存到: $OUTPUT_FILE${NC}"
    fi
}

# 执行主流程
main "$@"
