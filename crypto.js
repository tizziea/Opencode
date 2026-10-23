/* ==========================================================================
   Panel cripto — mercado en vivo, búsqueda, filtros, fichas y gráficos
   Fuente: API pública de CoinGecko (sin API key ni dependencias externas).
   ========================================================================== */

(() => {
  "use strict";

  const API = "https://api.coingecko.com/api/v3";
  const CACHE_KEY = "tiziano:crypto:markets:v1";
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const AUTO_REFRESH = 5 * 60 * 1000;
  const MARKET_URL =
    `${API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=12&page=1` +
    "&sparkline=true&price_change_percentage=1h%2C24h%2C7d";

  const grid = document.getElementById("crypto-grid");
  if (!grid) return;

  const byId = (id) => document.getElementById(id);

  const dom = {
    grid,
    count: byId("crypto-count"),
    empty: byId("crypto-empty"),
    emptyQuery: byId("crypto-empty-query"),
    reset: byId("crypto-reset"),
    error: byId("crypto-error"),
    errorText: byId("crypto-error-text"),
    retry: byId("crypto-retry"),
    status: byId("crypto-status"),
    statusText: byId("crypto-status-text"),
    updated: byId("crypto-updated"),
    notice: byId("crypto-notice"),
    noticeText: byId("crypto-notice-text"),
    noticeRetry: byId("crypto-notice-retry"),
    metricCap: byId("metric-cap"),
    metricVolume: byId("metric-volume"),
    metricMovers: byId("metric-movers"),
    search: byId("crypto-search"),
    clearSearch: byId("crypto-search-clear"),
    filters: Array.from(document.querySelectorAll("[data-crypto-filter]")),
    sort: byId("crypto-sort"),
    refresh: byId("crypto-refresh"),
    dialog: byId("coin-modal"),
    modalContent: byId("coin-modal-content"),
    modalClose: byId("coin-modal-close"),
    modalSource: byId("coin-modal-source"),
    modalSourceText: byId("coin-modal-source-text")
  };

  const state = {
    coins: [],
    source: "loading",
    updatedAt: null,
    loading: false,
    query: "",
    filter: "all",
    sort: "market_cap_desc",
    activeCoinId: null,
    chartRange: 7,
    chartRequest: 0,
    detailRequest: 0
  };

  const detailCache = new Map();
  const chartCache = new Map();

  const marketFallback = window.CRYPTO_FALLBACK || null;
  const assetInfo = window.CRYPTO_ASSET_INFO || {};

  const numberFormatterCache = new Map();

  /* ----------------------------------------------------------------------
     Utilidades de formato
     ---------------------------------------------------------------------- */

  const toNumber = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

  const currencyFormatter = (min, max) => {
    const key = `${min}:${max}`;
    if (!numberFormatterCache.has(key)) {
      numberFormatterCache.set(
        key,
        new Intl.NumberFormat("es-AR", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: min,
          maximumFractionDigits: max
        })
      );
    }
    return numberFormatterCache.get(key);
  };

  const formatPrice = (value) => {
    if (!Number.isFinite(value)) return "—";
    if (value >= 10000) return currencyFormatter(0, 0).format(value);
    if (value >= 0.01) return currencyFormatter(2, 2).format(value);
    return currencyFormatter(4, 8).format(value);
  };

  const compactFormatter = new Intl.NumberFormat("es-AR", {
    notation: "compact",
    maximumFractionDigits: 2
  });

  const compactCurrencyFormatter = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2
  });

  const formatCompactCurrency = (value) => (Number.isFinite(value) ? compactCurrencyFormatter.format(value) : "—");

  const percentFormatter = new Intl.NumberFormat("es-AR", {
    style: "percent",
    signDisplay: "exceptZero",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const formatPercent = (value) => (Number.isFinite(value) ? percentFormatter.format(value / 100) : "—");

  const formatSupply = (value, symbol) => {
    if (!Number.isFinite(value)) return "—";
    return `${compactFormatter.format(value)} ${symbol || ""}`.trim();
  };

  const formatDate = (value, withTime = false) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("es-AR", withTime
      ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }
      : { day: "2-digit", month: "short", year: "numeric" }
    ).format(date);
  };

  const formatAxis = (value) => {
    if (!Number.isFinite(value)) return "";
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toLocaleString("es-AR", { maximumFractionDigits: 1 })}B`;
    if (abs >= 1e6) return `${(value / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 })}M`;
    if (abs >= 1e3) return `${(value / 1e3).toLocaleString("es-AR", { maximumFractionDigits: 1 })}K`;
    if (abs >= 1) return value.toLocaleString("es-AR", { maximumFractionDigits: 2 });
    return value.toLocaleString("es-AR", { maximumFractionDigits: 4 });
  };

  const changeClass = (value) => (value > 0.00001 ? "is-up" : value < -0.00001 ? "is-down" : "is-flat");

  const escapeHtml = (value) =>
    String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const safeUrl = (value) => {
    try {
      const url = new URL(String(value));
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  };

  const stripHtml = (value) => {
    if (!value) return "";
    const holder = document.createElement("div");
    holder.innerHTML = value;
    return (holder.textContent || "").replace(/\s+/g, " ").trim();
  };

  const truncate = (text, max = 1200) => {
    if (!text || text.length <= max) return text;
    return `${text.slice(0, max).replace(/\s+\S*$/, "")}…`;
  };

  /* ----------------------------------------------------------------------
     Red
     ---------------------------------------------------------------------- */

  class ApiError extends Error {
    constructor(message, status = 0) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }

  const fetchJson = async (url, timeout = 14000) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) {
        throw new ApiError(`CoinGecko respondió con estado ${response.status}.`, response.status);
      }
      return await response.json();
    } finally {
      window.clearTimeout(timer);
    }
  };

  const describeError = (error) => {
    if (error && error.name === "AbortError") {
      return "La conexión tardó demasiado. Revisá tu internet y volvé a intentar.";
    }
    if (error instanceof ApiError && error.status === 429) {
      return "CoinGecko limitó temporalmente la cantidad de consultas (error 429). Esperá un minuto y reintentá.";
    }
    if (error instanceof ApiError && error.status >= 500) {
      return "CoinGecko está teniendo problemas temporales. Esperá unos minutos y reintentá.";
    }
    return "No pudimos conectar con CoinGecko. Revisá tu conexión a internet y volvé a intentar.";
  };

  /* ----------------------------------------------------------------------
     Normalización y caché
     ---------------------------------------------------------------------- */

  const normalizeCoin = (raw) => {
    if (!raw || !raw.id) return null;
    const sparkline = Array.isArray(raw.sparkline)
      ? raw.sparkline
      : Array.isArray(raw.sparkline_in_7d && raw.sparkline_in_7d.price)
        ? raw.sparkline_in_7d.price
        : [];

    return {
      id: String(raw.id),
      symbol: String(raw.symbol || "").toUpperCase(),
      name: String(raw.name || raw.id),
      image: safeUrl(raw.image),
      rank: toNumber(raw.rank != null ? raw.rank : raw.market_cap_rank),
      price: toNumber(raw.price != null ? raw.price : raw.current_price),
      change1h: toNumber(raw.change1h != null ? raw.change1h : raw.price_change_percentage_1h_in_currency),
      change24h: toNumber(raw.change24h != null ? raw.change24h : raw.price_change_percentage_24h),
      change7d: toNumber(raw.change7d != null ? raw.change7d : raw.price_change_percentage_7d_in_currency),
      marketCap: toNumber(raw.marketCap != null ? raw.marketCap : raw.market_cap),
      volume: toNumber(raw.volume != null ? raw.volume : raw.total_volume),
      circulatingSupply: toNumber(raw.circulatingSupply != null ? raw.circulatingSupply : raw.circulating_supply),
      totalSupply: toNumber(raw.totalSupply != null ? raw.totalSupply : raw.total_supply),
      maxSupply: toNumber(raw.maxSupply != null ? raw.maxSupply : raw.max_supply),
      ath: toNumber(raw.ath),
      athChange: toNumber(raw.athChange != null ? raw.athChange : raw.ath_change_percentage),
      athDate: raw.athDate || raw.ath_date || null,
      high24h: toNumber(raw.high24h != null ? raw.high24h : raw.high_24h),
      low24h: toNumber(raw.low24h != null ? raw.low24h : raw.low_24h),
      fdv: toNumber(raw.fdv != null ? raw.fdv : raw.fully_diluted_valuation),
      lastUpdated: raw.lastUpdated || raw.last_updated || null,
      sparkline: sparkline.filter(Number.isFinite)
    };
  };

  const saveCache = () => {
    try {
      window.localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ savedAt: new Date().toISOString(), coins: state.coins })
      );
    } catch {
      /* El almacenamiento puede estar lleno o bloqueado: no es crítico. */
    }
  };

  const readCache = () => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(CACHE_KEY) || "null");
      if (!raw || !Array.isArray(raw.coins) || !raw.coins.length) return null;
      const savedAt = new Date(raw.savedAt);
      if (Number.isNaN(savedAt.getTime())) return null;
      if (Date.now() - savedAt.getTime() > CACHE_TTL) return null;
      const coins = raw.coins.map(normalizeCoin).filter(Boolean);
      return coins.length ? { savedAt, coins } : null;
    } catch {
      return null;
    }
  };

  /* ----------------------------------------------------------------------
     Carga de mercado
     ---------------------------------------------------------------------- */

  const setStatus = (kind, text) => {
    if (!dom.status) return;
    dom.status.dataset.state = kind;
    if (dom.statusText) dom.statusText.textContent = text;
  };

  const setBusy = (busy) => {
    if (dom.refresh) {
      dom.refresh.disabled = busy;
      dom.refresh.classList.toggle("is-loading", busy);
      dom.refresh.setAttribute("aria-busy", String(busy));
    }
    grid.setAttribute("aria-busy", String(busy));
  };

  const showNotice = (message) => {
    if (!dom.notice) return;
    if (dom.noticeText) dom.noticeText.textContent = message;
    dom.notice.hidden = false;
  };

  const hideNotice = () => {
    if (dom.notice) dom.notice.hidden = true;
  };

  const showError = (message) => {
    if (dom.errorText) dom.errorText.textContent = message;
    if (dom.error) dom.error.hidden = false;
    grid.hidden = true;
    if (dom.empty) dom.empty.hidden = true;
    if (dom.count) dom.count.textContent = "No hay datos para mostrar";
  };

  const hideError = () => {
    if (dom.error) dom.error.hidden = true;
  };

  const renderSkeletons = () => {
    grid.hidden = false;
    grid.innerHTML = Array.from({ length: 8 }, () => `
      <div class="coin-card coin-card--skeleton" aria-hidden="true">
        <div class="skeleton skeleton--row"><span class="skeleton skeleton--avatar"></span><span class="skeleton skeleton--line"></span></div>
        <span class="skeleton skeleton--price"></span>
        <span class="skeleton skeleton--chart"></span>
        <div class="skeleton skeleton--row"><span class="skeleton skeleton--line"></span><span class="skeleton skeleton--line"></span></div>
      </div>
    `).join("");
    if (dom.count) dom.count.textContent = "Cargando monedas…";
  };

  const loadMarket = async ({ manual = false, silent = false } = {}) => {
    if (state.loading) return;
    state.loading = true;
    hideError();
    setBusy(true);

    if (!silent) {
      setStatus("loading", manual ? "Actualizando datos…" : "Conectando con CoinGecko…");
      if (!state.coins.length) renderSkeletons();
    }

    try {
      const raw = await fetchJson(MARKET_URL);
      if (!Array.isArray(raw) || !raw.length) throw new ApiError("La API devolvió una respuesta vacía.");
      const coins = raw.map(normalizeCoin).filter(Boolean);
      if (!coins.length) throw new ApiError("La API no devolvió monedas válidas.");

      state.coins = coins;
      state.source = "live";
      state.updatedAt = new Date();
      saveCache();
      hideNotice();
      setStatus("live", "Datos en vivo");
    } catch (error) {
      if (silent && state.coins.length) {
        setStatus("stale", "Sin actualizar");
        showNotice(`No se pudo actualizar automáticamente (${describeError(error)}). Seguimos mostrando los últimos datos de las ${state.updatedAt ? state.updatedAt.toLocaleTimeString("es-AR") : "—"}.`);
        return;
      }

      const cached = readCache();
      if (cached) {
        state.coins = cached.coins;
        state.source = "cache";
        state.updatedAt = cached.savedAt;
        setStatus("cache", "Sin conexión · datos guardados");
        showNotice(
          `No pudimos actualizar desde CoinGecko. Mostramos los últimos datos guardados en este navegador (actualizados el ${formatDate(cached.savedAt, true)}). ` +
          "No son precios en tiempo real."
        );
      } else if (marketFallback && Array.isArray(marketFallback.coins) && marketFallback.coins.length) {
        state.coins = marketFallback.coins.map(normalizeCoin).filter(Boolean);
        state.source = "snapshot";
        state.updatedAt = new Date(marketFallback.generatedAt);
        setStatus("snapshot", "Sin conexión · respaldo");
        showNotice(
          `No pudimos conectar con CoinGecko. Mostramos una foto de respaldo actualizada el ${formatDate(state.updatedAt, true)}. ` +
          "No son precios en tiempo real: usalos solo como referencia."
        );
      } else {
        state.coins = [];
        state.source = "error";
        state.updatedAt = null;
        setStatus("error", "Error de conexión");
        showError(describeError(error));
      }
    } finally {
      state.loading = false;
      setBusy(false);
      renderAll();
    }
  };

  /* ----------------------------------------------------------------------
     Render del mercado
     ---------------------------------------------------------------------- */

  const getVisibleCoins = () => {
    const query = state.query.trim().toLowerCase();
    let list = state.coins.filter((coin) => {
      if (!query) return true;
      return coin.name.toLowerCase().includes(query) || coin.symbol.toLowerCase().includes(query);
    });

    if (state.filter === "up") list = list.filter((coin) => (coin.change24h || 0) > 0);
    if (state.filter === "down") list = list.filter((coin) => (coin.change24h || 0) < 0);

    const sorters = {
      market_cap_desc: (a, b) => (b.marketCap || 0) - (a.marketCap || 0),
      price_desc: (a, b) => (b.price || 0) - (a.price || 0),
      change_desc: (a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity),
      change_asc: (a, b) => (a.change24h ?? Infinity) - (b.change24h ?? Infinity),
      volume_desc: (a, b) => (b.volume || 0) - (a.volume || 0),
      rank_asc: (a, b) => (a.rank || Infinity) - (b.rank || Infinity)
    };

    const sorter = sorters[state.sort] || sorters.market_cap_desc;
    return list.slice().sort(sorter);
  };

  const sparklineSvg = (values, change) => {
    const points = Array.isArray(values) ? values.filter(Number.isFinite) : [];
    if (points.length < 3) return '<div class="coin-card__spark-empty">Sin gráfico de 7 días</div>';

    const width = 120;
    const height = 38;
    const pad = 2;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    const color = change >= 0 ? "#34d399" : "#fb7185";
    const coords = points.map((value, index) => {
      const x = pad + (index / (points.length - 1)) * (width - pad * 2);
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return `${x.toFixed(2)} ${y.toFixed(2)}`;
    });
    const line = coords.map((coord, index) => `${index ? "L" : "M"}${coord}`).join(" ");
    const area = `${line} L${(width - pad).toFixed(2)} ${height - pad} L${pad} ${height - pad} Z`;

    return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
      <path d="${area}" fill="${color}" opacity=".12"></path>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`;
  };

  const cardTemplate = (coin) => {
    const changeClassValue = changeClass(coin.change24h);
    const spark = sparklineSvg(coin.sparkline, coin.change7d ?? coin.change24h ?? 0);
    const updated = coin.lastUpdated ? formatDate(coin.lastUpdated, true) : "—";

    return `
      <article class="coin-card" data-coin="${escapeHtml(coin.id)}">
        <div class="coin-card__top">
          <div class="coin-card__identity">
            ${coin.image
              ? `<img class="coin-card__logo" src="${escapeHtml(coin.image)}" alt="" width="40" height="40" loading="lazy" decoding="async">`
              : `<span class="coin-card__logo coin-card__logo--fallback" aria-hidden="true">${escapeHtml(coin.symbol.slice(0, 3))}</span>`}
            <div class="coin-card__meta">
              <h3 class="coin-card__name">${escapeHtml(coin.name)}</h3>
              <p class="coin-card__symbol">${escapeHtml(coin.symbol)}${coin.rank ? ` · #${coin.rank}` : ""}</p>
            </div>
          </div>
          <span class="coin-card__change ${changeClassValue}">${formatPercent(coin.change24h)}</span>
        </div>

        <div class="coin-card__price-row">
          <strong class="coin-card__price">${formatPrice(coin.price)}</strong>
          <span class="coin-card__period">24 h</span>
        </div>

        <div class="coin-card__spark">${spark}</div>

        <dl class="coin-card__stats">
          <div><dt>Cap. de mercado</dt><dd>${formatCompactCurrency(coin.marketCap)}</dd></div>
          <div><dt>Volumen 24 h</dt><dd>${formatCompactCurrency(coin.volume)}</dd></div>
        </dl>

        <div class="coin-card__footer">
          <span class="coin-card__updated">Actualizado ${escapeHtml(updated)}</span>
          <button class="coin-card__btn" type="button" data-open-coin="${escapeHtml(coin.id)}" aria-label="Ver la ficha de ${escapeHtml(coin.name)}">
            Ver ficha
            <svg class="icon" aria-hidden="true"><use href="#icon-arrow-up-right"/></svg>
          </button>
        </div>
      </article>
    `;
  };

  const renderOverview = () => {
    if (!state.coins.length) {
      if (dom.metricCap) dom.metricCap.textContent = "—";
      if (dom.metricVolume) dom.metricVolume.textContent = "—";
      if (dom.metricMovers) dom.metricMovers.textContent = "—";
      return;
    }

    const totalCap = state.coins.reduce((sum, coin) => sum + (coin.marketCap || 0), 0);
    const totalVolume = state.coins.reduce((sum, coin) => sum + (coin.volume || 0), 0);
    const up = state.coins.filter((coin) => (coin.change24h || 0) > 0).length;

    if (dom.metricCap) dom.metricCap.textContent = formatCompactCurrency(totalCap);
    if (dom.metricVolume) dom.metricVolume.textContent = formatCompactCurrency(totalVolume);
    if (dom.metricMovers) dom.metricMovers.textContent = `${up} de ${state.coins.length}`;
  };

  const renderCoins = () => {
    if (!state.coins.length) {
      if (state.source === "error") {
        grid.hidden = true;
        if (dom.empty) dom.empty.hidden = true;
        return;
      }
      renderSkeletons();
      return;
    }

    const visible = getVisibleCoins();
    grid.hidden = visible.length === 0;
    grid.innerHTML = visible.map(cardTemplate).join("");
    grid.setAttribute("aria-busy", "false");

    if (dom.count) {
      const total = state.coins.length;
      const sortLabels = {
        market_cap_desc: "capitalización",
        price_desc: "precio",
        change_desc: "mayor suba",
        change_asc: "mayor baja",
        volume_desc: "volumen",
        rank_asc: "ranking"
      };
      dom.count.textContent = visible.length === total
        ? `${total} monedas · ordenadas por ${sortLabels[state.sort] || "capitalización"}`
        : `${visible.length} de ${total} monedas coinciden con tu búsqueda o filtros`;
    }

    if (dom.empty) {
      const isEmpty = visible.length === 0;
      dom.empty.hidden = !isEmpty;
      if (isEmpty && dom.emptyQuery) {
        dom.emptyQuery.textContent = state.query.trim()
          ? `«${state.query.trim()}»`
          : "los filtros seleccionados";
      }
    }
  };

  const renderUpdated = () => {
    if (!dom.updated) return;
    if (!state.updatedAt || Number.isNaN(state.updatedAt.getTime())) {
      dom.updated.textContent = "";
      return;
    }
    dom.updated.textContent = `Actualizado: ${formatDate(state.updatedAt, true)}`;
  };

  const renderAll = () => {
    hideErrorIfData();
    renderOverview();
    renderCoins();
    renderUpdated();
  };

  const hideErrorIfData = () => {
    if (state.coins.length) hideError();
  };

  /* ----------------------------------------------------------------------
     Controles
     ---------------------------------------------------------------------- */

  const resetFilters = () => {
    state.query = "";
    state.filter = "all";
    state.sort = "market_cap_desc";
    if (dom.search) dom.search.value = "";
    if (dom.clearSearch) dom.clearSearch.hidden = true;
    if (dom.sort) dom.sort.value = "market_cap_desc";
    dom.filters.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.cryptoFilter === "all"));
    });
    renderCoins();
  };

  const bindControls = () => {
    if (dom.search) {
      dom.search.addEventListener("input", () => {
        state.query = dom.search.value;
        if (dom.clearSearch) dom.clearSearch.hidden = !state.query;
        renderCoins();
      });
      dom.search.addEventListener("search", () => {
        state.query = dom.search.value;
        if (dom.clearSearch) dom.clearSearch.hidden = !state.query;
        renderCoins();
      });
    }

    if (dom.clearSearch) {
      dom.clearSearch.addEventListener("click", () => {
        state.query = "";
        dom.search.value = "";
        dom.clearSearch.hidden = true;
        dom.search.focus();
        renderCoins();
      });
    }

    dom.filters.forEach((button) => {
      button.addEventListener("click", () => {
        state.filter = button.dataset.cryptoFilter || "all";
        dom.filters.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
        renderCoins();
      });
    });

    if (dom.sort) {
      dom.sort.addEventListener("change", () => {
        state.sort = dom.sort.value;
        renderCoins();
      });
    }

    if (dom.refresh) {
      dom.refresh.addEventListener("click", () => loadMarket({ manual: true }));
    }

    if (dom.retry) dom.retry.addEventListener("click", () => loadMarket({ manual: true }));
    if (dom.noticeRetry) dom.noticeRetry.addEventListener("click", () => loadMarket({ manual: true }));
    if (dom.reset) dom.reset.addEventListener("click", resetFilters);

    grid.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-open-coin]");
      const card = event.target.closest(".coin-card");
      if (trigger) {
        openCoin(trigger.dataset.openCoin);
        return;
      }
      if (card && !event.target.closest("a, button")) {
        openCoin(card.dataset.coin);
      }
    });

    if (dom.dialog) {
      if (dom.modalClose) dom.modalClose.addEventListener("click", closeModal);
      dom.dialog.addEventListener("click", (event) => {
        if (event.target === dom.dialog) closeModal();
      });
      dom.dialog.addEventListener("close", () => {
        document.body.classList.remove("modal-open");
        state.activeCoinId = null;
      });
      dom.modalContent.addEventListener("click", (event) => {
        const retryButton = event.target.closest("[data-chart-retry]");
        if (retryButton) {
          const days = Number(retryButton.dataset.chartRetry);
          if (Number.isFinite(days)) setChartRange(days);
          return;
        }
        const rangeButton = event.target.closest("[data-range]");
        if (rangeButton) setChartRange(Number(rangeButton.dataset.range));
      });
    }
  };

  /* ----------------------------------------------------------------------
     Gráficos
     ---------------------------------------------------------------------- */

  const sparklinePoints = (coin) => {
    if (!coin || !Array.isArray(coin.sparkline) || coin.sparkline.length < 2) return [];
    const end = Date.parse(coin.lastUpdated || "");
    const endTime = Number.isFinite(end) ? end : Date.now();
    const span = 7 * 24 * 60 * 60 * 1000;
    const step = span / (coin.sparkline.length - 1);
    return coin.sparkline.map((value, index) => [endTime - (coin.sparkline.length - 1 - index) * step, value]);
  };

  const chartMoment = (timestamp, range) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "—";
    if (range === 1) {
      return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(date);
    }
    if (range === 7) {
      return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
    }
    return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  };

  const renderChart = (points, label, coin) => {
    const canvas = byId("coin-chart-canvas");
    if (!canvas) return;

    const clean = (Array.isArray(points) ? points : [])
      .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
      .sort((a, b) => a[0] - b[0]);

    if (clean.length < 2) {
      canvas.innerHTML = '<p class="chart-message">No hay datos suficientes para dibujar este gráfico.</p>';
      return;
    }

    const width = 640;
    const height = 240;
    const padLeft = 16;
    const padRight = 16;
    const padTop = 18;
    const padBottom = 22;

    const values = clean.map((point) => point[1]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = (max - min) * 0.08 || Math.max(Math.abs(max) * 0.01, 0.0001);
    const low = min - padding;
    const high = max + padding;
    const valueSpan = high - low || 1;

    const xAt = (index) => padLeft + (index / (clean.length - 1)) * (width - padLeft - padRight);
    const yAt = (value) => padTop + (1 - (value - low) / valueSpan) * (height - padTop - padBottom);

    const line = clean.map((point, index) => `${index ? "L" : "M"}${xAt(index).toFixed(2)} ${yAt(point[1]).toFixed(2)}`).join(" ");
    const area = `${line} L${xAt(clean.length - 1).toFixed(2)} ${(height - padBottom).toFixed(2)} L${padLeft} ${(height - padBottom).toFixed(2)} Z`;
    const trend = clean[clean.length - 1][1] - clean[0][1];
    const color = trend >= 0 ? "#34d399" : "#fb7185";
    const gradientId = `chart-gradient-${state.activeCoinId || "coin"}`;

    const gridLines = [0, 1, 2, 3].map((index) => {
      const y = padTop + (index / 3) * (height - padTop - padBottom);
      return `<line x1="${padLeft}" y1="${y.toFixed(2)}" x2="${width - padRight}" y2="${y.toFixed(2)}" stroke="rgba(148,163,184,.13)" stroke-width="1"></line>`;
    }).join("");

    const yLabels = [high, (high + low) / 2, low].map((value, index) => {
      const y = padTop + (index / 2) * (height - padTop - padBottom) - 6;
      return `<text x="${padLeft}" y="${y.toFixed(2)}" fill="rgba(148,163,184,.8)" font-size="10" font-family="Inter, sans-serif">${escapeHtml(formatAxis(value))}</text>`;
    }).join("");

    canvas.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico de precio de ${escapeHtml(coin.name)} en ${escapeHtml(label)}">
        <defs>
          <linearGradient id="${escapeHtml(gradientId)}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity=".3"></stop>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        ${gridLines}
        <path d="${area}" fill="url(#${escapeHtml(gradientId)})"></path>
        <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        <line class="chart-crosshair" x1="0" y1="${padTop}" x2="0" y2="${height - padBottom}" stroke="rgba(232,237,247,.38)" stroke-width="1" stroke-dasharray="3 4" opacity="0"></line>
        <circle class="chart-dot" r="4" fill="${color}" stroke="#0a0f1c" stroke-width="2" opacity="0"></circle>
        ${yLabels}
        <rect class="chart-hit" x="${padLeft}" y="${padTop}" width="${width - padLeft - padRight}" height="${height - padTop - padBottom}" fill="transparent"></rect>
      </svg>
      <div class="coin-chart__tooltip" aria-hidden="true"></div>
    `;

    const startEl = byId("coin-chart-start");
    const endEl = byId("coin-chart-end");
    if (startEl) {
      startEl.textContent = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(clean[0][0]));
    }
    if (endEl) {
      endEl.textContent = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(clean[clean.length - 1][0]));
    }

    const svg = canvas.querySelector("svg");
    const crosshair = canvas.querySelector(".chart-crosshair");
    const dot = canvas.querySelector(".chart-dot");
    const tooltip = canvas.querySelector(".coin-chart__tooltip");
    if (!svg || !crosshair || !dot || !tooltip) return;

    const showPoint = (event) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const index = Math.round(ratio * (clean.length - 1));
      const point = clean[index];
      const x = xAt(index);
      const y = yAt(point[1]);

      crosshair.setAttribute("x1", x);
      crosshair.setAttribute("x2", x);
      crosshair.setAttribute("opacity", "1");
      dot.setAttribute("cx", x);
      dot.setAttribute("cy", y);
      dot.setAttribute("opacity", "1");

      tooltip.innerHTML = `${escapeHtml(formatPrice(point[1]))}<span>${escapeHtml(chartMoment(point[0], state.chartRange))}</span>`;
      tooltip.style.left = `${(x / width) * 100}%`;
      tooltip.style.top = `${(y / height) * 100}%`;
      tooltip.style.opacity = "1";
    };

    const hidePoint = () => {
      crosshair.setAttribute("opacity", "0");
      dot.setAttribute("opacity", "0");
      tooltip.style.opacity = "0";
    };

    svg.addEventListener("pointermove", showPoint);
    svg.addEventListener("pointerdown", showPoint);
    svg.addEventListener("pointerleave", hidePoint);
  };

  const showChartMessage = (message, retryDays = null) => {
    const canvas = byId("coin-chart-canvas");
    if (!canvas) return;
    const retry = Number.isFinite(retryDays)
      ? `<button type="button" class="btn btn--ghost btn--sm chart-retry" data-chart-retry="${retryDays}">Reintentar</button>`
      : "";
    canvas.innerHTML = `
      <div class="chart-message">
        <p>${escapeHtml(message)}</p>
        ${retry}
      </div>
    `;
  };

  const setChartRange = async (days) => {
    const coin = state.coins.find((item) => item.id === state.activeCoinId);
    if (!coin || !Number.isFinite(days)) return;

    state.chartRange = days;
    const rangeButtons = Array.from(dom.modalContent.querySelectorAll("[data-range]"));
    rangeButtons.forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.range) === days)));

    const label = days === 1 ? "24 horas" : days === 7 ? "7 días" : days === 30 ? "30 días" : "1 año";
    const sub = byId("coin-chart-sub");
    if (sub) sub.textContent = `Precio en USD · últimos ${label}`;

    if (days === 7) {
      const points = sparklinePoints(coin);
      if (points.length > 1) {
        renderChart(points, label, coin);
        return;
      }
    }

    const cacheKey = `${coin.id}:${days}`;
    if (chartCache.has(cacheKey)) {
      renderChart(chartCache.get(cacheKey), label, coin);
      return;
    }

    const requestId = ++state.chartRequest;
    showChartMessage("Cargando gráfico…");

    try {
      const data = await fetchJson(`${API}/coins/${encodeURIComponent(coin.id)}/market_chart?vs_currency=usd&days=${days}`);
      if (requestId !== state.chartRequest || state.activeCoinId !== coin.id || state.chartRange !== days) return;
      const points = Array.isArray(data.prices) ? data.prices : [];
      if (points.length < 2) throw new ApiError("Sin datos para este rango.");
      chartCache.set(cacheKey, points);
      renderChart(points, label, coin);
    } catch (error) {
      if (requestId !== state.chartRequest || state.activeCoinId !== coin.id || state.chartRange !== days) return;
      const message = error instanceof ApiError && error.status === 429
        ? "CoinGecko limitó temporalmente las consultas. Esperá un minuto y reintentá, o volvé a 7D."
        : "No se pudo cargar este rango. Revisá tu conexión y probá de nuevo, o volvé a 7D.";
      showChartMessage(message, days);
    }
  };

  /* ----------------------------------------------------------------------
     Ficha de la moneda
     ---------------------------------------------------------------------- */

  const linkTemplate = (href, label, icon = "icon-arrow-up-right") => {
    const url = safeUrl(href);
    if (!url) return "";
    return `<a class="coin-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
      ${escapeHtml(label)}
      <svg class="icon" aria-hidden="true"><use href="#${icon}"/></svg>
    </a>`;
  };

  const infoSectionTemplate = (info) => {
    if (!info) {
      return `
        <div class="coin-modal__pending" id="coin-detail-pending">
          <p>Cargando descripción ampliada de CoinGecko…</p>
        </div>
        <div id="coin-detail-extra"></div>
      `;
    }

    const list = (items, className = "") => {
      if (!Array.isArray(items) || !items.length) return "";
      return `<ul class="coin-list ${className}">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    };

    const chips = (items) => {
      if (!Array.isArray(items) || !items.length) return "";
      return `<ul class="coin-chips">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    };

    return `
      <section class="coin-modal__section">
        <h4>Qué es y cómo funciona</h4>
        <p>${escapeHtml(info.description)}</p>
        <p class="coin-modal__how">${escapeHtml(info.how)}</p>
      </section>

      <section class="coin-modal__section">
        <h4>Tecnología y características</h4>
        ${chips(info.tech)}
        ${chips(info.features)}
      </section>

      <section class="coin-modal__section">
        <h4>Casos de uso</h4>
        ${chips(info.useCases)}
      </section>

      <div class="coin-proscons">
        <section class="coin-modal__section coin-modal__section--flush">
          <h4>Ventajas</h4>
          ${list(info.advantages, "coin-list--pros")}
        </section>
        <section class="coin-modal__section coin-modal__section--flush">
          <h4>Riesgos y límites</h4>
          ${list(info.risks, "coin-list--risks")}
        </section>
      </div>

      <div class="coin-links">
        ${linkTemplate(info.official, "Sitio oficial")}
        ${linkTemplate(info.docs, "Documentación", "icon-code")}
        ${linkTemplate(info.explorer, "Explorador", "icon-layers")}
      </div>
    `;
  };

  const modalTemplate = (coin, info) => {
    const category = info ? info.category : "Ficha de CoinGecko";

    return `
      <div class="coin-modal__head">
        ${coin.image
          ? `<img class="coin-modal__logo" src="${escapeHtml(coin.image)}" alt="" width="56" height="56" decoding="async">`
          : `<span class="coin-modal__logo coin-modal__logo--fallback" aria-hidden="true">${escapeHtml(coin.symbol.slice(0, 3))}</span>`}
        <div class="coin-modal__identity">
          <p class="coin-modal__rank">${coin.rank ? `Ranking #${coin.rank}` : "Ranking —"} · ${escapeHtml(category)}</p>
          <h3 id="coin-modal-title">${escapeHtml(coin.name)} <span>${escapeHtml(coin.symbol)}</span></h3>
        </div>
        <div class="coin-modal__price">
          <strong>${formatPrice(coin.price)}</strong>
          <span class="coin-card__change ${changeClass(coin.change24h)}">${formatPercent(coin.change24h)} <small>24 h</small></span>
        </div>
      </div>

      <div class="coin-chart">
        <div class="coin-chart__head">
          <div>
            <h4>Precio histórico</h4>
            <p class="coin-chart__sub" id="coin-chart-sub">Precio en USD · últimos 7 días</p>
          </div>
          <div class="range-buttons" role="group" aria-label="Rango del gráfico">
            <button type="button" class="range-btn" data-range="1" aria-pressed="false">1D</button>
            <button type="button" class="range-btn" data-range="7" aria-pressed="true">7D</button>
            <button type="button" class="range-btn" data-range="30" aria-pressed="false">30D</button>
            <button type="button" class="range-btn" data-range="365" aria-pressed="false">1A</button>
          </div>
        </div>
        <div class="coin-chart__canvas" id="coin-chart-canvas"></div>
        <div class="coin-chart__footer">
          <span id="coin-chart-start">—</span>
          <span>USD · CoinGecko</span>
          <span id="coin-chart-end">—</span>
        </div>
      </div>

      <dl class="coin-modal__stats">
        <div class="coin-stat"><dt>Capitalización</dt><dd id="coin-stat-cap">${formatCompactCurrency(coin.marketCap)}</dd></div>
        <div class="coin-stat"><dt>Volumen 24 h</dt><dd id="coin-stat-volume">${formatCompactCurrency(coin.volume)}</dd></div>
        <div class="coin-stat"><dt>Oferta circulante</dt><dd id="coin-stat-supply">${formatSupply(coin.circulatingSupply, coin.symbol)}</dd></div>
        <div class="coin-stat"><dt>Oferta máxima</dt><dd id="coin-stat-max">${Number.isFinite(coin.maxSupply) ? formatSupply(coin.maxSupply, coin.symbol) : "Sin tope definido"}</dd></div>
        <div class="coin-stat"><dt>Máximo histórico</dt><dd id="coin-stat-ath">${formatPrice(coin.ath)}${coin.athDate ? `<span class="coin-stat__hint">${escapeHtml(formatDate(coin.athDate))}</span>` : ""}</dd></div>
        <div class="coin-stat"><dt>Rango 24 h</dt><dd id="coin-stat-range">${formatPrice(coin.low24h)} – ${formatPrice(coin.high24h)}</dd></div>
      </dl>

      <div class="coin-modal__sections" id="coin-modal-sections">
        ${infoSectionTemplate(info)}
      </div>
      <div class="coin-links" id="coin-detail-links">${
        info ? linkTemplate(`https://www.coingecko.com/en/coins/${coin.id}`, "Ver en CoinGecko") : ""
      }</div>

      <p class="coin-modal__source">
        Datos de mercado: CoinGecko. Última actualización: ${escapeHtml(coin.lastUpdated ? formatDate(coin.lastUpdated, true) : "—")}.
        Información educativa, no constituye asesoramiento financiero.
      </p>
    `;
  };

  const applyDetail = (data, coin, info) => {
    if (!data || state.activeCoinId !== coin.id) return;

    const pending = byId("coin-detail-pending");

    if (!info) {
      const description = truncate(stripHtml(data.description && (data.description.es || data.description.en)), 1300);
      if (pending && description) {
        const section = document.createElement("section");
        section.className = "coin-modal__section";
        section.innerHTML = `<h4>Qué es</h4><p id="coin-description">${escapeHtml(description)}</p>`;
        pending.replaceWith(section);
      } else if (pending) {
        pending.innerHTML = "<p>CoinGecko no ofrece una descripción ampliada para esta moneda. Igual podés consultar sus datos de mercado, enlaces oficiales y gráfico.</p>";
      }

      const extra = byId("coin-detail-extra");
      if (extra) {
        const categories = Array.isArray(data.categories) ? data.categories.filter(Boolean).slice(0, 6) : [];
        if (categories.length) {
          extra.innerHTML = `<section class="coin-modal__section">
            <h4>Categorías</h4>
            <ul class="coin-chips">${categories.map((category) => `<li>${escapeHtml(category)}</li>`).join("")}</ul>
          </section>`;
        }
      }

      const links = byId("coin-detail-links");
      if (links) {
        const homepage = data.links && Array.isArray(data.links.homepage) ? data.links.homepage.find(Boolean) : "";
        const explorer = data.links && Array.isArray(data.links.blockchain_site) ? data.links.blockchain_site.find(Boolean) : "";
        links.innerHTML = [
          linkTemplate(homepage, "Sitio oficial"),
          linkTemplate(explorer, "Explorador", "icon-layers"),
          linkTemplate(`https://www.coingecko.com/en/coins/${coin.id}`, "Ver en CoinGecko")
        ].join("");
      }
    }

    const market = data.market_data || {};
    const maybeUpdate = (id, value, formatter) => {
      const node = byId(id);
      if (node && Number.isFinite(value)) node.textContent = formatter(value);
    };

    maybeUpdate("coin-stat-cap", market.market_cap && market.market_cap.usd, formatCompactCurrency);
    maybeUpdate("coin-stat-volume", market.total_volume && market.total_volume.usd, formatCompactCurrency);
    maybeUpdate("coin-stat-supply", market.circulating_supply, (value) => formatSupply(value, coin.symbol));

    if (!Number.isFinite(coin.maxSupply) && data.market_data && Number.isFinite(data.market_data.max_supply)) {
      const node = byId("coin-stat-max");
      if (node) node.textContent = formatSupply(data.market_data.max_supply, coin.symbol);
    }

    const source = document.querySelector(".coin-modal__source");
    if (source && data.last_updated) {
      source.textContent =
        `Datos de mercado: CoinGecko. Última actualización: ${formatDate(data.last_updated, true)}. ` +
        "Información educativa, no constituye asesoramiento financiero.";
    }
  };

  const loadCoinDetail = async (coin, info) => {
    if (detailCache.has(coin.id)) {
      applyDetail(detailCache.get(coin.id), coin, info);
      return;
    }

    const requestId = ++state.detailRequest;
    try {
      const data = await fetchJson(
        `${API}/coins/${encodeURIComponent(coin.id)}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`
      );
      if (requestId !== state.detailRequest || state.activeCoinId !== coin.id) return;
      detailCache.set(coin.id, data);
      applyDetail(data, coin, info);
    } catch {
      if (requestId !== state.detailRequest || state.activeCoinId !== coin.id) return;
      const pending = byId("coin-detail-pending");
      if (pending) {
        pending.innerHTML = info
          ? "<p>No se pudo ampliar la ficha ahora, pero la información educativa y los datos de mercado siguen disponibles.</p>"
          : "<p>No se pudo cargar la descripción ampliada. Podés consultar los datos de mercado, el gráfico y el enlace a CoinGecko.</p>";
      }
    }
  };

  const updateModalSource = () => {
    if (!dom.modalSource || !dom.modalSourceText) return;
    const labels = {
      live: "CoinGecko · datos en vivo",
      cache: "CoinGecko · datos guardados (no en vivo)",
      snapshot: "CoinGecko · foto de respaldo (no en vivo)",
      stale: "CoinGecko · datos sin actualizar"
    };
    dom.modalSource.dataset.state = state.source === "live" ? "live" : "stale";
    dom.modalSourceText.textContent = labels[state.source] || "CoinGecko · datos de mercado";
  };

  const openCoin = (coinId) => {
    if (!coinId) return;
    const coin = state.coins.find((item) => item.id === coinId);
    if (!coin || !dom.dialog) return;

    state.activeCoinId = coin.id;
    state.chartRange = 7;
    state.detailRequest += 1;
    const info = assetInfo[coin.id] || null;
    updateModalSource();

    dom.modalContent.innerHTML = modalTemplate(coin, info);
    if (!dom.dialog.open) dom.dialog.showModal();
    document.body.classList.add("modal-open");
    if (dom.modalClose) dom.modalClose.focus();

    const points = sparklinePoints(coin);
    if (points.length > 1) {
      renderChart(points, "7 días", coin);
    } else {
      showChartMessage("Estamos cargando el gráfico de 7 días…");
    }

    if (!info) loadCoinDetail(coin, info);
  };

  const closeModal = () => {
    if (dom.dialog && dom.dialog.open) dom.dialog.close();
  };

  /* ----------------------------------------------------------------------
     Arranque y actualización automática
     ---------------------------------------------------------------------- */

  const init = () => {
    dom.filters.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.cryptoFilter === "all"));
    });
    bindControls();
    loadMarket();

    window.setInterval(() => {
      if (document.hidden || dom.dialog && dom.dialog.open) return;
      loadMarket({ silent: true });
    }, AUTO_REFRESH);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden || !state.updatedAt) return;
      const stale = Date.now() - state.updatedAt.getTime() > AUTO_REFRESH;
      if (stale && state.source === "live") loadMarket({ silent: true });
    });
  };

  init();
})();
