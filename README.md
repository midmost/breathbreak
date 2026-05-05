# BreathBreak

**Interrupts doom scrolling with breathing exercises. Scroll freely — just breathe first.**

BreathBreak is a Chrome extension that monitors how long you've been scrolling social media and surfaces escalating breathing exercises before letting you continue. The longer the session, the deeper the intervention.

---

## How it works

BreathBreak tracks active time per site per day. When you cross a threshold, a full-screen overlay appears and pauses any playing media. You complete a breathing exercise (and sometimes a body scan or journaling prompt) to unlock the feed again.

### The 5 levels

| Level | Triggered at | Exercise | Extra |
|-------|-------------|----------|-------|
| 1 · Quick Reset | 8 min | Box breath × 2 rounds | — |
| 2 · Nervous System Reset | 17 min | 4-7-8 × 2 rounds | Reflection prompt |
| 3 · Body Scan | 30 min | 4-7-8 × 2 rounds | Body scan |
| 4 · Deep Reset | 45 min | 4-7-8 × 3 rounds | Reflection prompt |
| 5 · Full Presence | 60 min | 4-7-8 × 5 rounds | Body scan + reflection |

Levels 1–4 trigger once each per day. Level 5 repeats every 20 minutes after the first hour.

### Breathing patterns

- **Box breath** — Inhale 4 · Hold 4 · Exhale 4 · Hold 4
- **4-7-8** — Inhale 4 · Hold 7 · Exhale 8

---

## Supported sites

Twitter/X · Instagram · LinkedIn · TikTok · Facebook · Reddit · YouTube

---

## Popup dashboard

Click the extension icon to see today's stats:

- **Interrupts** — how many times an overlay was triggered
- **Completed** — how many exercises you finished vs. skipped
- **Tracked** — total scroll time across all sites
- **Level breakdown** — completion rate per level with a visual bar
- **Reflections** — your journaling responses from Level 2, 4, and 5 prompts
- **Insight** — your personal tipping point (the level after which you usually don't go back)

---

## Installation (unpacked)

1. Clone or download this repo
2. Open `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the repo folder
5. Visit any supported social media site

---

## File structure

```
manifest.json     Extension config (MV3)
content.js        Core logic — scroll timing, overlay, breathing engine
background.js     Service worker — tab/session management
overlay.css       Overlay styles
popup.html        Extension popup
popup.js          Popup stats rendering
popup.css         Popup styles
icons/            Extension icons (16, 48, 128px)
```

---

## Privacy

No data leaves your browser. All session state and journal reflections are stored locally via `chrome.storage.local` and reset daily.

See [privacy.html](privacy.html) for the full privacy policy.
