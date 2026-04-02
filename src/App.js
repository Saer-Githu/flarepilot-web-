import { useState, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";

// ─── Font Injection ───────────────────────────────────────────────────────────
function useFonts() {
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href =
      "https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Rajdhani:wght@500;700&display=swap";
    document.head.appendChild(l);
  }, []);
}

// ─── Physics Engine (JS port of Python v2.1) ─────────────────────────────────
function compute(v) {
  const G = 1.882,
    A = 1.204,
    HV = 46400,
    SR = 15.67,
    VI = 1.84e-5,
    EX = 3.8,
    CA = 0.72;
  const pPa = v.p_gas * 6894.76;
  const rN = v.d_noz / 1000 / 2,
    aN = Math.PI * rN ** 2;
  const rg = G * (273.15 / (273.15 + v.amb_temp));
  const ra = A * (273.15 / (273.15 + v.amb_temp));
  const mG = v.cd * aN * Math.sqrt(2 * rg * pPa);
  const vG = aN > 0 ? mG / (rg * aN) : 0;
  const rT = v.d_thr / 1000 / 2,
    aT = Math.PI * rT ** 2;
  const rAir = v.d_air_in / 1000 / 2,
    aAir = Math.PI * rAir ** 2 * v.n_air_in;
  const aRat = aN > 0 ? aT / aN : 0;
  const eB = ((CA * aAir) / aT) * Math.sqrt(ra / rg);
  const rR = (v.m_eff / 100) * eB * Math.cos(Math.PI / 4) * 28.5;
  const mA = mG * rR,
    volA = mA / ra;
  const vMC = mG / rg + volA,
    vMS = aT > 0 ? vMC / aT : 0;
  const tRes = vMC > 0 ? (v.tube_vol / 1e6 / vMC) * 1000 : 0;
  const afr = mG > 0 ? mA / mG : 0;
  const phi = afr > 0 ? SR / afr : 0;
  const sLam = phi > 0 ? 0.43 * Math.exp(-3 * (phi - 1.05) ** 2) : 0;
  const tF =
    phi > 0
      ? Math.max(
          v.amb_temp,
          Math.min(1980, 1980 * (1 - 0.3 * Math.abs(1 - phi) ** 1.2))
        )
      : v.amb_temp;
  const nP = Math.round(v.rows) * Math.round(v.hpr);
  const rP = v.d_port / 1000 / 2,
    aP = Math.PI * rP ** 2 * Math.max(nP, 1);
  const expF = tF > 300 ? EX * (tF / 1980) : 1;
  const vEx = aP > 0 ? (vMC * expF) / aP : 0;
  const ePhi = Math.min(phi, 1.3);
  const slE = ePhi > 0 ? 0.43 * Math.exp(-3 * (ePhi - 1.05) ** 2) : 0;
  const vBl = slE * 18,
    mBl = vBl > 0 ? ((vBl - vEx) / vBl) * 100 : 0;
  const vPI = aP > 0 ? vMC / aP : 0;
  const mFl = sLam > 0 ? ((vPI - sLam) / sLam) * 100 : 999.9;
  const re = (ra * vMS * (v.d_thr / 1000)) / VI;
  const fSp = v.tube_len > 0 ? Math.min(v.spark, v.tube_len) / v.tube_len : 0.5;
  const vSp = vMS * (1 - 0.3 * fSp);
  const kw = mG * HV * (v.t_eff / 100);
  return {
    m_gas_hr: mG * 3600,
    m_air_hr: mA * 3600,
    afr,
    phi,
    kw,
    v_exit: vEx,
    v_mix: vMS,
    re,
    v_gas: vG,
    t_flame: tF,
    s_lam: sLam,
    t_res: tRes,
    area_ratio: aRat,
    v_at_spark: vSp,
    spark_ok: vSp > 0.3 && vSp < 8,
    ports_tot: nP,
    blowoff_margin: mBl,
    flashback_margin: mFl,
  };
}

// ─── Ranges & Tier ────────────────────────────────────────────────────────────
const RANGES = {
  m_gas_hr: [0.01, 2],
  m_air_hr: [0.1, 30],
  afr: [10, 22],
  area_ratio: [3, 150],
  phi: [0.7, 1.5],
  kw: [0.5, 50],
  ports_tot: [4, 64],
  v_exit: [0.3, 18],
  v_mix: [3, 30],
  re: [4000, 500000],
  v_gas: [10, 500],
  t_flame: [800, 1980],
  t_res: [1, 50],
  v_at_spark: [0.3, 8],
};
const TIER = {
  ok: { bg: "#052e16", border: "#16a34a", text: "#4ade80", bar: "#22c55e" },
  wn: { bg: "#1c1407", border: "#b45309", text: "#fbbf24", bar: "#f59e0b" },
  bad: { bg: "#1c0505", border: "#991b1b", text: "#f87171", bar: "#ef4444" },
  n: { bg: "#0f172a", border: "#334155", text: "#94a3b8", bar: "#475569" },
};
function tier(key, val) {
  const r = RANGES[key];
  if (!r) return "n";
  const [lo, hi] = r,
    m = (hi - lo) * 0.1;
  if (lo <= val && val <= hi) return "ok";
  if (lo - m <= val && val <= hi + m) return "wn";
  return "bad";
}
function fv(v) {
  if (v == null || isNaN(v)) return "—";
  if (Math.abs(v) >= 1e5) return (v / 1000).toFixed(0) + "k";
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 100) return v.toFixed(1);
  if (Math.abs(v) >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

const DEFAULTS = {
  p_gas: 11,
  d_noz: 0.8,
  cd: 0.82,
  amb_temp: 20,
  d_thr: 15,
  d_air_in: 8,
  n_air_in: 2,
  m_eff: 85,
  tube_len: 150,
  tube_vol: 38,
  spark: 140,
  rows: 4,
  hpr: 6,
  d_port: 10,
  t_eff: 88,
};
const SEC = {
  gas: "#22c55e",
  air: "#38bdf8",
  mix: "#fb923c",
  port: "#c084fc",
  flame: "#f97316",
};

// ─── SVG inline badge ─────────────────────────────────────────────────────────
function Bdg({ cx, cy, label, val, unit, ck, w = 86, h = 34 }) {
  const t = tier(ck, val),
    c = TIER[t];
  return (
    <g>
      <rect
        x={cx - w / 2}
        y={cy - h / 2}
        width={w}
        height={h}
        rx={6}
        fill={c.bg}
        stroke={c.border}
        strokeWidth="1.5"
        opacity=".95"
        style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,.6))" }}
      />
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fontSize="12"
        fontFamily="'Space Mono',monospace"
        fontWeight="bold"
        fill={c.text}
      >
        {fv(val)}
        <tspan fontSize="9" fontWeight="400">
          {" "}
          {unit}
        </tspan>
      </text>
      <text
        x={cx}
        y={cy + 9}
        textAnchor="middle"
        fontSize="7.5"
        fontFamily="'Space Mono',monospace"
        fill={c.text}
        opacity=".65"
      >
        {label}
      </text>
    </g>
  );
}

// ─── System Diagram SVG ───────────────────────────────────────────────────────
function Diagram({ inp, out }) {
  const W = 900,
    H = 260,
    cy = 132,
    WL = 6;
  const h = { gas: 11, noz: 3, ven: 34, mix: 20, man: 27 };

  // Section x coords
  const xg = [16, 84],
    xnoz = 112,
    xv = [112, 285],
    xm = [285, 575],
    xmn = [575, 638];
  const xprt = 646,
    xflm = 656;

  const sfrac =
    inp.tube_len > 0 ? Math.min(inp.spark, inp.tube_len) / inp.tube_len : 0.5;
  const spX = xm[0] + sfrac * (xm[1] - xm[0]);
  const nVis = Math.max(1, Math.min(8, Math.round(inp.rows)));
  const portH = (h.man * 2 - WL * 2) / nVis;

  const BY_TOP = 24,
    BY_BOT = 222;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <defs>
        <linearGradient id="dMetal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#334155" />
          <stop offset="45%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#334155" />
        </linearGradient>
        <linearGradient id="dGas" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1e3a8a" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id="dPre" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#064e3b" />
          <stop offset="100%" stopColor="#065f46" />
        </linearGradient>
        <radialGradient id="dFlame" cx="20%" cy="50%" r="80%">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="35%" stopColor="#f97316" />
          <stop offset="70%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#7f1d1d" stopOpacity="0" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ── GAS SUPPLY PIPE ── */}
      <rect
        x={xg[0]}
        y={cy - h.gas - WL}
        width={xg[1] - xg[0]}
        height={(h.gas + WL) * 2}
        rx="4"
        fill="url(#dMetal)"
      />
      <rect
        x={xg[0]}
        y={cy - h.gas}
        width={xg[1] - xg[0]}
        height={h.gas * 2}
        fill="url(#dGas)"
        opacity=".8"
      />
      <text
        x={(xg[0] + xg[1]) / 2}
        y={cy + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="7"
        fontFamily="'Space Mono',monospace"
        fontWeight="bold"
        fill="#93c5fd"
      >
        GAS
      </text>

      {/* ── NOZZLE CONVERGENCE ── */}
      <polygon
        fill="url(#dMetal)"
        points={`${xg[1]},${cy - h.gas - WL} ${xg[1]},${cy - h.gas} ${xnoz},${
          cy - h.noz
        } ${xnoz},${cy - h.noz - 14}`}
      />
      <polygon
        fill="url(#dMetal)"
        points={`${xg[1]},${cy + h.gas + WL} ${xg[1]},${cy + h.gas} ${xnoz},${
          cy + h.noz
        } ${xnoz},${cy + h.noz + 14}`}
      />
      <polygon
        fill="url(#dGas)"
        opacity=".75"
        points={`${xg[1]},${cy - h.gas} ${xg[1]},${cy + h.gas} ${xnoz},${
          cy + h.noz
        } ${xnoz},${cy - h.noz}`}
      />
      <circle
        cx={xnoz}
        cy={cy}
        r={5}
        fill="#1e3a8a"
        stroke="#60a5fa"
        strokeWidth="2"
        filter="url(#glow)"
      />

      {/* ── VENTURI BODY ── */}
      <rect
        x={xv[0]}
        y={cy - h.ven - WL}
        width={xv[1] - xv[0]}
        height={WL}
        fill="url(#dMetal)"
      />
      <rect
        x={xv[0]}
        y={cy + h.ven}
        width={xv[1] - xv[0]}
        height={WL}
        fill="url(#dMetal)"
      />
      <rect
        x={xv[0]}
        y={cy - h.ven}
        width={xv[1] - xv[0]}
        height={h.ven * 2}
        fill="url(#dPre)"
        opacity=".55"
      />
      <line
        x1={xv[0]}
        y1={cy}
        x2={xv[1]}
        y2={cy}
        stroke="#38bdf8"
        strokeWidth="1.5"
        strokeDasharray="5,3"
        opacity=".5"
        filter="url(#glow)"
      />
      {/* Air inlet arrows */}
      {[155, 222].map((ax) => (
        <g key={ax}>
          <polygon
            fill={SEC.air}
            opacity=".85"
            points={`${ax - 5},${cy - h.ven + 20} ${ax + 5},${
              cy - h.ven + 20
            } ${ax},${cy - h.ven + 5}`}
          />
          <line
            x1={ax}
            y1={cy - h.ven + 32}
            x2={ax}
            y2={cy - h.ven + 20}
            stroke={SEC.air}
            strokeWidth="2"
            opacity=".85"
          />
          <text
            x={ax}
            y={cy - h.ven + 42}
            textAnchor="middle"
            fontSize="7"
            fontFamily="'Space Mono',monospace"
            fill={SEC.air}
            fontWeight="bold"
          >
            AIR
          </text>
        </g>
      ))}
      <text
        x={(xv[0] + xv[1]) / 2}
        y={cy + h.ven + WL + 13}
        textAnchor="middle"
        fontSize="7.5"
        fontFamily="'Space Mono',monospace"
        fontWeight="bold"
        fill={SEC.air}
      >
        VENTURI
      </text>

      {/* ── VEN → MIX TAPER ── */}
      <polygon
        fill="url(#dMetal)"
        points={`${xv[1]},${cy - h.ven - WL} ${xv[1]},${cy - h.ven} ${xm[0]},${
          cy - h.mix
        } ${xm[0]},${cy - h.mix - WL}`}
      />
      <polygon
        fill="url(#dMetal)"
        points={`${xv[1]},${cy + h.ven} ${xv[1]},${cy + h.ven + WL} ${xm[0]},${
          cy + h.mix + WL
        } ${xm[0]},${cy + h.mix}`}
      />
      <polygon
        fill="url(#dPre)"
        opacity=".65"
        points={`${xv[1]},${cy - h.ven} ${xv[1]},${cy + h.ven} ${xm[0]},${
          cy + h.mix
        } ${xm[0]},${cy - h.mix}`}
      />

      {/* ── MIXING TUBE ── */}
      <rect
        x={xm[0]}
        y={cy - h.mix - WL}
        width={xm[1] - xm[0]}
        height={WL}
        fill="url(#dMetal)"
      />
      <rect
        x={xm[0]}
        y={cy + h.mix}
        width={xm[1] - xm[0]}
        height={WL}
        fill="url(#dMetal)"
      />
      <rect
        x={xm[0]}
        y={cy - h.mix}
        width={xm[1] - xm[0]}
        height={h.mix * 2}
        fill="url(#dPre)"
        opacity=".7"
      />
      <text
        x={(xm[0] + xm[1]) / 2}
        y={cy - h.mix - WL - 7}
        textAnchor="middle"
        fontSize="7.5"
        fontFamily="'Space Mono',monospace"
        fontWeight="bold"
        fill={SEC.mix}
      >
        MIXING TUBE
      </text>

      {/* ── SPARK ── */}
      <line
        x1={spX}
        y1={cy - h.mix - WL - 12}
        x2={spX}
        y2={cy + h.mix + WL + 12}
        stroke="#fbbf24"
        strokeWidth="2"
        strokeDasharray="2.5,2"
        opacity=".9"
        filter="url(#glow)"
      />
      <text x={spX} y={cy - h.mix - WL - 16} textAnchor="middle" fontSize="13">
        ⚡
      </text>

      {/* ── MIX → MANIFOLD TAPER ── */}
      <polygon
        fill="url(#dMetal)"
        points={`${xm[1]},${cy - h.mix - WL} ${xm[1]},${cy - h.mix} ${xmn[0]},${
          cy - h.man
        } ${xmn[0]},${cy - h.man - WL}`}
      />
      <polygon
        fill="url(#dMetal)"
        points={`${xm[1]},${cy + h.mix} ${xm[1]},${cy + h.mix + WL} ${xmn[0]},${
          cy + h.man + WL
        } ${xmn[0]},${cy + h.man}`}
      />
      <polygon
        fill="url(#dPre)"
        opacity=".75"
        points={`${xm[1]},${cy - h.mix} ${xm[1]},${cy + h.mix} ${xmn[0]},${
          cy + h.man
        } ${xmn[0]},${cy - h.man}`}
      />

      {/* ── PORT MANIFOLD ── */}
      <rect
        x={xmn[0]}
        y={cy - h.man - WL}
        width={xmn[1] - xmn[0]}
        height={WL}
        fill="url(#dMetal)"
      />
      <rect
        x={xmn[0]}
        y={cy + h.man}
        width={xmn[1] - xmn[0]}
        height={WL}
        fill="url(#dMetal)"
      />
      <rect
        x={xmn[1] - WL}
        y={cy - h.man - WL}
        width={WL}
        height={(h.man + WL) * 2}
        fill="url(#dMetal)"
      />
      <rect
        x={xmn[0]}
        y={cy - h.man}
        width={xmn[1] - xmn[0]}
        height={h.man * 2}
        fill="url(#dPre)"
        opacity=".8"
      />
      <text
        x={(xmn[0] + xmn[1]) / 2}
        y={cy - h.man - WL - 7}
        textAnchor="middle"
        fontSize="7.5"
        fontFamily="'Space Mono',monospace"
        fontWeight="bold"
        fill={SEC.port}
      >
        PORTS
      </text>

      {/* ── PORT HOLES ── */}
      {Array.from({ length: nVis }, (_, i) => {
        const py = cy - h.man + WL + (i + 0.5) * portH;
        return (
          <ellipse
            key={i}
            cx={xprt}
            cy={py}
            rx={5}
            ry={3.5}
            fill="#a5f3fc"
            stroke="#0e7490"
            strokeWidth="1.2"
            filter="url(#glow)"
          />
        );
      })}

      {/* ── FLAMES ── */}
      {Array.from({ length: nVis }, (_, i) => {
        const py = cy - h.man + WL + (i + 0.5) * portH;
        return (
          <g key={i} filter="url(#glow)">
            <ellipse
              cx={xflm + 18}
              cy={py}
              rx={18}
              ry={5}
              fill="#f97316"
              opacity=".95"
            />
            <ellipse
              cx={xflm + 33}
              cy={py}
              rx={11}
              ry={3.5}
              fill="#fb923c"
              opacity=".85"
            />
            <ellipse
              cx={xflm + 45}
              cy={py}
              rx={7}
              ry={2.5}
              fill="#fbbf24"
              opacity=".8"
            />
            <ellipse
              cx={xflm + 54}
              cy={py}
              rx={4}
              ry={1.8}
              fill="#fef08a"
              opacity=".7"
            />
          </g>
        );
      })}
      <text
        x={xflm + 32}
        y={cy - h.man - WL - 7}
        textAnchor="middle"
        fontSize="7.5"
        fontFamily="'Space Mono',monospace"
        fontWeight="bold"
        fill={SEC.flame}
      >
        FLAME 🔥
      </text>

      {/* ── GAS LABEL ── */}
      <text
        x={(xg[0] + xg[1]) / 2}
        y={cy - h.gas - WL - 7}
        textAnchor="middle"
        fontSize="7.5"
        fontFamily="'Space Mono',monospace"
        fontWeight="bold"
        fill={SEC.gas}
      >
        GAS
      </text>

      {/* ── TOP DATA BADGES (with leader lines) ── */}
      {/* Gas Flow */}
      <line
        x1={50}
        y1={BY_TOP + 17}
        x2={50}
        y2={cy - h.gas - WL - 2}
        stroke="#334155"
        strokeWidth=".9"
        strokeDasharray="3,2"
      />
      <Bdg
        cx={50}
        cy={BY_TOP}
        label="Gas Flow"
        val={out.m_gas_hr}
        unit="kg/h"
        ck="m_gas_hr"
        w={82}
      />

      {/* Jet Velocity */}
      <line
        x1={xnoz}
        y1={BY_TOP + 17}
        x2={xnoz}
        y2={cy - h.noz - 14}
        stroke="#334155"
        strokeWidth=".9"
        strokeDasharray="3,2"
      />
      <Bdg
        cx={xnoz}
        cy={BY_TOP}
        label="Jet Vel"
        val={out.v_gas}
        unit="m/s"
        ck="v_gas"
        w={78}
      />

      {/* Air Flow */}
      <line
        x1={190}
        y1={BY_TOP + 17}
        x2={190}
        y2={cy - h.ven - WL - 2}
        stroke="#334155"
        strokeWidth=".9"
        strokeDasharray="3,2"
      />
      <Bdg
        cx={190}
        cy={BY_TOP}
        label="Air Flow"
        val={out.m_air_hr}
        unit="kg/h"
        ck="m_air_hr"
        w={80}
      />

      {/* Area Ratio */}
      <line
        x1={255}
        y1={BY_TOP + 17}
        x2={255}
        y2={cy - h.ven - WL - 2}
        stroke="#334155"
        strokeWidth=".9"
        strokeDasharray="3,2"
      />
      <Bdg
        cx={255}
        cy={BY_TOP}
        label="Area Ratio"
        val={out.area_ratio}
        unit=":1"
        ck="area_ratio"
        w={84}
      />

      {/* Throat Velocity */}
      <line
        x1={370}
        y1={BY_TOP + 17}
        x2={370}
        y2={cy - h.mix - WL - 2}
        stroke="#334155"
        strokeWidth=".9"
        strokeDasharray="3,2"
      />
      <Bdg
        cx={370}
        cy={BY_TOP}
        label="Throat Vel"
        val={out.v_mix}
        unit="m/s"
        ck="v_mix"
        w={84}
      />

      {/* Reynolds No */}
      <line
        x1={470}
        y1={BY_TOP + 17}
        x2={470}
        y2={cy - h.mix - WL - 2}
        stroke="#334155"
        strokeWidth=".9"
        strokeDasharray="3,2"
      />
      <Bdg
        cx={470}
        cy={BY_TOP}
        label="Reynolds"
        val={out.re}
        unit=""
        ck="re"
        w={80}
      />

      {/* Exit Velocity */}
      <line
        x1={606}
        y1={BY_TOP + 17}
        x2={606}
        y2={cy - h.man - WL - 2}
        stroke="#334155"
        strokeWidth=".9"
        strokeDasharray="3,2"
      />
      <Bdg
        cx={606}
        cy={BY_TOP}
        label="Exit Vel"
        val={out.v_exit}
        unit="m/s"
        ck="v_exit"
        w={80}
      />

      {/* Net Power */}
      <line
        x1={746}
        y1={BY_TOP + 17}
        x2={746}
        y2={cy - h.man - WL - 2}
        stroke="#334155"
        strokeWidth=".9"
        strokeDasharray="3,2"
      />
      <Bdg
        cx={746}
        cy={BY_TOP}
        label="Net Power"
        val={out.kw}
        unit="kW"
        ck="kw"
        w={78}
      />

      {/* Flame Temp */}
      <line
        x1={830}
        y1={BY_TOP + 17}
        x2={830}
        y2={cy - h.man - WL - 2}
        stroke="#334155"
        strokeWidth=".9"
        strokeDasharray="3,2"
      />
      <Bdg
        cx={830}
        cy={BY_TOP}
        label="Flame Temp"
        val={out.t_flame}
        unit="°C"
        ck="t_flame"
        w={86}
      />

      {/* ── BOTTOM DATA BADGES ── */}
      {/* AFR */}
      <line
        x1={340}
        y1={cy + h.mix + WL + 2}
        x2={340}
        y2={BY_BOT - 17}
        stroke="#334155"
        strokeWidth=".9"
        strokeDasharray="3,2"
      />
      <Bdg
        cx={340}
        cy={BY_BOT}
        label="AFR"
        val={out.afr}
        unit="kg/kg"
        ck="afr"
        w={80}
      />

      {/* Equiv Ratio */}
      <line
        x1={435}
        y1={cy + h.mix + WL + 2}
        x2={435}
        y2={BY_BOT - 17}
        stroke="#334155"
        strokeWidth=".9"
        strokeDasharray="3,2"
      />
      <Bdg
        cx={435}
        cy={BY_BOT}
        label="Equiv. Φ"
        val={out.phi}
        unit=""
        ck="phi"
        w={78}
      />

      {/* Residence Time */}
      <line
        x1={520}
        y1={cy + h.mix + WL + 2}
        x2={520}
        y2={BY_BOT - 17}
        stroke="#334155"
        strokeWidth=".9"
        strokeDasharray="3,2"
      />
      <Bdg
        cx={520}
        cy={BY_BOT}
        label="Res. Time"
        val={out.t_res}
        unit="ms"
        ck="t_res"
        w={82}
      />

      {/* Spark Velocity (follows spark position) */}
      <line
        x1={spX}
        y1={cy + h.mix + WL + 12}
        x2={spX}
        y2={BY_BOT - 17}
        stroke="#b45309"
        strokeWidth=".9"
        strokeDasharray="2,2"
      />
      <Bdg
        cx={Math.min(Math.max(spX, 200), 560)}
        cy={BY_BOT}
        label="Spark Vel"
        val={out.v_at_spark}
        unit="m/s"
        ck="v_at_spark"
        w={82}
      />

      {/* Total Ports */}
      <line
        x1={606}
        y1={cy + h.man + WL + 2}
        x2={606}
        y2={BY_BOT - 17}
        stroke="#334155"
        strokeWidth=".9"
        strokeDasharray="3,2"
      />
      <Bdg
        cx={606}
        cy={BY_BOT}
        label="Total Ports"
        val={out.ports_tot}
        unit=""
        ck="ports_tot"
        w={84}
      />

      {/* Blowoff Margin */}
      <line
        x1={746}
        y1={cy + h.man + WL + 2}
        x2={746}
        y2={BY_BOT - 17}
        stroke="#334155"
        strokeWidth=".9"
        strokeDasharray="3,2"
      />
      <Bdg
        cx={746}
        cy={BY_BOT}
        label="Blowoff %"
        val={out.blowoff_margin}
        unit="%"
        ck="n"
        w={80}
      />

      {/* Flashback Margin */}
      <line
        x1={836}
        y1={cy + h.man + WL + 2}
        x2={836}
        y2={BY_BOT - 17}
        stroke="#334155"
        strokeWidth=".9"
        strokeDasharray="3,2"
      />
      <Bdg
        cx={836}
        cy={BY_BOT}
        label="Flashback%"
        val={out.flashback_margin}
        unit="%"
        ck="n"
        w={86}
      />
    </svg>
  );
}

// ─── Slider Component ─────────────────────────────────────────────────────────
function Slider({ label, unit, min, max, step, value, onChange, color }) {
  const fmt = (v) =>
    step < 0.1
      ? v.toFixed(2)
      : step < 1
      ? v.toFixed(1)
      : Number.isInteger(+v)
      ? String(Math.round(v))
      : v.toFixed(1);
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 1,
        }}
      >
        <span
          style={{
            fontSize: 9.5,
            color: "#94a3b8",
            fontFamily: "'Space Mono',monospace",
          }}
        >
          {label}
          {unit ? ` (${unit})` : ""}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: color || "#38bdf8",
            fontFamily: "'Space Mono',monospace",
          }}
        >
          {fmt(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: "100%",
          accentColor: color || "#38bdf8",
          cursor: "pointer",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 8,
          color: "#475569",
          fontFamily: "'Space Mono',monospace",
          marginTop: 1,
        }}
      >
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

// ─── Input Group Card ─────────────────────────────────────────────────────────
function Group({ title, color, children }) {
  return (
    <div
      style={{
        background: "#111827",
        borderRadius: 10,
        padding: "12px 14px",
        borderTop: `3px solid ${color}`,
        border: `1px solid #1e293b`,
        borderTopColor: color,
      }}
    >
      <div
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          color,
          fontFamily: "'Space Mono',monospace",
          textTransform: "uppercase",
          letterSpacing: 1,
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

// ─── Excel Export ─────────────────────────────────────────────────────────────
function doExport(inp, out, statusText) {
  const wb = XLSX.utils.book_new();

  const inpRows = [
    ["CONFIGURATION INPUTS", "", ""],
    ["Parameter", "Value", "Unit"],
    ["Gas Pressure", inp.p_gas, "PSI"],
    ["Nozzle Diameter", inp.d_noz, "mm"],
    ["Nozzle Cd", inp.cd, "—"],
    ["Ambient Temperature", inp.amb_temp, "°C"],
    ["Throat Diameter", inp.d_thr, "mm"],
    ["Air Inlet Diameter", inp.d_air_in, "mm"],
    ["No. of Air Inlets", inp.n_air_in, "—"],
    ["Mixing Efficiency", inp.m_eff, "%"],
    ["Tube Length", inp.tube_len, "mm"],
    ["Tube Volume", inp.tube_vol, "cm³"],
    ["Spark Position", inp.spark, "mm"],
    ["Port Rows", inp.rows, "—"],
    ["Holes per Row", inp.hpr, "—"],
    ["Port Diameter", inp.d_port, "mm"],
    ["Thermal Efficiency", inp.t_eff, "%"],
  ];

  const td = (k, v) => {
    const t = tier(k, v);
    return t === "ok" ? "✓ OK" : t === "wn" ? "⚠ MARGINAL" : "✗ OUT OF RANGE";
  };
  const outRows = [
    ["COMBUSTION RESULTS", "", "", ""],
    ["Parameter", "Value", "Unit", "Status"],
    ["Gas Mass Flow", out.m_gas_hr, "kg/hr", td("m_gas_hr", out.m_gas_hr)],
    ["Gas Jet Velocity", out.v_gas, "m/s", td("v_gas", out.v_gas)],
    ["Air Mass Flow", out.m_air_hr, "kg/hr", td("m_air_hr", out.m_air_hr)],
    [
      "Area Ratio (A_throat/A_noz)",
      out.area_ratio,
      ":1",
      td("area_ratio", out.area_ratio),
    ],
    ["Throat Velocity", out.v_mix, "m/s", td("v_mix", out.v_mix)],
    ["Reynolds Number", out.re, "—", td("re", out.re)],
    ["AFR (actual)", out.afr, "kg/kg", td("afr", out.afr)],
    ["Equivalence Ratio Φ", out.phi, "—", td("phi", out.phi)],
    ["Residence Time", out.t_res, "ms", td("t_res", out.t_res)],
    [
      "Velocity at Spark",
      out.v_at_spark,
      "m/s",
      td("v_at_spark", out.v_at_spark),
    ],
    ["Spark OK?", out.spark_ok ? "YES" : "NO", "—", "—"],
    ["Exit Velocity", out.v_exit, "m/s", td("v_exit", out.v_exit)],
    ["Total Ports", out.ports_tot, "—", td("ports_tot", out.ports_tot)],
    ["Flame Temperature", out.t_flame, "°C", td("t_flame", out.t_flame)],
    ["Net Power Output", out.kw, "kW", td("kw", out.kw)],
    ["Laminar Flame Speed", out.s_lam, "m/s", "—"],
    ["Blowoff Margin", out.blowoff_margin, "%", "—"],
    ["Flashback Margin", out.flashback_margin, "%", "—"],
    ["", "", "", ""],
    ["Combustion Status", statusText, "", ""],
  ];

  const ws1 = XLSX.utils.aoa_to_sheet(inpRows);
  const ws2 = XLSX.utils.aoa_to_sheet(outRows);
  ws1["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 10 }];
  ws2["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 10 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Configuration");
  XLSX.utils.book_append_sheet(wb, ws2, "Results");
  XLSX.writeFile(wb, "FlarePilot_Results.xlsx");
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  useFonts();
  const [inp, setInp] = useState(DEFAULTS);
  const out = useMemo(() => compute(inp), [inp]);
  const set = (k, v) => setInp((p) => ({ ...p, [k]: v }));

  // ─── NEW: Lightpanda Automation Trigger ───
  const handleRunLightpanda = async () => {
    console.log("Sending request to backend...");
    try {
      const response = await fetch("http://localhost:3001/api/run-scraper");
      const data = await response.json();

      if (data.success) {
        console.log("Success! Lightpanda returned:", data.result);
        alert(`Automation complete! Result: ${data.result}`);
      } else {
        console.error("Backend error:", data.error);
        alert("Something went wrong. Check your backend console.");
      }
    } catch (err) {
      console.error("Failed to reach backend.", err);
      alert(
        "Could not connect to backend. Is server.js still running on port 3001?"
      );
    }
  };

  const phi = out.phi,
    vExit = out.v_exit;
  let statusText, statusBg, statusTx;
  if (phi > 2.2) {
    statusText = "⚠  OVER-RICH / CHOKING";
    statusBg = "#3f0000";
    statusTx = "#fca5a5";
  } else if (phi > 1.5) {
    statusText = "⚠  STRONG IGNITABLE — RICH MIXTURE";
    statusBg = "#431407";
    statusTx = "#fdba74";
  } else if (phi > 1.05) {
    statusText = "●  RICH BURN  —  Φ > 1.05";
    statusBg = "#1c1407";
    statusTx = "#fbbf24";
  } else if (phi < 0.7 || vExit > 20) {
    statusText = "⚡  LEAN / BLOW-OFF RISK";
    statusBg = "#082f49";
    statusTx = "#7dd3fc";
  } else {
    statusText = "✓  STABLE BLUE BURN  —  0.70 ≤ Φ ≤ 1.30";
    statusBg = "#052e16";
    statusTx = "#4ade80";
  }

  const FONT = "'Space Mono', 'Courier New', monospace";
  const cardStyle = {
    background: "#111827",
    border: "1px solid #1e293b",
    borderRadius: 8,
    padding: "10px 12px",
  };

  return (
    <div
      style={{
        background: "#0a0f1a",
        minHeight: "100vh",
        fontFamily: FONT,
        color: "#e2e8f0",
      }}
    >
      {/* ── HEADER ── */}
      <div
        style={{
          background: "#020617",
          borderBottom: "1px solid #1e293b",
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#f97316",
              letterSpacing: -0.5,
            }}
          >
            🔥 Bihorns FLAREPILOT By Saer
          </span>
          <span style={{ fontSize: 10, color: "#475569" }}>
            Combustion System Designer · v3
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {[
            ["#22c55e", "OK"],
            ["#f59e0b", "Marginal"],
            ["#ef4444", "Out of Range"],
          ].map(([c, l]) => (
            <div
              key={l}
              style={{
                background: c + "22",
                border: `1px solid ${c}`,
                color: c,
                fontSize: 9,
                fontWeight: 700,
                borderRadius: 6,
                padding: "3px 9px",
              }}
            >
              {l}
            </div>
          ))}
          <button
            onClick={() => doExport(inp, out, statusText)}
            style={{
              background: "#1d4ed8",
              color: "white",
              border: "none",
              borderRadius: 7,
              padding: "7px 16px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: FONT,
              letterSpacing: 0.5,
              transition: "background .2s",
            }}
            onMouseEnter={(e) => (e.target.style.background = "#2563eb")}
            onMouseLeave={(e) => (e.target.style.background = "#1d4ed8")}
          >
            ⬇ EXPORT EXCEL
          </button>
          {/* ── NEW BUTTON ── */}
          <button
            onClick={handleRunLightpanda}
            style={{
              background: "#10b981",
              color: "white",
              border: "none",
              borderRadius: 7,
              padding: "7px 16px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: FONT,
              letterSpacing: 0.5,
              transition: "background .2s",
            }}
            onMouseEnter={(e) => (e.target.style.background = "#059669")}
            onMouseLeave={(e) => (e.target.style.background = "#10b981")}
          >
            🤖 RUN AUTOMATION
          </button>
        </div>
      </div>

      {/* ——— STATUS ——— */}
      <div
        style={{
          background: `linear-gradient(135deg, ${statusBg} 0%, rgba(0,0,0,0.2) 100%)`,
          color: statusTx,
          fontSize: 11,
          fontWeight: 800,
          padding: "6px 20px",
          letterSpacing: "1px",
          textTransform: "uppercase",
          border: "1px solid rgba(255,255,255,0.4)",
          boxShadow: `
      inset 0 1px 0 rgba(255,255,255,0.3),          
      inset 0 -1px 0 rgba(0,0,0,0.5),               
      0 4px 15px rgba(0,0,0,0.5)                    
    `,
          backdropFilter: "blur(10px) brightness(1.2)",
          clipPath: "polygon(2% 0, 100% 0, 98% 100%, 0% 100%)",
        }}
      >
        {statusText}
      </div>

      <div style={{ padding: "12px 16px", maxWidth: 1100, margin: "0 auto" }}>
        {/* ── DIAGRAM ── */}
        <div
          style={{
            background: "#060d1a",
            border: "1px solid #1e293b",
            borderRadius: 12,
            padding: "8px 6px",
            marginBottom: 14,
            overflow: "hidden",
          }}
        >
          <Diagram inp={inp} out={out} />
        </div>

        {/* ── INPUT PANEL ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <Group title="1 · Gas Supply &amp; Nozzle" color={SEC.gas}>
            <Slider
              label="Gas Pressure"
              unit="PSI"
              min={1}
              max={60}
              step={0.5}
              value={inp.p_gas}
              onChange={(v) => set("p_gas", v)}
              color={SEC.gas}
            />
            <Slider
              label="Nozzle Ø"
              unit="mm"
              min={0.3}
              max={3}
              step={0.05}
              value={inp.d_noz}
              onChange={(v) => set("d_noz", v)}
              color={SEC.gas}
            />
            <Slider
              label="Nozzle Cd"
              unit=""
              min={0.5}
              max={0.95}
              step={0.01}
              value={inp.cd}
              onChange={(v) => set("cd", v)}
              color={SEC.gas}
            />
            <Slider
              label="Ambient Temp"
              unit="°C"
              min={-20}
              max={60}
              step={1}
              value={inp.amb_temp}
              onChange={(v) => set("amb_temp", v)}
              color={SEC.gas}
            />
          </Group>

          <Group title="2 · Venturi Air Inlets" color={SEC.air}>
            <Slider
              label="Throat Ø"
              unit="mm"
              min={8}
              max={50}
              step={0.5}
              value={inp.d_thr}
              onChange={(v) => set("d_thr", v)}
              color={SEC.air}
            />
            <Slider
              label="Air Inlet Ø"
              unit="mm"
              min={4}
              max={30}
              step={0.5}
              value={inp.d_air_in}
              onChange={(v) => set("d_air_in", v)}
              color={SEC.air}
            />
            <Slider
              label="No. Air Inlets"
              unit=""
              min={1}
              max={6}
              step={1}
              value={inp.n_air_in}
              onChange={(v) => set("n_air_in", v)}
              color={SEC.air}
            />
            <Slider
              label="Mixing Efficiency"
              unit="%"
              min={50}
              max={100}
              step={1}
              value={inp.m_eff}
              onChange={(v) => set("m_eff", v)}
              color={SEC.air}
            />
          </Group>

          <Group title="3 · Mixing Tube &amp; Ignition" color={SEC.mix}>
            <Slider
              label="Tube Length"
              unit="mm"
              min={100}
              max={300}
              step={5}
              value={inp.tube_len}
              onChange={(v) => set("tube_len", v)}
              color={SEC.mix}
            />
            <Slider
              label="Tube Volume"
              unit="cm³"
              min={5}
              max={150}
              step={1}
              value={inp.tube_vol}
              onChange={(v) => set("tube_vol", v)}
              color={SEC.mix}
            />
            <Slider
              label="Spark Position"
              unit="mm"
              min={50}
              max={300}
              step={5}
              value={inp.spark}
              onChange={(v) => set("spark", v)}
              color={SEC.mix}
            />
            <Slider
              label="Thermal Efficiency"
              unit="%"
              min={30}
              max={100}
              step={1}
              value={inp.t_eff}
              onChange={(v) => set("t_eff", v)}
              color={SEC.mix}
            />
          </Group>

          <Group title="4 · Outlet Ports" color={SEC.port}>
            <Slider
              label="Port Rows"
              unit=""
              min={1}
              max={8}
              step={1}
              value={inp.rows}
              onChange={(v) => set("rows", v)}
              color={SEC.port}
            />
            <Slider
              label="Holes per Row"
              unit=""
              min={1}
              max={12}
              step={1}
              value={inp.hpr}
              onChange={(v) => set("hpr", v)}
              color={SEC.port}
            />
            <Slider
              label="Port Ø"
              unit="mm"
              min={2}
              max={20}
              step={0.5}
              value={inp.d_port}
              onChange={(v) => set("d_port", v)}
              color={SEC.port}
            />
          </Group>
        </div>

        {/* ── OUTPUT SUMMARY GRID ── */}
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            color: "#475569",
            marginBottom: 6,
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          — Complete Results —
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 7,
          }}
        >
          {[
            ["Gas Mass Flow", out.m_gas_hr, "kg/hr", "m_gas_hr", SEC.gas],
            ["Gas Jet Velocity", out.v_gas, "m/s", "v_gas", SEC.gas],
            ["Air Mass Flow", out.m_air_hr, "kg/hr", "m_air_hr", SEC.air],
            ["Area Ratio", out.area_ratio, ":1", "area_ratio", SEC.air],
            ["Throat Velocity", out.v_mix, "m/s", "v_mix", SEC.mix],
            ["Reynolds No.", out.re, "", "re", SEC.mix],
            ["AFR (actual)", out.afr, "kg/kg", "afr", SEC.mix],
            ["Equiv. Ratio Φ", out.phi, "", "phi", SEC.mix],
            ["Residence Time", out.t_res, "ms", "t_res", SEC.mix],
            ["Spark Velocity", out.v_at_spark, "m/s", "v_at_spark", SEC.mix],
            ["Exit Velocity", out.v_exit, "m/s", "v_exit", SEC.port],
            ["Total Ports", out.ports_tot, "", "ports_tot", SEC.port],
            ["Flame Temp", out.t_flame, "°C", "t_flame", SEC.flame],
            ["Net Power", out.kw, "kW", "kw", SEC.flame],
            ["Blowoff Margin", out.blowoff_margin, "%", "n", SEC.flame],
            ["Flashback Margin", out.flashback_margin, "%", "n", SEC.flame],
          ].map(([lbl, val, unit, ck, accent]) => {
            const t = tier(ck, val),
              c = TIER[t];
            const r = RANGES[ck];
            const pct = r
              ? Math.max(0, Math.min(1, (val - r[0]) / (r[1] - r[0])))
              : null;
            return (
              <div
                key={lbl}
                style={{
                  ...cardStyle,
                  borderTopColor: accent,
                  borderTopWidth: 2,
                  borderTopStyle: "solid",
                }}
              >
                <div
                  style={{ fontSize: 8.5, color: "#64748b", marginBottom: 3 }}
                >
                  {lbl}
                </div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: c.text,
                    lineHeight: 1,
                    marginBottom: 4,
                  }}
                >
                  {fv(val)}
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 400,
                      color: "#475569",
                      marginLeft: 3,
                    }}
                  >
                    {unit}
                  </span>
                </div>
                {pct != null && (
                  <div
                    style={{
                      height: 3,
                      background: "#1e293b",
                      borderRadius: 2,
                    }}
                  >
                    <div
                      style={{
                        width: `${pct * 100}%`,
                        height: "100%",
                        background: c.bar,
                        borderRadius: 2,
                        opacity: 0.8,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Stability card */}
        <div
          style={{
            ...cardStyle,
            marginTop: 7,
            display: "flex",
            gap: 20,
            alignItems: "center",
            padding: "12px 16px",
          }}
        >
          <span style={{ fontSize: 10, color: "#475569" }}>STABILITY</span>
          <div>
            <span style={{ fontSize: 9.5, color: "#64748b" }}>Blowoff: </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color:
                  out.blowoff_margin > 20
                    ? "#4ade80"
                    : out.blowoff_margin > 0
                    ? "#fbbf24"
                    : "#f87171",
              }}
            >
              {out.blowoff_margin > 0 ? "+" : ""}
              {fv(out.blowoff_margin)}%
            </span>
          </div>
          <div>
            <span style={{ fontSize: 9.5, color: "#64748b" }}>Flashback: </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color:
                  out.flashback_margin > 20
                    ? "#4ade80"
                    : out.flashback_margin > 0
                    ? "#fbbf24"
                    : "#f87171",
              }}
            >
              {out.flashback_margin > 0 ? "+" : ""}
              {fv(out.flashback_margin)}%
            </span>
          </div>
          <div style={{ marginLeft: "auto", fontSize: 9.5, color: "#475569" }}>
            Spark:{" "}
            <span
              style={{
                color: out.spark_ok ? "#4ade80" : "#f87171",
                fontWeight: 700,
              }}
            >
              {out.spark_ok ? "✓ GOOD" : "✗ CHECK"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
