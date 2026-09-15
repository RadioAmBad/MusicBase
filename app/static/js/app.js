const state = {
  folder: '',
  search: '',
  genre: '',
  year: '',
  sort: 'artist',
  order: 'asc',
  page: 1,
  perPage: 100,
  total: 0,
  songs: [],
  selected: new Set(),
  expandedFolders: new Set(),
  specialView: null, // null | {type: 'artist'|'genre', value: string}
  lastClickedIndex: null,
};

const el = (id) => document.getElementById(id);

// ------------------------------------------------------------------ //
// Toast
// ------------------------------------------------------------------ //
let toastTimer = null;
function showToast(message, isError = false) {
  const toast = el('toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
}

// ------------------------------------------------------------------ //
// API-Helfer
// ------------------------------------------------------------------ //
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Anfrage fehlgeschlagen (${res.status})`);
  }
  return res.json();
}

// ------------------------------------------------------------------ //
// Ordner laden — als Explorer-artiger, klappbarer Baum
// ------------------------------------------------------------------ //
const ICON_FOLDER_CLOSED = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6a2 2 0 0 1 2-2h4.5l2 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
const ICON_FOLDER_OPEN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a2 2 0 0 1 2-2h4.5l2 2H19a2 2 0 0 1 2 2H5.5a1.5 1.5 0 0 0-1.46 1.16L2.5 16.5V7z"/><path d="M2.5 16.5 4.04 10.16A1.5 1.5 0 0 1 5.5 9H21l-1.8 8.19A2 2 0 0 1 17.25 19H4.6a2 2 0 0 1-2-2.4z"/></svg>`;
const ICON_CHEVRON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 6 15 12 9 18"/></svg>`;

function buildFolderTree(folders) {
  // folders: [{raw: "2010er/sub", count: N}, ...] -> verschachtelter Baum,
  // Zähler werden für übergeordnete Ordner aus den Kindern aufsummiert.
  const root = { name: '', path: '', ownCount: 0, children: {} };

  folders.forEach((f) => {
    if (f.raw === '') { root.ownCount += f.count; return; }
    const parts = f.raw.split('/');
    let node = root;
    let acc = '';
    parts.forEach((part, idx) => {
      acc = acc ? `${acc}/${part}` : part;
      if (!node.children[part]) {
        node.children[part] = { name: part, path: acc, ownCount: 0, children: {} };
      }
      node = node.children[part];
      if (idx === parts.length - 1) node.ownCount += f.count;
    });
  });

  function totalCount(node) {
    let sum = node.ownCount;
    Object.values(node.children).forEach((child) => { sum += totalCount(child); });
    return sum;
  }
  return { root, totalCount };
}

function renderFolderNode(node, totalCountFn, depth) {
  const hasChildren = Object.keys(node.children).length > 0;
  const isExpanded = state.expandedFolders.has(node.path);
  const isActive = state.folder === node.path;
  const count = totalCountFn(node);

  const row = document.createElement('div');
  row.className = 'folder-node-row' + (isActive ? ' active' : '');
  row.innerHTML = `
    <span class="folder-chevron ${hasChildren ? '' : 'no-children'} ${isExpanded ? 'expanded' : ''}">${ICON_CHEVRON}</span>
    <span class="folder-icon">${isExpanded ? ICON_FOLDER_OPEN : ICON_FOLDER_CLOSED}</span>
    <span class="folder-node-name">${escapeHtml(node.name)}</span>
    <span class="folder-node-count">${count}</span>
  `;

  row.querySelector('.folder-node-name').addEventListener('click', () => selectFolder(node.path));
  row.querySelector('.folder-node-count').addEventListener('click', () => selectFolder(node.path));
  row.querySelector('.folder-icon').addEventListener('click', () => selectFolder(node.path));

  const chevron = row.querySelector('.folder-chevron');
  if (hasChildren) {
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isExpanded) state.expandedFolders.delete(node.path);
      else state.expandedFolders.add(node.path);
      loadFolders();
    });
  }

  const wrapper = document.createElement('div');
  wrapper.appendChild(row);

  if (hasChildren && isExpanded) {
    const childWrap = document.createElement('div');
    childWrap.className = 'folder-children';
    Object.values(node.children)
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
      .forEach((child) => childWrap.appendChild(renderFolderNode(child, totalCountFn, depth + 1)));
    wrapper.appendChild(childWrap);
  }

  return wrapper;
}

async function loadFolders() {
  const data = await api('/api/folders');
  el('totalCount').textContent = data.total;

  const tree = el('folderTree');
  tree.innerHTML = '';

  const allItem = document.createElement('div');
  allItem.className = 'folder-all' + (state.folder === '' ? ' active' : '');
  allItem.innerHTML = `<span class="folder-node-name">Alle Titel</span><span class="fcount">${data.total}</span>`;
  allItem.onclick = () => selectFolder('');
  tree.appendChild(allItem);

  const divider = document.createElement('div');
  divider.className = 'folder-tree-divider';
  tree.appendChild(divider);

  const { root, totalCount } = buildFolderTree(data.folders);
  Object.values(root.children)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .forEach((child) => tree.appendChild(renderFolderNode(child, totalCount, 0)));
}

function selectFolder(raw) {
  if (state.specialView) closeSpecialView({ skipReload: true });
  state.folder = raw;
  state.page = 1;
  loadFolders();
  loadSongs();
  closeMobileMenus(); // auf Mobile: Ordnerauswahl schließt die Schublade automatisch
}

// ------------------------------------------------------------------ //
// Interpreten-/Genre-Ansicht
// ------------------------------------------------------------------ //
function openSpecialView(type, value, opts = {}) {
  state.specialView = { type, value };
  state.page = 1;
  state.selected.clear();
  updateSelectionBar();

  el('viewHeader').style.display = 'flex';
  el('viewHeaderLabel').textContent = type === 'artist' ? 'Interpret' : 'Genre';
  el('viewHeaderName').textContent = value;

  if (!opts.skipHistory) {
    const path = `/${type === 'artist' ? 'artists' : 'genres'}/${encodeURIComponent(value)}`;
    history.pushState({ specialView: { type, value } }, '', path);
  }

  if (!opts.skipReload) loadSongs();
}

function closeSpecialView(opts = {}) {
  state.specialView = null;
  state.page = 1;
  el('viewHeader').style.display = 'none';
  if (!opts.skipHistory && location.pathname !== '/') {
    history.pushState({ specialView: null }, '', '/');
  }
  if (!opts.skipReload) loadSongs();
}

// Liest die aktuelle URL (/artists/xxx, /genres/yyy oder /) und bringt die
// Ansicht in den passenden Zustand, OHNE einen neuen History-Eintrag zu
// erzeugen (wird beim initialen Laden und bei popstate/Browser-Zurück genutzt).
function applyViewFromLocation() {
  const path = decodeURIComponent(location.pathname);
  const artistMatch = path.match(/^\/artists\/(.+)$/);
  const genreMatch = path.match(/^\/genres\/(.+)$/);

  if (artistMatch) {
    openSpecialView('artist', artistMatch[1], { skipHistory: true, skipReload: true });
  } else if (genreMatch) {
    openSpecialView('genre', genreMatch[1], { skipHistory: true, skipReload: true });
  } else {
    closeSpecialView({ skipHistory: true, skipReload: true });
  }
}

// ------------------------------------------------------------------ //
// Facetten (Genre/Jahr-Dropdowns)
// ------------------------------------------------------------------ //
async function loadFacets() {
  const data = await api('/api/facets');
  const genreSel = el('genreFilter');
  const yearSel = el('yearFilter');
  genreSel.innerHTML = '<option value="">Alle Genres</option>' +
    data.genres.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  yearSel.innerHTML = '<option value="">Alle Jahre</option>' +
    data.years.map((y) => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('');
}

// ------------------------------------------------------------------ //
// Songs laden + rendern
// ------------------------------------------------------------------ //
async function loadSongs() {
  const params = new URLSearchParams({
    search: state.search,
    sort: state.sort,
    order: state.order,
    page: state.page,
    per_page: state.perPage,
  });

  if (state.specialView) {
    params.set(state.specialView.type === 'artist' ? 'artist_is' : 'genre_is', state.specialView.value);
  } else {
    params.set('folder', state.folder);
    params.set('genre', state.genre);
    params.set('year', state.year);
  }

  const data = await api(`/api/songs?${params}`);
  state.songs = data.songs;
  state.total = data.total;
  renderTable();
  renderPagination();
}

function renderChips(value, kind) {
  if (!value) return '<span style="color:var(--text-muted)">—</span>';
  // Beim Interpret werden zusätzlich zu "," auch ";" und "/" als Trenner
  // erkannt (z.B. "A7S/David Guetta/Wizkid" oder "x;y").
  const splitRegex = kind === 'artist' ? /\s*[,;/]\s*/ : /\s*,\s*/;
  const parts = value.split(splitRegex).map((p) => p.trim()).filter(Boolean);
  return parts
    .map((p) => `<span class="chip-link" data-kind="${kind}" data-value="${escapeAttr(p)}">${escapeHtml(p)}</span>`)
    .join(', ');
}

function renderTable() {
  const body = el('songTableBody');
  if (state.songs.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="9">Keine Titel gefunden.</td></tr>`;
    return;
  }
  const showFolderPrefix = state.folder === '' || !!state.specialView;

  body.innerHTML = state.songs.map((s) => {
    const displayFile = showFolderPrefix && s.folder ? `${s.folder}/${s.filename}` : s.filename;
    const isPlaying = state.nowPlaying === s.path;
    return `
    <tr data-path="${escapeAttr(s.path)}" class="${state.selected.has(s.path) ? 'selected' : ''} ${isPlaying ? 'now-playing' : ''}">
      <td class="col-check"><input type="checkbox" class="row-check custom-checkbox" ${state.selected.has(s.path) ? 'checked' : ''}></td>
      <td class="col-play">
        <button class="row-play-btn ${isPlaying && !audioEl.paused ? 'playing' : ''}" data-path="${escapeAttr(s.path)}" title="Abspielen">
          <svg class="icon-play" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <svg class="icon-pause" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="display:none"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>
        </button>
      </td>
      <td>${renderChips(s.artist, 'artist')}</td>
      <td>${escapeHtml(s.title)}</td>
      <td>${escapeHtml(s.album)}</td>
      <td>${renderChips(s.genre, 'genre')}</td>
      <td class="col-num">${escapeHtml(s.year)}</td>
      <td class="col-num">${formatDuration(s.duration)}</td>
      <td class="col-file">${escapeHtml(displayFile)}</td>
    </tr>
  `;
  }).join('');

  body.querySelectorAll('tr').forEach((row) => {
    const path = row.dataset.path;
    const checkbox = row.querySelector('.row-check');

    checkbox.addEventListener('change', () => {
      toggleSelect(path, checkbox.checked, row);
      state.lastClickedIndex = state.songs.findIndex((s) => s.path === path);
    });

    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-play-btn') || e.target.closest('.chip-link') || e.target.tagName === 'INPUT') return;
      handleRowClick(path, e);
    });
  });

  body.querySelectorAll('.row-play-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlayForPath(btn.dataset.path);
    });
  });

  body.querySelectorAll('.chip-link').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      openSpecialView(chip.dataset.kind, chip.dataset.value);
    });
  });

  syncPlayButtonsUI();
}

// Auswahl per Klick wie im Windows Explorer: normaler Klick wählt nur
// diese Zeile aus, Strg/Cmd-Klick toggelt einzelne Zeilen dazu, Shift
// wählt einen Bereich ab der zuletzt angeklickten Zeile.
function handleRowClick(path, e) {
  const idx = state.songs.findIndex((s) => s.path === path);

  if (e.shiftKey && state.lastClickedIndex !== null) {
    const [start, end] = [state.lastClickedIndex, idx].sort((a, b) => a - b);
    for (let i = start; i <= end; i++) state.selected.add(state.songs[i].path);
  } else if (e.ctrlKey || e.metaKey) {
    if (state.selected.has(path)) state.selected.delete(path);
    else state.selected.add(path);
    state.lastClickedIndex = idx;
  } else {
    state.selected.clear();
    state.selected.add(path);
    state.lastClickedIndex = idx;
  }

  renderTable();
  updateSelectionBar();
}

function formatDuration(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function renderPagination() {
  const totalPages = Math.max(Math.ceil(state.total / state.perPage), 1);
  el('pageInfo').textContent = `Seite ${state.page} von ${totalPages} · ${state.total} Titel`;
  el('prevPage').disabled = state.page <= 1;
  el('nextPage').disabled = state.page >= totalPages;

  const onlyOnePage = totalPages <= 1;
  el('prevPage').style.display = onlyOnePage ? 'none' : 'inline-flex';
  el('nextPage').style.display = onlyOnePage ? 'none' : 'inline-flex';
}

// ------------------------------------------------------------------ //
// Auswahl
// ------------------------------------------------------------------ //
function toggleSelect(path, checked, row) {
  if (checked) {
    state.selected.add(path);
    row.classList.add('selected');
  } else {
    state.selected.delete(path);
    row.classList.remove('selected');
  }
  updateSelectionBar();
}

function updateSelectionBar() {
  const bar = el('selectionBar');
  const count = state.selected.size;
  bar.classList.toggle('visible', count > 0);
  el('selectionCount').textContent = `${count} ausgewählt`;
}

function clearSelectionState() {
  state.selected.clear();
  document.querySelectorAll('.row-check').forEach((c) => (c.checked = false));
  document.querySelectorAll('.song-table tbody tr').forEach((r) => r.classList.remove('selected'));
  el('selectAll').checked = false;
  updateSelectionBar();
}

// ------------------------------------------------------------------ //
// Bestätigungsdialog (generisch, für alle bestätigungspflichtigen Aktionen)
// ------------------------------------------------------------------ //
function confirmAction(title, body, okLabel = 'Bestätigen', danger = false) {
  return new Promise((resolve) => {
    el('confirmTitle').textContent = title;
    el('confirmBody').textContent = body;
    const okBtn = el('confirmOk');
    okBtn.textContent = okLabel;
    okBtn.classList.toggle('btn-danger', danger);
    okBtn.classList.toggle('btn-accent', !danger);
    el('confirmDialog').classList.add('visible');
    el('confirmOverlay').classList.add('visible');

    const cleanup = (result) => {
      el('confirmDialog').classList.remove('visible');
      el('confirmOverlay').classList.remove('visible');
      el('confirmOk').removeEventListener('click', onOk);
      el('confirmCancel').removeEventListener('click', onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    el('confirmOk').addEventListener('click', onOk);
    el('confirmCancel').addEventListener('click', onCancel);
  });
}

// ------------------------------------------------------------------ //
// Tag-Editor-Panel
// ------------------------------------------------------------------ //
function openTagPanel() {
  el('tagPanelHint').textContent = `${state.selected.size} Titel ausgewählt`;
  el('tagForm').reset();
  el('tagPanel').classList.add('visible');
  el('panelOverlay').classList.add('visible');
}

function closeTagPanel() {
  el('tagPanel').classList.remove('visible');
  el('panelOverlay').classList.remove('visible');
}

async function submitTagForm(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  const fields = {};
  for (const [key, value] of formData.entries()) {
    if (value.trim() !== '') fields[key] = value.trim();
  }
  if (Object.keys(fields).length === 0) {
    showToast('Bitte mindestens ein Feld ausfüllen.', true);
    return;
  }
  try {
    const result = await api('/api/tags/bulk', {
      method: 'POST',
      body: JSON.stringify({ paths: [...state.selected], fields }),
    });
    showToast(`Tags für ${result.updated.length} Titel gespeichert.` + (result.errors.length ? ` ${result.errors.length} Fehler.` : ''), result.errors.length > 0);
    closeTagPanel();
    await Promise.all([loadSongs(), loadFacets()]);
  } catch (err) {
    showToast(err.message, true);
  }
}

// ------------------------------------------------------------------ //
// Dateinamen fixen
// ------------------------------------------------------------------ //
async function handleRename() {
  const ok = await confirmAction(
    'Dateinamen anpassen?',
    `${state.selected.size} ausgewählte Dateien werden nach dem Schema "Interpret - Titel" umbenannt.`,
    'Umbenennen'
  );
  if (!ok) return;
  try {
    const result = await api('/api/rename', {
      method: 'POST',
      body: JSON.stringify({ paths: [...state.selected] }),
    });
    const renamed = result.results.filter((r) => !r.skipped).length;
    showToast(`${renamed} Datei(en) umbenannt.`);
    clearSelectionState();
    await Promise.all([loadFolders(), loadSongs()]);
  } catch (err) {
    showToast(err.message, true);
  }
}

// ------------------------------------------------------------------ //
// Titel bereinigen
// ------------------------------------------------------------------ //
async function handleCleanTitles() {
  const ok = await confirmAction(
    'Titel bereinigen?',
    `Bei ${state.selected.size} ausgewählten Titeln werden Zusätze wie "Remastered", "Radio Edit" o.ä. entfernt.`,
    'Bereinigen'
  );
  if (!ok) return;
  try {
    const result = await api('/api/clean-titles', {
      method: 'POST',
      body: JSON.stringify({ paths: [...state.selected] }),
    });
    const changed = result.results.filter((r) => r.changed).length;
    showToast(`${changed} Titel bereinigt.`);
    await loadSongs();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ------------------------------------------------------------------ //
// Interpret bereinigen (einheitliche Trennung mit ", ")
// ------------------------------------------------------------------ //
async function handleCleanArtists() {
  const ok = await confirmAction(
    'Interpret bereinigen?',
    `Bei ${state.selected.size} ausgewählten Titeln werden Trenner wie ";" oder "/" im Interpret-Tag durch ", " ersetzt.`,
    'Bereinigen'
  );
  if (!ok) return;
  try {
    const result = await api('/api/clean-artists', {
      method: 'POST',
      body: JSON.stringify({ paths: [...state.selected] }),
    });
    const changed = result.results.filter((r) => r.changed).length;
    showToast(`${changed} Interpret-Tag(s) bereinigt.`);
    await loadSongs();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ------------------------------------------------------------------ //
// Löschen
// ------------------------------------------------------------------ //
async function handleDelete() {
  const ok = await confirmAction(
    'Titel endgültig löschen?',
    `${state.selected.size} Datei(en) werden unwiderruflich aus der Cloud gelöscht. Das kann nicht rückgängig gemacht werden.`,
    'Löschen',
    true
  );
  if (!ok) return;
  try {
    const result = await api('/api/delete', {
      method: 'POST',
      body: JSON.stringify({ paths: [...state.selected] }),
    });
    showToast(`${result.deleted.length} Titel gelöscht.` + (result.errors.length ? ` ${result.errors.length} Fehler.` : ''), result.errors.length > 0);
    clearSelectionState();
    await Promise.all([loadFolders(), loadSongs()]);
  } catch (err) {
    showToast(err.message, true);
  }
}

// ------------------------------------------------------------------ //
// Scan (Hintergrund-Prozess mit Fortschrittsanzeige)
// ------------------------------------------------------------------ //
let scanPollTimer = null;
let lastRenderedScanCount = -1;

async function handleScan() {
  try {
    const result = await api('/api/scan/start', { method: 'POST' });
    if (!result.started) {
      showToast(result.reason || 'Es läuft bereits ein Scan.', true);
      return;
    }
    el('scanBtn').disabled = true;
    el('scanStatus').style.display = 'flex';
    lastRenderedScanCount = -1;
    pollScanStatus();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleCancelScan() {
  try {
    await api('/api/scan/cancel', { method: 'POST' });
    showToast('Scan wird abgebrochen …');
  } catch (err) {
    showToast(err.message, true);
  }
}

function pollScanStatus() {
  clearTimeout(scanPollTimer);
  const poll = async () => {
    let status;
    try {
      status = await api('/api/scan/status');
    } catch (err) {
      scanPollTimer = setTimeout(poll, 1500);
      return;
    }

    renderScanStatus(status);

    // Während des Scans bereits eingelesene Titel + Ordnerzahlen laufend
    // nachladen, aber nur wenn sich seit dem letzten Rendern wirklich was
    // getan hat -> spart unnötige Reloads.
    if (status.scanned !== lastRenderedScanCount && (status.status === 'running' || status.status === 'counting')) {
      lastRenderedScanCount = status.scanned;
      loadFolders();
      loadSongs();
    }

    if (status.status === 'running' || status.status === 'counting') {
      scanPollTimer = setTimeout(poll, 1200);
      return;
    }

    // Scan fertig, abgebrochen oder fehlgeschlagen
    finishScanUI(status);
  };
  poll();
}

function renderScanStatus(status) {
  const label = el('scanStatusText');
  const bar = el('scanProgressBar');

  if (status.status === 'counting') {
    label.textContent = 'Zähle Dateien …';
    bar.style.width = '5%';
    return;
  }

  const total = status.total_found || 0;
  const pct = total > 0 ? Math.min(100, Math.round((status.scanned / total) * 100)) : 0;
  bar.style.width = `${pct}%`;
  label.textContent = `${status.scanned} / ${total} Titel · +${status.added} neu · ${status.updated} aktualisiert`;
}

async function finishScanUI(status) {
  clearTimeout(scanPollTimer);
  el('scanBtn').disabled = false;
  el('scanStatus').style.display = 'none';

  if (status.status === 'done') {
    showToast(`Scan fertig: +${status.added} neu, ${status.updated} aktualisiert, -${status.removed} entfernt.`);
  } else if (status.status === 'cancelled') {
    showToast(`Scan abgebrochen bei ${status.scanned} von ${status.total_found} Titeln. Bereits gescannte Titel bleiben im Index.`);
  } else if (status.status === 'error') {
    showToast(`Scan-Fehler: ${status.error}`, true);
  }

  await Promise.all([loadFolders(), loadFacets(), loadSongs()]);
}

// Falls die Seite neu geladen wird, während im Hintergrund noch ein Scan
// läuft (z.B. weil ein zweiter Tab offen ist) -> Fortschrittsanzeige wieder aufnehmen.
async function resumeScanUiIfRunning() {
  try {
    const status = await api('/api/scan/status');
    if (status.status === 'running' || status.status === 'counting') {
      el('scanBtn').disabled = true;
      el('scanStatus').style.display = 'flex';
      pollScanStatus();
    }
  } catch (err) { /* ignorieren */ }
}

// ------------------------------------------------------------------ //
// AzuraCast
// ------------------------------------------------------------------ //

async function handleAzuraCastSync() {
  const btn = el('azuracastBtn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Synchronisiere …';
  try {
    await api('/api/azuracast/rescan', { method: 'POST' });
    showToast('AzuraCast wurde zum Neu-Einlesen angestoßen.');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ------------------------------------------------------------------ //
// Mobile Menüs (Ordner-Schublade + Such-/Filter-Dropdown)
// ------------------------------------------------------------------ //
function closeMobileMenus() {
  document.documentElement.classList.remove('mobile-sidebar-open', 'mobile-controls-open');
  el('mobileOverlay').classList.remove('visible');
}

function initMobileMenus() {
  el('mobileSidebarBtn').addEventListener('click', () => {
    const isOpen = document.documentElement.classList.contains('mobile-sidebar-open');
    closeMobileMenus();
    if (!isOpen) {
      document.documentElement.classList.add('mobile-sidebar-open');
      el('mobileOverlay').classList.add('visible');
    }
  });

  el('mobileControlsBtn').addEventListener('click', () => {
    const isOpen = document.documentElement.classList.contains('mobile-controls-open');
    closeMobileMenus();
    if (!isOpen) {
      document.documentElement.classList.add('mobile-controls-open');
      el('mobileOverlay').classList.add('visible');
    }
  });

  el('mobileOverlay').addEventListener('click', closeMobileMenus);
}

// ------------------------------------------------------------------ //
// Sidebar ein-/ausklappen
// ------------------------------------------------------------------ //
function initSidebarToggle() {
  el('sidebarToggle').addEventListener('click', () => {
    const collapsed = document.documentElement.classList.toggle('sidebar-collapsed');
    localStorage.setItem('musikinterface-sidebar-collapsed', collapsed ? '1' : '0');
  });
}

// ------------------------------------------------------------------ //
// Theme (Hell/Dunkel)
// ------------------------------------------------------------------ //
function initTheme() {
  el('themeToggle').addEventListener('click', () => {
    const html = document.documentElement;
    const isLight = html.getAttribute('data-theme') === 'light';
    const next = isLight ? 'dark' : 'light';
    html.setAttribute('data-theme', next);
    localStorage.setItem('musikinterface-theme', next);
  });
}

// ------------------------------------------------------------------ //
// Audio-Player
// ------------------------------------------------------------------ //
const audioEl = el('audioEl');
state.nowPlaying = null; // Pfad des aktuell geladenen Titels

function findSongByPath(path) {
  return state.songs.find((s) => s.path === path) || null;
}

function playPath(path) {
  const song = findSongByPath(path);
  if (!song) return;

  if (state.nowPlaying !== path) {
    state.nowPlaying = path;
    audioEl.src = `/api/stream/${path.split('/').map(encodeURIComponent).join('/')}`;
    el('playerTitle').textContent = song.title || song.filename;
    el('playerArtist').textContent = song.artist || 'Unbekannter Interpret';
    el('playerBar').classList.add('visible');
    document.body.classList.add('has-player');
  }
  audioEl.play();
}

function pausePlayback() {
  audioEl.pause();
}

function togglePlayForPath(path) {
  if (state.nowPlaying === path && !audioEl.paused) {
    pausePlayback();
  } else {
    playPath(path);
  }
}

function playAdjacent(direction) {
  // "direction": 1 = nächster, -1 = vorheriger — innerhalb der aktuell
  // geladenen (gefilterten/sortierten) Seite der Titelliste.
  if (!state.songs.length) return;
  const currentIndex = state.songs.findIndex((s) => s.path === state.nowPlaying);
  let nextIndex;
  if (currentIndex === -1) {
    nextIndex = direction === 1 ? 0 : state.songs.length - 1;
  } else {
    nextIndex = currentIndex + direction;
  }
  if (nextIndex < 0 || nextIndex >= state.songs.length) return; // Ende der Seite erreicht
  playPath(state.songs[nextIndex].path);
}

function syncPlayButtonsUI() {
  document.querySelectorAll('.row-play-btn').forEach((btn) => {
    const isCurrent = btn.dataset.path === state.nowPlaying;
    const playing = isCurrent && !audioEl.paused;
    btn.classList.toggle('playing', playing);
    btn.querySelector('.icon-play').style.display = playing ? 'none' : 'block';
    btn.querySelector('.icon-pause').style.display = playing ? 'block' : 'none';
  });
  document.querySelectorAll('.song-table tbody tr').forEach((row) => {
    row.classList.toggle('now-playing', row.dataset.path === state.nowPlaying);
  });
  el('playerPlayPause').classList.toggle('playing', !audioEl.paused && state.nowPlaying);
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function initPlayer() {
  el('playerPlayPause').addEventListener('click', () => {
    if (!state.nowPlaying) { playAdjacent(1); return; }
    if (audioEl.paused) audioEl.play(); else audioEl.pause();
  });
  el('playerNext').addEventListener('click', () => playAdjacent(1));
  el('playerPrev').addEventListener('click', () => playAdjacent(-1));

  audioEl.addEventListener('play', syncPlayButtonsUI);
  audioEl.addEventListener('pause', syncPlayButtonsUI);
  audioEl.addEventListener('ended', () => playAdjacent(1));

  audioEl.addEventListener('timeupdate', () => {
    if (!audioEl.duration || isScrubbing) return;
    updateScrubUI(audioEl.currentTime / audioEl.duration);
    el('playerCurrentTime').textContent = formatTime(audioEl.currentTime);
  });
  audioEl.addEventListener('loadedmetadata', () => {
    el('playerDuration').textContent = formatTime(audioEl.duration);
  });

  initScrubDrag();
  initVolumeControl();
}

// ------------------------------------------------------------------ //
// Lautstärke
// ------------------------------------------------------------------ //
let volumeBeforeMute = 1;

function initVolumeControl() {
  const slider = el('playerVolume');
  const muteBtn = el('playerMuteBtn');

  const saved = localStorage.getItem('musikinterface-volume');
  const initialVolume = saved !== null ? parseFloat(saved) : 1;
  audioEl.volume = initialVolume;
  slider.value = Math.round(initialVolume * 100);
  updateVolumeUI(initialVolume);

  slider.addEventListener('input', () => {
    const vol = slider.value / 100;
    audioEl.volume = vol;
    audioEl.muted = false;
    updateVolumeUI(vol);
    localStorage.setItem('musikinterface-volume', String(vol));
  });

  muteBtn.addEventListener('click', () => {
    if (audioEl.volume > 0) {
      volumeBeforeMute = audioEl.volume;
      audioEl.volume = 0;
      slider.value = 0;
      updateVolumeUI(0);
    } else {
      const restore = volumeBeforeMute || 1;
      audioEl.volume = restore;
      slider.value = Math.round(restore * 100);
      updateVolumeUI(restore);
    }
    localStorage.setItem('musikinterface-volume', String(audioEl.volume));
  });
}

function updateVolumeUI(vol) {
  const pct = Math.round(vol * 100);
  el('playerVolume').style.background =
    `linear-gradient(to right, var(--accent) ${pct}%, var(--bg-hover) ${pct}%)`;
  el('playerMuteBtn').querySelector('.icon-vol-high').style.display = vol > 0 ? 'block' : 'none';
  el('playerMuteBtn').querySelector('.icon-vol-mute').style.display = vol > 0 ? 'none' : 'block';
}

// Ziehbarer Regler in der Zeitleiste (wie bei YouTube): während des
// Ziehens wird nur die Anzeige aktualisiert, erst beim Loslassen wird
// tatsächlich gesprungen -> flüssiger als bei jedem Pixel zu seeken.
let isScrubbing = false;

function pctFromPointer(e, track) {
  const rect = track.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  return Math.min(1, Math.max(0, pct));
}

function updateScrubUI(pct) {
  const p = Math.min(1, Math.max(0, pct)) * 100;
  el('playerScrubFill').style.width = `${p}%`;
  el('playerScrubThumb').style.left = `${p}%`;
}

function initScrubDrag() {
  const track = el('playerScrubTrack');

  const onMove = (e) => {
    if (!isScrubbing) return;
    const pct = pctFromPointer(e, track);
    updateScrubUI(pct);
    el('playerCurrentTime').textContent = formatTime(pct * (audioEl.duration || 0));
  };

  const onUp = (e) => {
    if (!isScrubbing) return;
    isScrubbing = false;
    track.classList.remove('dragging');
    if (audioEl.duration) {
      audioEl.currentTime = pctFromPointer(e, track) * audioEl.duration;
    }
  };

  track.addEventListener('pointerdown', (e) => {
    if (!audioEl.duration) return;
    isScrubbing = true;
    track.classList.add('dragging');
    track.setPointerCapture(e.pointerId);
    onMove(e);
  });
  track.addEventListener('pointermove', onMove);
  track.addEventListener('pointerup', onUp);
  track.addEventListener('pointercancel', onUp);
}

// ------------------------------------------------------------------ //
// Lautstärke normalisieren (-23 LUFS, EBU R128)
// ------------------------------------------------------------------ //
let normalizePollTimer = null;

async function handleNormalize() {
  const ok = await confirmAction(
    'Lautheit normalisieren?',
    `${state.selected.size} ausgewählte Titel werden auf -23 LUFS (EBU R128) normalisiert. Die Dateien werden dafür neu encodiert — je nach Anzahl kann das eine Weile dauern und lässt sich jederzeit abbrechen.`,
    'Normalisieren'
  );
  if (!ok) return;

  try {
    const result = await api('/api/normalize/start', {
      method: 'POST',
      body: JSON.stringify({ paths: [...state.selected] }),
    });
    if (!result.started) {
      showToast(result.reason || 'Normalisierung konnte nicht gestartet werden.', true);
      return;
    }
    el('selectionActions').style.display = 'none';
    el('selectionProgress').style.display = 'flex';
    pollNormalizeStatus();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleNormalizeCancel() {
  try {
    await api('/api/normalize/cancel', { method: 'POST' });
    showToast('Normalisierung wird abgebrochen …');
  } catch (err) {
    showToast(err.message, true);
  }
}

function pollNormalizeStatus() {
  clearTimeout(normalizePollTimer);
  const poll = async () => {
    let status;
    try {
      status = await api('/api/normalize/status');
    } catch (err) {
      normalizePollTimer = setTimeout(poll, 1500);
      return;
    }

    const pct = status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;
    el('normalizeProgressBar').style.width = `${pct}%`;
    el('normalizeProgressText').textContent = `${status.processed} / ${status.total} · ${status.succeeded} ok${status.failed ? ` · ${status.failed} Fehler` : ''}`;

    if (status.status === 'running') {
      normalizePollTimer = setTimeout(poll, 1000);
      return;
    }

    el('selectionActions').style.display = 'flex';
    el('selectionProgress').style.display = 'none';

    if (status.status === 'done') {
      showToast(`Normalisierung fertig: ${status.succeeded} erfolgreich${status.failed ? `, ${status.failed} fehlgeschlagen` : ''}.`, status.failed > 0);
    } else if (status.status === 'cancelled') {
      showToast(`Normalisierung abgebrochen bei ${status.processed} von ${status.total} Titeln.`);
    }
    await loadSongs();
  };
  poll();
}

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

// ------------------------------------------------------------------ //
// Init / Event-Bindings
// ------------------------------------------------------------------ //
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initSidebarToggle();
  initMobileMenus();
  initPlayer();
  applyViewFromLocation();
  loadFolders();
  loadFacets();
  loadSongs();

  window.addEventListener('popstate', () => {
    applyViewFromLocation();
    loadSongs();
  });

  el('viewHeaderClose').addEventListener('click', () => closeSpecialView());

  el('searchInput').addEventListener('input', debounce((e) => {
    state.search = e.target.value;
    state.page = 1;
    loadSongs();
  }, 300));

  el('genreFilter').addEventListener('change', (e) => {
    if (state.specialView) closeSpecialView({ skipReload: true });
    state.genre = e.target.value; state.page = 1; loadSongs();
  });
  el('yearFilter').addEventListener('change', (e) => {
    if (state.specialView) closeSpecialView({ skipReload: true });
    state.year = e.target.value; state.page = 1; loadSongs();
  });

  document.querySelectorAll('.song-table thead th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sort === key) {
        state.order = state.order === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = key;
        state.order = 'asc';
      }
      document.querySelectorAll('.song-table thead th').forEach((h) => h.classList.remove('sorted', 'desc'));
      th.classList.add('sorted');
      if (state.order === 'desc') th.classList.add('desc');
      loadSongs();
    });
  });

  el('selectAll').addEventListener('change', (e) => {
    document.querySelectorAll('.row-check').forEach((c) => { c.checked = e.target.checked; });
    document.querySelectorAll('.song-table tbody tr').forEach((row) => {
      const path = row.dataset.path;
      if (!path) return;
      if (e.target.checked) { state.selected.add(path); row.classList.add('selected'); }
      else { state.selected.delete(path); row.classList.remove('selected'); }
    });
    updateSelectionBar();
  });

  el('prevPage').addEventListener('click', () => { if (state.page > 1) { state.page--; loadSongs(); } });
  el('nextPage').addEventListener('click', () => {
    const totalPages = Math.max(Math.ceil(state.total / state.perPage), 1);
    if (state.page < totalPages) { state.page++; loadSongs(); }
  });

  el('scanBtn').addEventListener('click', handleScan);
  el('cancelScanBtn').addEventListener('click', handleCancelScan);
  el('azuracastBtn').addEventListener('click', handleAzuraCastSync);
  resumeScanUiIfRunning();

  el('editTagsBtn').addEventListener('click', openTagPanel);
  el('closeTagPanel').addEventListener('click', closeTagPanel);
  el('cancelTagEdit').addEventListener('click', closeTagPanel);
  el('panelOverlay').addEventListener('click', closeTagPanel);
  el('tagForm').addEventListener('submit', submitTagForm);

  el('renameBtn').addEventListener('click', handleRename);
  el('cleanTitleBtn').addEventListener('click', handleCleanTitles);
  el('cleanArtistBtn').addEventListener('click', handleCleanArtists);
  el('normalizeBtn').addEventListener('click', handleNormalize);
  el('normalizeCancelBtn').addEventListener('click', handleNormalizeCancel);
  el('deleteBtn').addEventListener('click', handleDelete);
  el('clearSelection').addEventListener('click', clearSelectionState);
});
