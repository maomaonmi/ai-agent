# 启动方式: cd backend && python server.py
from fastapi import FastAPI, HTTPException
# SoundWave Music API - 启动方式: cd backend && python server.py
from fastapi.middleware.cors import CORSMiddleware
import json
from pathlib import Path

app = FastAPI(title="SoundWave Music API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path(__file__).parent / "database.json"

def load_db():
    with open(DB_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_db(data):
    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

@app.get("/api/tracks")
async def get_tracks():
    db = load_db()
    return db.get("tracks", [])

@app.get("/api/tracks/{track_id}")
async def get_track(track_id: int):
    db = load_db()
    tracks = db.get("tracks", [])
    for track in tracks:
        if track["id"] == track_id:
            return track
    raise HTTPException(status_code=404, detail="Track not found")

@app.post("/api/tracks/{track_id}/play")
async def play_track(track_id: int):
    db = load_db()
    tracks = db.get("tracks", [])
    for track in tracks:
        if track["id"] == track_id:
            track["plays"] = track.get("plays", 0) + 1
            save_db(db)
            return {"message": "Play recorded", "plays": track["plays"]}
    raise HTTPException(status_code=404, detail="Track not found")

@app.post("/api/tracks/{track_id}/like")
async def like_track(track_id: int):
    db = load_db()
    tracks = db.get("tracks", [])
    for track in tracks:
        if track["id"] == track_id:
            track["likes"] = track.get("likes", 0) + 1
            save_db(db)
            return {"message": "Liked", "likes": track["likes"]}
    raise HTTPException(status_code=404, detail="Track not found")

@app.get("/api/stats")
async def get_stats():
    db = load_db()
    tracks = db.get("tracks", [])
    total_plays = sum(t.get("plays", 0) for t in tracks)
    total_likes = sum(t.get("likes", 0) for t in tracks)
    return {
        "total_tracks": len(tracks),
        "total_plays": total_plays,
        "total_likes": total_likes
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)