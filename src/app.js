const DATA_FILES = {
  calendario: { path: "data/calendario_br.json" },
  kpis: { path: "data/kpis_dia.json" },
  funil: { path: "data/funil_dia.json" },
  produtos: { path: "data/produtos_dia.json" },
  campanhas: { path: "data/campanhas_dia.json" },
  utms: { path: "data/utms_dia.json" },
  estoque: { path: "data/estoque.json" },
  metas: { path: "data/metas_comerciais.json", optional: true },
  manifest: { path: "data/manifest.json", optional: true },
  eventosManuais: { path: "data/eventos_manuais.json", optional: true },
};

const MANUAL_EVENTS_STORAGE_KEY = "reise_eventos_manuais";
const MANUAL_EVENTS_DELETED_KEY = "reise_eventos_manuais_excluidos";
const PRODUCTION_API_BASE = "https://calendario-reise.vercel.app";
const API_BASE = resolveApiBase();

const COMPARISON_LABELS = {
  previousPeriod: "Período anterior",
  previousYear: "Ano anterior",
  previousMonth: "Mês anterior",
  nextYear: "Ano posterior",
  nextMonth: "Mês posterior",
  manualMonth: "Mesmo mês de outro ano",
  manualYear: "Mesmo mês de outro ano",
  previousYearEvent: "Mesmo evento do ano anterior",
  averagePreviousYears: "Média dos últimos anos",
  freeDate: "Data livre",
  target: "Meta",
  none: "Sem comparação",
};

const PERIOD_TYPE_LABELS = {
  today: "Hoje",
  yesterday: "Ontem",
  selectedDay: "Data selecionada",
  selectedPeriod: "Período selecionado",
  last7: "Últimos 7 dias",
  last15: "Últimos 15 dias",
  last30: "Últimos 30 dias",
  previous7: "7 dias anteriores",
  next7: "7 dias posteriores",
  previous15: "15 dias anteriores",
  next15: "15 dias posteriores",
  previous30: "30 dias anteriores",
  next30: "30 dias posteriores",
  previousMonthPeriod: "Mês anterior",
  nextMonthPeriod: "Mês posterior",
  previousYearPeriod: "Ano anterior",
  nextYearPeriod: "Ano posterior",
  fullCurrentMonth: "Mês atual",
  fullCurrentYear: "Ano atual",
  freePeriod: "Data livre",
};

const FLUCTUATION_METRICS = [
  { key: "receita_total", label: "Faturamento", formatter: formatCurrency },
  { key: "pedidos_aprovados", label: "Pedidos", formatter: formatInteger },
  { key: "ticket_medio", label: "Ticket médio", formatter: formatCurrency },
  { key: "sessoes", label: "Sessões", formatter: formatInteger },
  { key: "add_to_cart", label: "Add to cart", formatter: formatInteger },
  { key: "begin_checkout", label: "Checkout", formatter: formatInteger },
  { key: "abandono_carrinho_estimado", label: "Abandono carrinho", formatter: formatInteger },
  { key: "abandono_checkout_estimado", label: "Abandono checkout", formatter: formatInteger },
  { key: "clientes_novos", label: "Clientes novos", formatter: formatInteger },
  { key: "clientes_recorrentes", label: "Clientes recorrentes", formatter: formatInteger },
  { key: "investimento_total_mkt", label: "Investimento", formatter: formatCurrency },
  { key: "roas_mkt", label: "ROAS", formatter: formatRoas },
  { key: "taxa_conversao", label: "Conversão", formatter: formatPercent },
];

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const state = {
  data: {},
  indexes: {},
  year: 2026,
  month: 0,
  compareMode: "none",
  compareMonth: 0,
  compareYear: 2025,
  periodType: "fullCurrentMonth",
  freePeriodStart: "",
  freePeriodEnd: "",
  freeCompareStart: "",
  freeCompareEnd: "",
  selectedDate: null,
  selectionStart: null,
  selectionEnd: null,
  dragStart: null,
  isDragging: false,
  wasDragging: false,
  analysisActivated: false,
  openMenu: null,
  editingManualEventId: null,
  deletedManualEventIds: [],
  charts: {},
  missing: [],
  apiAvailable: false,
  backendStatus: null,
  isRefreshingNow: false,
  isSavingManualEvent: false,
  deletingManualEventId: null,
  loadedAt: null,
  lastEventApiError: "",
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindControls();
  await loadData();
  buildIndexes();
  populateSelectors();
  await refreshBackendStatus(true);
  window.setInterval(() => refreshBackendStatus(true), 60000);
  renderDashboard();
}

function bindControls() {
  document.getElementById("prevMonthButton").addEventListener("click", () => shiftMonth(-1));
  document.getElementById("nextMonthButton").addEventListener("click", () => shiftMonth(1));
  document.getElementById("todayButton").addEventListener("click", goToToday);
  document.getElementById("clearSelectionButton").addEventListener("click", clearSelection);
  document.getElementById("refreshNowButton").addEventListener("click", refreshNow);
  document.getElementById("periodMenuButton").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMenu("period");
  });
  document.getElementById("comparisonMenuButton").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMenu("comparison");
  });
  document.getElementById("manualEventsMenuButton").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMenu("manual");
  });
  document.getElementById("closeManualEventsButton").addEventListener("click", closeMenus);
  document.querySelector('[data-menu-root="manual"]').addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeMenus();
  });

  document.getElementById("yearSelect").addEventListener("change", (event) => {
    state.year = Number(event.target.value);
    clearSelection(false);
    renderDashboard();
  });

  document.getElementById("monthSelect").addEventListener("change", (event) => {
    state.month = Number(event.target.value);
    clearSelection(false);
    renderDashboard();
  });

  document.getElementById("compareYearSelect").addEventListener("change", (event) => {
    state.compareYear = Number(event.target.value);
    state.analysisActivated = true;
    updateControlVisibility();
  });

  ["freePeriodStart", "freePeriodEnd", "freeCompareStart", "freeCompareEnd"].forEach((id) => {
    document.getElementById(id).addEventListener("change", (event) => {
      state[id] = event.target.value;
      state.analysisActivated = true;
      updateControlVisibility();
    });
  });

  document.querySelectorAll("[data-period-option]").forEach((button) => {
    button.addEventListener("click", () => applyPeriodOption(button.dataset.periodOption));
  });

  document.querySelectorAll("[data-compare-option]").forEach((button) => {
    button.addEventListener("click", () => applyComparisonOption(button.dataset.compareOption));
  });

  document.getElementById("applyFreePeriodButton").addEventListener("click", applyFreePeriod);
  document.getElementById("applyCompareYearButton").addEventListener("click", applyCompareYear);
  document.getElementById("applyFreeCompareButton").addEventListener("click", applyFreeCompare);

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".menu-root")) closeMenus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus();
  });

  document.addEventListener("mouseup", () => {
    if (!state.isDragging) return;
    state.isDragging = false;
    state.dragStart = null;
    if (state.wasDragging || state.periodType !== "selectedPeriod") {
      syncPeriodTypeFromSelection();
    }
    renderDashboard();
  });

  document.querySelectorAll("[data-filter]").forEach((input) => {
    input.addEventListener("change", () => {
      renderCalendar();
      renderSelectedDetail();
      renderSummaryFluctuation();
    });
  });

  document.getElementById("addManualEventButton").addEventListener("click", () => {
    const form = document.getElementById("manualEventForm");
    if (!form.hidden && !state.editingManualEventId) {
      form.hidden = true;
      return;
    }
    resetManualEventForm();
    form.hidden = false;
    const today = toDateKey(state.year, state.month + 1, Math.min(new Date().getDate(), 28));
    document.getElementById("manualStartDate").value = today;
    document.getElementById("manualEndDate").value = today;
    document.getElementById("manualTitle").focus();
  });

  document.getElementById("cancelManualEventButton").addEventListener("click", () => {
    resetManualEventForm();
    document.getElementById("manualEventForm").hidden = true;
  });

  document.getElementById("manualEventForm").addEventListener("submit", saveManualEventFromForm);
  document.getElementById("exportManualEventsButton").addEventListener("click", exportManualEvents);
  document.getElementById("importManualEventsInput").addEventListener("change", importManualEvents);
  document.getElementById("manualEventsList").addEventListener("click", handleManualEventsListClick);
}

function resolveApiBase() {
  const location = window.location;
  const hostname = location.hostname;
  const port = location.port;

  if (location.protocol === "file:") return PRODUCTION_API_BASE;
  if ((hostname === "localhost" || hostname === "127.0.0.1") && port !== "8765") {
    return PRODUCTION_API_BASE;
  }
  return "";
}

function toggleMenu(menuName) {
  const shouldOpen = state.openMenu !== menuName;
  closeMenus();
  if (!shouldOpen) return;

  const root = document.querySelector(`[data-menu-root="${menuName}"]`);
  if (!root) return;
  const menu = root.querySelector(".floating-menu");
  const button = root.querySelector(".menu-trigger");
  state.openMenu = menuName;
  root.classList.add("is-open");
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
  if (menuName === "manual") renderManualEventsList();
  updateControlVisibility();
}

function closeMenus() {
  document.querySelectorAll("[data-menu-root]").forEach((root) => {
    const menu = root.querySelector(".floating-menu");
    const button = root.querySelector(".menu-trigger");
    root.classList.remove("is-open");
    if (menu) menu.hidden = true;
    if (button) button.setAttribute("aria-expanded", "false");
  });
  state.openMenu = null;
}

function applyPeriodOption(periodType) {
  state.periodType = periodType;
  state.analysisActivated = true;
  updateControlVisibility();
  if (periodType === "freePeriod") {
    document.getElementById("freePeriodStart").focus();
    return;
  }
  closeMenus();
  renderDashboard();
}

function applyFreePeriod() {
  state.periodType = "freePeriod";
  state.freePeriodStart = document.getElementById("freePeriodStart").value;
  state.freePeriodEnd = document.getElementById("freePeriodEnd").value;
  state.analysisActivated = true;
  closeMenus();
  renderDashboard();
}

function applyComparisonOption(compareMode) {
  state.compareMode = compareMode;
  state.analysisActivated = true;
  updateControlVisibility();
  if (compareMode === "manualYear") {
    document.getElementById("compareYearSelect").focus();
    return;
  }
  if (compareMode === "freeDate") {
    document.getElementById("freeCompareStart").focus();
    return;
  }
  closeMenus();
  renderDashboard();
}

function applyCompareYear() {
  state.compareMode = "manualYear";
  state.compareYear = Number(document.getElementById("compareYearSelect").value);
  state.analysisActivated = true;
  closeMenus();
  renderDashboard();
}

function applyFreeCompare() {
  state.compareMode = "freeDate";
  state.freeCompareStart = document.getElementById("freeCompareStart").value;
  state.freeCompareEnd = document.getElementById("freeCompareEnd").value;
  state.analysisActivated = true;
  closeMenus();
  renderDashboard();
}

function shiftMonth(delta) {
  const next = new Date(state.year, state.month + delta, 1);
  state.year = next.getFullYear();
  state.month = next.getMonth();
  clearSelection(false);
  ensureYearOption(state.year);
  renderDashboard();
}

function goToToday() {
  const today = new Date();
  state.year = today.getFullYear();
  state.month = today.getMonth();
  ensureYearOption(state.year);
  setSingleDateSelection(toDateKey(state.year, state.month + 1, today.getDate()));
  renderDashboard();
}

function clearSelection(shouldRender = true) {
  state.selectedDate = null;
  state.selectionStart = null;
  state.selectionEnd = null;
  state.dragStart = null;
  state.isDragging = false;
  state.analysisActivated = false;
  state.periodType = "fullCurrentMonth";
  if (shouldRender) renderDashboard();
}

function applyControlState() {
  state.analysisActivated = true;
  state.compareYear = Number(document.getElementById("compareYearSelect").value);
  state.freePeriodStart = document.getElementById("freePeriodStart").value;
  state.freePeriodEnd = document.getElementById("freePeriodEnd").value;
  state.freeCompareStart = document.getElementById("freeCompareStart").value;
  state.freeCompareEnd = document.getElementById("freeCompareEnd").value;
  updateControlVisibility();
  ensureYearOption(state.year);
  renderDashboard();
}

async function loadData() {
  state.missing = [];
  const apiPayload = await loadDataFromApi();
  if (apiPayload) {
    state.apiAvailable = true;
    state.data = normalizeCalendarPayload(apiPayload);
    state.deletedManualEventIds = [];
    state.backendStatus = {
      ...(state.backendStatus || {}),
      updated_at: apiPayload.atualizado_em || state.backendStatus?.updated_at,
    };
    state.loadedAt = apiPayload.atualizado_em || state.loadedAt;
    renderDataStatus();
    renderBackendStatus();
    return;
  }

  state.apiAvailable = false;
  const entries = await Promise.all(
    Object.entries(DATA_FILES).map(async ([key, config]) => {
      try {
        const path = config.path;
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const text = await response.text();
        return [key, JSON.parse(text || "[]")];
      } catch (error) {
        if (!config.optional) {
          state.missing.push(`${config.path}`);
        }
        return [key, []];
      }
    })
  );

  state.data = Object.fromEntries(entries);
  state.loadedAt = null;
  state.deletedManualEventIds = loadDeletedManualEventIds();
  state.data.eventosManuais = normalizeManualEventsList(
    mergeManualEvents(state.data.eventosManuais || [], loadManualEventsFromStorage()).filter(
      (event) => !state.deletedManualEventIds.includes(event.id)
    )
  );
  renderDataStatus();
  renderBackendStatus();
}

async function loadDataFromApi() {
  try {
    const response = await fetch(`${API_BASE}/api/calendar-data`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const events = await loadManualEventsFromApi();
    if (events) payload.eventos_manuais = events;
    return payload;
  } catch (error) {
    return null;
  }
}

async function loadManualEventsFromApi() {
  try {
    const response = await fetch(`${API_BASE}/api/events`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return null;
  }
}

function normalizeCalendarPayload(payload = {}) {
  return {
    calendario: payload.calendario || [],
    kpis: payload.kpis || [],
    funil: payload.funil || [],
    produtos: payload.produtos || [],
    campanhas: payload.campanhas || [],
    utms: payload.utms || [],
    estoque: payload.estoque || [],
    metas: payload.metas || {},
    manifest: payload.manifest || {},
    eventosManuais: normalizeManualEventsList(payload.eventos_manuais || payload.eventosManuais || []),
    analytics: payload.analytics || null,
  };
}

function normalizeManualEventsList(events = []) {
  return (Array.isArray(events) ? events : [])
    .filter(isActiveManualEvent)
    .map((event) => ({
      ...event,
      id: event.id || event.event_id || buildManualEventId(event),
      event_id: event.event_id || event.id || buildManualEventId(event),
    }));
}

function isActiveManualEvent(event = {}) {
  const status = slug(event.status || "");
  return status !== "excluido" && !event.deleted_at;
}

function renderDataStatus() {
  const status = document.getElementById("dataStatus");
  if (state.apiAvailable) {
    status.textContent = "API compartilhada conectada. Eventos manuais e dados vêm do backend central.";
    return;
  }
  if (!state.missing.length) {
    status.textContent =
      "API não disponível. Dashboard em modo local com JSONs e localStorage como fallback temporário.";
    return;
  }

  status.textContent =
    `Alguns JSONs não foram carregados (${state.missing.join(", ")}). Confirme que o servidor foi iniciado dentro da pasta calendario-reise.`;
}

async function refreshBackendStatus(silent = false) {
  const previousLoadedAt = state.loadedAt;
  try {
    const response = await fetch(`${API_BASE}/api/status`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.backendStatus = await response.json();
    state.apiAvailable = true;
    if (
      previousLoadedAt &&
      state.backendStatus.updated_at &&
      state.backendStatus.updated_at !== previousLoadedAt &&
      !state.isRefreshingNow
    ) {
      await loadData();
      buildIndexes();
      populateSelectorsPreservingSelection();
      renderDashboard();
    }
  } catch (error) {
    if (!silent) {
      state.backendStatus = {
        updated_at: null,
        next_update_at: null,
        is_refreshing: false,
        source_status: { error: "API indisponível" },
      };
    }
    state.apiAvailable = false;
  }
  renderBackendStatus();
}

function renderBackendStatus() {
  const pill = document.getElementById("backendStatusPill");
  const text = document.getElementById("backendStatusText");
  const lastUpdate = document.getElementById("lastUpdateText");
  const nextUpdate = document.getElementById("nextUpdateText");
  const button = document.getElementById("refreshNowButton");
  if (!pill || !text || !lastUpdate || !nextUpdate || !button) return;

  const status = state.backendStatus || {};
  const sourceStatus = status.source_status || {};
  const isRefreshing = Boolean(status.is_refreshing || state.isRefreshingNow);
  const isScheduled = sourceStatus.refresh_loop_enabled !== false;
  pill.textContent = state.apiAvailable ? "API compartilhada" : "Modo local";
  text.textContent = state.apiAvailable
    ? isRefreshing
      ? "Atualizando dados..."
      : isScheduled
        ? "Dados sincronizados"
        : "Dados prontos sob demanda"
    : "API indisponível; usando fallback local";
  lastUpdate.textContent = formatBackendDateTime(status.updated_at);
  nextUpdate.textContent = isScheduled ? formatBackendDateTime(status.next_update_at) : "Sob demanda";
  button.disabled = !state.apiAvailable || isRefreshing;
  button.textContent = isRefreshing ? "Atualizando..." : "Atualizar agora";
}

async function refreshNow() {
  if (state.isRefreshingNow) return;
  state.isRefreshingNow = true;
  renderBackendStatus();
  try {
    const response = await fetch(`${API_BASE}/api/refresh`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      setDataStatusMessage(payload.message || "Não foi possível atualizar agora.");
      await refreshBackendStatus(true);
      return;
    }
    await loadData();
    buildIndexes();
    populateSelectorsPreservingSelection();
    renderDashboard();
    setDataStatusMessage("Dados atualizados pelo backend central.");
  } catch (error) {
    state.apiAvailable = false;
    setDataStatusMessage("API indisponível. Não foi possível atualizar agora.");
  } finally {
    state.isRefreshingNow = false;
    await refreshBackendStatus(true);
    renderBackendStatus();
  }
}

function setDataStatusMessage(message) {
  const status = document.getElementById("dataStatus");
  if (status) status.textContent = message;
}

function populateSelectorsPreservingSelection() {
  const currentYear = state.year;
  const currentMonth = state.month;
  const currentCompareYear = state.compareYear;
  populateSelectors();
  state.year = currentYear;
  state.month = currentMonth;
  state.compareYear = currentCompareYear;
  ensureYearOption(state.year);
  ensureYearOption(state.compareYear, document.getElementById("compareYearSelect"));
  document.getElementById("yearSelect").value = String(state.year);
  document.getElementById("monthSelect").value = String(state.month);
  document.getElementById("compareYearSelect").value = String(state.compareYear);
  updateControlVisibility();
}

function buildIndexes() {
  state.indexes.kpis = indexByDate(state.data.kpis);
  state.indexes.funil = indexByDate(state.data.funil);
  state.indexes.produtos = groupByDate(state.data.produtos);
  state.indexes.campanhas = groupByDate(state.data.campanhas);
  state.indexes.utms = groupByDate(state.data.utms);
  state.indexes.estoque = indexBySku(state.data.estoque);
  state.indexes.manualEvents = normalizeManualEventsList(state.data.eventosManuais || []);
  state.data.eventosManuais = state.indexes.manualEvents;
}

function populateSelectors() {
  const yearSelect = document.getElementById("yearSelect");
  const monthSelect = document.getElementById("monthSelect");
  const compareYearSelect = document.getElementById("compareYearSelect");
  const years = collectYears();
  const today = new Date();
  const fallbackYear = years.includes(today.getFullYear())
    ? today.getFullYear()
    : years[years.length - 1] || 2026;

  state.year = fallbackYear;
  state.month = state.year === today.getFullYear() ? today.getMonth() : 0;
  state.compareYear = state.year - 1;

  yearSelect.innerHTML = years
    .map((year) => `<option value="${year}">${year}</option>`)
    .join("");
  yearSelect.value = String(state.year);

  monthSelect.innerHTML = MONTH_NAMES.map(
    (month, index) => `<option value="${index}">${month}</option>`
  ).join("");
  monthSelect.value = String(state.month);

  compareYearSelect.innerHTML = years
    .map((year) => `<option value="${year}">${year}</option>`)
    .join("");
  ensureYearOption(state.compareYear, compareYearSelect);
  compareYearSelect.value = String(state.compareYear);

  updateControlVisibility();
}

function collectYears() {
  const years = new Set([2024, 2025, 2026]);
  [
    ...(state.data.calendario || []),
    ...(state.data.kpis || []),
    ...(state.data.eventosManuais || []),
  ].forEach((item) => {
    const year = Number(
      item.ano || String(item.data || item.data_inicio || item.data_fim || "").slice(0, 4)
    );
    if (year) years.add(year);
  });
  return [...years].sort((a, b) => a - b);
}

function ensureYearOption(year, select = document.getElementById("yearSelect")) {
  if (![...select.options].some((option) => Number(option.value) === year)) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    select.appendChild(option);
    [...select.options]
      .sort((a, b) => Number(a.value) - Number(b.value))
      .forEach((option) => select.appendChild(option));
  }
}

function renderDashboard() {
  ensureYearOption(state.year);
  ensureYearOption(state.compareYear, document.getElementById("compareYearSelect"));
  document.getElementById("yearSelect").value = String(state.year);
  document.getElementById("monthSelect").value = String(state.month);
  document.getElementById("compareYearSelect").value = String(state.compareYear);
  document.getElementById("freePeriodStart").value = state.freePeriodStart;
  document.getElementById("freePeriodEnd").value = state.freePeriodEnd;
  document.getElementById("freeCompareStart").value = state.freeCompareStart;
  document.getElementById("freeCompareEnd").value = state.freeCompareEnd;
  updateControlVisibility();
  updateComparisonStateClass();
  renderCalendar();
  renderSummary();
  renderSummaryFluctuation();
  renderExecutiveIntelligence();
  renderCharts();
  renderTables();
  renderSelectedDetail();
  renderManualEventsList();
}

function updateComparisonStateClass() {
  const shell = document.querySelector(".page-shell");
  const context = buildComparisonContextForPeriod(resolveActivePeriod());
  const isActive = Boolean(context && state.compareMode !== "none");
  shell.classList.toggle("is-comparison-active", isActive);
  shell.classList.toggle("is-no-comparison", !isActive);
}

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  const title = document.getElementById("monthTitle");
  const insight = document.getElementById("monthInsight");
  const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
  const firstWeekday = new Date(state.year, state.month, 1).getDay();
  const monthDates = getMonthDateKeys();
  const activePeriod = resolveActivePeriod();
  const calendarSelection = getCalendarSelectionPeriod();
  const activeKeys = new Set(calendarSelection.keys);
  const today = new Date();
  const todayKey = toDateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const monthRevenue = monthDates.reduce((sum, key) => {
    return sum + getKpi(key).receita_total;
  }, 0);
  const monthEvents = monthDates.reduce((sum, key) => sum + getEventsForDate(key).length, 0);

  title.textContent = `${MONTH_NAMES[state.month]} ${state.year}`;
  insight.textContent = `${formatCurrency(monthRevenue)} no mês, com ${monthEvents} marcações comerciais ativas. Período ativo: ${activePeriod.label}.`;

  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push(`<div class="day-cell is-empty" aria-hidden="true"></div>`);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = toDateKey(state.year, state.month + 1, day);
    const kpi = getKpi(dateKey);
    const events = getEventsForDate(dateKey);
    const primaryEvent = events[0];
    const isActive = activeKeys.has(dateKey);
    const isSingleActive = calendarSelection.keys.length === 1 && isActive;
    const selected = isSingleActive ? " is-selected" : "";
    const todayClass = dateKey === todayKey ? " is-today" : "";
    const rangeClass = isActive && calendarSelection.keys.length > 1 ? " is-in-range" : "";
    const startClass = dateKey === calendarSelection.start && calendarSelection.keys.length > 1 ? " is-range-start" : "";
    const endClass = dateKey === calendarSelection.end && calendarSelection.keys.length > 1 ? " is-range-end" : "";
    const markers = [...new Set(events.map((event) => event.tipo_evento))]
      .map((type) => `<span class="event-dot event-${slug(type)}" title="${type}"></span>`)
      .join("");

    cells.push(`
      <button class="day-cell${selected}${todayClass}${rangeClass}${startClass}${endClass}" type="button" data-date="${dateKey}" aria-label="${formatDateLong(dateKey)}">
        <span class="day-head">
          <span class="day-number">${day}</span>
          <span class="event-markers">${markers}</span>
        </span>
        <span class="event-name">${primaryEvent ? primaryEvent.nome_evento : ""}</span>
        <span class="day-metrics">
          <span>Receita <strong>${formatCompactCurrency(kpi.receita_total)}</strong></span>
          <span>Pedidos <strong>${formatInteger(kpi.pedidos_aprovados)}</strong></span>
        </span>
      </button>
    `);
  }

  grid.innerHTML = cells.join("");
  grid.querySelectorAll("[data-date]").forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      startCalendarSelection(button.dataset.date);
    });
    button.addEventListener("mouseenter", () => updateCalendarSelection(button.dataset.date));
    button.addEventListener("click", () => {
      completeCalendarClick(button.dataset.date);
      renderCalendar();
      renderSelectedDetail();
      renderSummary();
      renderSummaryFluctuation();
      renderCharts();
      renderTables();
    });
  });
}

function startCalendarSelection(dateKey) {
  state.isDragging = true;
  state.wasDragging = false;
  if (
    state.periodType === "selectedPeriod" &&
    state.selectionStart &&
    state.selectionStart === state.selectionEnd &&
    state.selectionStart !== dateKey
  ) {
    state.dragStart = state.selectionStart;
    state.wasDragging = true;
    const [start, end] = sortDateKeys(state.selectionStart, dateKey);
    state.selectionStart = start;
    state.selectionEnd = end;
    state.selectedDate = null;
    return;
  }
  state.dragStart = dateKey;
  state.selectionStart = dateKey;
  state.selectionEnd = dateKey;
  state.selectedDate = dateKey;
}

function updateCalendarSelection(dateKey) {
  if (!state.isDragging || !state.dragStart) return;
  if (dateKey !== state.dragStart) {
    state.wasDragging = true;
  }
  const [start, end] = sortDateKeys(state.dragStart, dateKey);
  state.selectionStart = start;
  state.selectionEnd = end;
  state.selectedDate = start === end ? start : null;
  state.periodType = start === end ? "selectedDay" : "selectedPeriod";
  renderCalendar();
}

function completeCalendarClick(dateKey) {
  if (state.wasDragging) {
    state.wasDragging = false;
    syncPeriodTypeFromSelection();
    return;
  }

  if (
    state.periodType === "selectedPeriod" &&
    state.selectionStart === dateKey &&
    state.selectionEnd === dateKey
  ) {
    return;
  }

  if (state.periodType === "selectedPeriod" && state.selectionStart && state.selectionStart !== dateKey) {
    const [start, end] = sortDateKeys(state.selectionStart, dateKey);
    state.selectionStart = start;
    state.selectionEnd = end;
    state.selectedDate = null;
    return;
  }

  setSingleDateSelection(dateKey);
}

function setSingleDateSelection(dateKey) {
  state.selectedDate = dateKey;
  state.selectionStart = dateKey;
  state.selectionEnd = dateKey;
  state.periodType = "selectedDay";
}

function syncPeriodTypeFromSelection() {
  if (state.selectionStart && state.selectionEnd && state.selectionStart !== state.selectionEnd) {
    state.periodType = "selectedPeriod";
    state.selectedDate = null;
  } else if (state.selectionStart) {
    setSingleDateSelection(state.selectionStart);
  }
}

function renderSelectedDetail() {
  const period = resolveActivePeriod();
  const hasCalendarSelection = Boolean(state.selectedDate || state.selectionStart);
  if (!period.keys.length || (!hasCalendarSelection && !state.analysisActivated)) {
    document.getElementById("detailTitle").textContent = "Selecione uma data";
    document.getElementById("detailSubtitle").textContent =
      "Clique em um dia do calendário para abrir a leitura comercial.";
    document.getElementById("detailContent").innerHTML = "";
    return;
  }

  const metrics = getMetricSummary(period.keys);
  const events = getEventsForPeriod(period.keys);
  const event = events[0] || {};
  const manualEvents = events.filter((item) => item.manual);
  const products = period.keys.flatMap((dateKey) => state.indexes.produtos[dateKey] || []);
  const campaigns = period.keys.flatMap((dateKey) => state.indexes.campanhas[dateKey] || []);
  const utms = period.keys.flatMap((dateKey) => state.indexes.utms[dateKey] || []);
  const topProduct = aggregateProducts(products).find((item) => item.classificacao === "destaque");
  const fallingProduct = aggregateProducts(products).find((item) => item.classificacao === "queda");
  const mainCampaign = aggregateCampaigns(campaigns)[0];
  const mainUtm = aggregateUtms(utms)[0];
  const comparisonContext = buildComparisonContextForPeriod(period, event);
  const isComparisonActive = Boolean(comparisonContext && state.compareMode !== "none");
  const detailRows = isComparisonActive
    ? `
      ${metricRow(period.keys.length === 1 ? "Data" : "Data inicial", formatShortDate(period.start))}
      ${period.keys.length > 1 ? metricRow("Data final", formatShortDate(period.end)) : ""}
      ${metricRow("Período comparado", comparisonContext.baseline.label)}
      ${metricRow("Faturamento", formatCurrency(metrics.receita_total))}
      ${metricRow("Pedidos", formatInteger(metrics.pedidos_aprovados))}
      ${metricRow("Ticket médio", formatCurrency(metrics.ticket_medio))}
      ${metricRow("Conversão", formatPercent(metrics.taxa_conversao))}
      ${metricRow("ROAS", formatRoas(metrics.roas_mkt))}
      ${metricRow("Evento principal", event.nome_evento || "Sem marcação")}
      ${metricRow("Campanha principal", mainCampaign ? mainCampaign.campaign_name : "-")}
      ${metricRow("Produto destaque", topProduct ? topProduct.product_name : "-")}
      ${metricRow("Produto em queda", fallingProduct ? fallingProduct.product_name : "-")}
    `
    : `
      ${metricRow(period.keys.length === 1 ? "Data" : "Data inicial", formatShortDate(period.start))}
      ${period.keys.length > 1 ? metricRow("Data final", formatShortDate(period.end)) : ""}
      ${metricRow("Quantidade de dias", formatInteger(period.keys.length))}
      ${metricRow("Evento principal", event.nome_evento || "Sem marcação")}
      ${metricRow("Tipo do evento", event.tipo_evento || "-")}
      ${metricRow("Faturamento", formatCurrency(metrics.receita_total))}
      ${metricRow("Pedidos", formatInteger(metrics.pedidos_aprovados))}
      ${metricRow("Ticket médio", formatCurrency(metrics.ticket_medio))}
      ${metricRow("Sessões", formatInteger(metrics.sessoes))}
      ${metricRow("Add to cart", formatInteger(metrics.add_to_cart))}
      ${metricRow("Begin checkout", formatInteger(metrics.begin_checkout))}
      ${metricRow("Abandono carrinho estimado", formatInteger(metrics.abandono_carrinho_estimado))}
      ${metricRow("Abandono checkout estimado", formatInteger(metrics.abandono_checkout_estimado))}
      ${metricRow("Clientes novos", formatInteger(metrics.clientes_novos))}
      ${metricRow("Clientes recorrentes", formatInteger(metrics.clientes_recorrentes))}
      ${metricRow("Investimento", formatCurrency(metrics.investimento_total_mkt))}
      ${metricRow("ROAS", formatRoas(metrics.roas_mkt))}
      ${metricRow("Conversão", formatPercent(metrics.taxa_conversao))}
      ${metricRow("Campanha principal", mainCampaign ? mainCampaign.campaign_name : "-")}
      ${metricRow("UTM principal", mainUtm ? `${mainUtm.utm_source} / ${mainUtm.utm_campaign}` : "-")}
      ${metricRow("Produto destaque", topProduct ? topProduct.product_name : "-")}
      ${metricRow("Produto em queda", fallingProduct ? fallingProduct.product_name : "-")}
    `;

  document.getElementById("detailTitle").textContent =
    period.keys.length === 1 ? "Data selecionada" : "Período selecionado";
  document.getElementById("detailSubtitle").innerHTML = `
    ${period.label}${period.keys.length > 1 ? `<br>${formatInteger(period.keys.length)} dias` : ""}
  `;

  document.getElementById("detailContent").innerHTML = `
    ${renderAnalysisSummary(period, comparisonContext)}
    <div class="metric-list">
      ${detailRows}
    </div>
    ${renderManualEventsBlock(manualEvents)}
    ${renderComparisonDurationNote(period, comparisonContext)}
    ${renderManualComparisonNote(manualEvents, comparisonContext)}
  `;
}

function renderSummary() {
  const metrics = getMetricSummary(resolveActivePeriod().keys);

  document.getElementById("summaryRevenue").textContent = formatCurrency(metrics.receita_total);
  document.getElementById("summaryOrders").textContent = formatInteger(metrics.pedidos_aprovados);
  document.getElementById("summaryTicket").textContent = formatCurrency(metrics.ticket_medio);
  document.getElementById("summaryConversion").textContent = formatPercent(metrics.taxa_conversao);
  document.getElementById("summaryRoas").textContent = formatRoas(metrics.roas_mkt);
}

function renderExecutiveIntelligence() {
  const panel = document.getElementById("executiveIntelligence");
  const analytics = state.data.analytics;
  const forecast = analytics?.forecast || {};
  if (!panel || !analytics || !forecast.forecast_revenue) {
    if (panel) panel.hidden = true;
    return;
  }

  panel.hidden = false;
  document.getElementById("forecastRevenue").textContent = formatCurrency(forecast.forecast_revenue);
  document.getElementById("forecastMeta").textContent =
    `${forecast.month_label || "-"} · ${formatInteger(forecast.elapsed_days)} de ${formatInteger(forecast.total_days)} dias · ${targetSourceLabel(forecast)} · confiança ${forecast.confidence || "-"}`;
  document.getElementById("forecastCoverage").textContent = formatPercent(Number(forecast.target_coverage || 0));
  document.getElementById("forecastRemaining").textContent = formatCurrency(forecast.remaining_revenue);
  document.getElementById("forecastCutoff").textContent =
    analytics.data_cutoff ? `Dados até ${formatShortDate(analytics.data_cutoff)} · D-1` : "Dados até D-1";
  document.getElementById("analyticsDiagnostic").textContent = analytics.diagnostic || "";
  renderAutomationHealth(analytics.automation_health || {});

  const risk = slug(forecast.risk_level || "indefinido");
  const riskLabel = document.getElementById("forecastRisk");
  riskLabel.textContent = capitalize(forecast.risk_level || "-");
  riskLabel.className = `status-chip risk-${risk}`;

  const progress = document.getElementById("forecastProgressBar");
  const coverage = Math.max(0, Math.min(1.25, Number(forecast.target_coverage || 0)));
  progress.style.width = `${Math.max(4, Math.min(100, coverage * 100))}%`;
  progress.style.background = risk === "alto" ? "#9b3e37" : risk === "medio" ? "#8b6424" : "#174637";

  document.getElementById("analyticsSignalsList").innerHTML = renderSignalItems(analytics.signals || []);
  document.getElementById("upcomingEventsList").innerHTML = renderUpcomingEventItems(analytics.upcoming_events || []);
  document.getElementById("recommendationsList").innerHTML = renderRecommendationItems(analytics.recommendations || []);
  const readinessList = document.getElementById("readinessPlaybookList");
  if (readinessList) {
    readinessList.innerHTML = renderReadinessPlaybookItems(analytics.readiness_playbook || []);
  }
  const actionPlanList = document.getElementById("actionPlanList");
  if (actionPlanList) {
    actionPlanList.innerHTML = renderActionPlanItems(analytics.action_plan || []);
  }
}

function renderAutomationHealth(health = {}) {
  const target = document.getElementById("automationHealth");
  if (!target || !Object.keys(health).length) return;
  target.hidden = false;
  target.className = `automation-health automation-${slug(health.status || "atencao")}`;
  target.innerHTML = `
    <div>
      <span>Automacao D-1</span>
      <strong>${escapeHtml(health.label || "-")}</strong>
    </div>
    <div class="automation-health-grid">
      <span>Fim dados: <strong>${formatShortDate(health.data_end)}</strong></span>
      <span>Linhas: <strong>${formatInteger(health.total_rows || 0)}</strong></span>
      <span>Arquivos: <strong>${formatInteger(health.total_files || 0)}</strong></span>
      <span>Modo: <strong>${escapeHtml(health.mode || "-")}</strong></span>
    </div>
  `;
}

function targetSourceLabel(forecast = {}) {
  if (forecast.target_source === "oficial") {
    return `meta oficial: ${forecast.target_label || "configurada"}`;
  }
  return "referencia sugerida";
}

function renderSignalItems(signals = []) {
  if (!signals.length) {
    return `<li><strong>Nenhum alerta crítico</strong><span>O período não tem sinal executivo relevante no momento.</span></li>`;
  }
  return signals
    .map(
      (signal) => `
        <li class="signal-${slug(signal.kind || "sinal")}">
          <span class="signal-label">${escapeHtml(signal.kind || "sinal")}</span>
          <strong>${escapeHtml(signal.title || "-")}</strong>
          <span>${escapeHtml(signal.detail || "")}</span>
        </li>
      `
    )
    .join("");
}

function renderUpcomingEventItems(events = []) {
  if (!events.length) {
    return `<li><strong>Sem data crítica</strong><span>Nenhuma sazonalidade relevante nos próximos 90 dias.</span></li>`;
  }
  return events
    .map(
      (event) => `
        <li>
          <strong>${escapeHtml(event.name || "-")}</strong>
          <span>${formatShortDate(event.date)} · faltam ${formatInteger(event.days_until)} dia(s)</span>
          <span>${escapeHtml(event.action || "")}</span>
        </li>
      `
    )
    .join("");
}

function renderRecommendationItems(recommendations = []) {
  if (!recommendations.length) {
    return `<li><strong>Sem recomendação automática</strong><span>Aguardando mais dados para sugerir próximos movimentos.</span></li>`;
  }
  return recommendations
    .map((recommendation) => `<li><span>${escapeHtml(recommendation)}</span></li>`)
    .join("");
}

function renderReadinessPlaybookItems(items = []) {
  if (!items.length) {
    return `
      <article class="readiness-card readiness-monitorar">
        <div class="readiness-card-head">
          <span>Sem data critica</span>
          <strong>Monitorar</strong>
        </div>
        <h4>Nenhuma frente sazonal ativa</h4>
        <p>Nao ha data comercial relevante nos proximos 90 dias.</p>
      </article>
    `;
  }

  return items
    .map((item) => {
      const checklist = (item.checklist || [])
        .slice(0, 4)
        .map(
          (task) => `
            <li>
              <span>${escapeHtml(task.area || "-")}</span>
              <strong class="task-${slug(task.status || "status")}">${escapeHtml(task.status || "-")}</strong>
              <small>${escapeHtml(task.owner || "-")}</small>
            </li>
          `
        )
        .join("");
      const blockers = (item.blockers || [])
        .slice(0, 3)
        .map((blocker) => `<span>${escapeHtml(blocker)}</span>`)
        .join("");

      return `
        <article class="readiness-card readiness-${slug(item.status || "monitorar")}">
          <div class="readiness-card-head">
            <span>${escapeHtml(item.status || "monitorar")}</span>
            <strong>${formatInteger(item.score || 0)}% pronto</strong>
          </div>
          <h4>${escapeHtml(item.name || "-")}</h4>
          <p>${formatShortDate(item.date)} Â· faltam ${formatInteger(item.days_until)} dia(s)</p>
          <div class="readiness-metrics">
            <span>Lacuna: <strong>${formatCurrency(item.revenue_gap || 0)}</strong></span>
            <span>Ritmo diario: <strong>${formatCurrency(item.daily_required || 0)}</strong></span>
          </div>
          <ul class="readiness-checklist">${checklist}</ul>
          ${blockers ? `<div class="readiness-blockers">${blockers}</div>` : ""}
          <footer>${escapeHtml(item.main_action || "")}</footer>
        </article>
      `;
    })
    .join("");
}

function renderActionPlanItems(items = []) {
  if (!items.length) {
    return `<li><strong>Sem acao pendente</strong><span>O playbook nao encontrou pendencias executivas para as proximas datas.</span></li>`;
  }

  return items
    .map(
      (item) => `
        <li class="action-${slug(item.status || "planejar")}">
          <div>
            <strong>${escapeHtml(item.action || "-")}</strong>
            <span>${escapeHtml(item.event_name || "-")} &middot; ${escapeHtml(item.area || "-")}</span>
          </div>
          <div>
            <span>Dono: <strong>${escapeHtml(item.owner || "-")}</strong></span>
            <span>Prazo: <strong>${formatShortDate(item.due_date)}</strong></span>
            <span>Status: <strong>${escapeHtml(item.status || "-")}</strong></span>
          </div>
        </li>
      `
    )
    .join("");
}

function renderSummaryFluctuation() {
  const target = document.getElementById("summaryFluctuation");
  const context = buildComparisonContextForPeriod(resolveActivePeriod());
  if (!context) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }

  target.hidden = false;
  target.innerHTML = renderFluctuationPanel(context, "summary", true);
}

function renderCharts() {
  const period = resolveActivePeriod();
  const comparisonContext = buildComparisonContextForPeriod(period);
  const currentKeys =
    comparisonContext && state.compareMode !== "none"
      ? comparisonContext.current.keys || period.keys
      : period.keys;
  const comparisonKeys =
    comparisonContext && state.compareMode !== "none"
      ? comparisonContext.baseline.keys || []
      : [];

  const chartConfigs = [
    {
      canvasId: "revenueChart",
      label: "Faturamento",
      formatter: formatCurrency,
      value: (dateKey) => getKpi(dateKey).receita_total,
    },
    {
      canvasId: "ordersChart",
      label: "Pedidos",
      formatter: formatInteger,
      value: (dateKey) => getKpi(dateKey).pedidos_aprovados,
    },
    {
      canvasId: "ticketChart",
      label: "Ticket médio",
      formatter: formatCurrency,
      value: (dateKey) => getKpi(dateKey).ticket_medio,
    },
    {
      canvasId: "conversionChart",
      label: "Conversão",
      formatter: (value) => `${formatDecimal(value)}%`,
      value: (dateKey) => getKpi(dateKey).taxa_conversao * 100,
    },
    {
      canvasId: "roasChart",
      label: "ROAS",
      formatter: formatRoas,
      value: (dateKey) => getKpi(dateKey).roas_mkt,
    },
    {
      canvasId: "addToCartChart",
      label: "Add to cart",
      formatter: formatInteger,
      value: (dateKey) => Number(getFunil(dateKey).add_to_cart || 0),
    },
    {
      canvasId: "checkoutChart",
      label: "Checkout",
      formatter: formatInteger,
      value: (dateKey) => Number(getFunil(dateKey).begin_checkout || 0),
    },
  ];

  chartConfigs.forEach((config) => {
    const aligned = alignComparisonData(currentKeys, comparisonKeys, config.value);
    const hasComparison = comparisonKeys.length > 0;
    const labels = hasComparison
      ? aligned.map((row) => row.label)
      : currentKeys.map((dateKey) => formatShortDate(dateKey));
    const datasets = hasComparison
      ? [
          {
            label: "Atual",
            data: aligned.map((row) => row.valorAtual),
            color: "#1e5a49",
            fill: true,
          },
          {
            label: "Comparado",
            data: aligned.map((row) => row.valorComparado),
            color: "#b98d43",
            fill: false,
          },
        ]
      : [
          {
            label: config.label,
            data: aligned.map((row) => row.valorAtual),
            color: config.canvasId === "ordersChart" ? "#b98d43" : "#1e5a49",
            fill: true,
          },
        ];
    renderChart(config.canvasId, labels, datasets, config.formatter);
  });
}

function alignComparisonData(currentKeys, comparisonKeys, valueGetter) {
  const length = Math.max(currentKeys.length, comparisonKeys.length, 1);
  return Array.from({ length }, (_, index) => {
    const currentKey = currentKeys[index] || "";
    const comparisonKey = comparisonKeys[index] || "";
    return {
      label: comparisonKeys.length ? `D${index + 1}` : currentKey ? formatShortDate(currentKey) : `D${index + 1}`,
      dataAtual: currentKey,
      valorAtual: currentKey ? valueGetter(currentKey) : null,
      dataComparada: comparisonKey,
      valorComparado: comparisonKey ? valueGetter(comparisonKey) : null,
    };
  });
}

function renderChart(canvasId, labels, datasets, formatter) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (!window.Chart) {
    renderFallbackChart(canvas, datasets, formatter);
    return;
  }

  canvas.style.display = "block";
  const fallback = canvas.parentElement.querySelector(".fallback-chart");
  if (fallback) fallback.remove();

  if (state.charts[canvasId]) {
    state.charts[canvasId].destroy();
  }

  state.charts[canvasId] = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: datasets.map((dataset) => ({
        label: dataset.label,
        data: dataset.data,
        borderColor: dataset.color,
        backgroundColor:
          dataset.color === "#b98d43"
            ? "rgba(185, 141, 67, 0.12)"
            : "rgba(30, 90, 73, 0.12)",
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 5,
        fill: dataset.fill,
        tension: 0.35,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: { boxWidth: 10, usePointStyle: true },
        },
        tooltip: {
          callbacks: {
            label: (context) => `${context.dataset.label}: ${formatter(context.parsed.y)}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: (value) => formatter(value) } },
      },
    },
  });
}

function renderFallbackChart(canvas, datasets, formatter) {
  canvas.style.display = "none";
  const parent = canvas.parentElement;
  const oldFallback = parent.querySelector(".fallback-chart");
  if (oldFallback) oldFallback.remove();

  const values = datasets[0].data.map((value) => Number(value || 0));
  const max = Math.max(...values, 1);
  const bars = values
    .map((value) => {
      const height = Math.max(4, (value / max) * 180);
      return `<span class="fallback-bar" style="height:${height}px"><span>${formatter(value)}</span></span>`;
    })
    .join("");
  parent.insertAdjacentHTML("beforeend", `<div class="fallback-chart">${bars}</div>`);
}

function renderTables() {
  const period = resolveActivePeriod();
  const comparisonContext = buildComparisonContextForPeriod(period);
  const comparisonActive = Boolean(
    comparisonContext &&
      state.compareMode !== "none" &&
      comparisonContext.baseline.keys &&
      comparisonContext.baseline.keys.length
  );

  renderProductsTable(period, comparisonContext, comparisonActive);
  renderCampaignsTable(period, comparisonContext, comparisonActive);
}

function renderProductsTable(period, comparisonContext, comparisonActive) {
  const body = document.getElementById("productsTable");
  const head = document.getElementById("productsTableHead");
  const panel = document.getElementById("productsPanel");
  const subtext = document.getElementById("productsTableSubtext");
  const products = period.keys.flatMap((dateKey) => state.indexes.produtos[dateKey] || []);

  setTableComparisonState(
    panel,
    subtext,
    comparisonActive,
    "Produtos comparados entre período atual e período selecionado para comparação",
    comparisonContext
  );

  if (comparisonActive) {
    head.innerHTML = `
      <tr>
        <th>Produto</th>
        <th>Classificação</th>
        <th class="numeric-cell">Itens atual</th>
        <th class="numeric-cell">Itens comparado</th>
        <th class="numeric-cell">Var. itens %</th>
        <th class="numeric-cell">Receita atual</th>
        <th class="numeric-cell">Receita comparada</th>
        <th class="numeric-cell">Var. receita %</th>
        <th>Estoque</th>
        <th>Status</th>
      </tr>
    `;
    renderProductsComparisonTable(body, products, comparisonContext);
    return;
  }

  head.innerHTML = `
    <tr>
      <th>Produto</th>
      <th>Classificação</th>
      <th class="numeric-cell">Itens</th>
      <th class="numeric-cell">Receita</th>
      <th>Estoque</th>
    </tr>
  `;

  const grouped = aggregateProducts(products).slice(0, 10);

  body.innerHTML =
    grouped
      .map((item) => {
        const stock = state.indexes.estoque[item.sku] || {};
        const warning = stock.risk_status && stock.risk_status !== "Saudável";
        return `
          <tr>
            <td><strong>${item.product_name}</strong><br><span>${item.variant_title || item.sku}</span></td>
            <td><span class="status-chip ${item.classificacao === "queda" ? "warning" : ""}">${capitalize(item.classificacao)}</span></td>
            <td class="numeric-cell">${formatInteger(item.itens_vendidos)}</td>
            <td class="numeric-cell">${formatCurrency(item.receita_produto)}</td>
            <td><span class="status-chip ${warning ? "warning" : ""}">${stock.risk_status || "-"}</span></td>
          </tr>
        `;
      })
      .join("") || emptyTableRow(5);
}

function renderCampaignsTable(period, comparisonContext, comparisonActive) {
  const body = document.getElementById("campaignsTable");
  const head = document.getElementById("campaignsTableHead");
  const panel = document.getElementById("campaignsPanel");
  const subtext = document.getElementById("campaignsTableSubtext");
  const activeKeys = period.keys;
  const campaigns = activeKeys.flatMap((dateKey) => state.indexes.campanhas[dateKey] || []);
  const utms = activeKeys.flatMap((dateKey) => state.indexes.utms[dateKey] || []);

  setTableComparisonState(
    panel,
    subtext,
    comparisonActive,
    "Origem da receita no período atual versus período comparado",
    comparisonContext
  );

  if (comparisonActive) {
    head.innerHTML = `
      <tr>
        <th>Origem</th>
        <th>Nome</th>
        <th class="numeric-cell">Pedidos atual</th>
        <th class="numeric-cell">Pedidos comparado</th>
        <th class="numeric-cell">Var. pedidos %</th>
        <th class="numeric-cell">Receita atual</th>
        <th class="numeric-cell">Receita comparada</th>
        <th class="numeric-cell">Var. receita %</th>
        <th class="numeric-cell">ROAS atual</th>
        <th class="numeric-cell">ROAS comparado</th>
        <th class="numeric-cell">Var. ROAS %</th>
      </tr>
    `;
    renderAcquisitionComparisonTable(body, campaigns, utms, comparisonContext);
    return;
  }

  head.innerHTML = `
    <tr>
      <th>Origem</th>
      <th>Nome</th>
      <th class="numeric-cell">Pedidos</th>
      <th class="numeric-cell">Receita</th>
      <th class="numeric-cell">ROAS</th>
    </tr>
  `;

  const rows = [
    ...aggregateCampaigns(campaigns).slice(0, 5).map((item) => ({
      source: item.platform,
      name: item.campaign_name,
      orders: item.pedidos_atribuidos,
      revenue: item.receita_atribuida,
      roas: item.roas,
    })),
    ...aggregateUtms(utms).slice(0, 5).map((item) => ({
      source: item.utm_source,
      name: item.utm_campaign,
      orders: item.pedidos,
      revenue: item.receita,
      roas: null,
    })),
  ];

  body.innerHTML =
    rows
      .map(
        (row) => `
          <tr>
            <td>${row.source}</td>
            <td><strong>${row.name}</strong></td>
            <td class="numeric-cell">${formatInteger(row.orders)}</td>
            <td class="numeric-cell">${formatCurrency(row.revenue)}</td>
            <td class="numeric-cell">${row.roas === null ? "-" : formatRoas(row.roas)}</td>
          </tr>
        `
      )
      .join("") || emptyTableRow(5);
}

function setTableComparisonState(panel, subtext, comparisonActive, description, comparisonContext) {
  panel.classList.toggle("is-comparison-table", comparisonActive);
  if (!subtext) return;

  subtext.hidden = !comparisonActive;
  subtext.innerHTML = comparisonActive
    ? `${description}<br><span class="comparison-badge">Comparando com: ${comparisonContext.baseline.label}</span>`
    : "";
}

function renderProductsComparisonTable(body, currentRows, comparisonContext) {
  const comparedRows = comparisonContext.baseline.keys.flatMap((dateKey) => state.indexes.produtos[dateKey] || []);
  const currentMap = aggregateProductsByComparisonKey(currentRows);
  const comparedMap = aggregateProductsByComparisonKey(comparedRows);
  const keys = [...new Set([...currentMap.keys(), ...comparedMap.keys()])];
  const rows = keys
    .map((key) => {
      const current = currentMap.get(key) || makeEmptyProduct(comparedMap.get(key), key);
      const compared = comparedMap.get(key) || makeEmptyProduct(current, key);
      const stock = state.indexes.estoque[current.sku || compared.sku] || {};
      const itemVariation = calculateVariation(current.itens_vendidos, compared.itens_vendidos);
      const revenueVariation = calculateVariation(current.receita_produto, compared.receita_produto);
      return {
        key,
        current,
        compared,
        stock,
        itemVariation,
        revenueVariation,
        classification: classifyProductComparison(current, compared, stock, itemVariation, revenueVariation),
      };
    })
    .sort((a, b) => {
      const aWeight = a.current.receita_produto + a.compared.receita_produto + Math.abs(a.revenueVariation.absoluteChange);
      const bWeight = b.current.receita_produto + b.compared.receita_produto + Math.abs(b.revenueVariation.absoluteChange);
      return bWeight - aWeight;
    })
    .slice(0, 12);

  body.innerHTML =
    rows
      .map((row) => {
        const status = row.stock.risk_status || "-";
        const statusWarning = isStockRisky(status);
        return `
          <tr>
            <td>
              <strong>${row.current.product_name || row.compared.product_name || row.key}</strong>
              <br><span>${row.current.variant_title || row.compared.variant_title || row.current.sku || row.compared.sku || "-"}</span>
            </td>
            <td><span class="status-chip ${classificationClass(row.classification)}">${row.classification}</span></td>
            <td class="numeric-cell">${formatInteger(row.current.itens_vendidos)}</td>
            <td class="numeric-cell">${formatInteger(row.compared.itens_vendidos)}</td>
            <td class="numeric-cell">${variationBadge(row.itemVariation)}</td>
            <td class="numeric-cell">${formatCurrency(row.current.receita_produto)}</td>
            <td class="numeric-cell">${formatCurrency(row.compared.receita_produto)}</td>
            <td class="numeric-cell">${variationBadge(row.revenueVariation)}</td>
            <td class="numeric-cell">${row.stock.stock_available === undefined ? "-" : formatInteger(row.stock.stock_available)}</td>
            <td><span class="status-chip ${statusWarning ? "warning" : ""}">${status}</span></td>
          </tr>
        `;
      })
      .join("") || emptyTableRow(10);
}

function renderAcquisitionComparisonTable(body, currentCampaignRows, currentUtmRows, comparisonContext) {
  const comparedCampaignRows = comparisonContext.baseline.keys.flatMap(
    (dateKey) => state.indexes.campanhas[dateKey] || []
  );
  const comparedUtmRows = comparisonContext.baseline.keys.flatMap((dateKey) => state.indexes.utms[dateKey] || []);
  const currentMap = aggregateAcquisitionByComparisonKey(currentCampaignRows, currentUtmRows);
  const comparedMap = aggregateAcquisitionByComparisonKey(comparedCampaignRows, comparedUtmRows);
  const keys = [...new Set([...currentMap.keys(), ...comparedMap.keys()])];
  const rows = keys
    .map((key) => {
      const current = currentMap.get(key) || makeEmptyAcquisition(comparedMap.get(key), key);
      const compared = comparedMap.get(key) || makeEmptyAcquisition(current, key);
      const ordersVariation = calculateVariation(current.orders, compared.orders);
      const revenueVariation = calculateVariation(current.revenue, compared.revenue);
      const roasVariation = calculateRoasVariation(current.roas, compared.roas);
      return {
        key,
        current,
        compared,
        ordersVariation,
        revenueVariation,
        roasVariation,
        status: classifyAcquisitionComparison(current, compared, revenueVariation, ordersVariation),
      };
    })
    .sort((a, b) => {
      const aWeight = a.current.revenue + a.compared.revenue + Math.abs(a.revenueVariation.absoluteChange);
      const bWeight = b.current.revenue + b.compared.revenue + Math.abs(b.revenueVariation.absoluteChange);
      return bWeight - aWeight;
    })
    .slice(0, 12);

  body.innerHTML =
    rows
      .map(
        (row) => `
          <tr>
            <td>${row.current.source || row.compared.source || "-"}</td>
            <td>
              <strong>${row.current.name || row.compared.name || row.key}</strong>
              ${row.status ? `<br><span class="status-chip ${classificationClass(row.status)}">${row.status}</span>` : ""}
            </td>
            <td class="numeric-cell">${formatInteger(row.current.orders)}</td>
            <td class="numeric-cell">${formatInteger(row.compared.orders)}</td>
            <td class="numeric-cell">${variationBadge(row.ordersVariation)}</td>
            <td class="numeric-cell">${formatCurrency(row.current.revenue)}</td>
            <td class="numeric-cell">${formatCurrency(row.compared.revenue)}</td>
            <td class="numeric-cell">${variationBadge(row.revenueVariation)}</td>
            <td class="numeric-cell">${formatOptionalRoas(row.current.roas)}</td>
            <td class="numeric-cell">${formatOptionalRoas(row.compared.roas)}</td>
            <td class="numeric-cell">${variationBadge(row.roasVariation)}</td>
          </tr>
        `
      )
      .join("") || emptyTableRow(11);
}

function getMonthDateKeys() {
  const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) =>
    toDateKey(state.year, state.month + 1, index + 1)
  );
}

function resolveActivePeriod() {
  const base = getBaseSelectedPeriod();

  if (state.periodType === "today") {
    return makePeriod([currentDateKey()], "Hoje");
  }

  if (state.periodType === "yesterday") {
    return makePeriod([currentDateKey(-1)], "Ontem");
  }

  if (state.periodType === "selectedDay") {
    const key = state.selectedDate || state.selectionStart || toDateKey(state.year, state.month + 1, 1);
    return makePeriod([key], "Dia selecionado");
  }

  if (state.periodType === "selectedPeriod") {
    return makePeriod(base.keys, "Período selecionado");
  }

  if (state.periodType === "previous7") return makePeriod(relativeDayRange(base.start, -7, -1), "7 dias anteriores");
  if (state.periodType === "next7") return makePeriod(relativeDayRange(base.end, 1, 7), "7 dias posteriores");
  if (state.periodType === "previous15") return makePeriod(relativeDayRange(base.start, -15, -1), "15 dias anteriores");
  if (state.periodType === "next15") return makePeriod(relativeDayRange(base.end, 1, 15), "15 dias posteriores");
  if (state.periodType === "previous30") return makePeriod(relativeDayRange(base.start, -30, -1), "30 dias anteriores");
  if (state.periodType === "next30") return makePeriod(relativeDayRange(base.end, 1, 30), "30 dias posteriores");
  if (state.periodType === "last7") return makePeriod(relativeDayRange(base.end, -6, 0), "Últimos 7 dias");
  if (state.periodType === "last15") return makePeriod(relativeDayRange(base.end, -14, 0), "Últimos 15 dias");
  if (state.periodType === "last30") return makePeriod(relativeDayRange(base.end, -29, 0), "Últimos 30 dias");

  if (state.periodType === "previousMonthPeriod") {
    const shifted = new Date(state.year, state.month - 1, 1);
    return makePeriod(getMonthDateKeysFor(shifted.getFullYear(), shifted.getMonth()), "Mês anterior");
  }

  if (state.periodType === "nextMonthPeriod") {
    const shifted = new Date(state.year, state.month + 1, 1);
    return makePeriod(getMonthDateKeysFor(shifted.getFullYear(), shifted.getMonth()), "Mês posterior");
  }

  if (state.periodType === "previousYearPeriod") {
    return makePeriod(shiftPeriodByYears(base.keys, -1), "Ano anterior");
  }

  if (state.periodType === "nextYearPeriod") {
    return makePeriod(shiftPeriodByYears(base.keys, 1), "Ano posterior");
  }

  if (state.periodType === "fullCurrentYear") {
    return makePeriod(dateKeysBetween(`${state.year}-01-01`, `${state.year}-12-31`), "Ano atual completo");
  }

  if (state.periodType === "freePeriod") {
    const start = state.freePeriodStart || base.start;
    const end = state.freePeriodEnd || state.freePeriodStart || base.end;
    return makePeriod(dateKeysBetween(...sortDateKeys(start, end)), "Data livre");
  }

  return makePeriod(getMonthDateKeysFor(state.year, state.month), "Mês atual completo");
}

function getBaseSelectedPeriod() {
  if (state.selectionStart && state.selectionEnd) {
    return makePeriod(dateKeysBetween(state.selectionStart, state.selectionEnd), "Período selecionado");
  }
  if (state.selectedDate) {
    return makePeriod([state.selectedDate], "Dia selecionado");
  }
  return makePeriod(getMonthDateKeysFor(state.year, state.month), "Mês atual completo");
}

function getCalendarSelectionPeriod() {
  if (state.selectionStart && state.selectionEnd) {
    return makePeriod(dateKeysBetween(state.selectionStart, state.selectionEnd), "Período selecionado");
  }
  if (state.selectedDate) {
    return makePeriod([state.selectedDate], "Data selecionada");
  }
  return makePeriod([], "");
}

function makePeriod(keys, typeLabel) {
  const sortedKeys = [...new Set(keys.filter(Boolean))].sort();
  const start = sortedKeys[0] || "";
  const end = sortedKeys[sortedKeys.length - 1] || start;
  const label =
    start && end && start !== end
      ? `${formatShortDate(start)} a ${formatShortDate(end)}`
      : start
        ? formatShortDate(start)
        : "sem período";
  return { start, end, keys: sortedKeys, label, typeLabel };
}

function relativeDayRange(anchorKey, startOffset, endOffset) {
  return dateKeysBetween(addDays(anchorKey, startOffset), addDays(anchorKey, endOffset));
}

function shiftPeriodByYears(keys, years) {
  return [...new Set(keys.map((key) => shiftDateKey(key, years, 0)))].sort();
}

function shiftPeriodByMonths(keys, months) {
  return [...new Set(keys.map((key) => shiftDateKey(key, 0, months)))].sort();
}

function shiftDateKey(dateKey, years, months) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shiftedMonth = new Date(year + years, month - 1 + months, 1);
  const shiftedYear = shiftedMonth.getFullYear();
  const shiftedMonthIndex = shiftedMonth.getMonth();
  const lastDay = new Date(shiftedYear, shiftedMonthIndex + 1, 0).getDate();
  return toDateKey(shiftedYear, shiftedMonthIndex + 1, Math.min(day, lastDay));
}

function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + amount);
  return toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function currentDateKey(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function sortDateKeys(a, b) {
  return a <= b ? [a, b] : [b, a];
}

function getEventsForDate(dateKey) {
  const filters = activeFilters();
  return [...(state.data.calendario || []), ...getManualEventsForDate(dateKey)]
    .filter((event) => filters.has(event.tipo_evento) || filters.has(event.categoria))
    .filter((event) => {
      const start = event.janela_inicio || event.data;
      const end = event.janela_fim || event.data;
      return dateKey >= start && dateKey <= end;
    })
    .sort((a, b) => priorityScore(b.prioridade) - priorityScore(a.prioridade));
}

function getEventsForPeriod(dateKeys) {
  const map = new Map();
  dateKeys.forEach((dateKey) => {
    getEventsForDate(dateKey).forEach((event) => {
      const key = event.id || `${event.nome_evento}-${event.janela_inicio}-${event.janela_fim}`;
      map.set(key, event);
    });
  });
  return [...map.values()].sort((a, b) => priorityScore(b.prioridade) - priorityScore(a.prioridade));
}

function getManualEventsForDate(dateKey) {
  return (state.data.eventosManuais || [])
    .filter(isActiveManualEvent)
    .filter((event) => {
      const start = event.data_inicio || event.data;
      const end = event.data_fim || start;
      return dateKey >= start && dateKey <= end;
    })
    .map(normalizeManualEvent);
}

function normalizeManualEvent(event) {
  const start = event.data_inicio || event.data;
  const end = event.data_fim || start;
  return {
    ...event,
    data: start,
    nome_evento: event.titulo || "Evento manual",
    grupo_evento: event.campanha_relacionada || event.titulo || event.tipo || "Evento manual",
    tipo_evento: event.tipo || "Campanha",
    categoria: event.categoria || categoryFromManualType(event.tipo),
    prioridade: event.prioridade || "Média",
    janela_inicio: start,
    janela_fim: end,
    observacao: event.observacao || "",
    manual: true,
  };
}

function getKpi(dateKey) {
  const row = state.indexes.kpis[dateKey] || {};
  const revenue = Number(row.receita_total || 0);
  const orders = Number(row.pedidos_aprovados || 0);
  const investment = Number(row.investimento_total_mkt || 0);
  const sessions = Number(row.sessoes || 0);
  return {
    receita_total: revenue,
    pedidos_aprovados: orders,
    ticket_medio: Number(row.ticket_medio || (orders ? revenue / orders : 0)),
    sessoes: sessions,
    taxa_conversao: Number(row.taxa_conversao || (sessions ? orders / sessions : 0)),
    investimento_total_mkt: investment,
    roas_mkt: Number(row.roas_mkt || (investment ? revenue / investment : 0)),
    cps_mkt: Number(row.cps_mkt || (sessions ? investment / sessions : 0)),
    clientes_novos: Number(row.clientes_novos || 0),
    clientes_recorrentes: Number(row.clientes_recorrentes || 0),
  };
}

function getFunil(dateKey) {
  return state.indexes.funil[dateKey] || {};
}

function buildComparisonContextForPeriod(period, event = null) {
  if (!period.keys.length || state.compareMode === "none") return null;

  if (state.compareMode === "previousPeriod") {
    const baselineKeys = relativeDayRange(period.start, -period.keys.length, -1);
    return makeComparisonContext({
      title: "Flutuação do período",
      currentLabel: period.label,
      currentKeys: period.keys,
      baselineLabel: labelForKeys(baselineKeys),
      baselineKeys,
    });
  }

  if (state.compareMode === "previousYear") {
    const baselineKeys = shiftPeriodByYears(period.keys, -1);
    return makeComparisonContext({
      title: "Flutuação do período",
      currentLabel: period.label,
      currentKeys: period.keys,
      baselineLabel: labelForKeys(baselineKeys),
      baselineKeys,
      note: durationNote(period.keys, baselineKeys),
    });
  }

  if (state.compareMode === "nextYear") {
    const baselineKeys = shiftPeriodByYears(period.keys, 1);
    return makeComparisonContext({
      title: "Flutuação do período",
      currentLabel: period.label,
      currentKeys: period.keys,
      baselineLabel: labelForKeys(baselineKeys),
      baselineKeys,
      note: durationNote(period.keys, baselineKeys),
    });
  }

  if (state.compareMode === "previousMonth") {
    const baselineKeys = shiftPeriodByMonths(period.keys, -1);
    return makeComparisonContext({
      title: "Flutuação do período",
      currentLabel: period.label,
      currentKeys: period.keys,
      baselineLabel: labelForKeys(baselineKeys),
      baselineKeys,
      note: durationNote(period.keys, baselineKeys),
    });
  }

  if (state.compareMode === "nextMonth") {
    const baselineKeys = shiftPeriodByMonths(period.keys, 1);
    return makeComparisonContext({
      title: "Flutuação do período",
      currentLabel: period.label,
      currentKeys: period.keys,
      baselineLabel: labelForKeys(baselineKeys),
      baselineKeys,
      note: durationNote(period.keys, baselineKeys),
    });
  }

  if (state.compareMode === "manualMonth" || state.compareMode === "manualYear") {
    const baselineKeys = period.keys.map((key) =>
      toDateKey(state.compareYear, Number(key.slice(5, 7)), Number(key.slice(8, 10)))
    );
    return makeComparisonContext({
      title: "Flutuação do período",
      currentLabel: period.label,
      currentKeys: period.keys,
      baselineLabel: labelForKeys(baselineKeys),
      baselineKeys,
      note: durationNote(period.keys, baselineKeys),
    });
  }

  if (state.compareMode === "freeDate") {
    const start = state.freeCompareStart;
    const end = state.freeCompareEnd || start;
    const baselineKeys = start ? dateKeysBetween(...sortDateKeys(start, end)) : [];
    return makeComparisonContext({
      title: "Flutuação do período",
      currentLabel: period.label,
      currentKeys: period.keys,
      baselineLabel: baselineKeys.length ? labelForKeys(baselineKeys) : "data livre não definida",
      baselineKeys,
      note: durationNote(period.keys, baselineKeys),
    });
  }

  if (state.compareMode === "previousYearEvent") {
    const currentEvent = event || getEventsForPeriod(period.keys).find((item) => item.nome_evento);
    if (!currentEvent) return null;
    const previousEvent = findComparableEvent(currentEvent, Number(currentEvent.janela_inicio.slice(0, 4)) - 1);
    const baselineKeys = previousEvent ? dateKeysBetween(previousEvent.janela_inicio, previousEvent.janela_fim) : [];
    return makeComparisonContext({
      title: "Flutuação do período",
      currentLabel: `${currentEvent.nome_evento} ${currentEvent.janela_inicio.slice(0, 4)}`,
      currentKeys: dateKeysBetween(currentEvent.janela_inicio, currentEvent.janela_fim),
      baselineLabel: previousEvent
        ? `${previousEvent.nome_evento} ${previousEvent.janela_inicio.slice(0, 4)}`
        : "evento anterior não encontrado",
      baselineKeys,
      note: previousEvent
        ? durationNote(dateKeysBetween(currentEvent.janela_inicio, currentEvent.janela_fim), baselineKeys)
        : "Evento sem equivalente no ano anterior. Comparação direta pode estar distorcida por lançamento/campanha nova.",
    });
  }

  if (state.compareMode === "target") {
    return makeComparisonContext({
      title: "Comparação com meta",
      currentLabel: period.label,
      currentKeys: period.keys,
      baselineLabel: "Meta não configurada",
      baselineKeys: [],
      note: "Meta ainda não configurada nos dados locais.",
    });
  }

  if (state.compareMode === "averagePreviousYears") {
    const currentYear = Number(period.start.slice(0, 4));
    const previousYears = availableYearsBefore(currentYear);
    const baselineBuckets = previousYears.map((year) => ({
      label: String(year),
      keys: period.keys.map((key) => shiftDateKey(key, year - Number(key.slice(0, 4)), 0)),
    }));
    return makeAverageComparisonContext({
      title: "Flutuação do período",
      currentLabel: period.label,
      currentKeys: period.keys,
      baselineBuckets,
    });
  }

  return null;
}

function labelForKeys(keys) {
  const period = makePeriod(keys, "");
  return period.label;
}

function durationNote(currentKeys, baselineKeys) {
  if (!baselineKeys.length) return "";
  return currentKeys.length !== baselineKeys.length
    ? "Períodos com durações diferentes podem distorcer a comparação."
    : "";
}

function renderComparisonDurationNote(period, comparisonContext) {
  if (!comparisonContext || !comparisonContext.note) return "";
  return `<div class="comparison-note">${comparisonContext.note}</div>`;
}

function renderAnalysisSummary(period, comparisonContext) {
  const comparisonText = comparisonContext ? comparisonContext.baseline.label : "Comparação desativada";
  return `
    <div class="analysis-summary">
      <strong>Análise</strong>
      <span>Período: ${PERIOD_TYPE_LABELS[state.periodType] || period.typeLabel || period.label}</span>
      <span>Comparação: ${COMPARISON_LABELS[state.compareMode] || "Sem comparação"}</span>
      <span>Comparando com: ${comparisonText}</span>
    </div>
  `;
}

function buildDetailComparisonContext(dateKey, event) {
  if (state.compareMode === "none") return null;

  if (state.compareMode === "previousYear") {
    const previousKey = previousYearDateKey(dateKey);
    return makeComparisonContext({
      title: "Flutuação do período",
      currentLabel: String(dateKey.slice(0, 4)),
      currentKeys: [dateKey],
      baselineLabel: String(Number(dateKey.slice(0, 4)) - 1),
      baselineKeys: [previousKey],
      event,
    });
  }

  if (state.compareMode === "previousYearMonth") {
    return makeComparisonContext({
      title: "Flutuação do período",
      currentLabel: `${MONTH_NAMES[state.month]} ${state.year}`,
      currentKeys: getMonthDateKeysFor(state.year, state.month),
      baselineLabel: `${MONTH_NAMES[state.month]} ${state.year - 1}`,
      baselineKeys: getMonthDateKeysFor(state.year - 1, state.month),
      event,
    });
  }

  if (state.compareMode === "previousYearEvent") {
    const currentEvent = event && event.nome_evento ? event : null;
    if (!currentEvent) return null;
    const previousEvent = findComparableEvent(currentEvent, state.year - 1);
    return makeComparisonContext({
      title: "Flutuação do período",
      currentLabel: `${currentEvent.nome_evento} ${state.year}`,
      currentKeys: dateKeysBetween(currentEvent.janela_inicio, currentEvent.janela_fim),
      baselineLabel: previousEvent
        ? `${previousEvent.nome_evento} ${state.year - 1}`
        : `Sem equivalente em ${state.year - 1}`,
      baselineKeys: previousEvent ? dateKeysBetween(previousEvent.janela_inicio, previousEvent.janela_fim) : [],
      event: currentEvent,
      note: previousEvent ? "" : "Evento sem equivalente no ano anterior. Comparação direta pode estar distorcida por lançamento/campanha nova.",
    });
  }

  if (state.compareMode === "averagePreviousYears") {
    const previousYears = availableYearsBefore(state.year);
    const baselineBuckets = previousYears.map((year) => ({
      label: String(year),
      keys: [toDateKey(year, state.month + 1, Number(dateKey.slice(8, 10)))],
    }));
    return makeAverageComparisonContext({
      title: "Flutuação do período",
      currentLabel: String(state.year),
      currentKeys: [dateKey],
      baselineBuckets,
      event,
    });
  }

  return null;
}

function buildSummaryComparisonContext() {
  if (state.compareMode === "none") return null;

  const selectedEvent = state.selectedDate
    ? getEventsForDate(state.selectedDate).find((event) => event.nome_evento)
    : null;

  if (state.compareMode === "previousYearEvent" && selectedEvent) {
    return buildDetailComparisonContext(state.selectedDate, selectedEvent);
  }

  if (state.compareMode === "averagePreviousYears") {
    const previousYears = availableYearsBefore(state.year);
    const baselineBuckets = previousYears.map((year) => ({
      label: String(year),
      keys: getMonthDateKeysFor(year, state.month),
    }));
    return makeAverageComparisonContext({
      title: "Flutuação do período",
      currentLabel: `${MONTH_NAMES[state.month]} ${state.year}`,
      currentKeys: getMonthDateKeysFor(state.year, state.month),
      baselineBuckets,
    });
  }

  return makeComparisonContext({
    title: "Flutuação do período",
    currentLabel: `${MONTH_NAMES[state.month]} ${state.year}`,
    currentKeys: getMonthDateKeysFor(state.year, state.month),
    baselineLabel: `${MONTH_NAMES[state.month]} ${state.year - 1}`,
    baselineKeys: getMonthDateKeysFor(state.year - 1, state.month),
    event: selectedEvent,
  });
}

function makeComparisonContext({ title, currentLabel, currentKeys, baselineLabel, baselineKeys, event, note = "" }) {
  const currentMetrics = getMetricSummary(currentKeys);
  const baselineMetrics = getMetricSummary(baselineKeys);
  return {
    mode: state.compareMode,
    title,
    event,
    note,
    current: { label: currentLabel, keys: currentKeys, metrics: currentMetrics },
    baseline: { label: baselineLabel, keys: baselineKeys, metrics: baselineMetrics },
  };
}

function makeAverageComparisonContext({ title, currentLabel, currentKeys, baselineBuckets, event }) {
  const populatedBuckets = baselineBuckets.filter((bucket) => bucket.keys.length);
  const metrics = populatedBuckets.map((bucket) => getMetricSummary(bucket.keys));
  return {
    mode: state.compareMode,
    title,
    event,
    note: populatedBuckets.length ? "" : "Sem anos anteriores disponíveis para média.",
    current: { label: currentLabel, keys: currentKeys, metrics: getMetricSummary(currentKeys) },
    baseline: {
      label: populatedBuckets.length
        ? `Média ${populatedBuckets.map((bucket) => bucket.label).join(", ")}`
        : "Média indisponível",
      keys: [],
      metrics: averageMetricSummaries(metrics),
    },
  };
}

function getMetricSummary(dateKeys) {
  const uniqueKeys = [...new Set(dateKeys)].filter(Boolean);
  const totals = uniqueKeys.reduce(
    (acc, dateKey) => {
      const kpi = getKpi(dateKey);
      const funil = getFunil(dateKey);
      acc.receita_total += kpi.receita_total;
      acc.pedidos_aprovados += kpi.pedidos_aprovados;
      acc.sessoes += kpi.sessoes || Number(funil.sessions || 0);
      acc.add_to_cart += Number(funil.add_to_cart || 0);
      acc.begin_checkout += Number(funil.begin_checkout || 0);
      acc.clientes_novos += kpi.clientes_novos;
      acc.clientes_recorrentes += kpi.clientes_recorrentes;
      acc.investimento_total_mkt += kpi.investimento_total_mkt;
      return acc;
    },
    {
      receita_total: 0,
      pedidos_aprovados: 0,
      ticket_medio: 0,
      sessoes: 0,
      add_to_cart: 0,
      begin_checkout: 0,
      clientes_novos: 0,
      clientes_recorrentes: 0,
      investimento_total_mkt: 0,
      roas_mkt: 0,
      abandono_carrinho_estimado: 0,
      abandono_checkout_estimado: 0,
      taxa_conversao: 0,
    }
  );

  totals.abandono_carrinho_estimado = Math.max(0, totals.add_to_cart - totals.begin_checkout);
  totals.abandono_checkout_estimado = Math.max(0, totals.begin_checkout - totals.pedidos_aprovados);
  totals.ticket_medio = totals.pedidos_aprovados
    ? totals.receita_total / totals.pedidos_aprovados
    : 0;
  totals.roas_mkt = totals.investimento_total_mkt
    ? totals.receita_total / totals.investimento_total_mkt
    : 0;
  totals.taxa_conversao = totals.sessoes ? totals.pedidos_aprovados / totals.sessoes : 0;
  return totals;
}

function averageMetricSummaries(metrics) {
  if (!metrics.length) return getMetricSummary([]);
  const totals = metrics.reduce((acc, item) => {
    FLUCTUATION_METRICS.forEach((metric) => {
      acc[metric.key] = (acc[metric.key] || 0) + Number(item[metric.key] || 0);
    });
    return acc;
  }, {});
  FLUCTUATION_METRICS.forEach((metric) => {
    totals[metric.key] = totals[metric.key] / metrics.length;
  });
  return totals;
}

function renderFluctuationPanel(context, variant = "summary", innerOnly = false) {
  if (!context || state.compareMode === "none") return "";
  const content = `
    <div class="fluctuation-head">
      <div>
        <span class="eyebrow">${COMPARISON_LABELS[state.compareMode]}</span>
        <h2>Flutuação do período</h2>
      </div>
      <p>Comparando ${context.current.label} com ${context.baseline.label}</p>
    </div>
    ${context.note ? `<div class="comparison-note">${context.note}</div>` : ""}
    <div class="fluctuation-grid">
      ${FLUCTUATION_METRICS.map((metric) => renderFluctuationMetric(metric, context)).join("")}
    </div>
  `;
  return innerOnly ? content : `<section class="fluctuation-panel">${content}</section>`;
}

function renderFluctuationMetric(metric, context) {
  const current = Number(context.current.metrics[metric.key] || 0);
  const baseline = Number(context.baseline.metrics[metric.key] || 0);
  const diff = baseline ? variation(current, baseline) : null;
  const absoluteDiff = current - baseline;
  return `
    <article class="fluctuation-card">
      <h3>${metric.label}</h3>
      <div class="fluctuation-line"><span>Atual</span><strong>${metric.formatter(current)}</strong></div>
      <div class="fluctuation-line"><span>Comparado</span><strong>${metric.formatter(baseline)}</strong></div>
      <div class="fluctuation-delta">Absoluta: ${formatSignedValue(absoluteDiff, metric.formatter)}</div>
      <div class="fluctuation-variation">Variação: ${trendValue(diff)}</div>
    </article>
  `;
}

function renderManualEventsBlock(events) {
  if (!events.length) return "";
  return `
    <div class="manual-event-list">
      <span class="eyebrow">Eventos no período</span>
      ${events
        .map(
          (event) => `
            <div class="manual-event-item">
              <strong>${event.nome_evento}</strong>
              <span>${event.tipo_evento} · ${formatShortDate(event.janela_inicio)} a ${formatShortDate(event.janela_fim)}</span>
              ${event.produto_relacionado ? `<span>Produto: ${event.produto_relacionado}</span>` : ""}
              ${event.campanha_relacionada ? `<span>Campanha: ${event.campanha_relacionada}</span>` : ""}
              ${event.observacao ? `<span>${event.observacao}</span>` : ""}
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderManualComparisonNote(manualEvents, context) {
  if (!manualEvents.length || state.compareMode === "none") return "";
  const hasBaseline = context && Number(context.baseline.metrics.receita_total || 0) > 0;
  if (hasBaseline) return "";
  return `
    <div class="comparison-note">
      Evento sem equivalente no período comparado. Comparação direta pode estar distorcida por lançamento/campanha nova.
    </div>
  `;
}

function findComparableEvent(event, targetYear) {
  const targetEvents = [
    ...(state.data.calendario || []),
    ...(state.data.eventosManuais || []).map(normalizeManualEvent),
  ].filter((candidate) => {
    const start = candidate.janela_inicio || candidate.data_inicio || candidate.data;
    return Number(String(start || "").slice(0, 4)) === targetYear;
  });

  const eventGroup = normalizeComparableText(event.grupo_evento || event.nome_evento);
  const eventName = normalizeComparableText(event.nome_evento);
  const eventCategory = normalizeComparableText(event.categoria || event.tipo_evento);
  return targetEvents.find((candidate) => {
    const candidateGroup = normalizeComparableText(candidate.grupo_evento || candidate.nome_evento);
    const candidateName = normalizeComparableText(candidate.nome_evento || candidate.titulo);
    const candidateCategory = normalizeComparableText(candidate.categoria || candidate.tipo_evento);
    return (
      candidateGroup === eventGroup ||
      candidateName === eventName ||
      (candidateCategory === eventCategory && candidateName.includes(eventName))
    );
  });
}

function availableYearsBefore(year) {
  return collectYears().filter((item) => item < year);
}

function getMonthDateKeysFor(year, monthIndex) {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) =>
    toDateKey(year, monthIndex + 1, index + 1)
  );
}

function dateKeysBetween(start, end) {
  if (!start) return [];
  const keys = [];
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = (end || start).split("-").map(Number);
  const current = new Date(startYear, startMonth - 1, startDay);
  const final = new Date(endYear, endMonth - 1, endDay);
  while (current <= final) {
    keys.push(toDateKey(current.getFullYear(), current.getMonth() + 1, current.getDate()));
    current.setDate(current.getDate() + 1);
  }
  return keys;
}

function rangesOverlap(start, end, rangeStart, rangeEnd) {
  if (!start || !rangeStart || !rangeEnd) return false;
  const safeEnd = end || start;
  return start <= rangeEnd && safeEnd >= rangeStart;
}

function categoryFromManualType(type = "") {
  if (["Campanha", "CRM", "Mídia paga"].includes(type)) return "Campanha";
  if (["Lançamento de produto", "Ação comercial"].includes(type)) return "Data comercial";
  return "Sazonalidade";
}

function priorityScore(priority) {
  if (typeof priority === "number") return priority;
  return { Alta: 90, Média: 60, Baixa: 30 }[priority] || Number(priority || 0);
}

function normalizeComparableText(value = "") {
  return slug(String(value)).replace(/-/g, " ").trim();
}

function loadManualEventsFromStorage() {
  try {
    return JSON.parse(localStorage.getItem(MANUAL_EVENTS_STORAGE_KEY) || "[]");
  } catch (error) {
    return [];
  }
}

function loadDeletedManualEventIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(MANUAL_EVENTS_DELETED_KEY) || "[]");
    return Array.isArray(ids) ? ids : [];
  } catch (error) {
    return [];
  }
}

function persistManualEvents() {
  try {
    localStorage.setItem(MANUAL_EVENTS_STORAGE_KEY, JSON.stringify(state.data.eventosManuais || []));
    return true;
  } catch (error) {
    return false;
  }
}

function persistDeletedManualEventIds() {
  try {
    localStorage.setItem(MANUAL_EVENTS_DELETED_KEY, JSON.stringify(state.deletedManualEventIds || []));
    return true;
  } catch (error) {
    return false;
  }
}

function mergeManualEvents(fileEvents, storageEvents) {
  const map = new Map();
  [...fileEvents, ...storageEvents].forEach((event) => {
    if (!event) return;
    const id = event.id || buildManualEventId(event);
    map.set(id, { ...event, id });
  });
  return [...map.values()].sort((a, b) => String(a.data_inicio).localeCompare(String(b.data_inicio)));
}

function buildManualEventId(event) {
  const start = event.data_inicio || event.data || toDateKey(state.year, state.month + 1, 1);
  const end = event.data_fim || event.janela_fim || start;
  const base = [start, end, event.titulo || event.nome_evento || "evento", event.tipo || event.tipo_evento || ""]
    .join("_")
    .replace(/-/g, "_");
  return `manual_${slug(base).replace(/-/g, "_") || "evento"}`;
}

async function saveManualEventFromForm(event) {
  event.preventDefault();
  if (state.isSavingManualEvent) return;
  const form = event.currentTarget;
  setManualFormSaving(true);
  setManualStatus("Salvando evento...");
  const start = document.getElementById("manualStartDate").value;
  const end = document.getElementById("manualEndDate").value || start;
  const editingId = state.editingManualEventId;
  const eventId = editingId || `manual_${start.replace(/-/g, "_")}_${String(Date.now()).slice(-6)}`;
  const manualEvent = {
    id: eventId,
    event_id: eventId,
    data_inicio: start,
    data_fim: end < start ? start : end,
    titulo: document.getElementById("manualTitle").value.trim(),
    tipo: document.getElementById("manualType").value,
    categoria: categoryFromManualType(document.getElementById("manualType").value),
    produto_relacionado: document.getElementById("manualProduct").value.trim(),
    campanha_relacionada: document.getElementById("manualCampaign").value.trim(),
    prioridade: document.getElementById("manualPriority").value,
    responsavel: document.getElementById("manualOwner").value.trim(),
    observacao: document.getElementById("manualObservation").value.trim(),
    status: document.getElementById("manualStatusField").value,
  };

  try {
    const canUseSharedApi = state.apiAvailable || (await ensureSharedEventsApiReady());
    if (canUseSharedApi) {
      const saved = await saveManualEventWithApi(manualEvent, editingId);
      if (saved) {
        upsertManualEventLocally(saved);
        closeManualFormAfterSave(form, saved);
        const message = "Evento salvo na base compartilhada.";
        setManualStatus(message);
        closeMenus();
        renderDashboard();
        setDataStatusMessage(message);
        return;
      }
      setManualStatus(
        `Não foi possível salvar na base compartilhada. O evento não foi gravado. ${state.lastEventApiError || "Recarregue a página e tente novamente."}`
      );
      return;
    }

    state.data.eventosManuais = editingId
      ? (state.data.eventosManuais || []).map((item) => (item.id === editingId ? manualEvent : item))
      : mergeManualEvents(state.data.eventosManuais || [], [manualEvent]);
    state.deletedManualEventIds = (state.deletedManualEventIds || []).filter((id) => id !== manualEvent.id);
    buildIndexes();
    const persisted = persistManualEvents();
    persistDeletedManualEventIds();
    closeManualFormAfterSave(form, manualEvent);
    const message = persisted
      ? "Evento salvo no navegador. Use Exportar eventos manuais para gerar o JSON."
      : "Evento salvo nesta sessão. Use Exportar eventos manuais para baixar o JSON.";
    setManualStatus(message);
    closeMenus();
    renderDashboard();
    setDataStatusMessage(message);
  } finally {
    setManualFormSaving(false);
  }
}

function setManualFormSaving(isSaving) {
  state.isSavingManualEvent = isSaving;
  const form = document.getElementById("manualEventForm");
  if (!form) return;
  const submitButton = form.querySelector('button[type="submit"]');
  const cancelButton = document.getElementById("cancelManualEventButton");
  if (submitButton) {
    if (isSaving) submitButton.dataset.previousLabel = submitButton.textContent || "Salvar evento";
    submitButton.disabled = isSaving;
    submitButton.textContent = isSaving ? "Salvando..." : submitButton.dataset.previousLabel || "Salvar evento";
    if (!isSaving) delete submitButton.dataset.previousLabel;
  }
  if (cancelButton) cancelButton.disabled = isSaving;
  form.setAttribute("aria-busy", isSaving ? "true" : "false");
}

async function saveManualEventWithApi(manualEvent, editingId) {
  try {
    state.lastEventApiError = "";
    const url = editingId ? `${API_BASE}/api/events/${encodeURIComponent(editingId)}` : `${API_BASE}/api/events`;
    const method = editingId ? "PUT" : "POST";
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(apiManualEventPayload(manualEvent)),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || `HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    state.lastEventApiError = error.message || "Falha ao chamar /api/events.";
    state.apiAvailable = false;
    renderBackendStatus();
    return null;
  }
}

async function ensureSharedEventsApiReady() {
  await refreshBackendStatus(true);
  return state.apiAvailable;
}

function apiManualEventPayload(manualEvent) {
  return {
    data_inicio: manualEvent.data_inicio,
    data_fim: manualEvent.data_fim,
    titulo: manualEvent.titulo,
    tipo: manualEvent.tipo,
    categoria: manualEvent.categoria,
    produto_relacionado: manualEvent.produto_relacionado,
    campanha_relacionada: manualEvent.campanha_relacionada,
    prioridade: manualEvent.prioridade,
    responsavel: manualEvent.responsavel,
    observacao: manualEvent.observacao,
    status: manualEvent.status || "Ativo",
  };
}

function upsertManualEventLocally(event) {
  const normalized = normalizeManualEventsList([event])[0];
  if (!normalized) return;
  state.data.eventosManuais = mergeManualEvents(
    (state.data.eventosManuais || []).filter((item) => item.id !== normalized.id && item.event_id !== normalized.event_id),
    [normalized]
  );
  buildIndexes();
  populateSelectorsPreservingSelection();
}

function removeManualEventLocally(id) {
  state.data.eventosManuais = (state.data.eventosManuais || []).filter((event) => event.id !== id && event.event_id !== id);
  buildIndexes();
  populateSelectorsPreservingSelection();
}

async function reloadDataAfterManualEventChange() {
  await loadData();
  buildIndexes();
  populateSelectorsPreservingSelection();
}

function closeManualFormAfterSave(form, manualEvent) {
  form.reset();
  form.hidden = true;
  state.editingManualEventId = null;
  state.year = Number(manualEvent.data_inicio.slice(0, 4));
  state.month = Number(manualEvent.data_inicio.slice(5, 7)) - 1;
  state.selectedDate = manualEvent.data_inicio;
  ensureYearOption(state.year);
}

function resetManualEventForm() {
  const form = document.getElementById("manualEventForm");
  form.reset();
  state.editingManualEventId = null;
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.textContent = "Salvar evento";
}

function renderManualEventsList() {
  const target = document.getElementById("manualEventsList");
  if (!target) return;
  const events = getManualEventsForDisplayedMonth();

  target.innerHTML = `
    <div class="manual-list-head">
      <strong>Eventos manuais neste mês</strong>
      <span>${formatInteger(events.length)} evento(s)</span>
    </div>
    ${
      events.length
        ? events.map(renderManualEventListItem).join("")
        : '<p class="muted-empty">Nenhum evento manual cadastrado para este mês.</p>'
    }
  `;
}

function renderManualEventListItem(event) {
  const isDeleting = state.deletingManualEventId === event.id;
  return `
    <article class="manual-month-item">
      <div>
        <strong>${event.titulo || "Evento manual"}</strong>
        <span>${event.tipo || "-"} · ${formatShortDate(event.data_inicio)} a ${formatShortDate(event.data_fim || event.data_inicio)}</span>
        <span>Prioridade: ${event.prioridade || "-"}${event.responsavel ? ` · Responsável: ${event.responsavel}` : ""}</span>
      </div>
      <div class="manual-event-actions">
        <button class="secondary-button small-button" type="button" data-action="edit-manual" data-id="${event.id}" ${isDeleting ? "disabled" : ""}>Editar</button>
        <button class="secondary-button small-button danger-button" type="button" data-action="delete-manual" data-id="${event.id}" ${isDeleting ? "disabled" : ""}>${isDeleting ? "Excluindo..." : "Excluir"}</button>
      </div>
    </article>
  `;
}

function getManualEventsForDisplayedMonth() {
  const rangeStart = toDateKey(state.year, state.month + 1, 1);
  const rangeEnd = toDateKey(state.year, state.month + 1, new Date(state.year, state.month + 1, 0).getDate());
  return (state.data.eventosManuais || [])
    .filter(isActiveManualEvent)
    .filter((event) => rangesOverlap(event.data_inicio || event.data, event.data_fim || event.data_inicio || event.data, rangeStart, rangeEnd))
    .sort((a, b) => String(a.data_inicio).localeCompare(String(b.data_inicio)));
}

function handleManualEventsListClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (state.deletingManualEventId || button.disabled) return;
  const id = button.dataset.id;
  if (button.dataset.action === "edit-manual") {
    editManualEvent(id);
  }
  if (button.dataset.action === "delete-manual") {
    deleteManualEvent(id);
  }
}

function editManualEvent(id) {
  const manualEvent = (state.data.eventosManuais || []).find((event) => event.id === id);
  if (!manualEvent) return;
  state.editingManualEventId = id;
  const form = document.getElementById("manualEventForm");
  form.hidden = false;
  document.getElementById("manualTitle").value = manualEvent.titulo || "";
  document.getElementById("manualType").value = manualEvent.tipo || "Campanha";
  document.getElementById("manualStartDate").value = manualEvent.data_inicio || "";
  document.getElementById("manualEndDate").value = manualEvent.data_fim || manualEvent.data_inicio || "";
  document.getElementById("manualProduct").value = manualEvent.produto_relacionado || "";
  document.getElementById("manualCampaign").value = manualEvent.campanha_relacionada || "";
  document.getElementById("manualPriority").value = manualEvent.prioridade || "Média";
  document.getElementById("manualOwner").value = manualEvent.responsavel || "";
  document.getElementById("manualStatusField").value = manualEvent.status || "Ativo";
  document.getElementById("manualObservation").value = manualEvent.observacao || "";
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.textContent = "Salvar edição";
  document.getElementById("manualTitle").focus();
  setManualStatus("Editando evento manual.");
}

async function deleteManualEvent(id) {
  const manualEvent = (state.data.eventosManuais || []).find((event) => event.id === id);
  if (!manualEvent) return;
  if (!window.confirm("Tem certeza que deseja excluir este evento manual?")) return;

  state.deletingManualEventId = id;
  setManualStatus("Excluindo evento...");
  renderManualEventsList();

  try {
    const canUseSharedApi = state.apiAvailable || (await ensureSharedEventsApiReady());
    if (canUseSharedApi) {
      const deleted = await deleteManualEventWithApi(id);
      if (deleted) {
        if (state.editingManualEventId === id) {
          resetManualEventForm();
          document.getElementById("manualEventForm").hidden = true;
        }
        removeManualEventLocally(id);
        setManualStatus("Evento manual excluido da base compartilhada.");
        setDataStatusMessage("Evento manual excluido da base compartilhada.");
        renderDashboard();
        return;
      }
      setManualStatus(
        `Nao foi possivel excluir na base compartilhada. O evento continua ativo. ${state.lastEventApiError || "Recarregue a pagina e tente novamente."}`
      );
      return;
    }

    state.data.eventosManuais = (state.data.eventosManuais || []).filter((event) => event.id !== id);
    state.deletedManualEventIds = [...new Set([...(state.deletedManualEventIds || []), id])];
    if (state.editingManualEventId === id) {
      resetManualEventForm();
      document.getElementById("manualEventForm").hidden = true;
    }
    buildIndexes();
    persistManualEvents();
    persistDeletedManualEventIds();
    setManualStatus("Evento manual excluido do fallback local.");
    renderDashboard();
  } finally {
    state.deletingManualEventId = null;
    renderManualEventsList();
  }
}

async function deleteManualEventWithApi(id) {
  try {
    state.lastEventApiError = "";
    const response = await fetch(`${API_BASE}/api/events/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || `HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    state.lastEventApiError = error.message || "Falha ao chamar DELETE /api/events.";
    state.apiAvailable = false;
    renderBackendStatus();
    return null;
  }
}
function exportManualEvents() {
  const payload = JSON.stringify(state.data.eventosManuais || [], null, 2);
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "eventos_manuais.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setManualStatus("Arquivo eventos_manuais.json exportado.");
}

function importManualEvents(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const imported = JSON.parse(String(reader.result || "[]"));
      if (!Array.isArray(imported)) {
        throw new Error("JSON precisa ser uma lista de eventos.");
      }
      if (state.apiAvailable) {
        await importManualEventsWithApi(imported);
        await reloadDataAfterManualEventChange();
        setManualStatus(`${imported.length} evento(s) importado(s) para a base compartilhada.`);
        renderDashboard();
        return;
      }
      state.data.eventosManuais = mergeManualEvents(state.data.eventosManuais || [], imported);
      const importedIds = new Set(mergeManualEvents([], imported).map((item) => item.id));
      state.deletedManualEventIds = (state.deletedManualEventIds || []).filter((id) => !importedIds.has(id));
      buildIndexes();
      persistManualEvents();
      persistDeletedManualEventIds();
      setManualStatus(`${imported.length} evento(s) importado(s).`);
      renderDashboard();
    } catch (error) {
      setManualStatus("Não foi possível importar o JSON de eventos manuais.");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file, "utf-8");
}

async function importManualEventsWithApi(events) {
  for (const manualEvent of normalizeManualEventsList(events)) {
    const response = await fetch(`${API_BASE}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(apiManualEventPayload(manualEvent)),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }
}

function setManualStatus(message) {
  document.getElementById("manualEventsStatus").textContent = message;
}

function updateControlVisibility() {
  const showCompareYear = state.compareMode === "manualYear" || state.compareMode === "manualMonth";
  const showFreeCompare = state.compareMode === "freeDate";

  const periodLabel = PERIOD_TYPE_LABELS[state.periodType] || "Período";
  const comparisonLabel = COMPARISON_LABELS[state.compareMode] || "Sem comparação";
  document.getElementById("periodButtonLabel").textContent = periodLabel;
  document.getElementById("comparisonButtonLabel").textContent = comparisonLabel;

  document.getElementById("compareYearSection").hidden = !showCompareYear;
  document.getElementById("freeCompareSection").hidden = !showFreeCompare;

  document.querySelectorAll("[data-period-option]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.periodOption === state.periodType);
  });
  document.querySelectorAll("[data-compare-option]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.compareOption === state.compareMode);
  });
}

function activeFilters() {
  return new Set(
    [...document.querySelectorAll("[data-filter]:checked")].map((input) => input.value)
  );
}

function indexByDate(rows = []) {
  return rows.reduce((acc, row) => {
    if (row.data) acc[row.data] = row;
    return acc;
  }, {});
}

function groupByDate(rows = []) {
  return rows.reduce((acc, row) => {
    if (!row.data) return acc;
    if (!acc[row.data]) acc[row.data] = [];
    acc[row.data].push(row);
    return acc;
  }, {});
}

function indexBySku(rows = []) {
  return rows.reduce((acc, row) => {
    if (row.sku) acc[row.sku] = row;
    return acc;
  }, {});
}

function aggregateProductsByComparisonKey(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = productComparisonKey(row);
    if (!key) return;
    const current =
      map.get(key) || {
        key,
        sku: row.sku || "",
        product_key: row.product_key || "",
        product_name: row.product_name || key,
        variant_title: row.variant_title || "",
        itens_vendidos: 0,
        receita_produto: 0,
        classificacao: row.classificacao || "",
      };
    current.sku = current.sku || row.sku || "";
    current.product_key = current.product_key || row.product_key || "";
    current.product_name = current.product_name || row.product_name || key;
    current.variant_title = current.variant_title || row.variant_title || "";
    current.itens_vendidos += Number(row.itens_vendidos || 0);
    current.receita_produto += Number(row.receita_produto || 0);
    if (row.classificacao === "queda" || row.classificacao === "destaque") {
      current.classificacao = row.classificacao;
    }
    map.set(key, current);
  });
  return map;
}

function productComparisonKey(row = {}) {
  return row.product_key || row.sku || row.product_name || "";
}

function makeEmptyProduct(reference = {}, key = "") {
  return {
    key,
    sku: reference.sku || "",
    product_key: reference.product_key || "",
    product_name: reference.product_name || key,
    variant_title: reference.variant_title || "",
    itens_vendidos: 0,
    receita_produto: 0,
    classificacao: "",
  };
}

function classifyProductComparison(current, compared, stock, itemVariation, revenueVariation) {
  const currentTotal = Number(current.receita_produto || 0) + Number(current.itens_vendidos || 0);
  const comparedTotal = Number(compared.receita_produto || 0) + Number(compared.itens_vendidos || 0);

  if (currentTotal > 0 && comparedTotal === 0) return "Novo no período";
  if (currentTotal === 0 && comparedTotal > 0) return "Sumiu no período";
  if (
    isStockRisky(stock.risk_status) &&
    (revenueVariation.direction === "negative" || itemVariation.direction === "negative")
  ) {
    return "Atenção";
  }
  if (Number(revenueVariation.percentChange || 0) <= -0.15 || Number(itemVariation.percentChange || 0) <= -0.15) {
    return "Queda";
  }
  if (Number(revenueVariation.percentChange || 0) >= 0.15 || Number(itemVariation.percentChange || 0) >= 0.15) {
    return "Destaque";
  }
  return "Estável";
}

function aggregateAcquisitionByComparisonKey(campaignRows, utmRows) {
  const map = new Map();

  campaignRows.forEach((row) => {
    const key = `campaign:${row.campaign_id || row.campaign_name || "sem-campanha"}`;
    const current = map.get(key) || {
      key,
      source: row.platform || "Campanha",
      name: row.campaign_name || row.campaign_id || "Campanha sem nome",
      orders: 0,
      revenue: 0,
      investment: 0,
      roas: null,
    };
    current.orders += Number(row.pedidos_atribuidos || 0);
    current.revenue += Number(row.receita_atribuida || 0);
    current.investment += Number(row.investimento || 0);
    current.roas = current.investment ? current.revenue / current.investment : null;
    map.set(key, current);
  });

  utmRows.forEach((row) => {
    const key = `utm:${row.utm_source || "-"}|${row.utm_medium || "-"}|${row.utm_campaign || "-"}`;
    const current = map.get(key) || {
      key,
      source: `${row.utm_source || "-"} / ${row.utm_medium || "-"}`,
      name: row.utm_campaign || row.channel || "UTM sem nome",
      orders: 0,
      revenue: 0,
      investment: 0,
      roas: null,
    };
    current.orders += Number(row.pedidos || 0);
    current.revenue += Number(row.receita || 0);
    map.set(key, current);
  });

  return map;
}

function makeEmptyAcquisition(reference = {}, key = "") {
  return {
    key,
    source: reference.source || "-",
    name: reference.name || key,
    orders: 0,
    revenue: 0,
    investment: 0,
    roas: null,
  };
}

function classifyAcquisitionComparison(current, compared, revenueVariation, ordersVariation) {
  const currentTotal = Number(current.revenue || 0) + Number(current.orders || 0);
  const comparedTotal = Number(compared.revenue || 0) + Number(compared.orders || 0);

  if (currentTotal > 0 && comparedTotal === 0) return "Nova no período";
  if (currentTotal === 0 && comparedTotal > 0) return "Sem performance atual";
  if (Number(revenueVariation.percentChange || 0) <= -0.15 || Number(ordersVariation.percentChange || 0) <= -0.15) {
    return "Queda";
  }
  if (Number(revenueVariation.percentChange || 0) >= 0.15 || Number(ordersVariation.percentChange || 0) >= 0.15) {
    return "Destaque";
  }
  return "";
}

function aggregateProducts(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = `${row.sku}-${row.classificacao}`;
    const current = map.get(key) || { ...row, itens_vendidos: 0, receita_produto: 0 };
    current.itens_vendidos += Number(row.itens_vendidos || 0);
    current.receita_produto += Number(row.receita_produto || 0);
    map.set(key, current);
  });
  return [...map.values()].sort((a, b) => {
    if (a.classificacao !== b.classificacao) return a.classificacao === "destaque" ? -1 : 1;
    return b.receita_produto - a.receita_produto;
  });
}

function aggregateCampaigns(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = row.campaign_name;
    const current = map.get(key) || {
      platform: row.platform,
      campaign_name: row.campaign_name,
      investimento: 0,
      receita_atribuida: 0,
      pedidos_atribuidos: 0,
    };
    current.investimento += Number(row.investimento || 0);
    current.receita_atribuida += Number(row.receita_atribuida || 0);
    current.pedidos_atribuidos += Number(row.pedidos_atribuidos || 0);
    current.roas = current.investimento ? current.receita_atribuida / current.investimento : 0;
    map.set(key, current);
  });
  return [...map.values()].sort((a, b) => b.receita_atribuida - a.receita_atribuida);
}

function aggregateUtms(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = `${row.utm_source}-${row.utm_campaign}`;
    const current = map.get(key) || {
      utm_source: row.utm_source,
      utm_campaign: row.utm_campaign,
      receita: 0,
      pedidos: 0,
    };
    current.receita += Number(row.receita || 0);
    current.pedidos += Number(row.pedidos || 0);
    map.set(key, current);
  });
  return [...map.values()].sort((a, b) => b.receita - a.receita);
}

function pickProduct(products, classification) {
  return products
    .filter((item) => item.classificacao === classification)
    .sort((a, b) => Number(b.receita_produto || 0) - Number(a.receita_produto || 0))[0];
}

function maxBy(rows, field) {
  return [...rows].sort((a, b) => Number(b[field] || 0) - Number(a[field] || 0))[0];
}

function metricRow(label, value) {
  return `<div class="metric-row"><span>${label}</span><strong>${value}</strong></div>`;
}

function trendValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return `<span class="trend-neutral">-</span>`;
  }
  if (Math.abs(value) < 0.0001) {
    return `<span class="trend-neutral">- ${formatPercent(0)}</span>`;
  }
  const className = value >= 0 ? "trend-up" : "trend-down";
  const arrow = value > 0 ? "↑" : "↓";
  return `<span class="${className}">${arrow} ${formatPercent(value, true)}</span>`;
}

function calculateVariation(current, comparison) {
  const currentValue = Number(current || 0);
  const comparisonValue = Number(comparison || 0);
  const absoluteChange = currentValue - comparisonValue;

  if (comparisonValue === 0 && currentValue > 0) {
    return {
      absoluteChange,
      percentChange: null,
      label: "Novo",
      direction: "positive",
    };
  }

  if (currentValue === 0 && comparisonValue > 0) {
    return {
      absoluteChange,
      percentChange: -1,
      label: "-100%",
      direction: "negative",
    };
  }

  if (currentValue === 0 && comparisonValue === 0) {
    return {
      absoluteChange: 0,
      percentChange: null,
      label: "-",
      direction: "neutral",
    };
  }

  const percentChange = absoluteChange / comparisonValue;
  return {
    absoluteChange,
    percentChange,
    label: formatPercent(percentChange, true),
    direction: percentChange > 0 ? "positive" : percentChange < 0 ? "negative" : "neutral",
  };
}

function calculateRoasVariation(current, comparison) {
  if (!comparison || !Number.isFinite(Number(comparison))) {
    return {
      absoluteChange: 0,
      percentChange: null,
      label: "-",
      direction: "neutral",
    };
  }
  return calculateVariation(current, comparison);
}

function variationBadge(result) {
  return `<span class="variation-pill ${result.direction}">${result.label}</span>`;
}

function classificationClass(value = "") {
  const normalized = slug(value);
  if (["queda", "sumiu-no-periodo", "sem-performance-atual"].includes(normalized)) return "danger";
  if (["atencao"].includes(normalized)) return "warning";
  if (["destaque", "novo-no-periodo", "nova-no-periodo"].includes(normalized)) return "success";
  if (["estavel"].includes(normalized)) return "neutral";
  return "";
}

function isStockRisky(status = "") {
  if (!status || status === "-") return false;
  return slug(status) !== "saudavel";
}

function formatOptionalRoas(value) {
  return value === null || value === undefined ? "-" : formatRoas(value);
}

function variation(current, previous) {
  if (!previous) return null;
  return (current - previous) / previous;
}

function previousYearDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return toDateKey(year - 1, month, day);
}

function toDateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDateLong(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatShortDate(dateKey) {
  if (!dateKey) return "-";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatBackendDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatCompactCurrency(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 1000000) return `R$ ${(number / 1000000).toFixed(1).replace(".", ",")} mi`;
  if (Math.abs(number) >= 1000) return `R$ ${(number / 1000).toFixed(0)} mil`;
  return formatCurrency(number);
}

function formatInteger(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDecimal(value) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function formatPercent(value, signed = false) {
  const number = Number(value || 0);
  const sign = signed && number > 0 ? "+" : "";
  return `${sign}${formatDecimal(number * 100)}%`;
}

function formatRoas(value) {
  return `${formatDecimal(value)}x`;
}

function formatSignedValue(value, formatter) {
  if (!Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatter(Math.abs(value))}`;
}

function slug(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function capitalize(value = "") {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function emptyTableRow(colspan) {
  return `<tr><td colspan="${colspan}">Sem dados para o mês selecionado.</td></tr>`;
}
