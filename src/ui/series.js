import { compositeView } from "../analysis/sample.js";
import { MS_TO_KT } from "../analysis/shear.js";

export function nearestSampleByX(samples, x, width) {
  if (!samples.length || width <= 0) return null;
  const sorted = [...samples].sort((a, b) => a.timeMs - b.timeMs);
  const t0 = sorted[0].timeMs;
  const t1 = sorted[sorted.length - 1].timeMs;
  const span = Math.max(1, t1 - t0);
  const target = t0 + (Math.max(0, Math.min(1, x / width)) * span);
  let best = sorted[0];
  let bestDt = Math.abs(best.timeMs - target);
  for (const sample of sorted) {
    const dt = Math.abs(sample.timeMs - target);
    if (dt < bestDt) {
      best = sample;
      bestDt = dt;
    }
  }
  return best;
}

function pathFor(samples, getter, minY, maxY, w, h, pad) {
  const t0 = samples[0].timeMs;
  const t1 = samples[samples.length - 1].timeMs;
  const span = Math.max(1, t1 - t0);
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const pts = [];
  for (const sample of samples) {
    const yv = getter(sample);
    if (!Number.isFinite(yv)) continue;
    const x = pad.l + ((sample.timeMs - t0) / span) * innerW;
    const y = pad.t + (1 - (yv - minY) / (maxY - minY || 1)) * innerH;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

function cursorX(samples, selected, w, pad) {
  if (!selected || !samples.length) return null;
  const t0 = samples[0].timeMs;
  const t1 = samples[samples.length - 1].timeMs;
  const span = Math.max(1, t1 - t0);
  return pad.l + ((selected.timeMs - t0) / span) * (w - pad.l - pad.r);
}

function drawChart(el, { title, unit, samples, selected, getter, minY, maxY, color, onSelect }) {
  const w = 360;
  const h = 80;
  const pad = { l: 28, r: 8, t: 16, b: 14 };
  const sorted = [...samples].sort((a, b) => a.timeMs - b.timeMs);
  const points = pathFor(sorted, getter, minY, maxY, w, h, pad);
  const cx = cursorX(sorted, selected, w, pad);
  el.innerHTML = `
    <div class="series-head">${title} <span>${unit}</span></div>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" tabindex="0" aria-label="${title}">
      <text x="2" y="${pad.t + 4}" class="axis">${maxY}</text>
      <text x="2" y="${h - pad.b}" class="axis">${minY}</text>
      <polyline fill="none" stroke="${color}" stroke-width="1.6" points="${points}" />
      <line data-cursor x1="${cx ?? pad.l}" x2="${cx ?? pad.l}" y1="${pad.t}" y2="${h - pad.b}" stroke="#f0b429" stroke-width="1" visibility="${cx != null ? "visible" : "hidden"}" />
    </svg>
  `;
  const svg = el.querySelector("svg");
  svg.addEventListener("click", (event) => {
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * w;
    const sample = nearestSampleByX(sorted, x - pad.l, w - pad.l - pad.r);
    if (sample) onSelect?.(sample);
  });
  svg.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const idx = selected ? sorted.findIndex((s) => s.timeMs === selected.timeMs && s.stationId === selected.stationId) : -1;
    const next = event.key === "ArrowRight"
      ? sorted[Math.min(sorted.length - 1, Math.max(0, idx) + (idx < 0 ? 0 : 1))]
      : sorted[Math.max(0, (idx < 0 ? 0 : idx) - 1)];
    if (next) onSelect?.(next);
  });
}

export function renderSeries(root, samples, selected, onSelect) {
  const dbzEl = root.querySelector("[data-series=dbz]");
  const meanEl = root.querySelector("[data-series=mean]");
  const compEl = root.querySelector("[data-series=composite]");
  const velEl = root.querySelector("[data-series=vel]");
  if (!dbzEl || !velEl) return;
  const list = samples || [];
  if (list.length < 2) {
    dbzEl.innerHTML = "";
    velEl.innerHTML = "";
    if (meanEl) meanEl.innerHTML = "";
    if (compEl) compEl.innerHTML = "";
    return;
  }
  drawChart(dbzEl, {
    title: "Reflectivity",
    unit: "dBZ",
    samples: list,
    selected,
    getter: (s) => s.dbz,
    minY: 0,
    maxY: 75,
    color: "#3ee0b2",
    onSelect,
  });
  if (meanEl) {
    drawChart(meanEl, {
      title: "5 km mean reflectivity",
      unit: "dBZ",
      samples: list,
      selected,
      getter: (s) => s.meanDbz,
      minY: 0,
      maxY: 75,
      color: "#5ec8e8",
      onSelect,
    });
  }
  if (compEl) {
    drawChart(compEl, {
      title: "Composite reflectivity",
      unit: "dBZ",
      samples: list,
      selected,
      getter: (s) => s.compositeDbz,
      minY: 0,
      maxY: 75,
      color: "#f0b429",
      onSelect: (sample) => onSelect?.(compositeView(sample), { product: "reflectivity", zoom: true }),
    });
  }
  drawChart(velEl, {
    title: "Radial velocity",
    unit: "kt",
    samples: list,
    selected,
    getter: (s) => (Number.isFinite(s.vrMs) ? s.vrMs * MS_TO_KT : NaN),
    minY: -80,
    maxY: 80,
    color: "#7aa2ff",
    onSelect,
  });
}

export function updateSeriesCursor(root, samples, selected) {
  const w = 360;
  const pad = { l: 28, r: 8, t: 16, b: 14 };
  const sorted = [...(samples || [])].sort((a, b) => a.timeMs - b.timeMs);
  const cx = cursorX(sorted, selected, w, pad);
  root.querySelectorAll("[data-cursor]").forEach((line) => {
    if (cx == null) {
      line.setAttribute("visibility", "hidden");
      return;
    }
    line.setAttribute("visibility", "visible");
    line.setAttribute("x1", String(cx));
    line.setAttribute("x2", String(cx));
  });
}
