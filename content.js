'use strict';

if (window !== window.top) throw new Error('bb:skip-iframe');

// ─── Constants ────────────────────────────────────────────────────────────────

const SITE = (() => {
  const h = location.hostname.replace(/^www\./, '');
  const map = {
    'twitter.com': 'Twitter/X', 'x.com': 'Twitter/X',
    'instagram.com': 'Instagram', 'linkedin.com': 'LinkedIn',
    'tiktok.com': 'TikTok', 'facebook.com': 'Facebook', 'reddit.com': 'Reddit',
    'youtube.com': 'YouTube'
  };
  return map[h] || h;
})();

const IS_YOUTUBE = location.hostname.replace(/^www\./, '') === 'youtube.com';
const STORAGE_KEY = `bb_session_${location.hostname.replace(/^www\./, '')}`;
const LOG_KEY = 'bb_log';

const LEVELS = [
  {
    level: 1, threshold: 8 * 60 * 1000,
    name: 'Quick Reset',
    description: 'Box breath — 30 seconds',
    pattern: 'box', rounds: 2
  },
  {
    level: 2, threshold: 18 * 60 * 1000,
    name: 'Settle',
    description: '4-7-8 breath + reflection',
    pattern: '478', rounds: 2,
    prompt: 'What do I actually want right now?'
  },
  {
    level: 3, threshold: 30 * 60 * 1000,
    name: 'Body Scan',
    description: '4-7-8 breath + body awareness',
    pattern: '478', rounds: 2,
    bodyScan: true
  },
  {
    level: 4, threshold: 45 * 60 * 1000,
    name: 'Deep Reset',
    description: '4-7-8 × 3 rounds + reflection',
    pattern: '478', rounds: 3,
    prompt: 'What would feel genuinely good right now?'
  },
  {
    level: 5, threshold: 60 * 60 * 1000,
    name: 'Full Presence',
    description: '4-7-8 × 5 rounds + body scan + reflection',
    pattern: '478', rounds: 5,
    bodyScan: true,
    prompt: 'What matters most to me right now?'
  }
];

// box: inhale 4, hold 4, exhale 4, hold 4
// 478: inhale 4, hold 7, exhale 8
const PATTERNS = {
  box: [
    { phase: 'inhale', label: 'Inhale',  seconds: 4 },
    { phase: 'hold',   label: 'Hold',    seconds: 4 },
    { phase: 'exhale', label: 'Exhale',  seconds: 4 },
    { phase: 'hold',   label: 'Hold',    seconds: 4 }
  ],
  '478': [
    { phase: 'inhale', label: 'Inhale',  seconds: 4 },
    { phase: 'hold',   label: 'Hold',    seconds: 7 },
    { phase: 'exhale', label: 'Exhale',  seconds: 8 }
  ]
};

const BODY_SCAN_STEPS = [
  'Notice the weight of your feet on the floor.',
  'Feel your legs — heavy, grounded.',
  'Your lower back and hips — let them soften.',
  'Your belly — let it rise and fall naturally.',
  'Your chest — notice it open with each breath.',
  'Your hands and arms — release any tension.',
  'Your shoulders — let them drop.',
  'Your jaw, your eyes, your forehead — completely soft.',
  'You are here. Fully here.'
];

// ─── Storage helpers (guarded against invalidated extension context) ───────────

function isContextValid() {
  try { return !!chrome.runtime?.id; } catch (e) { return false; }
}

function storageSet(data) {
  if (!isContextValid()) return;
  try { chrome.storage.local.set(data); } catch (e) {}
}

function storageGet(keys, callback) {
  if (!isContextValid()) { callback({}); return; }
  try {
    chrome.storage.local.get(keys, data => {
      if (chrome.runtime.lastError) { callback({}); return; }
      callback(data);
    });
  } catch (e) {
    callback({});
  }
}

// ─── Session State ────────────────────────────────────────────────────────────

let session = null;
let activeStart = null;
let overlayActive = false;
let checkTimer = null;
let pausedMediaElements = [];
let mediaGuardInterval = null;
let trackingEnabled = true;  // B7: YouTube scope
let consecStreak = 0;        // B5: consecutive completion streak

function getAllMediaElements(root = document) {
  const results = [];
  root.querySelectorAll('video, audio').forEach(el => results.push(el));
  root.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot) getAllMediaElements(el.shadowRoot).forEach(e => results.push(e));
  });
  return results;
}

function suppressAllMedia() {
  getAllMediaElements().forEach(el => {
    if (!el.paused) el.pause();
    if (!el.muted) el.muted = true;
  });
}

function onMediaPlayAttempt(e) {
  if (!overlayActive) return;
  const el = e.target;
  if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
    el.pause();
    el.muted = true;
  }
}

function pausePageMedia() {
  pausedMediaElements = [];
  getAllMediaElements().forEach(el => {
    pausedMediaElements.push({ el, wasPaused: el.paused, wasMuted: el.muted });
    el.pause();
    el.muted = true;
  });
  // Capture-phase listener catches play attempts the instant they fire
  document.addEventListener('play', onMediaPlayAttempt, true);
  // 100ms guard catches lazy-loaded elements and platform auto-resume
  mediaGuardInterval = setInterval(suppressAllMedia, 100);
}

function resumePageMedia() {
  document.removeEventListener('play', onMediaPlayAttempt, true);
  clearInterval(mediaGuardInterval);
  mediaGuardInterval = null;
  pausedMediaElements.forEach(({ el, wasPaused, wasMuted }) => {
    el.muted = wasMuted;
    if (!wasPaused) el.play().catch(() => {});
  });
  pausedMediaElements = [];
}

function getAccumulatedTime() {
  if (!session) return 0;
  const sinceLastActive = (document.hidden || !activeStart) ? 0 : (Date.now() - activeStart);
  return (session.accumulatedMs || 0) + sinceLastActive;
}

function saveSession() {
  if (!session) return;
  storageSet({ [STORAGE_KEY]: session });
}

async function loadSession() {
  return new Promise(resolve => {
    storageGet([STORAGE_KEY, 'bb_consec_streak'], data => {
      consecStreak = data.bb_consec_streak || 0;
      const stored = data[STORAGE_KEY];
      const today = new Date().toDateString();
      if (stored && stored.date === today) {
        session = stored;
      } else {
        session = {
          date: today,
          site: SITE,
          accumulatedMs: 0,
          triggeredLevels: [],
          skipTimes: {},
          interrupts: []
        };
      }
      // Ensure skipTimes exists on sessions loaded from an older format
      if (!session.skipTimes) session.skipTimes = {};
      resolve(session);
    });
  });
}

// ─── B7: YouTube scope ────────────────────────────────────────────────────────

function shouldTrackOnCurrentPage() {
  if (!IS_YOUTUBE) return true;
  const path = location.pathname;
  // Track on homepage and Shorts; skip /watch and everything else
  return path === '/' || path.startsWith('/shorts/');
}

// ─── Timing ───────────────────────────────────────────────────────────────────

function enableTracking() {
  if (trackingEnabled) return;
  trackingEnabled = true;
  if (!document.hidden && !activeStart) activeStart = Date.now();
  if (!checkTimer) {
    checkTimer = setInterval(checkLevels, 10000);
    checkLevels();
  }
}

function disableTracking() {
  if (!trackingEnabled) return;
  trackingEnabled = false;
  if (activeStart) {
    session.accumulatedMs = (session.accumulatedMs || 0) + (Date.now() - activeStart);
    activeStart = null;
    saveSession();
  }
  clearInterval(checkTimer);
  checkTimer = null;
}

function startTracking() {
  // B7: Only start accumulating if we should track this page
  trackingEnabled = shouldTrackOnCurrentPage();
  if (trackingEnabled && !document.hidden) activeStart = Date.now();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (activeStart) {
        session.accumulatedMs = (session.accumulatedMs || 0) + (Date.now() - activeStart);
        activeStart = null;
        saveSession();
      }
    } else {
      if (trackingEnabled) activeStart = Date.now();
      if (overlayActive) suppressAllMedia();
    }
  });

  if (trackingEnabled) {
    checkTimer = setInterval(checkLevels, 10000);
    checkLevels();
  }
}

function checkLevels() {
  if (!isContextValid()) { clearInterval(checkTimer); checkTimer = null; return; }
  if (!trackingEnabled) return;
  if (overlayActive) return;
  const elapsed = getAccumulatedTime();

  // B4: Levels 1–4 — trigger once on completion; re-trigger after skip interval
  for (const lvl of LEVELS.slice(0, 4)) {
    if (session.triggeredLevels.includes(lvl.level)) continue; // already completed

    const skipData = session.skipTimes[lvl.level];
    if (skipData) {
      // Re-trigger after the user accumulates another full threshold of scroll time since skip
      if (elapsed >= skipData.accumulated + lvl.threshold) {
        delete session.skipTimes[lvl.level];
        triggerLevel(lvl);
        return;
      }
      continue; // not yet time to re-trigger
    }

    if (elapsed >= lvl.threshold) {
      triggerLevel(lvl);
      return;
    }
  }

  // Level 5: first at threshold, then every 20 min; re-triggers after skip
  const lvl5 = LEVELS[4];
  const lvl5Skip = session.skipTimes[5];
  if (lvl5Skip) {
    const repeatInterval = 20 * 60 * 1000;
    if (elapsed >= lvl5Skip.accumulated + repeatInterval) {
      delete session.skipTimes[5];
      triggerLevel(lvl5);
    }
  } else {
    const count = session.level5Count || 0;
    const nextThreshold = lvl5.threshold + count * 20 * 60 * 1000;
    if (elapsed >= nextThreshold) {
      session.level5Count = count + 1;
      triggerLevel(lvl5);
    }
  }
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

function triggerLevel(lvlConfig) {
  overlayActive = true; // prevents double-trigger during vignette + overlay phases
  const elapsed = getAccumulatedTime();
  const minutes = Math.round(elapsed / 60000);

  const interruptRecord = {
    level: lvlConfig.level,
    triggeredAt: Date.now(),
    sessionMinutes: minutes,
    completed: false,
    resumed: false
  };
  // B4: Do NOT push to triggeredLevels here — only on completion in dismissOverlay
  session.interrupts.push(interruptRecord);
  saveSession();

  // B2: Soft vignette phase — 3-second warning before the full overlay
  const vignette = buildVignette();
  document.documentElement.appendChild(vignette);

  setTimeout(() => {
    vignette.remove();
    pausePageMedia();
    const overlay = buildOverlay(lvlConfig, minutes, interruptRecord);
    document.documentElement.appendChild(overlay);
  }, 3000);
}

// B2: Subtle edge-darkening vignette with pulsing icon
function buildVignette() {
  const el = document.createElement('div');
  el.id = 'breathbreak-vignette';
  el.innerHTML = `
    <div class="bb-vignette-icon">
      <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" width="40" height="40">
        <circle cx="20" cy="20" r="16" fill="none"
          stroke="rgba(167,139,250,0.65)" stroke-width="2" class="bb-vig-ring"/>
        <circle cx="20" cy="20" r="7" fill="rgba(167,139,250,0.55)" class="bb-vig-dot"/>
      </svg>
    </div>
  `;
  return el;
}

function buildOverlay(lvlConfig, minutes, record) {
  // B5: Consecutive streak badge — shown in top-right when ≥ 2
  const streakBadge = consecStreak >= 2
    ? `<div class="bb-consec-badge">🌬 ${consecStreak} in a row</div>`
    : '';

  const el = document.createElement('div');
  el.id = 'breathbreak-overlay';
  el.innerHTML = `
    <div class="bb-card">
      ${streakBadge}
      <div class="bb-header">
        <span class="bb-logo">BreathBreak</span>
        <span class="bb-level-badge">Level ${lvlConfig.level}</span>
      </div>
      <div class="bb-title">${lvlConfig.name}</div>
      <div class="bb-subtitle">
        You've been scrolling ${SITE} for ${minutes} minute${minutes !== 1 ? 's' : ''}.<br>
        ${lvlConfig.description}
      </div>

      <div class="bb-breathing-area">
        <svg class="bb-circle-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle class="bb-ring-outer" cx="100" cy="100" r="88"/>
          <circle class="bb-circle-glow" id="bb-glow" cx="100" cy="100" r="60" fill="#60a5fa"/>
          <circle class="bb-circle-fill" id="bb-fill" cx="100" cy="100" r="60" fill="#60a5fa"/>
          <circle class="bb-ring" id="bb-ring" cx="100" cy="100" r="70"
            stroke-dasharray="439.8" stroke-dashoffset="439.8"
            stroke="#60a5fa"
            style="transform-origin:100px 100px; transform:rotate(-90deg)"/>
          <text class="bb-phase-text" id="bb-phase-text" x="100" y="93">Inhale</text>
          <text class="bb-count-text" id="bb-count-text" x="100" y="116">4</text>
        </svg>
      </div>

      <div class="bb-instruction" id="bb-instruction">Get comfortable. We'll begin in a moment.</div>

      <div class="bb-rounds" id="bb-rounds"></div>

      <div class="bb-progress-track">
        <div class="bb-progress-fill" id="bb-progress"></div>
      </div>

      <div id="bb-body-scan-area" style="display:none">
        <div class="bb-body-scan" id="bb-body-scan-text"></div>
      </div>

      <div id="bb-prompt-area" style="display:none" class="bb-prompt-section">
        <div class="bb-prompt-label">"${lvlConfig.prompt || ''}"</div>
        <textarea class="bb-prompt-input" id="bb-prompt-input"
          placeholder="Type anything to continue..." rows="3"></textarea>
        <div class="bb-prompt-hint">Focus the field to start the timer</div>
      </div>

      <button class="bb-continue-btn" id="bb-continue-btn" disabled>
        Complete exercise to continue
      </button>

      <button class="bb-exit">skip (I know what I'm doing)</button>
    </div>
  `;

  const roundsEl = el.querySelector('#bb-rounds');
  for (let i = 0; i < lvlConfig.rounds; i++) {
    const dot = document.createElement('div');
    dot.className = 'bb-round-dot';
    dot.dataset.round = i;
    roundsEl.appendChild(dot);
  }

  el.querySelector('.bb-exit').addEventListener('click', () => {
    dismissOverlay(el, record, false);
  });

  const continueBtn = el.querySelector('#bb-continue-btn');
  continueBtn.addEventListener('click', () => {
    if (!continueBtn.disabled) dismissOverlay(el, record, true);
  });

  setTimeout(() => runBreathing(el, lvlConfig, record), 1200);

  return el;
}

// ─── Breathing Engine ─────────────────────────────────────────────────────────

function runBreathing(el, lvlConfig, record) {
  const pattern = PATTERNS[lvlConfig.pattern];
  const totalRounds = lvlConfig.rounds;

  let currentRound = 0;
  let currentPhaseIdx = 0;
  let phaseStart = null;
  let animFrame = null;

  const phaseText = el.querySelector('#bb-phase-text');
  const countText = el.querySelector('#bb-count-text');
  const instruction = el.querySelector('#bb-instruction');
  const progress = el.querySelector('#bb-progress');
  const fill = el.querySelector('#bb-fill');
  const glow = el.querySelector('#bb-glow');
  const ring = el.querySelector('#bb-ring');
  const dots = el.querySelectorAll('.bb-round-dot');

  const COLORS = { inhale: '#60a5fa', hold: '#a78bfa', exhale: '#34d399' };
  const MIN_R = 42, MAX_R = 72;
  const RING_CIRCUMFERENCE = 2 * Math.PI * 70;

  let totalDone = 0;
  const totalMs = pattern.reduce((sum, p) => sum + p.seconds * 1000, 0) * totalRounds;

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  function startPhase(phaseIdx) {
    const phase = pattern[phaseIdx];
    const color = COLORS[phase.phase];

    phaseText.textContent = phase.label;
    phaseText.style.fill = color;
    ring.style.stroke = color;
    ring.style.strokeDashoffset = RING_CIRCUMFERENCE;
    phaseStart = Date.now();

    dots.forEach((d, i) => {
      if (i < currentRound) { d.classList.add('done'); d.classList.remove('active'); }
      else if (i === currentRound) { d.classList.add('active'); d.classList.remove('done'); }
      else d.classList.remove('active', 'done');
    });

    animFrame = requestAnimationFrame(tick);
  }

  function tick() {
    const phase = pattern[currentPhaseIdx];
    const elapsed = Date.now() - phaseStart;
    const t = Math.min(elapsed / (phase.seconds * 1000), 1);

    const remaining = Math.ceil((phase.seconds * 1000 - elapsed) / 1000);
    countText.textContent = Math.max(remaining, 1);

    let r;
    if (phase.phase === 'inhale') {
      r = MIN_R + (MAX_R - MIN_R) * easeInOut(t);
    } else if (phase.phase === 'exhale') {
      r = MAX_R - (MAX_R - MIN_R) * easeInOut(t);
    } else {
      r = (currentPhaseIdx === 0 || pattern[currentPhaseIdx - 1]?.phase === 'inhale') ? MAX_R : MIN_R;
    }

    fill.setAttribute('r', r);
    glow.setAttribute('r', r + 6);
    ring.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - t);

    const overallDone = totalDone + elapsed;
    progress.style.width = `${Math.min((overallDone / totalMs) * 100, 100)}%`;

    if (t < 1) {
      animFrame = requestAnimationFrame(tick);
    } else {
      totalDone += phase.seconds * 1000;
      advancePhase();
    }
  }

  function advancePhase() {
    currentPhaseIdx++;
    if (currentPhaseIdx >= pattern.length) {
      currentPhaseIdx = 0;
      currentRound++;
      dots[currentRound - 1]?.classList.add('done');
      dots[currentRound - 1]?.classList.remove('active');
    }
    if (currentRound >= totalRounds) { onBreathingComplete(); return; }
    startPhase(currentPhaseIdx);
  }

  function onBreathingComplete() {
    countText.textContent = '✓';
    phaseText.textContent = 'Done';
    fill.setAttribute('r', MAX_R);
    glow.setAttribute('r', MAX_R + 8);
    progress.style.width = '100%';
    instruction.textContent = 'Breathing complete.';

    if (lvlConfig.bodyScan) { runBodyScan(el, lvlConfig, record); return; }
    if (lvlConfig.prompt)   { showPrompt(el, record); return; }
    enableContinue(el, record);
  }

  instruction.textContent = 'Follow the circle…';
  startPhase(0);
}

// ─── Body Scan ────────────────────────────────────────────────────────────────

function runBodyScan(el, lvlConfig, record) {
  const area = el.querySelector('#bb-body-scan-area');
  const text = el.querySelector('#bb-body-scan-text');
  const instruction = el.querySelector('#bb-instruction');
  area.style.display = 'block';
  instruction.textContent = 'Now, a brief body scan…';

  let idx = 0;
  function showNext() {
    if (idx >= BODY_SCAN_STEPS.length) {
      if (lvlConfig.prompt) { showPrompt(el, record); } else { enableContinue(el, record); }
      return;
    }
    text.style.opacity = '0';
    setTimeout(() => {
      text.textContent = BODY_SCAN_STEPS[idx];
      text.style.transition = 'opacity 0.48s ease';
      text.style.opacity = '1';
      idx++;
      setTimeout(showNext, 5120);
    }, 320);
  }
  showNext();
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function showPrompt(el, record) {
  const area = el.querySelector('#bb-prompt-area');
  const input = el.querySelector('#bb-prompt-input');
  const btn = el.querySelector('#bb-continue-btn');
  const instruction = el.querySelector('#bb-instruction');

  area.style.display = 'flex';
  instruction.textContent = 'One last thing before you go back…';

  // B6: 2-second timer on first focus replaces the 3-word minimum gate
  let timerStarted = false;
  let timerDone = false;

  input.addEventListener('focus', () => {
    if (timerStarted) return;
    timerStarted = true;
    btn.classList.add('unlocking');
    btn.textContent = 'Unlocking…';

    setTimeout(() => {
      btn.classList.remove('unlocking');
      timerDone = true;
      if (input.value.trim()) {
        btn.disabled = false;
        btn.textContent = 'Return to feed';
      } else {
        btn.textContent = 'Say something first…';
      }
    }, 2000);
  });

  // After timer fires, keep btn state in sync with input content
  input.addEventListener('input', () => {
    if (!timerDone) return;
    if (input.value.trim()) {
      btn.disabled = false;
      btn.textContent = 'Return to feed';
    } else {
      btn.disabled = true;
      btn.textContent = 'Say something first…';
    }
  });
}

// ─── Unlock ───────────────────────────────────────────────────────────────────

function enableContinue(el, record) {
  const btn = el.querySelector('#bb-continue-btn');
  btn.disabled = false;
  btn.textContent = 'Return to feed';
}

// ─── Dismiss ──────────────────────────────────────────────────────────────────

function dismissOverlay(el, record, completed) {
  el.style.transition = 'opacity 0.3s ease';
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 320);

  // Capture journal reflection if the prompt was shown and filled in
  const promptInput = el.querySelector('#bb-prompt-input');
  if (promptInput && promptInput.value.trim()) {
    record.promptText = promptInput.value.trim();
  }

  record.completed = completed;

  if (completed) {
    record.completedAt = Date.now();
    record.resumed = true;
    // B4: Add to triggeredLevels only on completion, not on skip
    if (record.level <= 4 && !session.triggeredLevels.includes(record.level)) {
      session.triggeredLevels.push(record.level);
    }
    // B5: Increment consecutive streak
    consecStreak++;
    storageSet({ bb_consec_streak: consecStreak });
  } else {
    // B4: Record the accumulated time at skip for re-trigger calculation
    session.skipTimes = session.skipTimes || {};
    session.skipTimes[record.level] = { accumulated: getAccumulatedTime() };
    // B5: Reset consecutive streak on any skip
    consecStreak = 0;
    storageSet({ bb_consec_streak: 0 });
  }

  saveSession();
  appendLog(record);

  resumePageMedia();
  overlayActive = false;
  if (!document.hidden && trackingEnabled) activeStart = Date.now();
}

// ─── Logging ─────────────────────────────────────────────────────────────────

function appendLog(record) {
  storageGet([LOG_KEY], data => {
    const log = data[LOG_KEY] || [];
    log.push({ site: SITE, date: new Date().toDateString(), ...record });
    if (log.length > 500) log.splice(0, log.length - 500);
    storageSet({ [LOG_KEY]: log });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

loadSession().then(startTracking);

// B7: YouTube SPA navigation — re-evaluate tracking on every page transition
window.addEventListener('yt-navigate-finish', () => {
  if (!session) return;
  if (shouldTrackOnCurrentPage()) {
    enableTracking();
  } else {
    disableTracking();
  }
});
