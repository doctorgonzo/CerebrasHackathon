# The Hive — setup

A live multimodal agent swarm. Point your webcam at something, hit **Stare**,
and a tree of agents spawns to make sense of the scene. Forked from agentSpam;
runs on Claude for local testing, swaps to **Gemma 4 31B on Cerebras** at the
hackathon.

## 0. Install Node (this machine doesn't have it yet)

There's no Node/npm on this Mac. Pick one:

- **Easiest:** download the macOS `.pkg` from <https://nodejs.org> (LTS, v20 or v22) and run it.
- **Or nvm:**
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  # restart your shell, then:
  nvm install 22
  ```

Verify: `node -v` should print v20+ (Next 16 needs ≥ 18.18).

## 1. Install deps

```bash
cd ~/development/CerebrasHackathon
npm install
```

## 2. Add your API key

```bash
cp .env.local.example .env.local
# edit .env.local and set ANTHROPIC_API_KEY=sk-ant-...
```

## 3. Run

```bash
npm run dev
```

Open <http://localhost:3000>. The **Camera** tab is the default.

> **Camera note:** `getUserMedia` only works in a *secure context*.
> `http://localhost` counts as secure, so local dev is fine. If you serve it
> over a LAN IP or a tunnel, you'll need HTTPS or the camera will be blocked.

## How it works right now

1. **WebcamPanel** grabs a frame from your camera and downscales it to a JPEG.
2. The frame is handed to the existing file pipeline as an image attachment.
3. The **Extractor** (Claude vision) reads the frame into rich text.
4. **The Brain** decomposes that into a swarm of specialist agents.
5. Results synthesize into one verdict (spoken aloud if voice is on).

The whole webcam path reuses agentSpam's Extractor → Brain → swarm flow — no
engine changes were needed for the MVP.

## What's left (see the task list)

- **Multi-Eyes:** 2–3 parallel vision agents (objects / text-OCR / spatial+change)
  instead of one Extractor, for richer multimodal collaboration.
- **Glance loop:** continuous shallow re-runs every ~2s on the live feed; deep
  swarm only on "Stare." (Sells the Cerebras speed story.)
- **Cerebras/Gemma swap:** OpenAI-compatible client → Cerebras serving Gemma 4 31B.
  Confirm the endpoint accepts image input *first*.
