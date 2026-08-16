import { MS_TO_KT } from "../analysis/shear.js";

const COMPACT = { w: 360, h: 96, pad: { l: 28, r: 8, t: 16, b: 16 } };
const WIDE = { w: 720, h: 240, pad: { l: 36, r: 14, t: 18, b: 28 } };

const REF_SERIES = [
  { key: "dbz", label: "Closest", getter: (s) => s.dbz, color: "#3ee0b2" },
  { key: "mean", label: "5 km mean", getter: (s) => s.meanDbz, color: "#5ec8e8" },
  { key: "composite", label: "Composite", getter: (s) => s.compositeDbz, color: "#f0b429" },
];

let viewRange = null;
let viewKey = "";
let lastRender = { samples: [], selected: null, onSelect: null };
let dialogBound = false;

export function seriesGapMs(samples) {
  const dts = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].timeMs - samples[i - 1].timeMs;
    if (dt > 0) dts.push(dt);
  }
  if (!dts.length) return 180_000;
  dts.sort((a, b) => a - b);
  const median = dts[Math.floor(dts.length / 2)];
  return Math.max(median * 2.5, 90_000);
}

export function splitSeriesSegments(samples, getter, maxGapMs) {
  const sorted = [...samples].sort((a, b) => a.timeMs - b.timeMs);
  const gap = Number.isFinite(maxGapMs) ? maxGapMs : seriesGapMs(sorted);
  const segments = [];
  let current = [];
  let prevTime = null;
  for (const sample of sorted) {
    const yv = getter(sample);
    if (!Number.isFinite(yv)) {
      if (current.length) segments.push(current);
      current = [];
      prevTime = null;
      continue;
    }
    if (prevTime != null && sample.timeMs - prevTime > gap) {
      if (current.length) segments.push(current);
      current = [];
    }
    current.push(sample);
    prevTime = sample.timeMs;
  }
  if (current.length) segments.push(current);
  return segments;
}

export function viewRangeAround(samples, timeMs, { padMs = 10 * 60 * 1000 } = {}) {
  if (!samples?.length || !Number.isFinite(timeMs)) return null;
  const sorted = [...samples].sort((a, b) => a.timeMs - b.timeMs);
  const tMin = sorted[0].timeMs;
  const tMax = sorted[sorted.length - 1].timeMs;
  const span = Math.max(1, tMax - tMin);
  const pad = Math.max(60_000, Math.min(padMs, span / 2));
  let t0 = timeMs - pad;
  let t1 = timeMs + pad;
  if (t0 < tMin) {
    t1 = Math.min(tMax, t1 + (tMin - t0));
    t0 = tMin;
  }
  if (t1 > tMax) {
    t0 = Math.max(tMin, t0 - (t1 - tMax));
    t1 = tMax;
  }
  if (t1 - t0 >= span * 0.92) return null;
  return { t0, t1 };
}

export function setSeriesViewAround(samples, timeMs, opts) {
  const sorted = [...(samples || [])].sort((a, b) => a.timeMs - b.timeMs);
  viewKey = sorted.length ? `${sorted[0].timeMs}:${sorted[sorted.length - 1].timeMs}:${sorted.length}` : "";
  viewRange = viewRangeAround(sorted, timeMs, opts);
  return viewRange;
}

export function timeSpan(samples, range) {
  if (!samples.length) return { t0: 0, t1: 1 };
  const tMin = samples[0].timeMs;
  const tMax = samples[samples.length - 1].timeMs;
  if (!range) return { t0: tMin, t1: tMax };
  const t0 = Math.max(tMin, Math.min(range.t0, range.t1));
  const t1 = Math.min(tMax, Math.max(range.t0, range.t1));
  return { t0, t1: t1 > t0 ? t1 : t0 + 1 };
}

export function nearestSampleByX(samples, x, width, range) {
  if (!samples.length || width <= 0) return null;
  const sorted = [...samples].sort((a, b) => a.timeMs - b.timeMs);
  const { t0, t1 } = timeSpan(sorted, range);
  const target = t0 + (Math.max(0, Math.min(1, x / width)) * Math.max(1, t1 - t0));
  const inView = range
    ? sorted.filter((s) => s.timeMs >= t0 && s.timeMs <= t1)
    : sorted;
  const pool = inView.length ? inView : sorted;
  let best = pool[0];
  let bestDt = Math.abs(best.timeMs - target);
  for (const sample of pool) {
    const dt = Math.abs(sample.timeMs - target);
    if (dt < bestDt) {
      best = sample;
      bestDt = dt;
    }
  }
  return best;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function xAt(timeMs, t0, t1, w, pad) {
  const span = Math.max(1, t1 - t0);
  return pad.l + ((timeMs - t0) / span) * (w - pad.l - pad.r);
}

function yAt(value, minY, maxY, h, pad) {
  const innerH = h - pad.t - pad.b;
  return pad.t + (1 - (value - minY) / (maxY - minY || 1)) * innerH;
}

function fmtAxisTime(ms) {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(11, 16) + "Z";
}

function cursorX(samples, selected, w, pad, range) {
  if (!selected || !samples.length) return null;
  const { t0, t1 } = timeSpan(samples, range);
  if (selected.timeMs < t0 || selected.timeMs > t1) return null;
  return xAt(selected.timeMs, t0, t1, w, pad);
}

function marksFor(samples, getter, minY, maxY, w, h, pad, range) {
  const { t0, t1 } = timeSpan(samples, range);
  const visible = samples.filter((s) => s.timeMs >= t0 && s.timeMs <= t1);
  const segments = splitSeriesSegments(visible, getter, seriesGapMs(samples));
  const paths = [];
  const dots = [];
  for (const seg of segments) {
    const pts = seg.map((sample) => {
      const x = xAt(sample.timeMs, t0, t1, w, pad);
      const y = yAt(getter(sample), minY, maxY, h, pad);
      return { x, y };
    });
    if (pts.length === 1) {
      dots.push(pts[0]);
      continue;
    }
    paths.push(pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "));
  }
  return { paths, dots };
}

function syncViewKey(samples) {
  const key = samples.length
    ? `${samples[0].timeMs}:${samples[samples.length - 1].timeMs}:${samples.length}`
    : "";
  if (key !== viewKey) {
    viewKey = key;
    viewRange = null;
  }
}

function setViewRange(range) {
  viewRange = range;
  rerender();
}

function resetView() {
  if (!viewRange) return;
  setViewRange(null);
}

function ensureDialogBound(dialog) {
  if (dialogBound || !dialog) return;
  dialogBound = true;
  dialog.querySelector("[data-chart-close]")?.addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-chart-reset]")?.addEventListener("click", resetView);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

function openChartDialog() {
  const dialog = document.getElementById("chart-dialog");
  if (!dialog) return;
  ensureDialogBound(dialog);
  if (!dialog.open) dialog.showModal();
  rerender();
}

function bindTools(el) {
  el.querySelectorAll("[data-chart-expand]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openChartDialog();
    });
  });
  el.querySelectorAll("[data-chart-reset]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      resetView();
    });
  });
}

function bindPlot(svg, { samples, selected, w, h, pad, onSelect }) {
  const innerW = w - pad.l - pad.r;
  const zoomRect = svg.querySelector("[data-zoom-rect]");
  let drag = null;

  const timeFromClientX = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * w;
    const { t0, t1 } = timeSpan(samples, viewRange);
    return t0 + clamp((x - pad.l) / innerW, 0, 1) * Math.max(1, t1 - t0);
  };

  const showZoomRect = (ta, tb) => {
    if (!zoomRect) return;
    const { t0, t1 } = timeSpan(samples, viewRange);
    const x0 = xAt(Math.min(ta, tb), t0, t1, w, pad);
    const x1 = xAt(Math.max(ta, tb), t0, t1, w, pad);
    zoomRect.setAttribute("x", String(x0));
    zoomRect.setAttribute("width", String(Math.max(0, x1 - x0)));
    zoomRect.setAttribute("visibility", "visible");
  };

  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    svg.setPointerCapture(event.pointerId);
    drag = { x0: event.clientX, t0: timeFromClientX(event.clientX), moved: false };
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag) return;
    if (Math.abs(event.clientX - drag.x0) > 6) drag.moved = true;
    if (drag.moved) showZoomRect(drag.t0, timeFromClientX(event.clientX));
  });
  svg.addEventListener("pointerup", (event) => {
    if (!drag) return;
    const t1 = timeFromClientX(event.clientX);
    const wasDrag = drag.moved;
    const tStart = drag.t0;
    drag = null;
    zoomRect?.setAttribute("visibility", "hidden");
    if (wasDrag) {
      const lo = Math.min(tStart, t1);
      const hi = Math.max(tStart, t1);
      if (hi - lo > 2000) setViewRange({ t0: lo, t1: hi });
      return;
    }
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * w;
    const sample = nearestSampleByX(samples, x - pad.l, innerW, viewRange);
    if (sample) onSelect?.(sample);
  });
  svg.addEventListener("dblclick", (event) => {
    event.preventDefault();
    resetView();
  });
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const full = timeSpan(samples, null);
    const fullSpan = Math.max(1, full.t1 - full.t0);
    const { t0, t1 } = timeSpan(samples, viewRange);
    const span = Math.max(1, t1 - t0);
    const center = timeFromClientX(event.clientX);
    const nextSpan = clamp(span * (event.deltaY > 0 ? 1.25 : 0.8), 15_000, fullSpan);
    let next0 = center - ((center - t0) / span) * nextSpan;
    let next1 = next0 + nextSpan;
    if (next0 < full.t0) {
      next0 = full.t0;
      next1 = next0 + nextSpan;
    }
    if (next1 > full.t1) {
      next1 = full.t1;
      next0 = next1 - nextSpan;
    }
    setViewRange(nextSpan >= fullSpan - 1 ? null : { t0: next0, t1: next1 });
  }, { passive: false });
  svg.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const idx = selected
      ? samples.findIndex((s) => s.timeMs === selected.timeMs && s.stationId === selected.stationId)
      : -1;
    const next = event.key === "ArrowRight"
      ? samples[Math.min(samples.length - 1, Math.max(0, idx) + (idx < 0 ? 0 : 1))]
      : samples[Math.max(0, (idx < 0 ? 0 : idx) - 1)];
    if (next) onSelect?.(next);
  });
}

function seriesTools(resetVisible) {
  return `
    <div class="series-tools">
      <button type="button" class="ghost" data-chart-reset ${resetVisible ? "" : "hidden"}>Reset</button>
      <button type="button" class="ghost" data-chart-expand>Expand</button>
    </div>
  `;
}

function drawChart(el, {
  title,
  unit,
  samples,
  selected,
  series,
  minY,
  maxY,
  onSelect,
  wide,
  legend = "",
}) {
  const { w, h, pad } = wide ? WIDE : COMPACT;
  const sorted = [...samples].sort((a, b) => a.timeMs - b.timeMs);
  const { t0, t1 } = timeSpan(sorted, viewRange);
  const cx = cursorX(sorted, selected, w, pad, viewRange);
  const stroke = wide ? 2 : 1.6;
  const layers = series.flatMap((line) => {
    const { paths, dots } = marksFor(sorted, line.getter, minY, maxY, w, h, pad, viewRange);
    const pathSvg = paths.map((d) =>
      `<path fill="none" stroke="${line.color}" stroke-width="${stroke}" d="${d}" />`
    ).join("");
    const dotSvg = dots.map((p) =>
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${wide ? 3 : 2.2}" fill="${line.color}" />`
    ).join("");
    return [pathSvg, dotSvg];
  }).join("");
  const timeLabels = wide
    ? `<text x="${pad.l}" y="${h - 6}" class="axis axis-x">${fmtAxisTime(t0)}</text>
      <text x="${w - pad.r}" y="${h - 6}" class="axis axis-x" text-anchor="end">${fmtAxisTime(t1)}</text>`
    : "";
  el.innerHTML = `
    <div class="series-head">
      <div class="series-title">${title} <span class="series-unit">${unit}</span></div>
      ${legend}
      ${seriesTools(Boolean(viewRange))}
    </div>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" tabindex="0" aria-label="${title}"
      data-chart-w="${w}" data-pad-l="${pad.l}" data-pad-r="${pad.r}">
      <text x="2" y="${pad.t + 4}" class="axis">${maxY}</text>
      <text x="2" y="${h - pad.b}" class="axis">${minY}</text>
      ${timeLabels}
      ${layers}
      <rect data-zoom-rect x="0" y="${pad.t}" width="0" height="${h - pad.t - pad.b}" fill="#f0b429" opacity="0.18" visibility="hidden" />
      <line data-cursor x1="${cx ?? pad.l}" x2="${cx ?? pad.l}" y1="${pad.t}" y2="${h - pad.b}" stroke="#f0b429" stroke-width="1" visibility="${cx != null ? "visible" : "hidden"}" />
    </svg>
  `;
  bindTools(el);
  bindPlot(el.querySelector("svg"), { samples: sorted, selected, w, h, pad, onSelect });
}

function refLegend() {
  const items = REF_SERIES.map((line) =>
    `<span><i style="background:${line.color}"></i>${line.label}</span>`
  ).join("");
  return `<div class="series-legend">${items}</div>`;
}

function paintCharts(root, { samples, selected, onSelect }, { wide = false } = {}) {
  const dbzEl = root.querySelector("[data-series=dbz]");
  const velEl = root.querySelector("[data-series=vel]");
  if (!dbzEl || !velEl) return;
  const list = samples || [];
  if (list.length < 2) {
    dbzEl.innerHTML = "";
    velEl.innerHTML = "";
    return;
  }
  drawChart(dbzEl, {
    title: "Reflectivity",
    unit: "dBZ",
    samples: list,
    selected,
    series: REF_SERIES,
    minY: 0,
    maxY: 75,
    onSelect,
    wide,
    legend: refLegend(),
  });
  drawChart(velEl, {
    title: "Radial velocity",
    unit: "kt",
    samples: list,
    selected,
    series: [{ key: "vel", label: "Vr", getter: (s) => (Number.isFinite(s.vrMs) ? s.vrMs * MS_TO_KT : NaN), color: "#7aa2ff" }],
    minY: -80,
    maxY: 80,
    onSelect,
    wide,
  });
}

function syncZoomButtons() {
  document.querySelectorAll("[data-chart-reset]").forEach((btn) => {
    btn.hidden = !viewRange;
  });
}

function rerender() {
  const { samples, selected, onSelect } = lastRender;
  const charts = document.getElementById("charts");
  if (charts) paintCharts(charts, { samples, selected, onSelect });
  const dialog = document.getElementById("chart-dialog");
  if (dialog?.open) paintCharts(dialog, { samples, selected, onSelect }, { wide: true });
  syncZoomButtons();
}

export function renderSeries(root, samples, selected, onSelect) {
  const list = samples || [];
  syncViewKey(list);
  lastRender = { samples: list, selected, onSelect };
  const host = root?.querySelector?.("[data-series=dbz]") ? root : document.getElementById("charts") || root;
  if (host) paintCharts(host, lastRender);
  const dialog = document.getElementById("chart-dialog");
  ensureDialogBound(dialog);
  if (dialog?.open) paintCharts(dialog, lastRender, { wide: true });
  syncZoomButtons();
}

export function updateSeriesCursor(root, samples, selected) {
  lastRender = { ...lastRender, samples: samples || lastRender.samples, selected };
  const hosts = [root, document.getElementById("chart-dialog")].filter(Boolean);
  for (const host of hosts) {
    const sorted = [...(samples || [])].sort((a, b) => a.timeMs - b.timeMs);
    host.querySelectorAll("svg[data-chart-w]").forEach((svg) => {
      const w = Number(svg.dataset.chartW) || COMPACT.w;
      const pad = { l: Number(svg.dataset.padL) || COMPACT.pad.l, r: Number(svg.dataset.padR) || COMPACT.pad.r };
      const cx = cursorX(sorted, selected, w, pad, viewRange);
      const line = svg.querySelector("[data-cursor]");
      if (!line) return;
      if (cx == null) {
        line.setAttribute("visibility", "hidden");
        return;
      }
      line.setAttribute("visibility", "visible");
      line.setAttribute("x1", String(cx));
      line.setAttribute("x2", String(cx));
    });
  }
}
