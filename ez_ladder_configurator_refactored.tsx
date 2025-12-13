import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Input, Label, Switch, Checkbox, Button, cn } from "./ui-shim";
// remove the old "@/components/ui/*" and "@/lib/utils" imports


// ────────────────────────────────────────────────────────────────────────────────
// Constants & Utilities
const SO2_WALL = [8.625, 9.75, 10.875, 12];
const SO3_WALL = [13.125, 14.25, 15.375];
const SO2_FEET = [8.5, 10.75, 11.875];
const SO3_FEET = [13, 14.125];

const ALL_STANDOFFS = [
  { type: "SO2" as const, sku: "LAD-SO2", options: SO2_WALL },
  { type: "SO3" as const, sku: "LAD-SO3", options: SO3_WALL },
];

const PRICES = {
  LADDER_PER_FT: 64.06,
  SPLICE_KIT: 48.6,
  "LAD-SO2": 22.5,
  "LAD-SO3": 24.6,
  FEET_SO2: 22.5,
  FEET_SO3: 24.6,
  "LAD-CP2": 1.36,
  "FL-WT-01": 329.22,
  "FL-PR-02": 146.44,
  "LSG-2030-PCY": 425,
  "FL-LGDFP-02": 620,
};

// --- ERP / BOM helpers -------------------------------------------------------
const ERP_SKU = {
  LADDER_SECTION_10FT: "FL-10",            // ladder is sold in 10' sections
  SPLICE_KIT: "LADDER SPLICE KIT",         // splice kit Inventory ID
  CLAMP_PAIR: "LAD-CP1",                   // component for wall standoffs (per pair: qty 2)
  CLAMP_PAIR_ALT: "LAD-CP2",               // alternate clamp plate for specific offsets (per pair: qty 2)
  STANDOFF_GUSSET: "LAD-SO1G",             // component for wall standoffs (per pair: qty 2)
};

const CLAMP_PAIR_ALT_OFFSETS = [10.875, 14.25, 15.375];
const isAltClampOffset = (offset: number) =>
  CLAMP_PAIR_ALT_OFFSETS.some(v => Math.abs(v - offset) < 1e-6);

const normalizeSku = (s: string) => s.replace(/[‐-‒–—―]/g, "-");

const inchesToFeet = (inches: number) => inches / 12;
const feetToInches = (feet: number) => feet * 12;
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const fmtFeet = (ft: number) => `${Math.floor(ft)}'-${Math.round((ft % 1) * 12)}″`;
const fmtInches = (inch: number) => `${Math.floor(inch / 12)}'-${Math.round(inch % 12)}″`;

// Simple icons
const ArrowVertical = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 3v18" /><path d="M7 6l5-4 5 4" /><path d="M7 18l5 4 5-4" />
  </svg>
);
const ArrowHorizontal = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 12h18" /><path d="M6 7l-4 5 4 5" /><path d="M18 7l4 5-4 5" />
  </svg>
);

// ────────────────────────────────────────────────────────────────────────────────
// Sectioning in WHOLE-FOOT increments, 3–10 ft per section, fewest splices
function sectionizeEven(totalFeet: number) {
  if (totalFeet <= 0) return { sections: [] as number[], error: "Height must be positive." };
  const tgt = Math.max(3, Math.ceil(totalFeet)); // BOM = shortest integer feet ≥ requested
  const tryBuild = (n: number) => {
    const base = Math.floor(tgt / n); if (base < 3) return null;
    const rem = tgt - base * n; const arr = Array(n).fill(base).map((v, i) => v + (i < rem ? 1 : 0));
    return arr.some(v => v > 10) ? null : arr;
  };
  let n = Math.max(1, Math.ceil(tgt / 10)), out: number[] | null = null;
  while (!out && n <= 100) out = tryBuild(n++) as number[] | null;
  return out ? { sections: out, error: null as string | null } : { sections: [], error: "Unable to sectionize height under constraints." };
}

const computeSplices = (sections: number[]) => Math.max(0, sections.length - 1);

// Build rung grid based on rules
// - With feet: build BOTTOM→TOP starting at exact feet increment (e.g., 14.125") and step 12" up to top
// - Without feet: build TOP→DOWN and stop at computed first‑rung height (6–15") so we never show a rung at ground
function computeRungInfo(
  totalInches: number,
  usingFeet: boolean,
  _feetType?: string,
  firstRungIn?: number | null
) {
  let rungPositions: number[] = [];

  if (usingFeet && firstRungIn != null) {
    const out: number[] = [];
    for (let y = firstRungIn; y <= totalInches + 1e-6; y += 12) out.push(round(y));
    if (!out.length || Math.abs(out[out.length - 1] - totalInches) > 1e-6) out.push(round(totalInches));
    rungPositions = out.reverse(); // top→bottom
  } else {
    const limit = typeof firstRungIn === "number" ? Math.max(0, firstRungIn) : 0;
    const count = Math.max(1, Math.floor(totalInches / 12) + 1);
    const arr = Array.from({ length: count + 1 }, (_, i) => totalInches - i * 12).filter(v => v >= limit - 1e-6);
    if (arr.length && Math.abs(arr[arr.length - 1] - limit) > 1e-6 && limit > 0) arr.push(limit);
    rungPositions = arr;
  }

  let alignment: null | { aligned: boolean; offsetIn: number } = null;
  if (usingFeet && firstRungIn != null) {
    const remainder = (totalInches - firstRungIn) % 12; const aligned = Math.abs(remainder) < 1e-6;
    alignment = { aligned, offsetIn: aligned ? 0 : round(remainder) };
  }
  return { rungPositions, alignment };
}

function resolveStandoffSpec(targetInches: number) {
  const opts = ALL_STANDOFFS.flatMap(s => s.options.map(v => ({ type: s.type, sku: s.sku, value: v, delta: Math.abs(v - targetInches) })));
  opts.sort((a, b) => (a.delta === b.delta ? (a.type < b.type ? -1 : 1) : a.delta - b.delta));
  const best = opts[0];
  const range = ALL_STANDOFFS.flatMap(s => s.options);
  const inRange = targetInches >= Math.min(...range) && targetInches <= Math.max(...range);
  return { type: best.type, sku: best.sku, valueInches: best.value, exact: best.delta < 1e-6, inRange };
}

const Money = ({ value }: { value: number }) => <span>{(Number.isFinite(value) ? value : 0).toLocaleString("en-US", { style: "currency", currency: "USD" })}</span>;

// Height/feet planner per spec
function planHeightAndFeet(userInches: number, useFeet: boolean) {
  const MIN_BR = 6; // inches
  const MAX_BR = 15; // inches

  if (!useFeet) {
    // For an N‑ft ladder (N rungs @12"), bottom rung height = H - 12*(N-1)
    // Find smallest N ≥ 1 with MIN_BR ≤ H - 12*(N-1) ≤ MAX_BR
    const lower = Math.ceil((userInches - MAX_BR) / 12); // N-1 ≥ lower
    const upper = Math.floor((userInches - MIN_BR) / 12); // N-1 ≤ upper
    const nMinus1 = Math.max(0, Math.min(Math.max(lower, 0), upper));
    const ladderFeetFt = nMinus1 + 1;
    const firstRungInches = userInches - 12 * (ladderFeetFt - 1);
    return { totalInches: userInches, feet: null as null, ladderFeetFt, firstRungInches };
  }

  type FeetOpt = { type: "SO2"|"SO3"; sku: string; firstRungInches: number };
  const allowed: FeetOpt[] = [
    ...SO2_FEET.map(v => ({ type: "SO2" as const, sku: "LAD-SO2", firstRungInches: v })),
    ...SO3_FEET.map(v => ({ type: "SO3" as const, sku: "LAD-SO3", firstRungInches: v })),
  ].filter(c => c.firstRungInches >= 6 - 1e-6 && c.firstRungInches <= 15 + 1e-6);

  let best: FeetOpt | null = null; let bestMis = Infinity;
  for (const c of allowed) {
    const rem = ((userInches - c.firstRungInches) % 12 + 12) % 12; // 0..12
    const mis = Math.min(rem, (12 - rem) % 12);
    if (mis < bestMis - 1e-6 || (Math.abs(mis - bestMis) < 1e-6 && best?.type === "SO3" && c.type === "SO2")) { best = c; bestMis = mis; }
  }
  const firstRungInches = best?.firstRungInches ?? 6;
  const intervals = Math.max(0, Math.round((userInches - firstRungInches) / 12));
  const ladderFeetFt = intervals + 1;
  return { totalInches: userInches, feet: best, ladderFeetFt, firstRungInches };
}

// ────────────────────────────────────────────────────────────────────────────────
// 2D SVG Visualizer
function LadderSVG({ totalInches, rungPositions, standoffPositions, splicesFeet, useFeetAnchors, wallOffset, parapetEnabled, parapetWidth, parapetHeight }: {
  totalInches: number; rungPositions: number[]; standoffPositions: number[]; splicesFeet: number[]; useFeetAnchors: boolean; wallOffset: number; parapetEnabled: boolean; parapetWidth: number; parapetHeight: number;
}) {
  const LADDER_WIDTH_IN = 20, H = 560, pad = 16, innerH = H - pad * 2;
  const topOverhangIn = 6; // always 6" at top
  const bottomOverhangIn = 6; // always show rails 6" below the bottom rung in the drawing domain
  const domainInches = totalInches + topOverhangIn + bottomOverhangIn;
  const scale = domainInches > 0 ? innerH / domainInches : 1;
  const frontInnerW = LADDER_WIDTH_IN * scale, sideGutter = 40, sideWidth = Math.max(180, Math.round(wallOffset * scale + 100));
  const W = Math.max(360, Math.round(pad * 2 + frontInnerW + sideGutter + sideWidth));
  const cx = pad + frontInnerW / 2 + (W - (pad * 2 + frontInnerW + sideGutter + sideWidth)) / 2;
  const leftX = cx - frontInnerW / 2, rightX = cx + frontInnerW / 2, railWidthPx = Math.max(6, Math.min(10, scale * 2.25));
  const bottomY = pad + innerH, inchToY = (inch: number) => bottomY - (inch + bottomOverhangIn) * scale;
  const yGround = inchToY(0);

  // Rails must not project below ground. Always extend 6" below the bottom rung visually, clamped to ground.
  const bottomRungIn = rungPositions.length ? rungPositions[rungPositions.length - 1] : 0;
  const railLowerInches = Math.max(0, bottomRungIn - 6);
  const yTopRail = inchToY(totalInches + topOverhangIn);
  const yBottomRail = inchToY(railLowerInches);
  const railHeight = Math.max(0, yBottomRail - yTopRail);

  // Feet attach point used in both front and side views (vertical leg overlaps rail ~4")
  const yFeetAttach = inchToY(Math.min(Math.max(0, bottomRungIn - 6) + 4, bottomRungIn - 0.5));

  const mids: number[] = rungPositions.slice(0, -1).map((r, i) => (r + rungPositions[i + 1]) / 2); // for splice visualization only
  // Standoffs attach at **rungs**; snap to nearest rung height for drawing
  const snapRung = (inch: number) => (rungPositions.length ? rungPositions.reduce((b, a) => (Math.abs(a - inch) < Math.abs(b - inch) ? a : b)) : inch);
  const snapped = standoffPositions.map(ft => snapRung(ft * 12));
  const topRungY = inchToY(totalInches);
  const roofY = topRungY;

  const DimV = ({ x, y1, y2, label }: { x: number; y1: number; y2: number; label: string }) => {
    const yTop = Math.min(y1, y2), yBot = Math.max(y1, y2), mid = (yTop + yBot) / 2;
    return (
      <g>
        <line x1={x} y1={yTop} x2={x} y2={yBot} stroke="rgb(17,24,39)" strokeWidth={1.5} />
        <line x1={x - 6} y1={yTop} x2={x + 6} y2={yTop} stroke="rgb(17,24,39)" strokeWidth={1.5} />
        <line x1={x - 6} y1={yBot} x2={x + 6} y2={yBot} stroke="rgb(17,24,39)" strokeWidth={1.5} />
        <rect x={x - 34} y={mid - 10} width={68} height={20} fill="#fff" stroke="#e5e7eb" />
        <text x={x} y={mid + 4} fontSize={10} textAnchor="middle" fill="#111827">{label}</text>
      </g>
    );
  };
  const DimHRight = ({ y, x1, x2, label }: { y: number; x1: number; x2: number; label: string }) => {
    const xL = Math.min(x1, x2), xR = Math.max(x1, x2);
    return (
      <g>
        <line x1={xL} y1={y} x2={xR} y2={y} stroke="#111827" />
        <line x1={xL} y1={y - 6} x2={xL} y2={y + 6} stroke="#111827" />
        <line x1={xR} y1={y - 6} x2={xR} y2={y + 6} stroke="#111827" />
        <text x={xR + 8} y={y} fontSize={10} textAnchor="start" dominantBaseline="central" fill="#111827">{label}</text>
      </g>
    );
  };
  const sideStartX = rightX + 40, wallX = sideStartX + 24, rungCenterX = wallX + wallOffset * scale;
  const showParapet = parapetEnabled && parapetWidth > 0;
  const parapetBackX = wallX + Math.max(0, parapetWidth) * scale;
  const parapetTopY = roofY - Math.max(0, parapetHeight) * scale;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {/* FRONT */}
      <rect x={leftX - railWidthPx / 2} y={yTopRail} width={railWidthPx} height={railHeight} fill="#444" rx={2} />
      <rect x={rightX - railWidthPx / 2} y={yTopRail} width={railWidthPx} height={railHeight} fill="#444" rx={2} />
      {rungPositions.map((rin, i) => (<line key={i} x1={leftX} x2={rightX} y1={inchToY(rin)} y2={inchToY(rin)} stroke="#777" strokeWidth={Math.max(3, scale * 0.9)} />))}
      {mids.map((mi, i) => (
        <g key={`holes-${i}`}>
          <rect x={leftX - railWidthPx / 4} y={inchToY(mi) - 2} width={railWidthPx / 2} height={4} fill="#9ca3af" rx={1} />
          <rect x={rightX - railWidthPx / 4} y={inchToY(mi) - 2} width={railWidthPx / 2} height={4} fill="#9ca3af" rx={1} />
        </g>
      ))}
      {splicesFeet.map((sf, i) => {
        const y = inchToY(sf * 12), h = 4 * scale; return (
          <g key={`sp-${i}`}>
            <rect x={leftX - railWidthPx / 2 - 4} y={y - h / 2} width={2} height={h} fill="#f97316" />
            <rect x={rightX + railWidthPx / 2 + 2} y={y - h / 2} width={2} height={h} fill="#f97316" />
          </g>
        );
      })}
      {standoffPositions.map((ft, i) => (
        <g key={`s-${i}`}>
          <circle cx={leftX} cy={inchToY(ft * 12)} r={5} fill="#2563eb" />
          <circle cx={rightX} cy={inchToY(ft * 12)} r={5} fill="#2563eb" />
        </g>
      ))}
      {/* Feet L‑brackets (bent plate) when feet are used */}
      {useFeetAnchors && (
        <g>
          {(() => {
            const inset = 2; // small visual gap off the rail face
            const baseLenPx = 3 * scale; // horizontal leg = 3 inches
            const strokeW = Math.max(2, 2.5);
            const yAttachTop = yFeetAttach;
            const xLeftFace = leftX - railWidthPx / 2 - inset;
            const xRightFace = rightX + railWidthPx / 2 + inset;
            const dLeft = `M ${xLeftFace} ${yAttachTop} L ${xLeftFace} ${yGround} L ${xLeftFace - baseLenPx} ${yGround}`;
            const dRight = `M ${xRightFace} ${yAttachTop} L ${xRightFace} ${yGround} L ${xRightFace + baseLenPx} ${yGround}`;
            return (<>
              <path d={dLeft} fill="none" stroke="#1f2937" strokeWidth={strokeW} strokeLinecap="square" strokeLinejoin="miter" />
              <path d={dRight} fill="none" stroke="#1f2937" strokeWidth={strokeW} strokeLinecap="square" strokeLinejoin="miter" />
            </>);
          })()}
        </g>
      )}
      <DimV x={leftX - 28} y1={inchToY(0)} y2={topRungY} label={`Top rung ${fmtInches(totalInches)}`} />

      {/* SIDE */}
      <g>
        {/* Structure dashed line clipped to ground */}
        <line x1={wallX} y1={pad} x2={wallX} y2={yGround} stroke="#374151" strokeDasharray="4 4" />
        {showParapet && (
          <g>
            <line x1={wallX} y1={parapetTopY} x2={parapetBackX} y2={parapetTopY} stroke="#dc2626" strokeDasharray="6 4" />
            <line x1={wallX} y1={roofY} x2={parapetBackX} y2={roofY} stroke="#dc2626" strokeDasharray="6 4" />
            <line x1={parapetBackX} y1={parapetTopY} x2={parapetBackX} y2={roofY} stroke="#dc2626" strokeDasharray="6 4" />
          </g>
        )}
        {/* Ladder rail (profile) */}
        <line x1={rungCenterX} y1={yTopRail} x2={rungCenterX} y2={yBottomRail} stroke="#6b7280" strokeWidth={railWidthPx} />

        {/* Splices shown on side view (orange straps across rail) */}
        {splicesFeet.map((sf, i) => {
          const y = inchToY(sf * 12);
          const h = Math.max(8, 8); // ~8 px tall marker
          const w = railWidthPx + 6; // extend slightly past rail
          return (
            <rect key={`side-sp-${i}`} x={rungCenterX - w / 2} y={y - h / 2} width={w} height={h} rx={2} fill="#f97316" />
          );
        })}

        {/* Standoffs from structure to rail (rung-anchored) */}
        {standoffPositions.map((ft, i) => (
          <rect key={`ss-${i}`} x={Math.min(wallX, rungCenterX)} y={inchToY(ft * 12) - 2} width={Math.max(2, Math.abs(rungCenterX - wallX))} height={4} fill="#2563eb" />
        ))}

        {/* Ladder feet (side view): appears as a solid rectangle the width of the rail, extending to ground */}
        {useFeetAnchors && (
          <rect
            x={rungCenterX - railWidthPx / 2}
            y={yFeetAttach}
            width={railWidthPx}
            height={Math.max(0, yGround - yFeetAttach)}
            fill="#1f2937"
          />
        )}

        {/* Dimension to top rung center pulled to the right */}
        <DimHRight y={topRungY - 12} x1={wallX} x2={rungCenterX} label={`${round(wallOffset,2)}″ to top rung center`} />
      </g>

      <text x={8} y={pad} fontSize={10} fill="#6b7280">Top</text>
      {/* Ground/Lower Elevation line and label */}
      <line x1={pad} x2={W - pad} y1={yGround} y2={yGround} stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="6 4" />
      <text x={wallX + 8} y={yGround + 12} fontSize={10} textAnchor="start" fill="#6b7280">Ground/Lower Elevation</text>
    </svg>
  );
}

// Standoff planner (rung-anchored). Standoffs attach to **rungs**; splice plates attach **between** rungs.
function computeStandoffsSpliceAware(totalFeet: number, usingFeet: boolean, sections: number[], rungPositionsInches: number[]) {
  const allowed: number[] = rungPositionsInches.map((rin) => rin / 12).sort((a, b) => a - b);
  if (!allowed.length) return { positions: [], wallPairs: 0 };

  // Binary searches
  const lb = (arr: number[], v: number) => { let l = 0, r = arr.length; while (l < r) { const m = (l + r) >> 1; if (arr[m] < v) l = m + 1; else r = m; } return l; };
  const ub = (arr: number[], v: number) => { let l = 0, r = arr.length; while (l < r) { const m = (l + r) >> 1; if (arr[m] <= v) l = m + 1; else r = m; } return l; };

  // 1) Top support on a rung by ordinal: 2nd from top preferred, else 3rd
  const topIdx = allowed.length - 1;
  let top = allowed[Math.max(0, topIdx - 1)];
  if (topIdx - 2 >= 0) top = allowed[topIdx - 1];

  // Helper choose highest rung ≤ limit and ≥ min below nextAbove
  const pickHighestAtOrBelow = (limit: number, nextAbove?: number | null, minGap = 3) => {
    const cap = Math.min(limit, (nextAbove ?? Infinity) - minGap - 1e-6);
    if (!(cap > 0)) return null;
    let idx = ub(allowed, cap) - 1;
    return idx >= 0 ? allowed[idx] : null;
  };

  const bottomTarget = usingFeet ? 7 : 3; // feet ON → ~7 ft; OFF → ~3 ft
  const picks: number[] = [];
  const bottom = pickHighestAtOrBelow(bottomTarget, top, 3);
  if (bottom != null) picks.push(bottom);

  // Pack toward top favoring near‑7 ft spans within [3,7]
  const MAX = 7, MIN = 3;
  const pushNextUp = (prev: number, finalTop: number) => {
    const limit = Math.min(prev + MAX, finalTop - MIN - 1e-6);
    if (!(limit > prev + MIN - 1e-6)) return null;
    return pickHighestAtOrBelow(limit, finalTop, MIN);
  };

  if (picks.length === 0) {
    const idx = lb(allowed, top - MIN);
    if (idx > 0) {
      let best: number | null = null;
      for (let i = 0; i < idx; i++) {
        const a = allowed[i];
        if (usingFeet && a > 7 + 1e-6) break;
        if (best == null || a > best) best = a;
      }
      if (best != null) picks.push(best);
    }
  }
  while (picks.length && (top - picks[picks.length - 1] > MAX + 1e-6)) {
    const next = pushNextUp(picks[picks.length - 1], top);
    if (next == null) break; picks.push(next);
  }

  // Close near top if needed
  const last = picks[picks.length - 1] ?? null;
  if (last == null || top - last > MAX + 1e-6) {
    const ins = pickHighestAtOrBelow(top - MIN, top, MIN);
    if (ins != null && (last == null || ins - last >= MIN - 1e-6)) picks.push(ins);
  }

  picks.push(top); picks.sort((a, b) => a - b);
  for (let i = picks.length - 2; i >= 0; i--) if (Math.abs(picks[i] - picks[i + 1]) < 1e-6) picks.splice(i, 1);

  return { positions: picks, wallPairs: picks.length };
}

// ────────────────────────────────────────────────────────────────────────────────
export default function EzLadderConfigurator() {
  // Preferred logo path + fallback
  const base = (import.meta as any).env.BASE_URL || "/";
  const LOGO_SRC = (typeof window !== "undefined" && (window as any).__DFP_LOGO__) || base + "DFPlogo_white.png";
  const LOGO_FALLBACK =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="200" height="40" viewBox="0 0 200 40"><rect width="200" height="40" fill="#001C55"/><text x="12" y="26" font-family="Inter, Arial, Helvetica, sans-serif" font-size="18" fill="white">Diversified Fall Protection</text></svg>`
    );
  const INFO_IMG_SRC = (typeof window !== "undefined" && (window as any).__STANDOFF_INFO__) || base + "standoff_info.png";
  
  // Inputs
  const [feet, setFeet] = useState(20);
  const [inches, setInches] = useState(0);
  const [standoffInches, setStandoffInches] = useState(12);
  const [useFeetAnchors, setUseFeetAnchors] = useState(false);
  const [accWT, setAccWT] = useState(false);
  const [accPR, setAccPR] = useState(false);
  const [accGate, setAccGate] = useState(false);
  const [accCover, setAccCover] = useState(false);
  const [parapetCrossover, setParapetCrossover] = useState(false);
  const [parapetWidthIn, setParapetWidthIn] = useState(0);
  const [parapetHeightIn, setParapetHeightIn] = useState(0);
  const [showInfo, setShowInfo] = useState(false);

  // Derived user height
  const userInches = useMemo(() => feetToInches(Number(feet || 0)) + Number(inches || 0), [feet, inches]);

  // Standoff resolution
  const requestedStandoffInches = useMemo(() => Number(standoffInches || 0), [standoffInches]);
  const wallResolved = useMemo(() => resolveStandoffSpec(requestedStandoffInches || 0), [requestedStandoffInches]);
  const wallSku = wallResolved?.sku ?? "LAD-SO2";
  const wallOffset = wallResolved?.valueInches ?? 0;

  // Ladder length & feet selection
  const plan = useMemo(() => planHeightAndFeet(userInches, useFeetAnchors), [userInches, useFeetAnchors]);
  const ladderFeetFt = plan.ladderFeetFt; // integer feet of ladder length
  const firstRungInches = plan.firstRungInches; // for visualizer
  const resolvedFeet = plan.feet; // null or feet selection
  const bottomRungOK = firstRungInches >= 6 - 1e-6 && firstRungInches <= 15 + 1e-6;

  // Sections for BOM (distribute N feet into 3–10 ft chunks)
  const { sections, error: sectionError } = useMemo(() => sectionizeEven(ladderFeetFt), [ladderFeetFt]);
  const splices = useMemo(() => computeSplices(sections), [sections]);

  // Rungs (top at elevation)
  const { rungPositions } = useMemo(
    () => computeRungInfo(userInches, !!resolvedFeet, resolvedFeet?.type, firstRungInches),
    [userInches, resolvedFeet, firstRungInches]
  );

  // Splice FEET positions (snap cumulative boundaries to midpoints between rungs)
  const spliceFeet = useMemo(() => {
    const midsIn: number[] = rungPositions.slice(0, -1).map((r, i) => (r + rungPositions[i + 1]) / 2);
    const midsFt = midsIn.map(v => v / 12);
    const nearest = (v: number) => (midsFt.length ? midsFt.reduce((b, a) => (Math.abs(a - v) < Math.abs(b - v) ? a : b)) : v);
    const out: number[] = []; let acc = 0;
    for (let i = 0; i < sections.length - 1; i++) { acc += sections[i]; out.push(nearest(acc)); }
    return out;
  }, [sections, rungPositions]);

  // Standoffs from rung grid
  const { positions: standoffPositions, wallPairs } = useMemo(
    () => computeStandoffsSpliceAware(inchesToFeet(userInches), !!resolvedFeet, sections, rungPositions),
    [userInches, resolvedFeet, sections, rungPositions]
  );

  // Quote helpers
  const combinedSupports = useMemo(() => {
    const map = new Map<string, number>();
    // wall standoff pairs
    if (wallPairs > 0) map.set(wallSku, (map.get(wallSku) || 0) + wallPairs);
    // feet contribute one additional pair of the same SKU, if present
    if (resolvedFeet) map.set(resolvedFeet.sku, (map.get(resolvedFeet.sku) || 0) + 1);
    return Array.from(map.entries()).map(([sku, qty]) => ({ sku, qty }));
  }, [wallPairs, wallSku, resolvedFeet]);
  
// --- BOM rows (Inventory ID + Quantity) for export ---------------------------
const bomItems = useMemo(() => {
  const rows: { sku: string; qty: string }[] = [];
  const add = (sku: string, qty: number | string) => {
    const numeric = typeof qty === "number" ? qty : parseFloat(qty);
    if (!numeric || numeric <= 0) return;
    const display = typeof qty === "number" ? qty.toString() : qty;
    rows.push({ sku: normalizeSku(sku), qty: display });
  };

  let cp1Pairs = 0;
  let cp2Pairs = 0;

  sections.forEach((sectionFeet) => {
    const qty = (sectionFeet / 10).toFixed(1);
    add(ERP_SKU.LADDER_SECTION_10FT, qty);
  });

  add(ERP_SKU.SPLICE_KIT, Math.max(0, splices));

  combinedSupports.forEach(({ sku, qty }) => add(sku, 2 * qty));

  if (wallPairs > 0) {
    cp2Pairs = isAltClampOffset(wallOffset) ? wallPairs : 0;
    cp1Pairs = wallPairs - cp2Pairs;
    if (cp1Pairs > 0) add(ERP_SKU.CLAMP_PAIR, (2 * cp1Pairs).toString());
    if (cp2Pairs > 0) add(ERP_SKU.CLAMP_PAIR_ALT, (2 * cp2Pairs).toString());
    const gussetQty = (2 * wallPairs).toString();
    add(ERP_SKU.STANDOFF_GUSSET, gussetQty);
  }

  if (accWT) add("FL-WT-01", "1");
  if (accWT && accPR) add("FL-PR-02", "1");
  if (accWT && accPR && accGate) add("LSG-2030-PCY", "1");
  if (accCover) add("FL-LGDFP-02", "1");

  const feetStandoffs = resolvedFeet ? 2 : 0;
  const cp1Plates = cp1Pairs * 2;
  const cp2Plates = cp2Pairs * 2;
  const hardwareQty = feetStandoffs * 2 + cp1Plates * 4 + cp2Plates * 6;
  if (hardwareQty > 0) {
    ["19634", "36753", "33784", "0156022"].forEach((sku) => add(sku, hardwareQty));
  }

  return rows;
}, [sections, splices, combinedSupports, wallPairs, wallOffset, accWT, accPR, accGate, accCover, resolvedFeet]);

// --- CSV download (adds Project Task + Cost Code) ----------------------------
function exportBOMCsv() {
  const PROJECT_TASK = "06PROD";
  const COST_CODE = "40-030";

  const header = ["Inventory ID", "Quantity", "Project Task", "Cost Code"];
  const lines = [header.join(",")].concat(
    bomItems.map(r => `${r.sku},${r.qty},${PROJECT_TASK},${COST_CODE}`)
  );

  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "EZ-Ladder-BOM.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

  
  // Pricing (placeholders)
  const ladderFeetLen = Math.max(0, sections.reduce((a, b) => a + b, 0));
  const ladderCost = ladderFeetLen * PRICES.LADDER_PER_FT;
  const spliceCost = splices * PRICES.SPLICE_KIT;
  const wallCost = wallPairs * (PRICES as any)[wallSku];
  const feetCost = resolvedFeet ? (resolvedFeet.type === "SO2" ? PRICES.FEET_SO2 : PRICES.FEET_SO3) : 0;
  const wtCost = accWT ? PRICES["FL-WT-01"] : 0;
  const prCost = accWT && accPR ? PRICES["FL-PR-02"] : 0;
  const gateCost = accWT && accPR && accGate ? PRICES["LSG-2030-PCY"] : 0;
  const coverCost = accCover ? PRICES["FL-LGDFP-02"] : 0;
  const totalCost = ladderCost + spliceCost + wallCost + feetCost + wtCost + prCost + gateCost + coverCost;

  const accessories = useMemo(() => {
    const list: { sku: string; desc: string }[] = [];
    if (accWT) list.push({ sku: "FL‑WT‑01", desc: "Walk‑Through Arms" });
    if (accWT && accPR) list.push({ sku: "FL‑PR‑02", desc: "P Returns" });
    if (accWT && accPR && accGate) list.push({ sku: "LSG-2030-PCY", desc: "Safety Gate" });
    if (accCover) list.push({ sku: "FL‑LGDFP‑02", desc: "Security Cover" });
    return list;
  }, [accWT, accPR, accGate, accCover]);

  // Tests (minimal, non-breaking)
  function runTests() {
    const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;
    // 13' → 7 + 6 sections, bottom rung ~12"
    const p13 = planHeightAndFeet(13 * 12, false);
    const s13 = sectionizeEven(p13.ladderFeetFt).sections; console.assert(s13.reduce((a,b)=>a+b,0) === 13, "13ft → 13ft BOM");
    console.assert(p13.firstRungInches >= 6 && p13.firstRungInches <= 15, "13ft no-feet bottom rung in window");
    // 10'3" → 10ft ladder, bottom rung 15"
    const p103 = planHeightAndFeet(10 * 12 + 3, false); console.assert(p103.ladderFeetFt === 10, "10'3\" → 10ft ladder");
    console.assert(near(p103.firstRungInches, 15), "10'3\" → 15\" first rung");
    // Feet selection stays within 6–15"
    const pFeet = planHeightAndFeet(13 * 12 + 2, true); console.assert(pFeet.firstRungInches >= 6 && pFeet.firstRungInches <= 15, "feet case window");
    alert("All tests passed ✔");
  }

  return (
    <div className="w-full">
      {/* Banner */}
      <header className="w-full bg-[#001C55] text-white">
        <div className="max-w-6xl mx-auto flex items-center gap-3 px-4 py-3">
          <img
            src={LOGO_SRC}
            alt="Diversified Fall Protection"
            className="h-8 w-auto object-contain"
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = LOGO_FALLBACK; }}
          />
          <span className="text-sm opacity-90">EZ‑Ladder Configurator</span>
        </div>
      </header>

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_minmax(520px,1fr)_380px] gap-4 mt-4">
        {/* LEFT: Inputs */}
        <Card className="order-2 lg:order-1">
          <CardHeader><CardTitle>EZ‑Ladder — Inputs</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            {/* Ladder Height */}
            <div className="rounded-xl border p-3">
              <div className="flex items-center justify-between"><Label className="font-medium">Ladder Height</Label><ArrowVertical className="w-5 h-5 text-neutral-500" /></div>
              <div className="mt-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <div><Label className="text-xs">Feet</Label><Input type="number" min={0} value={feet} onChange={(e) => setFeet(Number(e.target.value))} /></div>
                <div><Label className="text-xs">Inches</Label><Input type="number" min={0} max={11} value={inches} onChange={(e) => setInches(Math.min(11, Math.max(0, Number(e.target.value))))} /></div>
                <div className="hidden sm:flex items-center justify-center p-2"><ArrowVertical className="w-8 h-8 text-neutral-400" /></div>
              </div>
            </div>

            {/* Standoff Distance */}
            <div className="rounded-xl border p-3 relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label className="font-medium">Standoff Distance</Label>
                  {/* Info icon (hover/tap) */}
                  <button
                    type="button"
                    aria-label="Standoff distance help"
                    className="h-5 w-5 rounded-full border text-[10px] leading-none grid place-items-center text-neutral-700 hover:bg-neutral-50"
                    onMouseEnter={() => setShowInfo(true)}
                    onMouseLeave={() => setShowInfo(false)}
                    onFocus={() => setShowInfo(true)}
                    onBlur={() => setShowInfo(false)}
                    onClick={() => setShowInfo((v) => !v)}
                  >i</button>
                </div>
                <ArrowHorizontal className="w-5 h-5 text-neutral-500" />
              </div>
              {showInfo && (
                  <div className="absolute right-3 top-10 z-50 w-80 bg-white border rounded-md shadow-lg p-2">
                    <img
                      src={INFO_IMG_SRC}
                      alt="Standoff distance guidance"
                      className="w-full h-auto rounded"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                )}
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-xs uppercase tracking-wide text-neutral-500">Selected offset</span>
                  <span className="font-medium">{Math.round(standoffInches)}″</span>
                </div>
                <input
                  type="range"
                  min={7}
                  max={15}
                  step={1}
                  value={standoffInches}
                  onChange={(e) => setStandoffInches(Number(e.target.value))}
                  className="w-full accent-blue-600"
                  aria-label="Standoff distance in inches"
                />
                <div className="flex items-center justify-between text-xs text-neutral-500">
                  <span>7″</span>
                  <span>15″</span>
                </div>
              </div>
              {/* Per request: hide requested/resolved summary */}
            </div>

            {/* Feet Toggle */}
            <div className="flex items-center justify-between rounded-xl border p-3">
              <div><Label className="font-medium">Use Ladder Feet (ground‑anchored)?</Label></div>
              <Switch checked={useFeetAnchors} onCheckedChange={setUseFeetAnchors} />
            </div>

            {/* Auto-selected feet summary (output only) */}
            {useFeetAnchors && (
              <div className="text-sm text-muted-foreground">
                Auto-selected feet: <span className="font-medium">{resolvedFeet?.sku}</span> @ <span className="font-medium">{resolvedFeet?.firstRungInches}″</span>
              </div>
            )}

            {/* Accessories */}
            <div className="space-y-2">
              <Label className="font-medium">Optional Accessories</Label>
              <div className="grid grid-cols-2 gap-2">
                <label htmlFor="wt" className={cn("flex items-center gap-3 p-2 border rounded-lg cursor-pointer", accWT && "ring-2 ring-blue-500") }>
                  <div className="w-10 h-10 rounded bg-neutral-100 border grid place-items-center text-neutral-500">WT</div>
                  <div className="flex-1"><div className="font-medium text-sm">Walk‑Through Arms</div><div className="text-xs text-muted-foreground">FL‑WT‑01</div></div>
                  <Checkbox id="wt" checked={accWT} onCheckedChange={setAccWT} />
                </label>
                <label htmlFor="pr" className={cn("flex items-center gap-3 p-2 border rounded-lg cursor-pointer", (accWT && accPR) && "ring-2 ring-blue-500", !accWT && "opacity-50") }>
                  <div className="w-10 h-10 rounded bg-neutral-100 border grid place-items-center text-neutral-500">PR</div>
                  <div className="flex-1"><div className="font-medium text-sm">P Returns</div><div className="text-xs text-muted-foreground">FL‑PR‑02</div></div>
                  <Checkbox id="pr" checked={accPR && accWT} disabled={!accWT} onCheckedChange={(v) => setAccPR(!!v)} />
                </label>
                <label htmlFor="gate" className={cn("flex items-center gap-3 p-2 border rounded-lg cursor-pointer", (accWT && accPR && accGate) && "ring-2 ring-blue-500", !(accWT && accPR) && "opacity-50") }>
                  <div className="w-10 h-10 rounded bg-neutral-100 border grid place-items-center text-neutral-500">GT</div>
                  <div className="flex-1"><div className="font-medium text-sm">Safety Gate</div><div className="text-xs text-muted-foreground">LSG-2030-PCY</div></div>
                  <Checkbox id="gate" checked={accWT && accPR && accGate} disabled={!(accWT && accPR)} onCheckedChange={(v) => setAccGate(!!v)} />
                </label>
                <label htmlFor="cover" className={cn("flex items-center gap-3 p-2 border rounded-lg cursor-pointer", accCover && "ring-2 ring-blue-500") }>
                  <div className="w-10 h-10 rounded bg-neutral-100 border grid place-items-center text-neutral-500">CV</div>
                  <div className="flex-1"><div className="font-medium text-sm">Security Cover</div><div className="text-xs text-muted-foreground">FL‑LGDFP‑02</div></div>
                  <Checkbox id="cover" checked={accCover} onCheckedChange={setAccCover} />
                </label>
              </div>
            </div>

            {/* Parapet crossover */}
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-xl border p-3">
                <div>
                  <div className="font-medium">Parapet crossover</div>
                  <div className="text-xs text-muted-foreground">Add parapet dimensions to visualize dashed guides.</div>
                </div>
                <Switch
                  checked={parapetCrossover}
                  onCheckedChange={(v) => setParapetCrossover(v)}
                  aria-label="Toggle parapet crossover"
                />
              </div>
              {parapetCrossover && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="parapet-width">Parapet width (in)</Label>
                    <Input
                      id="parapet-width"
                      type="number"
                      min={0}
                      step={0.1}
                      value={parapetWidthIn}
                      onChange={(e) => setParapetWidthIn(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="parapet-height">Parapet height (in)</Label>
                    <Input
                      id="parapet-height"
                      type="number"
                      min={0}
                      step={0.1}
                      value={parapetHeightIn}
                      onChange={(e) => setParapetHeightIn(Number(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">Height of 0 sets roof and parapet top equal.</p>
                  </div>
                </div>
              )}
            </div>

            {sectionError && (<div className="text-red-600 text-sm leading-tight bg-red-50 border border-red-200 rounded-md p-2">{sectionError}</div>)}

            <div className="pt-2"><Button variant="outline" onClick={runTests}>Run Tests</Button></div>
          </CardContent>
        </Card>

        {/* CENTER: Visualizer */}
        <Card className="order-1 lg:order-2">
          <CardHeader><CardTitle>Visualizer</CardTitle></CardHeader>
          <CardContent>
            <div className="w-full h-[560px] rounded-xl border overflow-hidden">
              <LadderSVG
                totalInches={userInches}
                rungPositions={rungPositions}
                standoffPositions={standoffPositions}
                splicesFeet={spliceFeet}
                useFeetAnchors={!!resolvedFeet}
                wallOffset={wallOffset}
                parapetEnabled={parapetCrossover}
                parapetWidth={Number(parapetWidthIn) || 0}
                parapetHeight={Number(parapetHeightIn) || 0}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-neutral-100 p-3"><div className="font-medium">Sections</div>{sections.map((s, i) => (<div key={i}>Section {i + 1}: {fmtFeet(s)}</div>))}</div>
              <div className="rounded-lg bg-neutral-100 p-3"><div className="font-medium">Supports</div><div>Wall Standoffs (pairs): {wallPairs}</div><div>Feet (pair): {resolvedFeet ? `1 — ${resolvedFeet.sku} @ ${resolvedFeet.firstRungInches}″` : '0'}</div><div className="text-xs mt-1">1st rung: {firstRungInches.toFixed(2)}″ {bottomRungOK ? '' : '(out of 6–15″)'} </div></div>
            </div>
          </CardContent>
        </Card>

        {/* RIGHT: Quote */}
        <Card className="order-3">
          <CardHeader><CardTitle>Live Quote</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl border p-3 space-y-2 text-sm">
              {/* Main ladder line item with total price */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">EZ Ladder — {sections.reduce((a,b)=>a+b,0)} ft</div>
                  <ul className="ml-4 list-disc">
                    {sections.map((s,i)=>(<li key={i}>Section {i+1}: {fmtFeet(s)}</li>))}
                  </ul>
                  {splices > 0 && (<div className="text-xs mt-1">Includes {splices} splice kit(s)</div>)}
                </div>
                <div className="font-medium"><Money value={ladderCost + spliceCost} /></div>
              </div>

              {/* Supports combined by SKU */}
              {combinedSupports.map(({sku, qty}) => (
                <div key={sku} className="flex items-center justify-between">
                  <div>{sku} — {qty} pair(s)</div>
                </div>
              ))}

              {/* Accessories as separate line items */}
              {accessories.map((a) => (
                <div key={a.sku} className="flex items-center justify-between">
                  <div>{a.desc} — {a.sku}</div>
                </div>
              ))}

              {/* Total */}
              <div className="border-t pt-2 flex items-center justify-between font-medium">
                <div>Total</div>
                <div><Money value={totalCost} /></div>
              </div>
            </div>

            {/* Export */}
            <div className="pt-3">
              <Button onClick={exportBOMCsv} className="w-full">
                Export BOM (CSV)
              </Button>
            </div>

            {inchesToFeet(userInches) >= 24 && (
              <div className="text-amber-700 text-xs bg-amber-50 border border-amber-200 rounded p-2">Note: Ladders ≥ 24 ft often require fall-arrest systems per applicable codes. Verify with your AHJ.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
