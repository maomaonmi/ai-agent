#!/bin/bash

###############################################################################
# context-analyzer.sh - 依赖关系分析器
# 
# 功能：分析变更文件的依赖关系，找出引用该文件的其他文件
# 
# 支持的语言：
#   - Java: 分析 import 语句
#   - Python: 分析 import/from...import 语句
#   - Go: 分析 import 语句
#   - Node.js/JS/TS: 分析 require/import 语句
#   - PHP: 分析 use/require/include 语句
# 
# 用法：
#   ./context-analyzer.sh --file <file_path> --lang <language>
#   ./context-analyzer.sh --file UserServiceImpl.java --lang java
#   ./context-analyzer.sh --changes-file changes.txt --lang java
# 
# 输出：
#   - 引用该文件的其他文件列表
#   - 依赖关系图（可选）
###############################################################################

set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 参数初始化
FILE_PATH=""
LANGUAGE=""
CHANGES_FILE=""
OUTPUT_GRAPH=false
SRC_DIR="src"

# 帮助信息
usage() {
    cat << EOF
用法: $0 [选项]

选项:
  --file <file_path>        文件路径
  --lang <language>         语言类型（java/python/go/nodejs/php）
  --changes-file <file>     变更文件列表
  --src-dir <dir>           源码目录（默认 src）
  --graph                   输出依赖关系图
  -h, --help                显示帮助信息

示例:
  # 分析单个文件
  $0 --file UserServiceImpl.java --lang java

  # 分析批量文件
  $0 --changes-file changes.txt --lang java

  # 输出依赖关系图
  $0 --file UserServiceImpl.java --lang java --graph
EOF
    exit 1
}

# 参数解析
while [[ $# -gt 0 ]]; do
    case $1 in
        --file)
            FILE_PATH="$2"
            shift 2
            ;;
        --lang)
            LANGUAGE="$2"
            shift 2
            ;;
        --changes-file)
            CHANGES_FILE="$2"
            shift 2
            ;;
        --src-dir)
            SRC_DIR="$2"
            shift 2
            ;;
        --graph)
            OUTPUT_GRAPH=true
            shift
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
if [ -z "$CHANGES_FILE" ]; then
    if [ -z "$FILE_PATH" ] || [ -z "$LANGUAGE" ]; then
        echo -e "${RED}错误: 必须指定 --file 和 --lang，或 --changes-file${NC}"
        usage
    fi
fi

# 从文件路径提取类名/模块名
extract_class_name() {
    local file_path=$1
    local language=$2
    
    local base_name=$(basename "$file_path")
    
    case $language in
        java)
            # UserServiceImpl.java -> UserServiceImpl
            echo "${base_name%.java}"
            ;;
        python)
            # user_service.py -> user_service
            echo "${base_name%.py}"
            ;;
        go)
            # user_service.go -> user_service
            echo "${base_name%.go}"
            ;;
        nodejs)
            # UserService.js -> UserService
            echo "${base_name%.js}"
            ;;
        php)
            # UserService.php -> UserService
            echo "${base_name%.php}"
            ;;
        *)
            echo "$base_name"
            ;;
    esac
}

# 查找引用该类的其他文件（Java）
find_java_dependencies() {
    local class_name=$1
    local src_dir=$2
    
    echo -e "${BLUE}正在搜索引用类 '$class_name' 的 Java 文件...${NC}"
    echo ""
    
    # 搜索 import 语句
    local results=$(grep -r "import.*${class_name}" --include="*.java" "$src_dir" 2>/dev/null || true)
    
    if [ -z "$results" ]; then
        echo -e "${YELLOW}未找到引用该类的文件${NC}"
        return
    fi
    
    # 提取文件路径
    echo "$results" | cut -d: -f1 | sort -u | while read -r file; do
        echo "  - $file"
    done
}

# 查找引用该模块的其他文件（Python）
find_python_dependencies() {
    local module_name=$1
    local src_dir=$2
    
    echo -e "${BLUE}正在搜索引用模块 '$module_name' 的 Python 文件...${NC}"
    echo ""
    
    # 搜索 import 语句
    local results=$(grep -rE "from.*${module_name} import|import ${module_name}" --include="*.py" "$src_dir" 2>/dev/null || true)
    
    if [ -z "$results" ]; then
        echo -e "${YELLOW}未找到引用该模块的文件${NC}"
        return
    fi
    
    # 提取文件路径
    echo "$results" | cut -d: -f1 | sort -u | while read -r file; do
        echo "  - $file"
    done
}

# 查找引用该包的其他文件（Go）
find_go_dependencies() {
    local package_name=$1
    local src_dir=$2
    
    echo -e "${BLUE}正在搜索引用包 '$package_name' 的 Go 文件...${NC}"
    echo ""
    
    # 搜索 import 语句
    local results=$(grep -r "\".*${package_name}\"" --include="*.go" "$src_dir" 2>/dev/null || true)
    
    if [ -z "$results" ]; then
        echo -e "${YELLOW}未找到引用该包的文件${NC}"
        return
    fi
    
    # 提取文件路径
    echo "$results" | cut -d: -f1 | sort -u | while read -r file; do
        echo "  - $file"
    done
}

# 查找引用该模块的其他文件（Node.js）
find_nodejs_dependencies() {
    local module_name=$1
    local src_dir=$2
    
    echo -e "${BLUE}正在搜索引用模块 '$module_name' 的 Node.js 文件...${NC}"
    echo ""
    
    # 搜索 require/import 语句
    local results=$(grep -rE "require\(.*${module_name}|from.*${module_name}" --include="*.js" --include="*.ts" "$src_dir" 2>/dev/null || true)
    
    if [ -z "$results" ]; then
        echo -e "${YELLOW}未找到引用该模块的文件${NC}"
        return
    fi
    
    # 提取文件路径
    echo "$results" | cut -d: -f1 | sort -u | while read -r file; do
        echo "  - $file"
    done
}

# 查找引用该类的其他文件（PHP）
find_php_dependencies() {
    local class_name=$1
    local src_dir=$2
    
    echo -e "${BLUE}正在搜索引用类 '$class_name' 的 PHP 文件...${NC}"
    echo ""
    
    # 搜索 use/require/include 语句
    local results=$(grep -rE "use.*${class_name}|require.*${class_name}|include.*${class_name}" --include="*.php" "$src_dir" 2>/dev/null || true)
    
    if [ -z "$results" ]; then
        echo -e "${YELLOW}未找到引用该类的文件${NC}"
        return
    fi
    
    # 提取文件路径
    echo "$results" | cut -d: -f1 | sort -u | while read -r file; do
        echo "  - $file"
    done
}

# 分析单个文件的依赖关系
analyze_file_dependencies() {
    local file_path=$1
    local language=$2
    
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  文件: $file_path${NC}"
    echo -e "${GREEN}========================================${NC}"
    
    # 提取类名/模块名
    local class_name=$(extract_class_name "$file_path" "$language")
    echo -e "${BLUE}类名/模块名:${NC} $class_name"
    echo ""
    
    # 根据语言类型查找依赖
    case $language in
        java)
            find_java_dependencies "$class_name" "$SRC_DIR"
            ;;
        python)
            find_python_dependencies "$class_name" "$SRC_DIR"
            ;;
        go)
            find_go_dependencies "$class_name" "$SRC_DIR"
            ;;
        nodejs)
            find_nodejs_dependencies "$class_name" "$SRC_DIR"
            ;;
        php)
            find_php_dependencies "$class_name" "$SRC_DIR"
            ;;
        *)
            echo -e "${RED}错误: 不支持的语言类型 $language${NC}"
            exit 1
            ;;
    esac
    
    echo ""
}

# 生成依赖关系图（Mermaid 格式）
generate_dependency_graph() {
    local file_path=$1
    local language=$2
    local class_name=$(extract_class_name "$file_path" "$language")
    
    echo "```mermaid"
    echo "graph LR"
    echo "    A[$class_name] --> B[依赖文件1]"
    echo "    A --> C[依赖文件2]"
    echo "```"
}

# 处理批量文件
process_batch_files() {
    local changes_file=$1
    local language=$2
    
    if [ ! -f "$changes_file" ]; then
        echo -e "${RED}错误: 文件不存在 $changes_file${NC}"
        exit 1
    fi
    
    while IFS=$'\t' read -r change_type file_path; do
        # 跳过删除的文件
        if [ "$change_type" = "D" ]; then
            continue
        fi
        
        analyze_file_dependencies "$file_path" "$language"
        
        if [ "$OUTPUT_GRAPH" = true ]; then
            generate_dependency_graph "$file_path" "$language"
            echo ""
        fi
        
    done < "$changes_file"
}

# 主流程
main() {
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  依赖关系分析器${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    
    # 检查源码目录是否存在
    if [ ! -d "$SRC_DIR" ]; then
        echo -e "${YELLOW}警告: 源码目录不存在 $SRC_DIR，尝试使用当前目录${NC}"
        SRC_DIR="."
    fi
    
    if [ -n "$CHANGES_FILE" ]; then
        # 批量处理
        process_batch_files "$CHANGES_FILE" "$LANGUAGE"
    else
        # 单个文件
        analyze_file_dependencies "$FILE_PATH" "$LANGUAGE"
        
        if [ "$OUTPUT_GRAPH" = true ]; then
            echo -e "${BLUE}依赖关系图:${NC}"
            generate_dependency_graph "$FILE_PATH" "$LANGUAGE"
        fi
    fi
}

# 执行主流程
main "$@"
