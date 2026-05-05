'use strict';

const LOG_KEY = 'bb_log';
const LEVEL_NAMES = ['Quick Reset', 'Nervous System Reset', 'Body Scan', 'Deep Reset', 'Full Presence'];
const LEVEL_THRESHOLDS = [8, 17, 30, 45, 60];
const LEVEL_PROMPTS = [
  null,
  'What do I actually want right now?',
  null,
  'What would feel genuinely good right now?',
  'What matters most to me right now?'
];
const SITES = ['twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'facebook.com', 'reddit.com', 'youtube.com'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BAR_MAX_H = 73; // px — matches bars-row height minus count label area

let currentTab = 'today';
let weekOffset = 0;
let fullLog = [];
let fullSessions = [];

document.getElementById('today-label').textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    weekOffset = 0;
    renderCurrentTab();
  });
});

chrome.storage.local.get([LOG_KEY, ...SITES.map(s => `bb_session_${s}`)], data => {
  fullLog = data[LOG_KEY] || [];
  fullSessions = SITES.map(s => data[`bb_session_${s}`]).filter(Boolean);
  renderStreak(fullLog);
  renderCurrentTab();
});

function renderCurrentTab() {
  if (currentTab === 'today') {
    const todayStr = new Date().toDateString();
    const todayLog = fullLog.filter(e => e.date === todayStr);
    const todaySessions = fullSessions.filter(s => s.date === todayStr);
    render(todayLog, todaySessions);
  } else {
    renderWeekly(fullLog, weekOffset);
  }
}

function computeStreak(log) {
  const completedDates = new Set(log.filter(e => e.completed).map(e => e.date));
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (completedDates.has(d.toDateString())) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function renderStreak(log) {
  const streak = computeStreak(log);
  const el = document.getElementById('streak-badge');
  if (streak >= 2) {
    el.textContent = `🔥 ${streak}`;
  } else {
    el.style.display = 'none';
  }
}

function getWeekDays(offset) {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dow + 6) % 7) + offset * 7);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function renderWeekly(log, offset) {
  const days = getWeekDays(offset);
  const todayStr = new Date().toDateString();
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);

  const byDate = {};
  log.forEach(e => {
    (byDate[e.date] = byDate[e.date] || []).push(e);
  });

  const dayStats = days.map(d => {
    const dateStr = d.toDateString();
    const isFuture = d > todayMidnight;
    const entries = isFuture ? [] : (byDate[dateStr] || []);
    return {
      date: d,
      dateStr,
      isToday: dateStr === todayStr,
      isFuture,
      triggered: entries.length,
      completed: entries.filter(e => e.completed).length,
    };
  });

  const maxTriggered = Math.max(1, ...dayStats.map(s => s.triggered));
  const weekTriggered = dayStats.reduce((s, d) => s + d.triggered, 0);
  const weekCompleted = dayStats.reduce((s, d) => s + d.completed, 0);
  const bestDay = dayStats.reduce((best, d) => d.completed > best.completed ? d : best, dayStats[0]);

  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekLabel = `${fmt(days[0])} – ${fmt(days[6])}`;

  const barsHTML = dayStats.map((s, i) => {
    const pct = s.triggered / maxTriggered;
    const barH = s.triggered > 0 ? Math.max(4, Math.round(pct * BAR_MAX_H)) : 0;
    const completedH = barH > 0 ? Math.min(barH, Math.round(barH * s.completed / s.triggered)) : 0;
    const skippedH = barH - completedH;

    const segs = [
      skippedH > 0 ? `<div class="bar-seg purple" style="height:${skippedH}px"></div>` : '',
      completedH > 0 ? `<div class="bar-seg green" style="height:${completedH}px"></div>` : '',
    ].join('');

    return `
      <div class="bar-col${s.isToday ? ' is-today' : ''}">
        <div class="bar-count">${s.completed > 0 ? s.completed : ''}</div>
        <div class="bar-inner">
          ${barH === 0
            ? `<div class="bar-empty"></div>`
            : `<div class="bar-stack" style="height:${barH}px;animation-delay:${i * 0.04}s">${segs}</div>`
          }
        </div>
      </div>`;
  }).join('');

  const labelsHTML = dayStats.map((s, i) =>
    `<div class="day-lbl${s.isToday ? ' today' : ''}">${DAY_LABELS[i]}</div>`
  ).join('');

  const statsHTML = weekTriggered > 0 ? `
    <div class="divider"></div>
    <div class="stats-grid">
      <div class="stat-cell">
        <div class="stat-value purple">${weekTriggered}</div>
        <div class="stat-label">Interrupts</div>
      </div>
      <div class="stat-cell">
        <div class="stat-value green">${weekCompleted}</div>
        <div class="stat-label">Completed</div>
      </div>
      <div class="stat-cell">
        <div class="stat-value">${bestDay.completed > 0
          ? bestDay.date.toLocaleDateString('en-US', { weekday: 'short' })
          : '—'}</div>
        <div class="stat-label">Best day</div>
      </div>
    </div>` : `<div class="week-empty-msg">No activity this week</div>`;

  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="week-nav">
      <button class="week-nav-btn" id="week-prev">‹</button>
      <span class="week-range-label">${weekLabel}</span>
      <button class="week-nav-btn" id="week-next"${offset >= 0 ? ' disabled' : ''}>›</button>
    </div>
    <div class="chart-area">
      <div class="bars-row">${barsHTML}</div>
      <div class="day-labels-row">${labelsHTML}</div>
    </div>
    ${statsHTML}
  `;

  document.getElementById('week-prev').addEventListener('click', () => {
    weekOffset--;
    renderWeekly(fullLog, weekOffset);
  });

  document.getElementById('week-next').addEventListener('click', () => {
    if (weekOffset < 0) { weekOffset++; renderWeekly(fullLog, weekOffset); }
  });
}

function render(log, sessions) {
  const main = document.getElementById('main-content');

  if (log.length === 0 && sessions.length === 0) {
    main.innerHTML = `
      <div class="empty">
        <span class="empty-icon">🌬️</span>
        No sessions yet today.<br>
        Open a social media tab and start scrolling.
      </div>`;
    return;
  }

  const totalInterrupts = log.length;
  const completed = log.filter(e => e.completed).length;

  const LEVEL_DURATIONS = [0.5, 1, 2, 3, 4];
  const minutesDisplaced = log
    .filter(e => e.completed)
    .reduce((sum, e) => sum + (LEVEL_DURATIONS[(e.level || 1) - 1] || 0.5), 0);

  const totalScrollMin = sessions.reduce((sum, s) => sum + Math.round((s.accumulatedMs || 0) / 60000), 0);

  const reflections = log.filter(e => e.promptText && e.promptText.trim());

  main.innerHTML = `
    <div class="stats-grid">
      <div class="stat-cell">
        <div class="stat-value purple">${totalInterrupts}</div>
        <div class="stat-label">Interrupts</div>
      </div>
      <div class="stat-cell">
        <div class="stat-value green">${completed}</div>
        <div class="stat-label">Completed</div>
      </div>
      <div class="stat-cell">
        <div class="stat-value">${totalScrollMin}m</div>
        <div class="stat-label">Tracked</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Level breakdown</div>
      <div class="level-list" id="level-list"></div>
    </div>

    <div class="divider"></div>

    <div class="section" id="insight-section"></div>

    ${reflections.length > 0 ? `
    <div class="divider"></div>
    <div class="section">
      <div class="section-title">Reflections</div>
      <div class="reflection-list" id="reflection-list"></div>
    </div>` : ''}

    ${sessions.length > 0 ? `
    <div class="divider"></div>
    <div class="section">
      <div class="section-title">Today's sessions</div>
      <div class="session-list" id="session-list"></div>
    </div>` : ''}
  `;

  const levelList = document.getElementById('level-list');
  const maxCount = Math.max(1, ...LEVEL_NAMES.map((_, i) => log.filter(e => e.level === i + 1).length));

  LEVEL_NAMES.forEach((name, i) => {
    const level = i + 1;
    const triggered = log.filter(e => e.level === level).length;
    const comp = log.filter(e => e.level === level && e.completed).length;
    const hasTriggers = triggered > 0;

    const row = document.createElement('div');
    row.className = 'level-row';
    row.innerHTML = `
      <div class="level-dot ${comp > 0 ? 'completed' : hasTriggers ? 'triggered' : ''}"></div>
      <div class="level-name">L${level} · ${name}</div>
      <div class="level-bar-track">
        <div class="level-bar-fill ${comp > 0 ? 'completed' : ''}"
          style="width:${hasTriggers ? Math.round((triggered / maxCount) * 100) : 0}%"></div>
      </div>
      <div class="level-count">${triggered > 0 ? `${comp}/${triggered}` : '—'}</div>
    `;
    levelList.appendChild(row);
  });

  const insightSection = document.getElementById('insight-section');
  const insight = getInsight(log, minutesDisplaced);
  if (insight) {
    insightSection.innerHTML = `
      <div class="section-title">Insight</div>
      <div class="insight">${insight}</div>`;
  }

  const reflectionList = document.getElementById('reflection-list');
  if (reflectionList) {
    [...reflections].reverse().forEach(e => {
      const levelIdx = (e.level || 1) - 1;
      const promptQ = LEVEL_PROMPTS[levelIdx];
      const time = e.triggeredAt
        ? new Date(e.triggeredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : '';
      const card = document.createElement('div');
      card.className = 'reflection-card';
      card.innerHTML = `
        ${promptQ ? `<div class="reflection-prompt">"${promptQ}"</div>` : ''}
        <div class="reflection-text">${e.promptText}</div>
        <div class="reflection-meta">${e.site || ''} · L${e.level} · ${time}</div>
      `;
      reflectionList.appendChild(card);
    });
  }

  const sessionList = document.getElementById('session-list');
  if (sessionList) {
    sessions.slice(-5).reverse().forEach(s => {
      const min = Math.round((s.accumulatedMs || 0) / 60000);
      const row = document.createElement('div');
      row.className = 'session-row';
      row.innerHTML = `
        <div class="session-site">${s.site || 'Social media'}</div>
        <div class="session-meta">
          <span class="session-time">${min}m tracked</span>
          <span class="session-levels">${s.triggeredLevels?.length || 0} interrupt${s.triggeredLevels?.length !== 1 ? 's' : ''}</span>
        </div>`;
      sessionList.appendChild(row);
    });
  }
}

function getInsight(log, minutesDisplaced) {
  if (log.length === 0) return null;

  for (let level = 5; level >= 1; level--) {
    const atLevel = log.filter(e => e.level === level && e.completed);
    const notResumed = atLevel.filter(e => !e.resumed).length;
    if (atLevel.length >= 2 && notResumed / atLevel.length >= 0.6) {
      return `Your tipping point is <strong>Level ${level}</strong> — you usually don't go back after completing it. ${minutesDisplaced > 0 ? `~${minutesDisplaced.toFixed(0)} min of scroll time displaced today.` : ''}`;
    }
  }

  const completionRate = log.length > 0 ? Math.round((log.filter(e => e.completed).length / log.length) * 100) : 0;
  if (minutesDisplaced >= 5) {
    return `You've displaced roughly <strong>${minutesDisplaced.toFixed(0)} minutes</strong> of scrolling with actual presence today.`;
  }
  if (completionRate >= 80) {
    return `<strong>${completionRate}% completion rate</strong> today. You're doing the work.`;
  }
  return null;
}
