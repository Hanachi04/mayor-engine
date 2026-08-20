(() => {
  "use strict";

  // ----- config -----
  const OWNER = "lo77667";
  const REPO = "mayor-engine";
  const BRANCH = "main";
  const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/data`;
  const TRACKED_URL = `${RAW_BASE}/tracked.json`;
  const VERIFY_URL = `${RAW_BASE}/verification.json`;
  const REFRESH_MS = 5 * 60 * 1000; // auto-refresh every 5 minutes (engine runs every 30 min)
  const LS_KEY = "mayor_last_good_v1";

  // ----- dom refs -----
  const $ = (id) => document.getElementById(id);
  const els = {
    syncDot: $("syncDot"), syncText: $("syncText"), refreshBtn: $("refreshBtn"),
    gateCard: $("gateCard"), gateBadge: $("gateBadge"), gateBadgeText: $("gateBadgeText"),
    gateVersion: $("gateVersion"), gateHeadline: $("gateHeadline"), gateReason: $("gateReason"),
    gateWarnings: $("gateWarnings"),
    statTotal: $("statTotal"), statTotalSub: $("statTotalSub"), statOpen: $("statOpen"),
    statWinrate: $("statWinrate"), statWinrateSub: $("statWinrateSub"), statNet: $("statNet"),
    chartHolder: $("chartHolder"), chartCount: $("chartCount"),
    tradesList: $("tradesList"), tradeCount: $("tradeCount"), filters: $("filters"),
    installCard: $("installCard"), installText: $("installText"),
  };

  let state = { tracked: [], verification: null, filter: "all" };

  // ----- helpers -----
  const fmtPct = (n) => (n === null || n === undefined || isNaN(n)) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  const fmtNum = (n, d = 4) => (n === null || n === undefined || isNaN(n)) ? "—" : Number(n).toFixed(d).replace(/0+$/,"").replace(/\.$/,"");
  const fmtTime = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleString("ar-EG", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
  };
  const timeAgo = (date) => {
    const s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 60) return "الآن";
    if (s < 3600) return `منذ ${Math.floor(s/60)} د`;
    if (s < 86400) return `منذ ${Math.floor(s/3600)} س`;
    return `منذ ${Math.floor(s/86400)} يوم`;
  };

  function modeLabel(mode) {
    return { balanced: "⚖️ متوازن", momentum: "🚀 زخم", breakout: "📐 اختراق" }[mode] || mode;
  }

  function tradeStatus(t) {
    if (!t.closed) return "open";
    if (t.closeResult === "SL") return "loss";
    if (typeof t.closeResult === "string" && t.closeResult.startsWith("TP")) return "win";
    return "timeout"; // 48h expiry
  }

  // ----- arc svg for mtf / core consensus -----
  function arcSvg(pct, color) {
    const p = Math.max(0, Math.min(100, pct || 0));
    const r = 20, c = 2 * Math.PI * r, dash = (p/100) * c;
    return `<svg width="52" height="52" viewBox="0 0 52 52">
      <circle cx="26" cy="26" r="${r}" fill="none" stroke="#1e2b42" stroke-width="5"/>
      <circle cx="26" cy="26" r="${r}" fill="none" stroke="${color}" stroke-width="5"
        stroke-linecap="round" stroke-dasharray="${dash} ${c}"/>
    </svg>`;
  }

  // ----- render: gate -----
  function renderGate(v) {
    const card = els.gateCard;
    if (!v) {
      card.className = "gate loading";
      els.gateHeadline.textContent = "تعذر جلب حالة البوابة";
      els.gateReason.textContent = "تحقق من الاتصال أو من وجود data/verification.json في المستودع.";
      return;
    }
    const passed = v.passed === true && v.status === "PASS";
    card.className = "gate " + (passed ? "pass" : "blocked");
    els.gateBadge.className = "gate-badge " + (passed ? "pass" : "blocked");
    els.gateBadgeText.textContent = passed ? "البث الحي مسموح" : "البث محظور";
    els.gateVersion.textContent = v.gateVersion || "—";
    els.gateHeadline.textContent = passed
      ? "البوابة الإحصائية اجتازت كل الشروط"
      : "البوابة تمنع البث الحي حاليًا";
    els.gateReason.textContent = passed
      ? "النتائج التاريخية جاوزت اختبارات IS/OOS ومونت كارلو المطلوبة، والإشارات الجديدة تُبث فعليًا."
      : (v.reason ? `السبب: ${translateReason(v.reason)}` : "لم تتحقق شروط التحقق الإحصائي بعد.");
    els.gateWarnings.innerHTML = "";
    (v.warnings || []).forEach((w) => {
      const div = document.createElement("div");
      div.className = "gate-warn";
      div.textContent = translateReason(w);
      els.gateWarnings.appendChild(div);
    });
  }

  function translateReason(s) {
    if (!s) return s;
    return s
      .replace("one or more symbol gates blocked", "واحد أو أكثر من بوابات الأزواج محظورة")
      .replace(/IS sample small: (\d+)\/(\d+)/, "عينة العينة الداخلية صغيرة: $1 من $2 مطلوبة")
      .replace(/OOS sample small: (\d+)\/(\d+)/, "عينة خارج العينة صغيرة: $1 من $2 مطلوبة")
      .replace("Statistical gate not passed; live broadcast remains blocked", "البوابة الإحصائية لم تُجتز؛ البث الحي يبقى محظورًا")
      .replace("verification-file-missing", "ملف التحقق غير موجود في المستودع")
      .replace(/^verification-read-error:/, "خطأ في قراءة ملف التحقق: ");
  }

  // ----- render: stats -----
  function renderStats(list) {
    const closed = list.filter((t) => t.closed);
    const open = list.filter((t) => !t.closed);
    const wins = closed.filter((t) => tradeStatus(t) === "win");
    const winRate = closed.length ? (wins.length / closed.length) * 100 : null;
    const net = closed.reduce((s, t) => s + (typeof t.closePct === "number" ? t.closePct : 0), 0);

    els.statTotal.textContent = list.length;
    els.statTotalSub.textContent = `${closed.length} مغلقة`;
    els.statOpen.textContent = open.length;
    els.statWinrate.textContent = winRate === null ? "—" : `${winRate.toFixed(0)}%`;
    els.statWinrateSub.textContent = closed.length ? `${wins.length}/${closed.length}` : "لا صفقات مغلقة";
    els.statNet.textContent = closed.length ? fmtPct(net) : "—";
    els.statNet.className = "value" + (closed.length ? (net >= 0 ? " green" : " red") : "");
  }

  // ----- render: equity chart -----
  function renderChart(list) {
    const closed = list
      .filter((t) => t.closed && typeof t.closePct === "number")
      .sort((a, b) => (a.closeAt || "").localeCompare(b.closeAt || ""));
    els.chartCount.textContent = closed.length ? `${closed.length} صفقة` : "";
    if (!closed.length) {
      els.chartHolder.innerHTML = `<div class="chart-empty">لا توجد صفقات مغلقة بعد لرسم المنحنى</div>`;
      return;
    }
    let cum = 0;
    const points = closed.map((t) => (cum += t.closePct));
    const w = 320, h = 150, pad = 6;
    const min = Math.min(0, ...points), max = Math.max(0, ...points);
    const range = (max - min) || 1;
    const stepX = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
    const toY = (v) => h - pad - ((v - min) / range) * (h - pad * 2);
    const coords = points.map((v, i) => [pad + i * stepX, toY(v)]);
    const line = coords.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    const zeroY = toY(0).toFixed(1);
    const last = points[points.length - 1];
    const color = last >= 0 ? "#22d3a5" : "#ff5d73";
    const areaPath = `${line} L${coords[coords.length-1][0].toFixed(1)},${h-pad} L${coords[0][0].toFixed(1)},${h-pad} Z`;
    els.chartHolder.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <line x1="${pad}" y1="${zeroY}" x2="${w-pad}" y2="${zeroY}" stroke="#1e2b42" stroke-width="1" stroke-dasharray="3 3"/>
      <path d="${areaPath}" fill="${color}" opacity="0.08"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${coords[coords.length-1][0].toFixed(1)}" cy="${coords[coords.length-1][1].toFixed(1)}" r="3.5" fill="${color}"/>
    </svg>`;
    els.chartHolder.parentElement.querySelector(".chart-legend")?.remove();
    const legend = document.createElement("div");
    legend.className = "chart-legend";
    legend.innerHTML = `<span>البداية</span><span style="color:${color}">${fmtPct(last)} تراكمي</span>`;
    els.chartHolder.parentElement.appendChild(legend);
  }

  // ----- render: trade cards -----
  function tradeCard(t) {
    const status = tradeStatus(t);
    const dir = t.dir === "LONG" ? "long" : "short";
    const dirLabel = t.dir === "LONG" ? "شراء" : "بيع";
    const statusLabel = { open: "مفتوحة", win: "رابحة", loss: "خاسرة", timeout: "انتهت المدة" }[status];
    const pnl = t.closed
      ? `<span class="trade-pnl ${t.closePct >= 0 ? "green" : "red"}">${fmtPct(t.closePct)}</span>`
      : `<span class="trade-pnl pending">قيد المتابعة</span>`;
    const time = t.closed ? fmtTime(t.closeAt) : fmtTime(t.date ? t.ts ? new Date(t.ts).toISOString() : null : null);

    return `<div class="trade">
      <div class="trade-top">
        <div class="trade-sym">
          <span class="dir-badge ${dir}">${dirLabel}</span>
          <b>${t.symbol || "—"}</b>
        </div>
        <span class="status-pill ${status}">${statusLabel}</span>
      </div>
      <div class="trade-mid">
        <div class="arcs">
          <div class="arc-wrap">${arcSvg(t.mtfPct, "#4d9fff")}<div class="arc-label">${t.mtfPct ?? "—"}<small>MTF%</small></div></div>
          <div class="arc-wrap">${arcSvg(t.corePct, "#ffb545")}<div class="arc-label">${t.corePct ?? "—"}<small>تصويت%</small></div></div>
        </div>
        <div class="trade-levels mono">
          <div><span class="k">دخول</span> <span class="v">${fmtNum(t.price)}</span></div>
          <div><span class="k">RR</span> <span class="v">1:${t.rr ?? "—"}</span></div>
          <div><span class="k">SL</span> <span class="v" style="color:var(--red)">${fmtNum(t.sl)}</span></div>
          <div><span class="k">TP1</span> <span class="v" style="color:var(--green)">${fmtNum(t.tp1)}</span></div>
        </div>
      </div>
      <div class="trade-bottom">
        ${pnl}
        <span class="trade-time">${time}</span>
      </div>
      ${(t.strategyMode || Number.isFinite(t.sentiment)) ? `<div class="trade-meta">
        ${t.strategyMode ? `<span class="meta-chip">${modeLabel(t.strategyMode)}</span>` : ""}
        ${Number.isFinite(t.sentiment) ? `<span class="meta-chip">🌡️ ${t.sentiment}</span>` : ""}
      </div>` : ""}
    </div>`;
  }

  function renderTrades() {
    let list = [...state.tracked].sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (state.filter !== "all") list = list.filter((t) => tradeStatus(t) === state.filter);
    els.tradeCount.textContent = list.length ? `${list.length} إشارة` : "";
    if (!list.length) {
      els.tradesList.innerHTML = `<div class="empty-state">لا توجد إشارات في هذا التصنيف بعد.<br>المحرك يفحص السوق كل 30 دقيقة تلقائيًا.</div>`;
      return;
    }
    els.tradesList.innerHTML = list.map(tradeCard).join("");
  }

  // ----- data fetch -----
  async function fetchJson(url) {
    const res = await fetch(`${url}?cache=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function refresh(isManual) {
    if (isManual) els.refreshBtn.classList.add("spin");
    els.syncDot.className = "sync-dot";
    els.syncText.textContent = "جارٍ التحديث من GitHub…";
    try {
      const [tracked, verification] = await Promise.all([
        fetchJson(TRACKED_URL),
        fetchJson(VERIFY_URL).catch(() => null),
      ]);
      state.tracked = Array.isArray(tracked) ? tracked : [];
      state.verification = verification;
      localStorage.setItem(LS_KEY, JSON.stringify({ tracked: state.tracked, verification, at: Date.now() }));
      renderAll();
      els.syncDot.className = "sync-dot live";
      els.syncText.textContent = `محدّث الآن — ${new Date().toLocaleTimeString("ar-EG", {hour:"2-digit", minute:"2-digit"})}`;
    } catch (err) {
      const cached = localStorage.getItem(LS_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        state.tracked = parsed.tracked || [];
        state.verification = parsed.verification || null;
        renderAll();
        els.syncDot.className = "sync-dot stale";
        els.syncText.textContent = `تعذر التحديث — يُعرض آخر نسخة محفوظة (${timeAgo(new Date(parsed.at))})`;
      } else {
        els.syncDot.className = "sync-dot err";
        els.syncText.textContent = "تعذر الاتصال بالمستودع. تحقق من اتصال الإنترنت.";
      }
    } finally {
      if (isManual) setTimeout(() => els.refreshBtn.classList.remove("spin"), 500);
    }
  }

  function renderAll() {
    renderGate(state.verification);
    renderStats(state.tracked);
    renderChart(state.tracked);
    renderTrades();
  }

  // ----- events -----
  els.refreshBtn.addEventListener("click", () => refresh(true));
  els.filters.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter");
    if (!btn) return;
    [...els.filters.children].forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.filter = btn.dataset.f;
    renderTrades();
  });

  // pull state from cache immediately for instant paint, then refresh over network
  (function boot() {
    const cached = localStorage.getItem(LS_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        state.tracked = parsed.tracked || [];
        state.verification = parsed.verification || null;
        renderAll();
        els.syncText.textContent = `يُعرض آخر نسخة محفوظة (${timeAgo(new Date(parsed.at))})…`;
      } catch (_) {}
    }
    refresh(false);
    setInterval(() => refresh(false), REFRESH_MS);
  })();

  // ----- PWA install prompt -----
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    els.installCard.style.display = "block";
    els.installText.textContent = "اضغط هنا لإضافة اللوحة إلى شاشتك الرئيسية كتطبيق مستقل.";
    els.installCard.style.cursor = "pointer";
    els.installCard.onclick = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      els.installCard.style.display = "none";
    };
  });
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (isIos && !isStandalone) {
    els.installCard.style.display = "block";
    els.installText.textContent = "لإضافتها للشاشة الرئيسية: اضغط زر المشاركة أسفل Safari ثم «إضافة إلى الشاشة الرئيسية».";
  }

  // ----- service worker -----
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
