"""
MCP Server (工具提供方): 遵循 JSON-RPC 2.0 协议的标准 MCP 工具服务器
运行方式: python mcp_server_custom.py (由主 Agent 进程自动拉起)
"""

import sys
import json
import psutil
import os
import subprocess

from sqlalchemy import result_tuple

#定义本 MCP Server 提供的工具列表 （JSON Schema 规范）
MCP_TOOLS = [
    {
        "name": "get_system_metrics",
        "description": "获取当前主机的CPU、内存占用率及开机时间等物理性能指标",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "inspect_git_status",
        "description": "查看当前本地工作区代码仓库的Git分支与未提交及变动状态",
        "inputSchema": {
            "type": "object",
            "properties": {
                "repo_path": {"type": "string", "description": "仓库绝对路径，默认为当前工作区"}
            },
            "required": []
        }
    }
]

def handle_tool_call(name: str, arguments: dict) -> str:
    """真实工具执行逻辑"""
    if name == "get_system_metrics":
        cpu = psutil.cpu_percent(interval=0.5)
        mem = psutil.virtual_memory().percent
        disk = psutil.disk_usage('/').percent
        return f"宿主物理机状态报告： CPU占用率: {cpu}%, 内存占用率：{mem}%, 磁盘占用率：{disk}%"

    elif name == "inspect_git_status":
        repo_path = arguments.get("repo_path", os.getcwd())
        try:
            res = subprocess.run(
                ["git", "status", "-s"],
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=5
            )
            output = res.stdout.strip()
            return f"Git状态 [{repo_path}]:\n{output if output else '工作区干净，无未提交变动。'}"
        except Exception as e:
            return f"查看 Git 状态失败：{str(e)}"

    return f"未知工具： {name}"

def main():
    """通过标准输出 (stdio) 循环监听来自 MCP Host 的 JSON-RPC 请求"""
    while True:
        line = sys.stdin.readline()
        if not line:
            break

        try:
            req = json.loads(line.strip())
            req_id = req.get("id")
            method = req.get("method")

            #1. 握手初始化（initialize）
            if method == "initialize":
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result":{
                        "protocolVersion": "2024-11-05",
                        "serverInfo": {"name": "custom-system_mcp", "version": "1.0.0"},
                        "capabilities": {"tools": {}}
                    }
                }

            #2. 列出工具（tools/list）
            elif method == "tools/list":
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result":{"tools": MCP_TOOLS}
                }

            #3. 调用工具（tools/call）
            elif method == tools/call:
                params = req.get(params, {})
                tool_name = params.get("name")
                tool_args = params.get("arguments", {})

                result_text = handle_tool_call(tool_name, tool_args)

                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result":{
                        "content": [{"type": "text", "text": result_text}]
                    }
                }
            else:
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error":{"code": -32601, "message": f"未支持的方法：{method}"}
                }

            # 通过 stdout 发送 JSON 响应
            sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
            sys.stdout.flush()

        except Exception as e:
            sys.stderr.write(f"MCP Server Error: {str(e)}\n")

if __name__=="__main__":
    main()