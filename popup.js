'use strict';

const LOG_KEY = 'bb_log';
const LEVEL_NAMES = ['Quick Reset', 'Nervous System Reset', 'Body Scan', 'Deep Reset', 'Full Presence'];
const LEVEL_THRESHOLDS = [5, 15, 25, 40, 60];

const SITES = ['twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'facebook.com', 'reddit.com', 'youtube.com'];

document.getElementById('today-label').textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

chrome.storage.local.get([LOG_KEY, ...SITES.map(s => `bb_session_${s}`)], data => {
  const log = (data[LOG_KEY] || []).filter(e => e.date === new Date().toDateString());
  const allSessions = SITES.map(s => data[`bb_session_${s}`]).filter(Boolean)
    .filter(s => s.date === new Date().toDateString());

  render(log, allSessions);
});

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

  // Top-level stats
  const totalInterrupts = log.length;
  const completed = log.filter(e => e.completed).length;
  const completionRate = totalInterrupts > 0 ? Math.round((completed / totalInterrupts) * 100) : 0;

  // Estimate scroll time displaced: sum of level durations for completed exercises
  const LEVEL_DURATIONS = [0.5, 1, 2, 3, 4]; // minutes per level
  const minutesDisplaced = log
    .filter(e => e.completed)
    .reduce((sum, e) => sum + (LEVEL_DURATIONS[(e.level || 1) - 1] || 0.5), 0);

  // Total tracked scroll time today
  const totalScrollMin = sessions.reduce((sum, s) => sum + Math.round((s.accumulatedMs || 0) / 60000), 0);

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

    ${sessions.length > 0 ? `
    <div class="divider"></div>
    <div class="section">
      <div class="section-title">Today's sessions</div>
      <div class="session-list" id="session-list"></div>
    </div>` : ''}
  `;

  // Level breakdown
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

  // Insight
  const insightSection = document.getElementById('insight-section');
  const insight = getInsight(log, minutesDisplaced);
  if (insight) {
    insightSection.innerHTML = `
      <div class="section-title">Insight</div>
      <div class="insight">${insight}</div>`;
  }

  // Sessions
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

  // Find personal tipping point (highest level where user mostly doesn't resume)
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
