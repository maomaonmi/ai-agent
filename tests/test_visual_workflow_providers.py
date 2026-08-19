from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from visual_workflow_providers import HttpImageProvider, HttpVisionProvider, WorkflowImageProviderError


def test_qwen_image_provider_sends_multiple_reference_images():
    captured = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.content)
        return httpx.Response(200, json={"output": {"choices": [{"message": {"content": [{"image": "https://cdn.example/out.png"}]}}]}})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = HttpImageProvider({"qwen": "qwen-key"}, client=client, qwen_base_url="https://dashscope.test")
    urls = asyncio.run(provider.generate(model="qwen-image-3.0", prompt="一只猫", ratio="1:1", count=1, references=["https://cdn.example/a.png", "https://cdn.example/b.png"]))
    asyncio.run(client.aclose())

    assert urls == ["https://cdn.example/out.png"]
    content = captured["json"]["input"]["messages"][0]["content"]
    assert [item["image"] for item in content if "image" in item] == ["https://cdn.example/a.png", "https://cdn.example/b.png"]


def test_wan27_image_provider_submits_async_task_and_polls_until_succeeded():
    captured = {}
    poll_count = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal poll_count
        if request.method == "POST":
            captured["path"] = request.url.path
            captured["headers"] = dict(request.headers)
            captured["json"] = json.loads(request.content)
            return httpx.Response(200, json={"output": {"task_id": "img-task-1", "task_status": "PENDING"}})
        poll_count += 1
        if poll_count == 1:
            return httpx.Response(200, json={"output": {"task_id": "img-task-1", "task_status": "RUNNING"}})
        return httpx.Response(
            200,
            json={
                "output": {
                    "task_id": "img-task-1",
                    "task_status": "SUCCEEDED",
                    "choices": [{"message": {"content": [{"image": "https://cdn.example/wan27.png"}]}}],
                }
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = HttpImageProvider(
        {"qwen": "qwen-key"},
        client=client,
        qwen_base_url="https://dashscope.test",
        image_poll_interval_seconds=0,
        max_image_polls=3,
    )
    urls = asyncio.run(provider.generate(model="wan2.7-image", prompt="一只猫", ratio="1:1", count=1, references=[]))
    asyncio.run(client.aclose())

    assert urls == ["https://cdn.example/wan27.png"]
    assert captured["path"] == "/api/v1/services/aigc/image-generation/generation"
    assert captured["headers"]["x-dashscope-async"] == "enable"
    assert captured["json"]["parameters"]["thinking_mode"] is True
    assert "prompt_extend" not in captured["json"]["parameters"]
    assert poll_count == 2


def test_qwen_image_provider_converts_local_image_asset_to_data_uri():
    captured = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, headers={"content-type": "image/png"}, content=b"png-bytes")
        captured["json"] = json.loads(request.content)
        return httpx.Response(200, json={"output": {"choices": [{"message": {"content": [{"image": "https://cdn.example/out.png"}]}}]}})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = HttpImageProvider({"qwen": "qwen-key"}, client=client, qwen_base_url="https://dashscope.test")
    urls = asyncio.run(provider.generate(model="qwen-image-3.0", prompt="编辑图片", ratio="1:1", count=1, references=["http://localhost:8000/api/image/plaza/assets/local-1"]))
    asyncio.run(client.aclose())

    assert urls == ["https://cdn.example/out.png"]
    image_value = captured["json"]["input"]["messages"][0]["content"][1]["image"]
    assert image_value.startswith("data:image/png;base64,")


def test_image_provider_requires_configured_key_and_validates_output():
    provider = HttpImageProvider({})
    with pytest.raises(WorkflowImageProviderError, match="未配置"):
        asyncio.run(provider.generate(model="qwen-image-3.0", prompt="猫", ratio="1:1", count=1, references=[]))


def test_vision_provider_uses_openai_compatible_model_and_returns_prompt():
    captured = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "一只猫在雨中奔跑，电影感运镜"}}]})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = HttpVisionProvider({"qwen": {"api_key": "key", "base_url": "https://qwen.test/v1", "model": "qwen3.7-flash"}}, client=client)
    prompt = asyncio.run(provider.describe(["https://cdn.example/cat.png"]))
    asyncio.run(client.aclose())

    assert prompt.startswith("一只猫")
    assert captured["json"]["model"] == "qwen3.7-flash"
    assert captured["json"]["messages"][0]["content"][0]["image_url"]["url"] == "https://cdn.example/cat.png"
