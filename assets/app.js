(() => {
  'use strict';

  const STORAGE_KEY = 'daymark_state_v4';
  const API = 'api.php';
  const CATEGORIES = {
    expense: ['餐饮', '购物', '交通', '住房', '娱乐', '医疗', '教育', '通讯', '日用', '人情', '旅行', '其他'],
    income: ['工资', '奖金', '投资', '副业', '退款', '礼金', '其他']
  };
  const COLORS = ['#168a73', '#3b6fd8', '#b7791f', '#c85d4c', '#7b61a8', '#2a8fa3', '#8b6c45', '#6c7a7d'];
  const DEFAULT_STATE = {
    version: 4,
    updatedAt: '',
    finance: [],
    daily: {},
    habits: [
      { id: 'habit-water', name: '主动喝水', target: 1, unit: '次', color: '#168a73', createdAt: '2026-01-01' },
      { id: 'habit-exercise', name: '运动 30 分钟', target: 1, unit: '次', color: '#c85d4c', createdAt: '2026-01-01' },
      { id: 'habit-reading', name: '阅读', target: 1, unit: '次', color: '#3b6fd8', createdAt: '2026-01-01' },
      { id: 'habit-sleep', name: '按时睡觉', target: 1, unit: '次', color: '#b7791f', createdAt: '2026-01-01' }
    ],
    habitLogs: {},
    tasks: [],
    goals: [],
    budgets: {},
    customMetrics: [],
    settings: { currency: '¥', waterGoal: 2000, stepsGoal: 8000, sleepGoal: 8, theme: 'light' }
  };

  const $ = id => document.getElementById(id);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let state = normalizeState(readLocal());
  let selectedDate = localDate();
  let selectedMood = 0;
  let financeType = 'expense';
  let financeMonth = monthKey(selectedDate);
  let habitWeekOffset = 0;
  let taskFilter = 'today';
  let calendarCursor = new Date(selectedDate + 'T12:00:00');
  let calendarSelected = selectedDate;
  let syncMode = 'checking';
  let saveTimer = null;
  let activeView = 'overview';

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function normalizeState(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const next = clone(DEFAULT_STATE);
    Object.assign(next, source);
    next.settings = { ...DEFAULT_STATE.settings, ...(source.settings || {}) };
    ['finance', 'habits', 'tasks', 'goals', 'customMetrics'].forEach(k => { if (!Array.isArray(next[k])) next[k] = []; });
    ['daily', 'habitLogs', 'budgets'].forEach(k => { if (!next[k] || typeof next[k] !== 'object' || Array.isArray(next[k])) next[k] = {}; });
    next.version = 4;
    return next;
  }
  function readLocal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (_) { return null; }
  }
  function uid(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
  function localDate(date = new Date()) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function addDays(dateString, amount) {
    const d = new Date(`${dateString}T12:00:00`);
    d.setDate(d.getDate() + amount);
    return localDate(d);
  }
  function monthKey(dateString) { return String(dateString).slice(0, 7); }
  function monthDays(month) {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }
  function dateRange(endDate, count) { return Array.from({ length: count }, (_, i) => addDays(endDate, i - count + 1)); }
  function startOfWeek(dateString) {
    const d = new Date(`${dateString}T12:00:00`);
    const delta = (d.getDay() + 6) % 7;
    return addDays(dateString, -delta);
  }
  function formatDate(dateString, options = {}) {
    return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short', ...options }).format(new Date(`${dateString}T12:00:00`));
  }
  function formatShort(dateString) { return `${Number(dateString.slice(5, 7))}/${Number(dateString.slice(8, 10))}`; }
  function money(value) { return `${state.settings.currency}${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
  function empty(icon, text) { return `<div class="empty-state"><i data-lucide="${icon}"></i><span>${esc(text)}</span></div>`; }
  function moodLabel(value) { return ['', '很差', '不佳', '平稳', '不错', '很好'][num(value)] || '待记录'; }

  async function api(method, path, body) {
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) options.body = JSON.stringify(body);
    const response = await fetch(`${API}?endpoint=${encodeURIComponent(path)}`, options);
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }
  async function hydrate() {
    setSync('checking');
    let migratedLegacy = false;
    try {
      const remote = await api('GET', '/state');
      const remoteState = remote.data && Object.keys(remote.data).length ? normalizeState(remote.data) : null;
      if (remoteState && (!state.updatedAt || String(remoteState.updatedAt) >= String(state.updatedAt))) state = remoteState;
      if (!state.finance.length) {
        const legacy = await api('GET', '/records');
        if (Array.isArray(legacy.data) && legacy.data.length) {
          state.finance = legacy.data.map(r => ({ ...r, id: String(r.id), account: r.account || '其他' }));
          migratedLegacy = true;
        }
      }
      setSync('online');
      if (migratedLegacy) persist(true);
    } catch (error) {
      console.info('Daymark local mode:', error.message);
      setSync('offline');
    }
    applyTheme(state.settings.theme || 'light');
    renderAll();
  }
  function persist(pushNow = false) {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (syncMode !== 'online') return;
    clearTimeout(saveTimer);
    const sync = async () => {
      try { await api('PUT', '/state', state); setSync('online'); }
      catch (error) { console.warn(error); setSync('offline'); toast('服务器同步失败，数据已保存在本机', 'error'); }
    };
    if (pushNow) sync(); else saveTimer = setTimeout(sync, 450);
  }
  function setSync(mode) {
    syncMode = mode;
    const el = $('syncIndicator');
    if (!el) return;
    el.className = `sync-indicator ${mode}`;
    const text = mode === 'online' ? '已同步' : mode === 'offline' ? '本地模式' : '正在连接';
    el.querySelector('b').textContent = text;
    $('storageCaption').textContent = mode === 'online' ? 'SQLite + 本地备份' : '浏览器本地存储';
    $('dataStorageText').textContent = mode === 'online' ? '服务器与本地双重保存' : mode === 'offline' ? '当前使用浏览器本地存储' : '正在检测';
    $('dataStatusDot').className = `status-dot ${mode}`;
  }
  function mutate(message, callback) {
    callback(state);
    persist();
    renderAll();
    if (message) toast(message);
  }

  function applyTheme(theme) {
    const value = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = value;
    document.querySelector('meta[name="theme-color"]').content = value === 'dark' ? '#111718' : '#f5f7f8';
    state.settings.theme = value;
  }
  function refreshIcons() {
    try { if (window.lucide) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } }); } catch (_) {}
  }
  function toast(message, type = 'success', action) {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.innerHTML = `<i data-lucide="${type === 'error' ? 'circle-alert' : 'circle-check'}"></i><span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    if (action) node.querySelector('button').addEventListener('click', () => { action.run(); node.remove(); });
    $('toastStack').appendChild(node);
    refreshIcons();
    setTimeout(() => node.remove(), action ? 6500 : 3500);
  }
  function ask(title, message) {
    const dialog = $('confirmDialog');
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
  }

  function daily(date = selectedDate) { return state.daily[date] || {}; }
  function dayFinance(date = selectedDate) { return state.finance.filter(r => r.date === date); }
  function monthFinance(month = financeMonth) { return state.finance.filter(r => monthKey(r.date) === month); }
  function habitDone(date, id) { return Boolean(state.habitLogs[date] && state.habitLogs[date][id]); }
  function dayCompletion(date) {
    const log = daily(date);
    const habits = state.habits.length ? state.habits.filter(h => habitDone(date, h.id)).length / state.habits.length : 0;
    const tasks = state.tasks.filter(t => t.date === date);
    const taskRate = tasks.length ? tasks.filter(t => t.done).length / tasks.length : 0;
    const checkFields = ['mood', 'sleep', 'water', 'steps', 'focus'];
    const check = checkFields.filter(k => num(log[k]) > 0).length / checkFields.length;
    const available = [habits, taskRate, check].filter((v, i) => i !== 1 || tasks.length);
    return Math.round((available.reduce((a, b) => a + b, 0) / Math.max(1, available.length)) * 100);
  }
  function habitStreak(id, from = localDate()) {
    let count = 0;
    for (let i = 0; i < 3650; i++) {
      const date = addDays(from, -i);
      if (!habitDone(date, id)) break;
      count++;
    }
    return count;
  }

  function setDate(date) {
    selectedDate = date;
    calendarSelected = date;
    calendarCursor = new Date(`${date}T12:00:00`);
    $('globalDate').value = date;
    $('financeDate').value = date;
    $('taskDate').value = date;
    renderAll();
  }
  function switchView(view) {
    activeView = view;
    $$('.view').forEach(el => el.classList.toggle('active', el.id === `view-${view}`));
    $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    $('sidebar').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(renderCharts, 40);
  }

  function renderAll() {
    renderHeader();
    renderOverview();
    renderFinance();
    renderHabits();
    renderHealth();
    renderTasks();
    renderCalendar();
    renderInsights();
    renderData();
    refreshIcons();
    setTimeout(renderCharts, 0);
  }
  function renderHeader() {
    const today = localDate();
    $('dateLabel').textContent = selectedDate === today ? '今天' : formatDate(selectedDate);
    $('globalDate').value = selectedDate;
    const hour = new Date().getHours();
    $('overviewGreeting').textContent = hour < 11 ? '早上好，先定下今天的节奏' : hour < 18 ? '下午好，看看今天进展如何' : '晚上好，给今天做个收尾';
    $('overviewEyebrow').textContent = formatDate(selectedDate, { year: 'numeric' });
  }
  function renderOverview() {
    const records = dayFinance();
    const income = records.filter(r => r.type === 'income').reduce((s, r) => s + num(r.amount), 0);
    const expense = records.filter(r => r.type === 'expense').reduce((s, r) => s + num(r.amount), 0);
    const completedHabits = state.habits.filter(h => habitDone(selectedDate, h.id)).length;
    const tasks = state.tasks.filter(t => t.date === selectedDate);
    const completedTasks = tasks.filter(t => t.done).length;
    const log = daily();
    $('statBalance').textContent = money(income - expense);
    $('statFinanceMeta').textContent = `${records.length} 笔记录`;
    $('statHabit').textContent = `${completedHabits} / ${state.habits.length}`;
    $('statHabitMeta').textContent = state.habits.length ? `${Math.round(completedHabits / state.habits.length * 100)}% 完成` : '尚未创建习惯';
    $('statFocus').textContent = `${num(log.focus)} 分钟`;
    $('statTaskMeta').textContent = `${completedTasks} 项任务完成`;
    $('statWellness').textContent = log.mood ? moodLabel(log.mood) : '待记录';
    $('statWellnessMeta').textContent = log.sleep ? `睡眠 ${num(log.sleep)} 小时` : '睡眠与心情';
    $('dayScore').querySelector('b').textContent = `${dayCompletion(selectedDate)}%`;
    selectedMood = num(log.mood);
    $$('#moodPicker button').forEach(btn => btn.classList.toggle('active', num(btn.dataset.mood) === selectedMood));
    $('dailySleep').value = log.sleep ?? '';
    $('dailyWater').value = log.water ?? '';
    $('dailySteps').value = log.steps ?? '';
    $('dailyFocus').value = log.focus ?? '';
    $('dailyNote').value = log.note ?? '';
    $('checkinSaved').textContent = log.updatedAt ? `已保存 ${new Date(log.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '';
    $('habitProgressText').textContent = `${Math.max(0, state.habits.length - completedHabits)} 项待完成`;
    $('overviewHabits').innerHTML = state.habits.length ? state.habits.map(h => habitRow(h, selectedDate)).join('') : empty('circle-dashed', '还没有习惯，先创建一个');
    $('taskProgressText').textContent = `${Math.max(0, tasks.length - completedTasks)} 项待处理`;
    $('overviewTasks').innerHTML = tasks.length ? tasks.slice(0, 5).map(taskRow).join('') : empty('list-todo', '今天还没有任务');
  }
  function habitRow(habit, date) {
    const done = habitDone(date, habit.id);
    return `<div class="habit-row"><button class="habit-check ${done ? 'done' : ''}" data-action="toggle-habit" data-id="${esc(habit.id)}" data-date="${date}" aria-label="${done ? '取消' : '完成'}${esc(habit.name)}"><i data-lucide="check"></i></button><span class="habit-color" style="background:${esc(habit.color)}"></span><div class="habit-info"><span>${esc(habit.name)}</span><small>${habitStreak(habit.id, date)} 天连续</small></div></div>`;
  }
  function taskRow(task) {
    return `<div class="task-row ${task.done ? 'completed' : ''}" data-priority="${esc(task.priority || 'normal')}"><span class="priority-dot"></span><button class="task-check ${task.done ? 'done' : ''}" data-action="toggle-task" data-id="${esc(task.id)}" aria-label="${task.done ? '标记未完成' : '标记完成'}"><i data-lucide="check"></i></button><div class="task-info"><span>${esc(task.title)}</span><small>${formatDate(task.date)}${task.priority === 'high' ? ' · 高优先' : ''}</small></div><button class="row-action" data-action="delete-task" data-id="${esc(task.id)}" title="删除任务" aria-label="删除任务"><i data-lucide="trash-2"></i></button></div>`;
  }

  function renderFinance() {
    $('financeMonth').value = financeMonth;
    const records = monthFinance();
    const incomes = records.filter(r => r.type === 'income');
    const expenses = records.filter(r => r.type === 'expense');
    const income = incomes.reduce((s, r) => s + num(r.amount), 0);
    const expense = expenses.reduce((s, r) => s + num(r.amount), 0);
    const net = income - expense;
    $('monthIncome').textContent = money(income);
    $('monthExpense').textContent = money(expense);
    $('monthNet').textContent = money(net);
    $('incomeCount').textContent = `${incomes.length} 笔`;
    $('expenseCount').textContent = `${expenses.length} 笔`;
    $('savingRate').textContent = `储蓄率 ${income ? Math.round(net / income * 100) : 0}%`;
    $('dailyAverage').textContent = money(expense / Math.max(1, monthDays(financeMonth)));
    fillCategorySelect($('financeCategory'), financeType);
    renderBudgets(expenses);
    renderFinanceTable(records);
  }
  function fillCategorySelect(select, type, selected) {
    select.innerHTML = CATEGORIES[type].map(c => `<option ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('');
  }
  function renderBudgets(expenses) {
    const budgets = state.budgets[financeMonth] || {};
    const categories = [...new Set([...Object.keys(budgets), ...expenses.map(r => r.category)])];
    const totalLimit = Object.values(budgets).reduce((s, v) => s + num(v), 0);
    const totalSpent = expenses.reduce((s, r) => s + num(r.amount), 0);
    $('budgetStatus').textContent = totalLimit ? `总预算剩余 ${money(totalLimit - totalSpent)}` : '未设置总预算';
    $('budgetList').innerHTML = categories.length ? categories.slice(0, 8).map(category => {
      const spent = expenses.filter(r => r.category === category).reduce((s, r) => s + num(r.amount), 0);
      const limit = num(budgets[category]);
      const pct = limit ? Math.round(spent / limit * 100) : 0;
      return `<div class="progress-item ${pct > 100 ? 'over' : ''}"><div class="progress-meta"><span>${esc(category)}</span><span>${money(spent)} / ${limit ? money(limit) : '未设'}</span></div><div class="progress-track"><i style="width:${clamp(pct, 0, 100)}%"></i></div></div>`;
    }).join('') : empty('gauge', '设置分类预算后可查看进度');
  }
  function renderFinanceTable(records) {
    const query = $('financeSearch').value.trim().toLowerCase();
    const type = $('financeFilterType').value;
    const filtered = records.filter(r => (type === 'all' || r.type === type) && (!query || `${r.note} ${r.category} ${r.account}`.toLowerCase().includes(query))).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    $('recordCountLabel').textContent = `共 ${filtered.length} 条`;
    $('financeTable').innerHTML = filtered.length ? filtered.map(r => `<tr><td>${esc(r.date)}</td><td><span class="type-badge ${r.type}">${r.type === 'income' ? '收入' : '支出'}</span></td><td>${esc(r.category)}</td><td>${esc(r.account || '其他')}</td><td>${esc(r.note || '—')}</td><td class="num ${r.type === 'income' ? 'amount-income' : 'amount-expense'}">${r.type === 'income' ? '+' : '-'}${money(r.amount)}</td><td><div class="row-actions"><button class="row-action" data-action="edit-record" data-id="${esc(r.id)}" title="编辑" aria-label="编辑"><i data-lucide="pencil"></i></button></div></td></tr>`).join('') : `<tr><td colspan="7">${empty('receipt-text', '当前筛选下没有收支记录')}</td></tr>`;
  }
  function parseNaturalFinance(text) {
    const atoms = text.split(/[，,；;、\n]+/).map(s => s.trim()).filter(Boolean);
    return atoms.map(atom => {
      const match = atom.match(/^(.*?)([+-]?\d+(?:\.\d{1,2})?)(?:元)?$/);
      if (!match) return null;
      const note = match[1].replace(/[：:=\s-]+$/, '').trim() || '快速记录';
      const raw = match[2];
      const isIncomeWord = /工资|奖金|收入|报销|退款|回款|进账|盈利|赚/.test(note);
      const type = raw.startsWith('+') || isIncomeWord ? 'income' : 'expense';
      return { id: uid('fin'), type, amount: Math.abs(num(raw)), category: guessCategory(note, type), account: '其他', note, date: selectedDate, createdAt: new Date().toISOString() };
    }).filter(r => r && r.amount > 0);
  }
  function guessCategory(text, type) {
    const maps = type === 'income' ? [['工资|薪资', '工资'], ['奖金|提成', '奖金'], ['退款|报销', '退款'], ['兼职|副业|项目', '副业'], ['基金|股票|理财', '投资']] : [['饭|餐|外卖|咖啡|奶茶|菜', '餐饮'], ['车|地铁|公交|打车|油费', '交通'], ['房租|物业|水电', '住房'], ['药|医院|体检', '医疗'], ['书|课程|培训', '教育'], ['电影|游戏|娱乐', '娱乐'], ['话费|宽带', '通讯'], ['衣|鞋|淘宝|京东|购物', '购物'], ['旅行|酒店|机票', '旅行']];
    const found = maps.find(([pattern]) => new RegExp(pattern, 'i').test(text));
    return found ? found[1] : '其他';
  }

  function renderHabits() {
    const todayDone = state.habits.filter(h => habitDone(selectedDate, h.id)).length;
    const ranges = dateRange(selectedDate, 30);
    const totalChecks = ranges.reduce((s, d) => s + state.habits.filter(h => habitDone(d, h.id)).length, 0);
    const best = state.habits.map(h => ({ name: h.name, streak: habitStreak(h.id, selectedDate) })).sort((a, b) => b.streak - a.streak)[0];
    $('habitSummary').innerHTML = [
      ['今日完成', `${todayDone}/${state.habits.length}`, state.habits.length ? `${Math.round(todayDone / state.habits.length * 100)}%` : '0%'],
      ['近 30 天打卡', totalChecks, '累计完成'],
      ['最长连续', `${best ? best.streak : 0} 天`, best ? best.name : '暂无'],
      ['活跃习惯', state.habits.length, '可随时调整']
    ].map(([label, value, meta]) => `<article class="metric"><small>${label}</small><strong>${esc(value)}</strong><em>${esc(meta)}</em></article>`).join('');
    renderHabitWeek();
    $('habitManageList').innerHTML = state.habits.length ? state.habits.map(h => `<div class="manage-row"><span class="habit-color" style="background:${esc(h.color)}"></span><div class="habit-info"><span>${esc(h.name)}</span><small>目标 ${num(h.target, 1)} ${esc(h.unit || '次')} / 天</small></div><span class="streak">${habitStreak(h.id, selectedDate)} 天</span><button class="row-action" data-action="edit-habit" data-id="${esc(h.id)}" title="编辑" aria-label="编辑"><i data-lucide="pencil"></i></button><button class="row-action" data-action="delete-habit" data-id="${esc(h.id)}" title="删除" aria-label="删除"><i data-lucide="trash-2"></i></button></div>`).join('') : empty('circle-dashed', '创建第一个习惯');
  }
  function renderHabitWeek() {
    const base = addDays(selectedDate, habitWeekOffset * 7);
    const start = startOfWeek(base);
    const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    $('habitWeekRange').textContent = `${formatShort(dates[0])} - ${formatShort(dates[6])}`;
    const header = `<div class="habit-week-header"><span>习惯</span>${dates.map(d => `<span>${['日','一','二','三','四','五','六'][new Date(`${d}T12:00:00`).getDay()]}<br>${formatShort(d)}</span>`).join('')}</div>`;
    const rows = state.habits.map(h => `<div class="habit-week-row"><div class="habit-week-name"><i class="habit-color" style="background:${esc(h.color)}"></i><span>${esc(h.name)}</span></div>${dates.map(d => `<div class="habit-day"><button style="--habit-color:${esc(h.color)}" class="${habitDone(d, h.id) ? 'done' : ''} ${d > localDate() ? 'future' : ''}" data-action="toggle-habit" data-id="${esc(h.id)}" data-date="${d}" aria-label="${d} ${esc(h.name)}"><i data-lucide="check"></i></button></div>`).join('')}</div>`).join('');
    $('habitWeek').innerHTML = `<div class="habit-week-grid">${header}${rows || empty('circle-dashed', '暂无习惯')}</div>`;
  }

  function renderHealth() {
    const log = daily();
    $('healthFormTitle').textContent = `${formatDate(selectedDate)}健康记录`;
    const fields = { healthSleep: 'sleep', healthWeight: 'weight', healthSteps: 'steps', healthWater: 'water', healthExercise: 'exercise', healthFocus: 'focus', healthScreen: 'screen', healthEnergy: 'energy', healthStress: 'stress', healthGratitude: 'gratitude' };
    Object.entries(fields).forEach(([id, key]) => { $(id).value = log[key] ?? (['healthEnergy', 'healthStress'].includes(id) ? 3 : ''); });
    $('healthEnergyOut').value = $('healthEnergy').value;
    $('healthStressOut').value = $('healthStress').value;
    $('customMetricInputs').innerHTML = state.customMetrics.map(metric => `<label><span>${esc(metric.name)}</span><div class="unit-input"><input type="number" step="0.1" data-custom-metric="${esc(metric.id)}" value="${esc((log.custom || {})[metric.id] ?? '')}"><b>${esc(metric.unit || '')}</b></div></label>`).join('');
    const select = $('healthMetric');
    const current = select.value;
    select.innerHTML = [{ id: 'sleep', name: '睡眠' }, { id: 'weight', name: '体重' }, { id: 'steps', name: '步数' }, { id: 'water', name: '饮水' }, { id: 'exercise', name: '运动' }, { id: 'focus', name: '专注' }, { id: 'screen', name: '屏幕时间' }, ...state.customMetrics].map(m => `<option value="${esc(m.id)}" ${m.id === current ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    $('customMetricList').innerHTML = state.customMetrics.length ? state.customMetrics.map(m => `<span class="metric-tag" style="--metric-color:${esc(m.color)}"><b>${esc(m.name)}</b><small>${m.target ? `目标 ${num(m.target)} ${esc(m.unit)}` : esc(m.unit || '数值')}</small><button data-action="delete-metric" data-id="${esc(m.id)}" aria-label="删除${esc(m.name)}"><i data-lucide="x"></i></button></span>`).join('') : `<span class="empty-state">暂无自定义指标</span>`;
    renderHealthSummary();
  }
  function renderHealthSummary() {
    const metric = $('healthMetric').value || 'sleep';
    const dates = dateRange(selectedDate, 30);
    const values = dates.map(d => metricValue(d, metric)).filter(v => v !== null);
    const latest = values.length ? values[values.length - 1] : 0;
    const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const change = values.length > 1 ? latest - values[0] : 0;
    $('healthTrendSummary').innerHTML = `<div><small>最新</small><strong>${round(latest)}</strong></div><div><small>平均</small><strong>${round(average)}</strong></div><div><small>周期变化</small><strong>${change > 0 ? '+' : ''}${round(change)}</strong></div>`;
  }
  function metricValue(date, key) {
    const log = daily(date);
    const value = state.customMetrics.some(m => m.id === key) ? (log.custom || {})[key] : log[key];
    return value === '' || value === undefined || value === null ? null : num(value);
  }
  function round(value) { return Math.round(num(value) * 10) / 10; }

  function renderTasks() {
    $$('#taskFilter button').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === taskFilter));
    let tasks = [...state.tasks];
    if (taskFilter === 'today') tasks = tasks.filter(t => t.date === selectedDate);
    if (taskFilter === 'pending') tasks = tasks.filter(t => !t.done);
    if (taskFilter === 'done') tasks = tasks.filter(t => t.done);
    tasks.sort((a, b) => Number(a.done) - Number(b.done) || ({ high: 0, normal: 1, low: 2 }[a.priority] - { high: 0, normal: 1, low: 2 }[b.priority]) || a.date.localeCompare(b.date));
    $('taskListCaption').textContent = `${tasks.filter(t => !t.done).length} 项待完成`;
    $('taskList').innerHTML = tasks.length ? tasks.map(taskRow).join('') : empty('list-checks', '当前没有任务');
    $('goalList').innerHTML = state.goals.length ? state.goals.map(goal => {
      const pct = clamp(Math.round(num(goal.current) / Math.max(1, num(goal.target)) * 100), 0, 100);
      return `<div class="goal-row"><div class="goal-top"><strong>${esc(goal.title)}</strong><span>${pct}%</span></div><div class="progress-track"><i style="width:${pct}%"></i></div><div class="goal-foot"><small>${num(goal.current)} / ${num(goal.target)} ${esc(goal.unit || '')}${goal.deadline ? ` · ${esc(goal.deadline)}` : ''}</small><div class="goal-controls"><button data-action="goal-minus" data-id="${esc(goal.id)}" aria-label="减少进度"><i data-lucide="minus"></i></button><button data-action="goal-plus" data-id="${esc(goal.id)}" aria-label="增加进度"><i data-lucide="plus"></i></button><button data-action="delete-goal" data-id="${esc(goal.id)}" aria-label="删除目标"><i data-lucide="trash-2"></i></button></div></div></div>`;
    }).join('') : empty('target', '还没有长期目标');
  }

  function renderCalendar() {
    const y = calendarCursor.getFullYear();
    const m = calendarCursor.getMonth();
    $('calendarTitle').textContent = `${y} 年 ${m + 1} 月`;
    const first = new Date(y, m, 1, 12);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(y, m, 1 - offset, 12);
    const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return localDate(d); });
    $('calendarGrid').innerHTML = days.map(date => {
      const records = dayFinance(date);
      const exp = records.filter(r => r.type === 'expense').reduce((s, r) => s + num(r.amount), 0);
      const done = state.habits.filter(h => habitDone(date, h.id)).length;
      const log = daily(date);
      const marks = [exp ? `<span><i style="background:var(--coral)"></i>支出 ${money(exp)}</span>` : '', done ? `<span><i style="background:var(--primary)"></i>习惯 ${done}/${state.habits.length}</span>` : '', log.mood ? `<span><i style="background:var(--amber)"></i>${moodLabel(log.mood)}</span>` : ''].filter(Boolean).join('');
      return `<button class="calendar-day ${monthKey(date) !== `${y}-${String(m + 1).padStart(2, '0')}` ? 'other' : ''} ${date === calendarSelected ? 'selected' : ''} ${date === localDate() ? 'today' : ''}" data-action="calendar-day" data-date="${date}"><span class="day-number">${Number(date.slice(8))}</span><span class="calendar-marks">${marks}</span></button>`;
    }).join('');
    renderDayDetail(calendarSelected);
  }
  function renderDayDetail(date) {
    const records = dayFinance(date);
    const income = records.filter(r => r.type === 'income').reduce((s, r) => s + num(r.amount), 0);
    const expense = records.filter(r => r.type === 'expense').reduce((s, r) => s + num(r.amount), 0);
    const log = daily(date);
    const habits = state.habits.filter(h => habitDone(date, h.id));
    const tasks = state.tasks.filter(t => t.date === date);
    $('calendarDayDetail').innerHTML = `<p class="eyebrow">日期详情</p><h2>${esc(formatDate(date, { year: 'numeric' }))}</h2><div class="detail-section"><div class="detail-line"><span>收入</span><strong class="amount-income">${money(income)}</strong></div><div class="detail-line"><span>支出</span><strong class="amount-expense">${money(expense)}</strong></div><div class="detail-line"><span>完成度</span><strong>${dayCompletion(date)}%</strong></div></div><div class="detail-section"><div class="detail-line"><span>心情</span><strong>${moodLabel(log.mood)}</strong></div><div class="detail-line"><span>睡眠</span><strong>${log.sleep ? `${num(log.sleep)} 小时` : '未记录'}</strong></div><div class="detail-line"><span>步数</span><strong>${log.steps ? num(log.steps).toLocaleString() : '未记录'}</strong></div></div><div class="detail-section"><div class="detail-line"><span>习惯</span><strong>${habits.length}/${state.habits.length}</strong></div><div class="detail-line"><span>任务</span><strong>${tasks.filter(t => t.done).length}/${tasks.length}</strong></div>${log.note ? `<p>${esc(log.note)}</p>` : ''}</div><button class="primary-btn" data-action="open-date" data-date="${date}"><i data-lucide="arrow-up-right"></i>打开这一天</button>`;
  }

  function renderInsights() {
    const count = num($('insightPeriod').value, 30);
    const dates = dateRange(selectedDate, count);
    const completions = dates.map(dayCompletion);
    const avgCompletion = completions.reduce((a, b) => a + b, 0) / count;
    const logs = dates.map(daily);
    const sleeps = logs.map(l => num(l.sleep)).filter(Boolean);
    const moods = logs.map(l => num(l.mood)).filter(Boolean);
    const expenses = state.finance.filter(r => r.type === 'expense' && dates.includes(r.date));
    const expenseTotal = expenses.reduce((s, r) => s + num(r.amount), 0);
    const taskList = state.tasks.filter(t => dates.includes(t.date));
    const taskRate = taskList.length ? taskList.filter(t => t.done).length / taskList.length * 100 : 0;
    const insights = [
      ['平均完成度', `${Math.round(avgCompletion)}%`, trendText(completions), '#168a73'],
      ['平均睡眠', sleeps.length ? `${round(sleeps.reduce((a,b) => a+b, 0) / sleeps.length)} 小时` : '暂无', sleeps.length ? `${sleeps.length} 天有记录` : '开始记录后生成趋势', '#3b6fd8'],
      ['周期支出', money(expenseTotal), `${expenses.length} 笔消费`, '#c85d4c'],
      ['任务完成率', `${Math.round(taskRate)}%`, `${taskList.filter(t => t.done).length}/${taskList.length} 项`, '#b7791f']
    ];
    $('insightCards').innerHTML = insights.map(([label, value, meta, color]) => `<article class="insight-card" style="--insight-color:${color}"><small>${label}</small><strong>${esc(value)}</strong><em>${esc(meta)}</em></article>`).join('');
    const categoryMap = {};
    expenses.forEach(r => { categoryMap[r.category] = (categoryMap[r.category] || 0) + num(r.amount); });
    const categories = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
    $('expenseLegend').innerHTML = categories.length ? categories.map(([name, value], i) => `<div class="legend-row"><i style="background:${COLORS[i % COLORS.length]}"></i><span>${esc(name)}</span><small>${money(value)}</small></div>`).join('') : empty('chart-pie', '当前周期没有支出');
    void moods;
  }
  function trendText(values) {
    if (values.length < 2) return '记录积累中';
    const half = Math.floor(values.length / 2);
    const first = values.slice(0, half).reduce((a,b) => a+b, 0) / half;
    const second = values.slice(half).reduce((a,b) => a+b, 0) / (values.length - half);
    const diff = Math.round(second - first);
    return diff === 0 ? '前后周期持平' : `较前半段${diff > 0 ? '提升' : '下降'} ${Math.abs(diff)}%`;
  }

  function renderData() {
    const dailyCount = Object.keys(state.daily).length;
    const checks = Object.values(state.habitLogs).reduce((s, log) => s + Object.values(log).filter(Boolean).length, 0);
    $('dataStats').innerHTML = [['收支', state.finance.length], ['签到', dailyCount], ['打卡', checks], ['任务', state.tasks.length]].map(([name, value]) => `<div><small>${name}</small><strong>${value}</strong></div>`).join('');
    $('settingCurrency').value = state.settings.currency;
    $('settingWater').value = state.settings.waterGoal;
    $('settingSteps').value = state.settings.stepsGoal;
    $('settingSleep').value = state.settings.sleepGoal;
  }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function canvasContext(id) {
    const canvas = $(id);
    if (!canvas || canvas.offsetParent === null) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(280, canvas.clientWidth);
    const height = Math.max(180, canvas.clientHeight);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  }
  function chartFrame(c, values, formatter = v => round(v)) {
    const { ctx, width, height } = c;
    const pad = { l: 42, r: 12, t: 16, b: 28 };
    const max = Math.max(1, ...values.map(num));
    ctx.font = '10px Segoe UI';
    ctx.strokeStyle = css('--line');
    ctx.fillStyle = css('--muted');
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (height - pad.t - pad.b) * i / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(width - pad.r, y); ctx.stroke();
      ctx.fillText(String(formatter(max * (1 - i / 4))), 3, y + 3);
    }
    return { pad, max, plotW: width - pad.l - pad.r, plotH: height - pad.t - pad.b };
  }
  function drawBarChart(id, labels, positive, negative, lineValues) {
    const c = canvasContext(id); if (!c) return;
    const all = [...positive, ...negative];
    const frame = chartFrame(c, all, v => v >= 1000 ? `${round(v / 1000)}k` : round(v));
    const { ctx, width, height } = c, { pad, max, plotW, plotH } = frame;
    const step = plotW / Math.max(1, labels.length), bar = Math.max(2, Math.min(8, step * .27));
    labels.forEach((label, i) => {
      const x = pad.l + step * i + step / 2;
      const h1 = num(positive[i]) / max * plotH, h2 = num(negative[i]) / max * plotH;
      ctx.fillStyle = css('--green'); ctx.fillRect(x - bar - 1, pad.t + plotH - h1, bar, h1);
      ctx.fillStyle = css('--coral'); ctx.fillRect(x + 1, pad.t + plotH - h2, bar, h2);
      if (labels.length <= 12 || i % Math.ceil(labels.length / 8) === 0) { ctx.fillStyle = css('--muted'); ctx.textAlign = 'center'; ctx.fillText(label, x, height - 8); }
    });
    if (lineValues) {
      ctx.strokeStyle = css('--blue'); ctx.lineWidth = 2; ctx.beginPath();
      lineValues.forEach((v, i) => { const x = pad.l + step * i + step / 2, y = pad.t + plotH - clamp(num(v), 0, 100) / 100 * plotH; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
    ctx.textAlign = 'left';
  }
  function drawLineChart(id, labels, series) {
    const c = canvasContext(id); if (!c) return;
    const values = series.flatMap(s => s.values.filter(v => v !== null));
    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 1;
    const range = Math.max(1, maxValue - Math.min(0, minValue));
    const frame = chartFrame(c, [maxValue], v => round(v));
    const { ctx, width, height } = c, { pad, plotW, plotH } = frame;
    const step = plotW / Math.max(1, labels.length - 1);
    series.forEach(s => {
      ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = 2; ctx.beginPath(); let started = false;
      s.values.forEach((v, i) => {
        if (v === null) { started = false; return; }
        const x = pad.l + step * i, y = pad.t + plotH - (num(v) - Math.min(0, minValue)) / range * plotH;
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
      s.values.forEach((v, i) => { if (v === null) return; const x = pad.l + step * i, y = pad.t + plotH - (num(v) - Math.min(0, minValue)) / range * plotH; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill(); });
    });
    ctx.fillStyle = css('--muted'); ctx.font = '10px Segoe UI'; ctx.textAlign = 'center';
    labels.forEach((label, i) => { if (labels.length <= 12 || i % Math.ceil(labels.length / 8) === 0) ctx.fillText(label, pad.l + step * i, height - 8); });
    ctx.textAlign = 'left';
    void width;
  }
  function drawDonut(id, items) {
    const c = canvasContext(id); if (!c) return;
    const { ctx, width, height } = c, total = items.reduce((s, item) => s + num(item[1]), 0);
    const cx = width / 2, cy = height / 2, radius = Math.min(width, height) * .34, thickness = Math.max(18, radius * .35);
    ctx.lineWidth = thickness; ctx.lineCap = 'butt';
    if (!total) { ctx.strokeStyle = css('--surface-3'); ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke(); }
    let start = -Math.PI / 2;
    items.forEach((item, i) => { const angle = num(item[1]) / total * Math.PI * 2; ctx.strokeStyle = COLORS[i % COLORS.length]; ctx.beginPath(); ctx.arc(cx, cy, radius, start, start + angle); ctx.stroke(); start += angle; });
    ctx.fillStyle = css('--text'); ctx.font = '700 20px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText(total ? money(total) : '暂无', cx, cy + 2);
    ctx.fillStyle = css('--muted'); ctx.font = '10px Segoe UI'; ctx.fillText('周期支出', cx, cy + 20); ctx.textAlign = 'left';
  }
  function renderCharts() {
    const seven = dateRange(selectedDate, 7);
    const dayValues = seven.map(date => {
      const records = dayFinance(date);
      return { income: records.filter(r => r.type === 'income').reduce((s,r) => s + num(r.amount), 0), expense: records.filter(r => r.type === 'expense').reduce((s,r) => s + num(r.amount), 0), completion: dayCompletion(date) };
    });
    drawBarChart('overviewChart', seven.map(formatShort), dayValues.map(v => v.income), dayValues.map(v => v.expense), dayValues.map(v => v.completion));
    const days = monthDays(financeMonth), monthDates = Array.from({ length: days }, (_, i) => `${financeMonth}-${String(i + 1).padStart(2, '0')}`);
    drawBarChart('financeChart', monthDates.map(d => String(Number(d.slice(8)))), monthDates.map(d => dayFinance(d).filter(r => r.type === 'income').reduce((s,r) => s + num(r.amount), 0)), monthDates.map(d => dayFinance(d).filter(r => r.type === 'expense').reduce((s,r) => s + num(r.amount), 0)));
    const healthDates = dateRange(selectedDate, 30), metric = $('healthMetric').value || 'sleep';
    drawLineChart('healthChart', healthDates.map(formatShort), [{ values: healthDates.map(d => metricValue(d, metric)), color: css('--primary') }]);
    const insightCount = num($('insightPeriod').value, 30), insightDates = dateRange(selectedDate, insightCount);
    drawLineChart('completionChart', insightDates.map(formatShort), [{ values: insightDates.map(dayCompletion), color: css('--primary') }]);
    drawLineChart('moodSleepChart', insightDates.map(formatShort), [{ values: insightDates.map(d => metricValue(d, 'sleep')), color: css('--blue') }, { values: insightDates.map(d => metricValue(d, 'mood')), color: css('--amber') }]);
    const map = {}; state.finance.filter(r => r.type === 'expense' && insightDates.includes(r.date)).forEach(r => { map[r.category] = (map[r.category] || 0) + num(r.amount); });
    drawDonut('expenseDonut', Object.entries(map).sort((a,b) => b[1] - a[1]));
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  function exportJson(silent = false) {
    download(`日迹备份-${localDate()}.json`, JSON.stringify(state, null, 2), 'application/json;charset=utf-8');
    if (!silent) toast('完整备份已导出');
  }
  function csvCell(value) { const s = String(value ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
  function exportFinanceCsv() {
    const rows = [['日期','类型','分类','账户','备注','金额'], ...monthFinance().map(r => [r.date, r.type === 'income' ? '收入' : '支出', r.category, r.account || '', r.note || '', r.amount])];
    download(`收支明细-${financeMonth}.csv`, '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
    toast('收支 CSV 已导出');
  }
  function exportDailyCsv() {
    const dates = [...new Set([...Object.keys(state.daily), ...state.finance.map(r => r.date), ...state.tasks.map(t => t.date), ...Object.keys(state.habitLogs)])].sort();
    const head = ['日期','收入','支出','心情','睡眠小时','饮水ml','步数','运动分钟','专注分钟','屏幕分钟','习惯完成','任务完成','完成度','日记'];
    const rows = dates.map(date => { const recs = dayFinance(date), log = daily(date), tasks = state.tasks.filter(t => t.date === date); return [date, recs.filter(r => r.type === 'income').reduce((s,r)=>s+num(r.amount),0), recs.filter(r => r.type === 'expense').reduce((s,r)=>s+num(r.amount),0), log.mood || '', log.sleep || '', log.water || '', log.steps || '', log.exercise || '', log.focus || '', log.screen || '', state.habits.filter(h => habitDone(date,h.id)).length, tasks.filter(t=>t.done).length, `${dayCompletion(date)}%`, log.note || '']; });
    download(`每日汇总-${localDate()}.csv`, '\uFEFF' + [head, ...rows].map(row => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
    toast('每日汇总 CSV 已导出');
  }
  function mergeStates(base, incoming) {
    const merged = normalizeState(base);
    ['finance','habits','tasks','goals','customMetrics'].forEach(key => { const map = new Map(merged[key].map(item => [String(item.id), item])); incoming[key].forEach(item => map.set(String(item.id), item)); merged[key] = [...map.values()]; });
    merged.daily = { ...merged.daily, ...incoming.daily };
    merged.habitLogs = { ...merged.habitLogs, ...incoming.habitLogs };
    merged.budgets = { ...merged.budgets, ...incoming.budgets };
    merged.settings = { ...merged.settings, ...incoming.settings };
    return merged;
  }
  function demoState() {
    const demo = normalizeState(DEFAULT_STATE);
    const today = localDate();
    dateRange(today, 35).forEach((date, i) => {
      demo.daily[date] = { mood: 3 + (i % 3), sleep: round(6.5 + (i % 5) * .35), water: 1400 + (i % 5) * 250, steps: 4200 + (i % 7) * 1050, exercise: i % 3 ? 30 : 0, focus: 35 + (i % 6) * 20, screen: 160 + (i % 5) * 25, energy: 2 + (i % 4), stress: 1 + (i % 4), note: i === 34 ? '完成了本周复盘，晚上散步。' : '' };
      demo.habitLogs[date] = {}; demo.habits.forEach((h, hi) => { demo.habitLogs[date][h.id] = (i + hi) % 5 !== 0; });
      demo.finance.push({ id: uid('demo'), type: 'expense', amount: 18 + (i % 6) * 9, category: i % 3 ? '餐饮' : '交通', account: '微信', note: i % 3 ? '日常餐饮' : '通勤', date, createdAt: `${date}T08:00:00` });
      if (i % 14 === 0) demo.finance.push({ id: uid('demo'), type: 'income', amount: 1200 + i * 10, category: '副业', account: '银行卡', note: '项目结算', date, createdAt: `${date}T12:00:00` });
    });
    demo.tasks = [{ id: uid('task'), title: '整理本周数据', date: today, priority: 'high', done: false }, { id: uid('task'), title: '阅读 30 分钟', date: today, priority: 'normal', done: true }, { id: uid('task'), title: '预约体检', date: addDays(today, 1), priority: 'normal', done: false }];
    demo.goals = [{ id: uid('goal'), title: '年度阅读计划', target: 24, current: 9, unit: '本', deadline: `${today.slice(0,4)}-12-31` }, { id: uid('goal'), title: '跑步累计', target: 300, current: 126, unit: '公里', deadline: `${today.slice(0,4)}-12-31` }];
    demo.budgets[monthKey(today)] = { 餐饮: 1800, 交通: 500, 购物: 800, 娱乐: 500 };
    return demo;
  }

  function openHabit(id) {
    const habit = state.habits.find(h => String(h.id) === String(id));
    $('habitDialogTitle').textContent = habit ? '编辑习惯' : '新建习惯';
    $('habitId').value = habit?.id || '';
    $('habitName').value = habit?.name || '';
    $('habitTarget').value = habit?.target || 1;
    $('habitUnit').value = habit?.unit || '次';
    $('habitColor').value = habit?.color || '#168a73';
    $('habitDialog').showModal();
  }
  function openRecord(id) {
    const record = state.finance.find(r => String(r.id) === String(id)); if (!record) return;
    $('editRecordId').value = record.id; $('editRecordType').value = record.type; $('editRecordAmount').value = record.amount; $('editRecordDate').value = record.date; $('editRecordNote').value = record.note || '';
    fillCategorySelect($('editRecordCategory'), record.type, record.category);
    $('recordDialog').showModal();
  }
  function openBudgetDialog() {
    const current = state.budgets[financeMonth] || {};
    $('budgetInputs').innerHTML = CATEGORIES.expense.map(category => `<label class="budget-input-row"><span>${esc(category)}</span><div class="unit-input"><input type="number" min="0" step="100" data-budget="${esc(category)}" value="${esc(current[category] || '')}" placeholder="0"><b>${esc(state.settings.currency)}</b></div></label>`).join('');
    $('budgetDialog').showModal();
  }
  function showSearch() { $('searchDialog').showModal(); $('searchInput').value = ''; renderSearch(''); setTimeout(() => $('searchInput').focus(), 30); }
  function renderSearch(query) {
    const q = query.trim().toLowerCase();
    if (!q) { $('searchResults').innerHTML = empty('search', '输入关键词开始搜索'); return; }
    const results = [];
    state.finance.forEach(r => { if (`${r.note} ${r.category} ${r.account}`.toLowerCase().includes(q)) results.push({ icon: 'wallet-cards', title: r.note || r.category, meta: `${r.date} · ${money(r.amount)}`, view: 'finance', date: r.date }); });
    state.tasks.forEach(t => { if (t.title.toLowerCase().includes(q)) results.push({ icon: 'list-todo', title: t.title, meta: `${t.date} · ${t.done ? '已完成' : '待办'}`, view: 'tasks', date: t.date }); });
    state.goals.forEach(g => { if (g.title.toLowerCase().includes(q)) results.push({ icon: 'target', title: g.title, meta: `${g.current}/${g.target} ${g.unit}`, view: 'tasks' }); });
    Object.entries(state.daily).forEach(([date, log]) => { if (`${log.note || ''} ${log.gratitude || ''}`.toLowerCase().includes(q)) results.push({ icon: 'notebook-pen', title: log.note || log.gratitude, meta: date, view: 'overview', date }); });
    $('searchResults').innerHTML = results.length ? results.slice(0, 40).map(r => `<button class="search-result" data-action="search-open" data-view="${r.view}" data-date="${r.date || ''}"><i data-lucide="${r.icon}"></i><span><b>${esc(r.title)}</b><small>${esc(r.meta)}</small></span><i data-lucide="arrow-up-right"></i></button>`).join('') : empty('search-x', '没有匹配记录');
    refreshIcons();
  }

  function bindEvents() {
    document.addEventListener('click', async event => {
      const nav = event.target.closest('[data-view]');
      if (nav && nav.classList.contains('nav-item')) { switchView(nav.dataset.view); return; }
      const go = event.target.closest('[data-goto]'); if (go) { switchView(go.dataset.goto); return; }
      const action = event.target.closest('[data-action]'); if (!action) return;
      const id = action.dataset.id, date = action.dataset.date;
      if (action.dataset.action === 'toggle-habit') mutate('', s => { s.habitLogs[date] ||= {}; s.habitLogs[date][id] = !s.habitLogs[date][id]; });
      if (action.dataset.action === 'toggle-task') mutate('', s => { const t = s.tasks.find(x => String(x.id) === String(id)); if (t) t.done = !t.done; });
      if (action.dataset.action === 'delete-task') { const old = state.tasks.find(t => String(t.id) === String(id)); mutate('任务已删除', s => { s.tasks = s.tasks.filter(t => String(t.id) !== String(id)); }); toast('任务已删除', 'success', { label: '撤销', run: () => mutate('', s => s.tasks.push(old)) }); }
      if (action.dataset.action === 'edit-record') openRecord(id);
      if (action.dataset.action === 'edit-habit') openHabit(id);
      if (action.dataset.action === 'delete-habit' && await ask('删除习惯', '历史打卡会保留，但该习惯将不再显示。')) mutate('习惯已删除', s => { s.habits = s.habits.filter(h => String(h.id) !== String(id)); });
      if (action.dataset.action === 'delete-metric' && await ask('删除自定义指标', '已记录的历史数值不会显示。')) mutate('指标已删除', s => { s.customMetrics = s.customMetrics.filter(m => String(m.id) !== String(id)); });
      if (action.dataset.action === 'goal-plus' || action.dataset.action === 'goal-minus') mutate('', s => { const g = s.goals.find(x => String(x.id) === String(id)); if (g) g.current = Math.max(0, num(g.current) + (action.dataset.action === 'goal-plus' ? 1 : -1)); });
      if (action.dataset.action === 'delete-goal' && await ask('删除目标', '该目标与当前进度将被删除。')) mutate('目标已删除', s => { s.goals = s.goals.filter(g => String(g.id) !== String(id)); });
      if (action.dataset.action === 'calendar-day') { calendarSelected = date; renderCalendar(); refreshIcons(); }
      if (action.dataset.action === 'open-date') { setDate(date); switchView('overview'); }
      if (action.dataset.action === 'search-open') { $('searchDialog').close(); if (date) setDate(date); switchView(action.dataset.view); }
    });
    $('mobileMenu').addEventListener('click', () => $('sidebar').classList.toggle('open'));
    $('datePrev').addEventListener('click', () => setDate(addDays(selectedDate, -1)));
    $('dateNext').addEventListener('click', () => setDate(addDays(selectedDate, 1)));
    $('dateToday').addEventListener('click', () => setDate(localDate()));
    $('dateLabel').addEventListener('click', () => { $('globalDate').style.pointerEvents = 'auto'; $('globalDate').showPicker?.(); });
    $('globalDate').addEventListener('change', e => { $('globalDate').style.pointerEvents = 'none'; if (e.target.value) setDate(e.target.value); });
    $('themeToggle').addEventListener('click', () => { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); persist(); renderCharts(); });
    $('quickAdd').addEventListener('click', () => { switchView('finance'); setTimeout(() => $('financeAmount').focus(), 50); });
    $('globalSearch').addEventListener('click', showSearch);
    $('closeSearch').addEventListener('click', () => $('searchDialog').close());
    $('searchInput').addEventListener('input', e => renderSearch(e.target.value));
    document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); showSearch(); } });
    $$('#moodPicker button').forEach(btn => btn.addEventListener('click', () => { selectedMood = num(btn.dataset.mood); $$('#moodPicker button').forEach(b => b.classList.toggle('active', b === btn)); }));
    $('dailyForm').addEventListener('submit', e => { e.preventDefault(); mutate('今日签到已保存', s => { s.daily[selectedDate] = { ...s.daily[selectedDate], mood: selectedMood, sleep: num($('dailySleep').value), water: num($('dailyWater').value), steps: num($('dailySteps').value), focus: num($('dailyFocus').value), note: $('dailyNote').value.trim(), updatedAt: new Date().toISOString() }; }); });
    $('quickTaskForm').addEventListener('submit', e => { e.preventDefault(); const title = $('quickTaskInput').value.trim(); if (!title) return; mutate('任务已添加', s => s.tasks.push({ id: uid('task'), title, date: selectedDate, priority: 'normal', done: false, createdAt: new Date().toISOString() })); $('quickTaskInput').value = ''; });
    $$('#financeType button').forEach(btn => btn.addEventListener('click', () => { financeType = btn.dataset.type; $$('#financeType button').forEach(b => b.classList.toggle('active', b === btn)); fillCategorySelect($('financeCategory'), financeType); }));
    $('financeForm').addEventListener('submit', e => { e.preventDefault(); const amount = num($('financeAmount').value); if (amount <= 0) return; mutate('收支记录已保存', s => s.finance.push({ id: uid('fin'), type: financeType, amount, category: $('financeCategory').value, account: $('financeAccount').value, note: $('financeNote').value.trim(), date: $('financeDate').value, createdAt: new Date().toISOString() })); e.target.reset(); $('financeDate').value = selectedDate; financeType = 'expense'; $$('#financeType button').forEach(b => b.classList.toggle('active', b.dataset.type === financeType)); fillCategorySelect($('financeCategory'), financeType); });
    $('parseFinance').addEventListener('click', () => { const records = parseNaturalFinance($('naturalFinance').value); if (!records.length) return toast('没有识别到“事项+金额”格式', 'error'); mutate(`已保存 ${records.length} 笔记录`, s => s.finance.push(...records)); $('naturalFinance').value = ''; });
    $('financeMonth').addEventListener('change', e => { financeMonth = e.target.value || monthKey(selectedDate); renderFinance(); renderCharts(); refreshIcons(); });
    $('financeSearch').addEventListener('input', () => { renderFinanceTable(monthFinance()); refreshIcons(); });
    $('financeFilterType').addEventListener('change', () => { renderFinanceTable(monthFinance()); refreshIcons(); });
    $('openFinanceForm').addEventListener('click', () => { $('financeEntryPanel').scrollIntoView({ behavior: 'smooth' }); setTimeout(() => $('financeAmount').focus(), 250); });
    $('exportFinanceCsv').addEventListener('click', exportFinanceCsv);
    $('editBudgets').addEventListener('click', openBudgetDialog);
    $('addHabit').addEventListener('click', () => openHabit());
    $('habitWeekPrev').addEventListener('click', () => { habitWeekOffset--; renderHabitWeek(); refreshIcons(); });
    $('habitWeekNext').addEventListener('click', () => { habitWeekOffset++; renderHabitWeek(); refreshIcons(); });
    $('habitWeekCurrent').addEventListener('click', () => { habitWeekOffset = 0; renderHabitWeek(); refreshIcons(); });
    ['healthEnergy','healthStress'].forEach(id => $(id).addEventListener('input', e => $(`${id}Out`).value = e.target.value));
    $('healthMetric').addEventListener('change', () => { renderHealthSummary(); renderCharts(); });
    $('saveHealthTop').addEventListener('click', () => $('healthForm').requestSubmit());
    $('healthForm').addEventListener('submit', e => { e.preventDefault(); const custom = {}; $$('[data-custom-metric]').forEach(input => custom[input.dataset.customMetric] = num(input.value)); mutate('健康记录已保存', s => { s.daily[selectedDate] = { ...s.daily[selectedDate], sleep: num($('healthSleep').value), weight: num($('healthWeight').value), steps: num($('healthSteps').value), water: num($('healthWater').value), exercise: num($('healthExercise').value), focus: num($('healthFocus').value), screen: num($('healthScreen').value), energy: num($('healthEnergy').value), stress: num($('healthStress').value), gratitude: $('healthGratitude').value.trim(), custom, updatedAt: new Date().toISOString() }; }); });
    $('addMetric').addEventListener('click', () => { $('metricForm').reset(); $('metricColor').value = '#3b6fd8'; $('metricDialog').showModal(); });
    $$('#taskFilter button').forEach(btn => btn.addEventListener('click', () => { taskFilter = btn.dataset.filter; renderTasks(); refreshIcons(); }));
    $('taskForm').addEventListener('submit', e => { e.preventDefault(); mutate('任务已添加', s => s.tasks.push({ id: uid('task'), title: $('taskTitle').value.trim(), date: $('taskDate').value, priority: $('taskPriority').value, done: false, createdAt: new Date().toISOString() })); $('taskTitle').value = ''; });
    $('addGoal').addEventListener('click', () => { $('goalForm').reset(); $('goalCurrent').value = 0; $('goalDialog').showModal(); });
    $('calendarPrev').addEventListener('click', () => { calendarCursor.setMonth(calendarCursor.getMonth() - 1); renderCalendar(); refreshIcons(); });
    $('calendarNext').addEventListener('click', () => { calendarCursor.setMonth(calendarCursor.getMonth() + 1); renderCalendar(); refreshIcons(); });
    $('insightPeriod').addEventListener('change', () => { renderInsights(); renderCharts(); });
    $('exportJson').addEventListener('click', () => exportJson());
    $('exportAllCsv').addEventListener('click', exportDailyCsv);
    $('importJson').addEventListener('change', async e => { const file = e.target.files[0]; if (!file) return; try { const incoming = normalizeState(JSON.parse(await file.text())); if (await ask('导入并合并备份', '同 ID 的记录以导入文件为准，其余记录会保留。')) { state = mergeStates(state, incoming); persist(true); renderAll(); toast('备份已导入并合并'); } } catch (error) { toast(`导入失败：${error.message}`, 'error'); } e.target.value = ''; });
    $('settingsForm').addEventListener('submit', e => { e.preventDefault(); mutate('偏好设置已保存', s => { s.settings.currency = $('settingCurrency').value.trim() || '¥'; s.settings.waterGoal = num($('settingWater').value); s.settings.stepsGoal = num($('settingSteps').value); s.settings.sleepGoal = num($('settingSleep').value); }); });
    $('loadDemo').addEventListener('click', async () => { if (await ask('载入演示数据', '演示数据会与现有数据合并，方便查看全部功能。')) { state = mergeStates(state, demoState()); persist(true); renderAll(); toast('演示数据已载入'); } });
    $('resetData').addEventListener('click', async () => { if (await ask('清空全部数据', '系统会先下载备份，然后清空所有统计记录。')) { exportJson(true); state = normalizeState(DEFAULT_STATE); persist(true); renderAll(); toast('全部数据已清空'); } });
    $('editRecordType').addEventListener('change', e => fillCategorySelect($('editRecordCategory'), e.target.value));
    window.addEventListener('resize', debounce(renderCharts, 120));
  }
  function bindDialogForms() {
    $('habitForm').addEventListener('submit', e => { e.preventDefault(); if (e.submitter?.value === 'cancel') return $('habitDialog').close(); const id = $('habitId').value; mutate(id ? '习惯已更新' : '习惯已创建', s => { const data = { id: id || uid('habit'), name: $('habitName').value.trim(), target: num($('habitTarget').value, 1), unit: $('habitUnit').value.trim() || '次', color: $('habitColor').value, createdAt: id ? (s.habits.find(h => String(h.id) === id)?.createdAt || localDate()) : localDate() }; if (id) s.habits = s.habits.map(h => String(h.id) === id ? data : h); else s.habits.push(data); }); $('habitDialog').close(); });
    $('goalForm').addEventListener('submit', e => { e.preventDefault(); if (e.submitter?.value === 'cancel') return $('goalDialog').close(); mutate('目标已创建', s => s.goals.push({ id: uid('goal'), title: $('goalTitle').value.trim(), target: num($('goalTarget').value), current: num($('goalCurrent').value), unit: $('goalUnit').value.trim(), deadline: $('goalDeadline').value })); $('goalDialog').close(); });
    $('metricForm').addEventListener('submit', e => { e.preventDefault(); if (e.submitter?.value === 'cancel') return $('metricDialog').close(); mutate('自定义指标已添加', s => s.customMetrics.push({ id: uid('metric'), name: $('metricName').value.trim(), unit: $('metricUnit').value.trim(), target: num($('metricTarget').value), color: $('metricColor').value })); $('metricDialog').close(); });
    $('budgetForm').addEventListener('submit', e => { e.preventDefault(); if (e.submitter?.value === 'cancel') return $('budgetDialog').close(); mutate('预算已保存', s => { const next = {}; $$('[data-budget]').forEach(input => { if (num(input.value) > 0) next[input.dataset.budget] = num(input.value); }); s.budgets[financeMonth] = next; }); $('budgetDialog').close(); });
    $('recordEditForm').addEventListener('submit', e => { e.preventDefault(); if (e.submitter?.value === 'cancel') return $('recordDialog').close(); const id = $('editRecordId').value; mutate('收支记录已更新', s => { const r = s.finance.find(x => String(x.id) === id); if (r) Object.assign(r, { type: $('editRecordType').value, amount: num($('editRecordAmount').value), date: $('editRecordDate').value, category: $('editRecordCategory').value, note: $('editRecordNote').value.trim() }); }); $('recordDialog').close(); });
    $('deleteRecord').addEventListener('click', async () => { const id = $('editRecordId').value; if (!await ask('删除收支记录', '这笔记录将从统计中移除。')) return; mutate('收支记录已删除', s => { s.finance = s.finance.filter(r => String(r.id) !== id); }); $('recordDialog').close(); });
  }
  function debounce(fn, delay) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; }

  function init() {
    $('financeDate').value = selectedDate;
    $('taskDate').value = selectedDate;
    $('financeMonth').value = financeMonth;
    bindEvents();
    bindDialogForms();
    applyTheme(state.settings.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    renderAll();
    hydrate();
    setTimeout(refreshIcons, 700);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
