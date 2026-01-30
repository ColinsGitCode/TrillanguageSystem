#!/bin/bash

# ========================================
# Gemini API 测试脚本
# ========================================
# 用途：验证 Gemini API 配置和功能
# 使用：chmod +x test_api.sh && ./test_api.sh
# ========================================

set -e  # 遇到错误立即退出

# 配置
API_BASE="http://localhost:3010"
TEST_PHRASES=(
    "hello"
    "你好"
    "API"
    "run"
    "打招呼"
)

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# 检查服务是否运行
check_server() {
    print_info "检查服务状态..."

    if curl -s -f "${API_BASE}/api/folders" > /dev/null 2>&1; then
        print_success "服务正在运行"
        return 0
    else
        print_error "服务未运行，请先启动服务"
        echo ""
        echo "启动命令："
        echo "  npm start"
        echo "  或"
        echo "  docker compose up -d"
        exit 1
    fi
}

# 测试单个短语生成
test_generate() {
    local phrase=$1
    local test_num=$2
    local total=$3

    print_info "测试 [$test_num/$total]: \"$phrase\""

    # 发送请求
    response=$(curl -s -X POST "${API_BASE}/api/generate" \
        -H "Content-Type: application/json" \
        -d "{\"phrase\":\"$phrase\"}" \
        2>&1)

    # 检查响应
    if echo "$response" | grep -q '"success":true'; then
        print_success "生成成功: $phrase"

        # 提取文件路径
        md_file=$(echo "$response" | grep -o '"markdown":"[^"]*"' | cut -d'"' -f4)
        html_file=$(echo "$response" | grep -o '"html":"[^"]*"' | cut -d'"' -f4)

        echo "  - Markdown: $md_file"
        echo "  - HTML: $html_file"

        return 0
    else
        print_error "生成失败: $phrase"
        echo "$response" | head -5
        return 1
    fi
}

# 测试 OCR（可选）
test_ocr() {
    print_info "测试 OCR 功能（需要测试图片）..."

    # 查找测试图片
    if [ ! -f "test_image.png" ] && [ ! -f "test_image.jpg" ]; then
        print_warning "未找到测试图片 (test_image.png 或 test_image.jpg)，跳过 OCR 测试"
        return 0
    fi

    local image_file="test_image.png"
    if [ ! -f "$image_file" ]; then
        image_file="test_image.jpg"
    fi

    print_info "使用图片: $image_file"

    # 转换为 base64
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        image_base64=$(base64 -i "$image_file" | tr -d '\n')
    else
        # Linux
        image_base64=$(base64 -w 0 "$image_file")
    fi

    # 获取 MIME 类型
    if [[ "$image_file" == *.png ]]; then
        mime_type="image/png"
    else
        mime_type="image/jpeg"
    fi

    # 发送 OCR 请求
    response=$(curl -s -X POST "${API_BASE}/api/ocr" \
        -H "Content-Type: application/json" \
        -d "{\"image\":\"data:${mime_type};base64,${image_base64}\"}" \
        2>&1)

    # 检查响应
    if echo "$response" | grep -q '"text"'; then
        print_success "OCR 成功"
        recognized_text=$(echo "$response" | grep -o '"text":"[^"]*"' | cut -d'"' -f4)
        echo "  识别文字: $recognized_text"
        return 0
    else
        print_error "OCR 失败"
        echo "$response" | head -5
        return 1
    fi
}

# 性能测试
performance_test() {
    print_info "性能测试：连续生成 3 个短语..."

    local start_time=$(date +%s)
    local success_count=0

    for phrase in "hello" "world" "test"; do
        if curl -s -X POST "${API_BASE}/api/generate" \
            -H "Content-Type: application/json" \
            -d "{\"phrase\":\"$phrase\"}" \
            | grep -q '"success":true'; then
            ((success_count++))
        fi

        # 遵守 4 秒速率限制
        sleep 4
    done

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    print_success "完成 $success_count/3 个请求，耗时 ${duration}s"

    if [ $success_count -eq 3 ]; then
        return 0
    else
        return 1
    fi
}

# 主测试流程
main() {
    echo ""
    echo "========================================="
    echo "  Gemini API 功能测试"
    echo "========================================="
    echo ""

    # 1. 检查服务
    check_server
    echo ""

    # 2. 测试文本生成
    echo "========================================="
    echo "  测试 1: 文本生成"
    echo "========================================="
    echo ""

    local total=${#TEST_PHRASES[@]}
    local success=0
    local failed=0

    for i in "${!TEST_PHRASES[@]}"; do
        if test_generate "${TEST_PHRASES[$i]}" $((i+1)) $total; then
            ((success++))
        else
            ((failed++))
        fi
        echo ""

        # 遵守速率限制（4秒/次）
        if [ $((i+1)) -lt $total ]; then
            print_info "等待 4 秒（速率限制）..."
            sleep 4
        fi
    done

    echo ""
    echo "========================================="
    echo "  测试结果汇总"
    echo "========================================="
    echo ""
    print_info "总测试数: $total"
    print_success "成功: $success"
    if [ $failed -gt 0 ]; then
        print_error "失败: $failed"
    fi

    # 3. 测试 OCR（可选）
    echo ""
    echo "========================================="
    echo "  测试 2: OCR 图片识别"
    echo "========================================="
    echo ""

    test_ocr

    # 4. 性能测试（可选）
    echo ""
    echo "========================================="
    echo "  测试 3: 性能测试"
    echo "========================================="
    echo ""

    performance_test

    # 最终结果
    echo ""
    echo "========================================="
    echo "  测试完成"
    echo "========================================="
    echo ""

    if [ $failed -eq 0 ]; then
        print_success "所有测试通过！系统配置正确 ✓"
        return 0
    else
        print_warning "部分测试失败，请检查配置和日志"
        return 1
    fi
}

# 运行主函数
main
