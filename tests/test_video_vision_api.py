from fastapi.testclient import TestClient

import main


def test_video_frame_analysis_requires_tail_frame_for_start_end_mode():
    response = TestClient(main.app).post(
        "/api/video/analyze_frames",
        json={
            "mode": "start_end_video",
            "first_frame_url": "data:image/png;base64," + ("A" * 32),
        },
    )

    assert response.status_code == 422
    assert "尾帧" in response.json()["detail"]


def test_video_frame_analysis_returns_generated_prompt(monkeypatch):
    async def fake_vision(image_urls: list[str], mode: str):
        assert len(image_urls) == 2
        assert mode == "start_end_video"
        return "镜头从首帧平滑推进到尾帧", "glm-5v-turbo"

    monkeypatch.setattr(main, "_call_video_frame_vision", fake_vision)
    response = TestClient(main.app).post(
        "/api/video/analyze_frames",
        json={
            "mode": "start_end_video",
            "first_frame_url": "data:image/png;base64," + ("A" * 32),
            "last_frame_url": "https://example.com/last.png",
        },
    )

    assert response.status_code == 200
    assert response.json()["prompt"] == "镜头从首帧平滑推进到尾帧"
    assert response.json()["model"] == "glm-5v-turbo"
