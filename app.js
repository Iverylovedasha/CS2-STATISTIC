const config = window.CS2_SCOPE_CONFIG ?? { apiBase: '' };
const apiBase = String(config.apiBase ?? '').replace(/\/$/, '');
const endpoint = `${apiBase}/v1/profile`;
const formatter = new Intl.NumberFormat('ru-RU');
const dateFormatter = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

const dom = {
  form: document.querySelector('#search-form'),
  query: document.querySelector('#player-query'),
  inventory: document.querySelector('#inventory-toggle'),
  submit: document.querySelector('#search-button'),
  feedback: document.querySelector('#form-feedback'),
  results: document.querySelector('#results'),
  notices: document.querySelector('#notices'),
  avatar: document.querySelector('#profile-avatar'),
  avatarFallback: document.querySelector('#avatar-fallback'),
  profileName: document.querySelector('#profile-name'),
  country: document.querySelector('#profile-country'),
  steamLink: document.querySelector('#steam-link'),
  visibility: document.querySelector('#profile-visibility'),
  updated: document.querySelector('#updated-at'),
  matches: document.querySelector('#metric-matches'),
  winRate: document.querySelector('#metric-winrate'),
  wins: document.querySelector('#metric-wins'),
  kd: document.querySelector('#metric-kd'),
  kills: document.querySelector('#metric-kills'),
  level: document.querySelector('#metric-level'),
  elo: document.querySelector('#metric-elo'),
  playtime: document.querySelector('#metric-playtime'),
  levelNote: document.querySelector('#faceit-level-note'),
  matchesBody: document.querySelector('#matches-body'),
  matchesEmpty: document.querySelector('#matches-empty'),
  inventorySection: document.querySelector('#inventory-section'),
  inventoryCount: document.querySelector('#inventory-count'),
  inventoryGrid: document.querySelector('#inventory-grid'),
  inventoryEmpty: document.querySelector('#inventory-empty'),
  dataNote: document.querySelector('#data-note')
};

dom.form.addEventListener('submit', (event) => {
  event.preventDefault();
  search(dom.query.value);
});

document.querySelectorAll('[data-example]').forEach((button) => {
  button.addEventListener('click', () => {
    dom.query.value = button.dataset.example;
    dom.query.focus();
  });
});

const sharedQuery = new URLSearchParams(window.location.search).get('player');
if (sharedQuery) {
  dom.query.value = sharedQuery;
  search(sharedQuery, false);
}

async function search(rawQuery, shouldUpdateUrl = true) {
  const query = rawQuery.trim();
  if (!query) {
    setFeedback('Введите Steam ID, ссылку на профиль или никнейм FACEIT.', 'error');
    dom.query.focus();
    return;
  }

  setLoading(true);
  setFeedback('Ищем профиль и запрашиваем доступные данные…', 'loading');
  try {
    const params = new URLSearchParams({ query });
    if (dom.inventory.checked) params.set('inventory', '1');
    const response = await fetch(`${endpoint}?${params}`, { headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || 'Сервер вернул некорректный ответ.');
    renderDashboard(payload);
    setFeedback('', '');
    if (shouldUpdateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('player', query);
      window.history.replaceState({}, '', url);
    }
  } catch (error) {
    const startupHint = !apiBase && window.location.protocol === 'file:'
      ? 'Откройте сайт через веб-сервер и настройте API в config.js.'
      : error.message || 'Не удалось получить данные.';
    setFeedback(startupHint, 'error');
  } finally {
    setLoading(false);
  }
}

function renderDashboard(data) {
  const profile = data.profile ?? {};
  const faceit = data.faceit;
  const summary = faceit?.summary ?? {};
  const inventory = data.steam?.inventory;

  dom.profileName.textContent = profile.name || 'Игрок CS2';
  dom.avatarFallback.textContent = (profile.name || '?').trim().slice(0, 1).toUpperCase() || '?';
  setAvatar(profile.avatar, profile.name || 'Аватар игрока');
  setTextOrHide(dom.country, profile.country ? profile.country.toUpperCase() : null);
  setLinkOrHide(dom.steamLink, profile.profileUrl);
  dom.visibility.textContent = profile.visibility === 'public' ? 'Steam public' : 'частичные данные';
  dom.updated.textContent = formatDate(data.queriedAt);

  dom.matches.textContent = formatNumber(summary.matches);
  dom.winRate.textContent = summary.winRate === null || summary.winRate === undefined ? '—' : `${formatDecimal(summary.winRate)}%`;
  dom.wins.textContent = summary.wins === null || summary.wins === undefined ? 'победы / матчи' : `${formatNumber(summary.wins)} побед · ${formatNumber(summary.matches)} матчей`;
  dom.kd.textContent = formatDecimal(summary.kd);
  dom.kills.textContent = summary.kills === null || summary.kills === undefined ? 'убийства / смерти' : `${formatNumber(summary.kills)} / ${formatNumber(summary.deaths)}`;
  dom.level.textContent = faceit?.level ? `LVL ${faceit.level}` : '—';
  dom.elo.textContent = faceit?.elo ? `${formatNumber(faceit.elo)} Elo` : 'FACEIT Elo';
  dom.playtime.textContent = formatDuration(data.steam?.playtimeMinutes);
  dom.levelNote.textContent = faceit
    ? `Профиль FACEIT: ${faceit.nickname || 'связан с аккаунтом'}.`
    : 'FACEIT-профиль не найден — игровые метрики недоступны.';

  renderNotices(data.notices ?? []);
  renderMatches(faceit?.matches ?? []);
  renderInventory(inventory);
  dom.dataNote.textContent = data.sources?.limitation || 'Источник показателей указан рядом с каждой метрикой.';
  dom.results.classList.remove('hidden');
}

function renderNotices(notices) {
  dom.notices.replaceChildren();
  for (const notice of notices) {
    const element = document.createElement('p');
    element.className = `notice ${notice.level === 'info' ? 'info' : ''}`;
    element.textContent = notice.message;
    dom.notices.append(element);
  }
}

function renderMatches(matches) {
  dom.matchesBody.replaceChildren();
  dom.matchesEmpty.hidden = matches.length > 0;
  for (const match of matches) {
    const row = document.createElement('tr');
    row.append(
      tableCell(match.map || '—', 'map-name'),
      resultCell(match.result),
      tableCell(match.score || '—'),
      tableCell([match.kills, match.deaths, match.assists].every((value) => value === null || value === undefined) ? '—' : `${formatNumber(match.kills)} / ${formatNumber(match.deaths)} / ${formatNumber(match.assists)}`),
      tableCell(formatDecimal(match.kd)),
      tableCell(formatDate(match.finishedAt, true))
    );
    dom.matchesBody.append(row);
  }
}

function renderInventory(inventory) {
  const hasResponse = Boolean(inventory);
  dom.inventorySection.hidden = !hasResponse;
  dom.inventoryGrid.replaceChildren();
  dom.inventoryEmpty.hidden = !hasResponse || inventory.items?.length > 0;
  if (!hasResponse) return;

  dom.inventoryCount.textContent = inventory.total === null || inventory.total === undefined ? '' : `(${formatNumber(inventory.total)})`;
  for (const item of inventory.items ?? []) {
    const card = document.createElement('article');
    card.className = 'inventory-item';
    card.title = item.name || '';
    const visual = document.createElement('div');
    visual.className = 'item-visual';
    if (isSafeHttpUrl(item.icon)) {
      const image = document.createElement('img');
      image.src = item.icon;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => image.remove());
      visual.append(image);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'item-no-image';
      fallback.textContent = 'CS2';
      visual.append(fallback);
    }
    const name = document.createElement('strong');
    name.className = 'item-name';
    name.textContent = item.name || 'Предмет без названия';
    const type = document.createElement('small');
    type.className = 'item-type';
    type.textContent = [item.rarity, item.type].filter(Boolean).join(' · ') || 'Предмет Steam';
    card.append(visual, name, type);
    dom.inventoryGrid.append(card);
  }
}

function resultCell(result) {
  const cell = document.createElement('td');
  const badge = document.createElement('span');
  const safeResult = ['win', 'loss'].includes(result) ? result : 'unknown';
  badge.className = `result-pill ${safeResult}`;
  badge.textContent = safeResult === 'win' ? 'Победа' : safeResult === 'loss' ? 'Поражение' : 'Нет данных';
  cell.append(badge);
  return cell;
}

function tableCell(value, className = '') {
  const cell = document.createElement('td');
  cell.className = className;
  cell.textContent = value;
  return cell;
}

function setAvatar(url, alt) {
  if (!isSafeHttpUrl(url)) {
    dom.avatar.hidden = true;
    dom.avatarFallback.hidden = false;
    return;
  }
  dom.avatar.alt = alt;
  dom.avatar.src = url;
  dom.avatar.hidden = false;
  dom.avatarFallback.hidden = true;
  dom.avatar.onerror = () => {
    dom.avatar.hidden = true;
    dom.avatarFallback.hidden = false;
  };
}

function setLinkOrHide(element, url) {
  if (!isSafeHttpUrl(url)) {
    element.hidden = true;
    element.removeAttribute('href');
    return;
  }
  element.href = url;
  element.hidden = false;
}

function setTextOrHide(element, value) {
  element.hidden = !value;
  element.textContent = value || '';
}

function isSafeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function setLoading(loading) {
  dom.submit.disabled = loading;
  dom.submit.querySelector('span').textContent = loading ? 'Загрузка…' : 'Найти игрока';
}

function setFeedback(message, className) {
  dom.feedback.textContent = message;
  dom.feedback.className = `form-feedback ${className}`;
}

function formatNumber(value) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : formatter.format(Number(value));
}

function formatDecimal(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value));
}

function formatDuration(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) return '—';
  const hours = Math.floor(Number(minutes) / 60);
  return `${formatter.format(hours)} ч`;
}

function formatDate(value, dateOnly = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateOnly ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(date) : dateFormatter.format(date);
}
