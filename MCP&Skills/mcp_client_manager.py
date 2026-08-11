"""
MCP Client Manager (MCP 客户端管理器): 
负责启动 MCP 子进程，通过 JSON-RPC 通信，并将 MCP Tools 转化为 LangGraph 绑定工具
"""

import sys
import json
import subprocess
import os
from typing import List, Dict, Any
from langchain_core.tools import tool

class MCPClientManager:
    def __init__(self, server_script_path: str):
        self.server_script_path = server_script_path
        self.process = None
        self.req_id_counter = 1
        self.tools_schema = []

    def start_and_init(self):
        """1. 在后台拉起 MCP Server 子进程并建立 stdio 管道"""
        print(f"\n[MCP Client] 🔌 正在通过 stdio 建立 MCP 协议连接: {self.server_script_path}...")
        
        self.process = subprocess.Popen(
            [sys.executable, self.server_script_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            encoding='utf-8'
        )

        # 2. 发送 initialize 握手
        init_req = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "initialize",
            "params": {"clientInfo": {"name": "FastAPI-Agent-Host"}}
        }
        self._send_request(init_req)

        # 3. 获取工具列表 (tools/list)
        list_req = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tools/list"
        }
        resp = self._send_request(list_req)
        
        if "result" in resp and "tools" in resp["result"]:
            self.tools_schema = resp["result"]["tools"]
            print(f"✅ [MCP Client] 连接成功！成功搜寻到 {len(self.tools_schema)} 个 MCP 工具:")
            for t in self.tools_schema:
                print(f"   - 🛠️  [{t['name']}]: {t['description']}")

    def call_mcp_tool(self, name: str, arguments: dict) -> str:
        """4. 远程调用 MCP Server 上的工具 (tools/call)"""
        print(f"⚡ [MCP Client] 正在通过 JSON-RPC 调用 MCP 工具: {name} (参数: {arguments})...")
        call_req = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": arguments
            }
        }
        resp = self._send_request(call_req)
        
        if "result" in resp and "content" in resp["result"]:
            content_list = resp["result"]["content"]
            return "\n".join([item.get("text", "") for item in content_list])
        elif "error" in resp:
            return f"MCP 工具执行失败: {resp['error']['message']}"
        return "未知工具响应"

    def _next_id(self) -> int:
        self.req_id_counter += 1
        return self.req_id_counter

    def _send_request(self, req: dict) -> dict:
        """通过 stdin 写入 JSON，并从 stdout 读取一行响应"""
        req_str = json.dumps(req, ensure_ascii=False) + "\n"
        self.process.stdin.write(req_str)
        self.process.stdin.flush()
        
        line = self.process.stdout.readline()
        if not line:
            return {}
        return json.loads(line.strip())

    def close(self):
        if self.process:
            self.process.terminate()
            print("[MCP Client] 🛑 MCP 协议连接已安全关闭。")