import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3-selection";
import { zoom, zoomIdentity, ZoomBehavior } from "d3-zoom";
import { ArrowRight, HelpCircle, Layers, Maximize2, Minus, Plus } from "lucide-react";
import type { Block, Colour } from "@/lib/ledger/types";
import { shortId } from "@/lib/ledger/hash";
import { cn } from "@/lib/utils";

type VisualRole = "tip" | "chain" | "blue" | "red" | "genesis";

const ROLE_META: Record<
  VisualRole,
  {
    color: string;
    cardBg: string;
    cardBorder: string;
    pillBg: string;
    pillText: string;
    badge: string;
    label: string;
    shortDesc: string;
    plainExplanation: string;
  }
> = {
  tip: {
    color: "#F2A900",
    cardBg: "rgba(242, 169, 0, 0.14)",
    cardBorder: "#F2A900",
    pillBg: "rgba(242, 169, 0, 0.24)",
    pillText: "#FBD36B",
    badge: "LIVE TIP",
    label: "Live Tip",
    shortDesc: "Newest winning block",
    plainExplanation:
      "The latest leading block on the winning GHOSTDAG backbone. New blocks build on top of this tip.",
  },
  chain: {
    color: "#F2A900",
    cardBg: "rgba(242, 169, 0, 0.08)",
    cardBorder: "rgba(242, 169, 0, 0.55)",
    pillBg: "rgba(242, 169, 0, 0.16)",
    pillText: "#F2A900",
    badge: "MAIN CHAIN",
    label: "Main Chain",
    shortDesc: "Winning GHOSTDAG backbone",
    plainExplanation:
      "Part of the primary backbone chosen by GHOSTDAG (highest accumulated proof-of-work).",
  },
  blue: {
    color: "#38bdf8",
    cardBg: "rgba(56, 189, 248, 0.09)",
    cardBorder: "rgba(56, 189, 248, 0.6)",
    pillBg: "rgba(56, 189, 248, 0.18)",
    pillText: "#7dd3fc",
    badge: "PARALLEL BLUE",
    label: "Parallel Blue",
    shortDesc: "Mined in parallel & merged in",
    plainExplanation:
      "Mined at the same time as another block and accepted into consensus — nothing is wasted and all valid transactions count.",
  },
  red: {
    color: "#f43f5e",
    cardBg: "rgba(244, 63, 94, 0.09)",
    cardBorder: "rgba(244, 63, 94, 0.65)",
    pillBg: "rgba(244, 63, 94, 0.2)",
    pillText: "#fda4af",
    badge: "LATE / FORK",
    label: "Late / Fork",
    shortDesc: "Outside K=5 parallel window",
    plainExplanation:
      "Arrived late (outside the K=5 parallel window) or on a competing branch. Recorded in the DAG, ordered after blue blocks.",
  },
  genesis: {
    color: "#f2f1ee",
    cardBg: "rgba(242, 241, 238, 0.1)",
    cardBorder: "rgba(242, 241, 238, 0.7)",
    pillBg: "rgba(242, 241, 238, 0.18)",
    pillText: "#ffffff",
    badge: "GENESIS",
    label: "Genesis #0",
    shortDesc: "First anchor block",
    plainExplanation: "Block #0 — the immutable origin anchor of the Kovanica BlockDAG.",
  },
};

const CARD_W = 136;
const CARD_H = 66;
const COL_GAP = 184;
const ROW_GAP = 92;
const PAD_LEFT = 96;
const PAD_RIGHT = 120;
const PAD_Y = 74;

type PositionedNode = {
  id: string;
  x: number;
  y: number;
  lane: number;
  colIdx: number;
  colour: Colour;
  role: VisualRole;
  height: number;
  blueScore: number;
  txCount: number;
  parentCount: number;
  nonce: number;
  timestamp: number;
};

type PositionedEdge = {
  key: string;
  d: string;
  kind: "backbone" | "merge" | "fork";
};

type Props = {
  blocks: Block[];
  selectedId: string | null;
  selectedTipId?: string | null;
  onSelect: (id: string) => void;
};

export function DagCanvas({ blocks, selectedId, selectedTipId = null, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 8 || h < 8) return;
      setSize({ w, h });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(
    () => layoutBlocksHorizontal(blocks, size.w, size.h, selectedTipId),
    [blocks, size.w, size.h, selectedTipId],
  );

  // Setup D3 Zoom & Pan — default view focuses on the latest (rightmost) tip
  useEffect(() => {
    if (!svgRef.current || !gRef.current || size.w <= 0 || size.h <= 0) return;
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 2.5])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    zoomRef.current = zoomBehavior;
    svg.call(zoomBehavior);

    const targetX = Math.max(size.w / 2, layout.tipX - size.w * 0.25);
    const targetY = layout.centerY;
    svg.call(zoomBehavior.translateTo, targetX, targetY);
  }, [layout.width, layout.height, layout.tipX, layout.centerY, size.w, size.h]);

  const handleZoomIn = () => {
    if (!svgRef.current || !zoomRef.current) return;
    (d3.select(svgRef.current) as any).transition().duration(180).call(zoomRef.current.scaleBy, 1.25);
  };

  const handleZoomOut = () => {
    if (!svgRef.current || !zoomRef.current) return;
    (d3.select(svgRef.current) as any).transition().duration(180).call(zoomRef.current.scaleBy, 0.8);
  };

  const handleFocusTip = () => {
    if (!svgRef.current || !zoomRef.current || size.w <= 0) return;
    const targetX = Math.max(size.w / 2, layout.tipX - size.w * 0.25);
    (d3.select(svgRef.current) as any)
      .transition()
      .duration(280)
      .call(zoomRef.current.translateTo, targetX, layout.centerY);
  };

  const handleFitAll = () => {
    if (!svgRef.current || !zoomRef.current || size.w <= 0 || size.h <= 0) return;
    const scaleX = (size.w - 40) / Math.max(layout.width, 1);
    const scaleY = (size.h - 40) / Math.max(layout.height, 1);
    const scale = Math.max(0.28, Math.min(1, Math.min(scaleX, scaleY)));
    const tx = (size.w - layout.width * scale) / 2;
    const ty = (size.h - layout.height * scale) / 2;
    (d3.select(svgRef.current) as any)
      .transition()
      .duration(280)
      .call(zoomRef.current.transform, zoomIdentity.translate(tx, ty).scale(scale));
  };

  const hoveredNode = useMemo(
    () => (hoveredId ? layout.nodes.find((n) => n.id === hoveredId) ?? null : null),
    [hoveredId, layout.nodes],
  );

  return (
    <div
      ref={wrapRef}
      data-testid="dag-canvas"
      data-direction="left-to-right"
      className="relative h-full min-h-[340px] overflow-hidden rounded-lg border border-border bg-bg/95 cursor-grab active:cursor-grabbing select-none"
    >
      {/* Top-Left Direction Indicator */}
      <div className="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-2 rounded-lg border border-border/80 bg-surface/90 px-2.5 py-1.5 text-[11px] font-mono text-muted backdrop-blur-md">
        <span className="text-subtle">Older</span>
        <ArrowRight className="size-3.5 text-gold" />
        <span className="font-semibold text-fg">Latest Tip</span>
        <span className="hidden sm:inline text-border">·</span>
        <span className="hidden sm:inline text-subtle">
          {layout.nodes.length} {layout.nodes.length === 1 ? "block" : "blocks"}
        </span>
      </div>

      {/* Top-Right Canvas Controls */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-surface/90 p-1 text-xs shadow-sm backdrop-blur-md">
        <button
          type="button"
          onClick={handleZoomIn}
          className="flex size-7 items-center justify-center rounded font-mono text-muted transition-colors hover:bg-bg hover:text-fg"
          title="Zoom In"
          aria-label="Zoom In"
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          className="flex size-7 items-center justify-center rounded font-mono text-muted transition-colors hover:bg-bg hover:text-fg"
          title="Zoom Out"
          aria-label="Zoom Out"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleFocusTip}
          className="flex h-7 items-center gap-1 rounded px-2 font-mono text-[11px] text-gold transition-colors hover:bg-bg"
          title="Jump to Latest Tip"
        >
          <span>Tip</span>
          <ArrowRight className="size-3" />
        </button>
        <button
          type="button"
          onClick={handleFitAll}
          className="flex h-7 items-center gap-1 rounded px-2 font-mono text-[11px] text-muted transition-colors hover:bg-bg hover:text-fg"
          title="Fit All Blocks"
        >
          <Maximize2 className="size-3" />
          <span className="hidden sm:inline">Fit</span>
        </button>
      </div>

      {/* Bottom-Left Plain-English Hover Card */}
      {hoveredNode ? (
        <div
          data-testid="dag-hover-tooltip"
          className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-sm rounded-lg border border-border bg-surface/95 p-3 text-xs shadow-lg backdrop-blur-md"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-fg">
              <span
                className="size-2.5 rounded-full"
                style={{ background: ROLE_META[hoveredNode.role].color }}
              />
              <span>#{hoveredNode.height.toLocaleString()}</span>
              <span className="text-subtle">· {shortId(hoveredNode.id, 6)}</span>
            </span>
            <span
              className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold"
              style={{
                background: ROLE_META[hoveredNode.role].pillBg,
                color: ROLE_META[hoveredNode.role].pillText,
              }}
            >
              {ROLE_META[hoveredNode.role].badge}
            </span>
          </div>
          <p className="mt-1.5 leading-relaxed text-muted">
            {ROLE_META[hoveredNode.role].plainExplanation}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-1.5 font-mono text-[10px] text-subtle">
            <span>{hoveredNode.txCount} tx</span>
            <span>{hoveredNode.parentCount} parent{hoveredNode.parentCount === 1 ? "" : "s"}</span>
            <span>blue score {hoveredNode.blueScore.toLocaleString()}</span>
            <span className="text-gold">Click to inspect</span>
          </div>
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 hidden sm:flex items-center gap-1.5 rounded-md border border-border/60 bg-surface/80 px-2.5 py-1 text-[11px] text-subtle backdrop-blur-sm">
          <Layers className="size-3 text-gold" />
          <span>Drag to pan · Scroll to zoom · Hover or click any block card for details</span>
        </div>
      )}

      {size.w > 0 ? (
        <svg
          ref={svgRef}
          role="img"
          aria-label="BlockDAG Left-to-Right Graph"
          width="100%"
          height="100%"
          className="block"
        >
          <defs>
            {/* Subtle dot grid pattern */}
            <pattern id="dag-grid-dots" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="0.8" fill="rgba(154,154,163,0.16)" />
            </pattern>

            {/* Glow for Live Tip */}
            <filter id="glow-gold" x="-25%" y="-25%" width="150%" height="150%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>

            {/* Directional arrowheads (parent -> child, left -> right) */}
            <marker
              id="arrow-backbone"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" fill="#F2A900" />
            </marker>
            <marker
              id="arrow-merge"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5.5"
              markerHeight="5.5"
              orient="auto-start-reverse"
            >
              <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" fill="#38bdf8" />
            </marker>
            <marker
              id="arrow-fork"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5.5"
              markerHeight="5.5"
              orient="auto-start-reverse"
            >
              <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" fill="#f43f5e" />
            </marker>
          </defs>

          {/* Subtle background dot matrix */}
          <rect width="100%" height="100%" fill="url(#dag-grid-dots)" />

          <g ref={gRef}>
            {/* Horizontal Main Chain Backbone Guide */}
            <line
              x1={PAD_LEFT - CARD_W / 2 - 24}
              y1={layout.centerY}
              x2={layout.width - PAD_RIGHT + CARD_W / 2 + 24}
              y2={layout.centerY}
              stroke="rgba(242, 169, 0, 0.14)"
              strokeWidth="2"
              strokeDasharray="6 6"
            />

            {/* Vertical Height Column Markers */}
            {layout.columns.map((col) => (
              <g key={`col-${col.height}`} transform={`translate(${col.x}, 0)`}>
                <line
                  x1={0}
                  y1={28}
                  x2={0}
                  y2={layout.height - 20}
                  stroke="rgba(42, 42, 48, 0.55)"
                  strokeWidth="1"
                  strokeDasharray="2 4"
                />
                <text
                  x={0}
                  y={20}
                  textAnchor="middle"
                  className="fill-subtle"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
                >
                  #{col.height.toLocaleString()}
                </text>
              </g>
            ))}

            {/* Curved Directional Edges (Parent -> Child, Left -> Right) */}
            {layout.edges.map((e) => {
              const stroke =
                e.kind === "backbone"
                  ? "#F2A900"
                  : e.kind === "merge"
                    ? "#38bdf8"
                    : "#f43f5e";
              const marker =
                e.kind === "backbone"
                  ? "url(#arrow-backbone)"
                  : e.kind === "merge"
                    ? "url(#arrow-merge)"
                    : "url(#arrow-fork)";
              return (
                <path
                  key={e.key}
                  d={e.d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={e.kind === "backbone" ? 2.4 : e.kind === "merge" ? 1.7 : 1.5}
                  strokeDasharray={e.kind === "fork" ? "4 4" : "none"}
                  opacity={e.kind === "backbone" ? 0.92 : 0.78}
                  markerEnd={marker}
                />
              );
            })}

            {/* Block Cards */}
            {layout.nodes.map((n) => {
              const meta = ROLE_META[n.role];
              const active = n.id === selectedId;
              const hovered = n.id === hoveredId;
              const isTip = n.role === "tip";
              const x0 = -CARD_W / 2;
              const y0 = -CARD_H / 2;

              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x} ${n.y})`}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredId(n.id)}
                  onMouseLeave={() => setHoveredId((prev) => (prev === n.id ? null : prev))}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(n.id);
                  }}
                >
                  {/* Pulsing halo for Live Tip */}
                  {isTip ? (
                    <rect
                      x={x0 - 5}
                      y={y0 - 5}
                      width={CARD_W + 10}
                      height={CARD_H + 10}
                      rx={13}
                      fill="none"
                      stroke="#F2A900"
                      strokeWidth="1.5"
                      opacity="0.5"
                      className="animate-pulse"
                    />
                  ) : null}

                  {/* Active selection outline */}
                  {active ? (
                    <rect
                      x={x0 - 3}
                      y={y0 - 3}
                      width={CARD_W + 6}
                      height={CARD_H + 6}
                      rx={11}
                      fill="none"
                      stroke="#f2f1ee"
                      strokeWidth="2"
                      opacity="0.95"
                    />
                  ) : null}

                  {/* Card base */}
                  <rect
                    x={x0}
                    y={y0}
                    width={CARD_W}
                    height={CARD_H}
                    rx={9}
                    fill="#121214"
                    stroke={hovered ? "#f2f1ee" : meta.cardBorder}
                    strokeWidth={isTip || active ? 1.8 : 1.2}
                    strokeDasharray={n.role === "red" ? "3 2" : "none"}
                    filter={isTip ? "url(#glow-gold)" : undefined}
                  />

                  {/* Subtle role tint overlay */}
                  <rect
                    x={x0 + 1}
                    y={y0 + 1}
                    width={CARD_W - 2}
                    height={CARD_H - 2}
                    rx={8}
                    fill={meta.cardBg}
                  />

                  {/* Left colour accent bar */}
                  <rect
                    x={x0 + 1}
                    y={y0 + 8}
                    width={3}
                    height={CARD_H - 16}
                    rx={1.5}
                    fill={meta.color}
                  />

                  {/* Left & right edge port dots */}
                  <circle cx={x0} cy={0} r={3} fill={meta.color} opacity={0.85} />
                  <circle cx={x0 + CARD_W} cy={0} r={3} fill={meta.color} opacity={0.85} />

                  {/* Row 1: Role badge + tx count */}
                  <text
                    x={x0 + 11}
                    y={y0 + 17}
                    fill={meta.pillText}
                    style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, fontWeight: 600 }}
                  >
                    {meta.badge}
                  </text>
                  <text
                    x={x0 + CARD_W - 9}
                    y={y0 + 17}
                    textAnchor="end"
                    fill="#9a9aa3"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 8.5 }}
                  >
                    {n.txCount} tx
                  </text>

                  {/* Row 2: Block height */}
                  <text
                    x={x0 + 11}
                    y={y0 + 37}
                    fill="#f2f1ee"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700 }}
                  >
                    {n.role === "genesis" ? "#0 Genesis" : `#${n.height.toLocaleString()}`}
                  </text>

                  {/* Row 3: Short hash + parent merge indicator */}
                  <text
                    x={x0 + 11}
                    y={y0 + 54}
                    fill="#9a9aa3"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
                  >
                    {shortId(n.id, 5)}
                  </text>
                  {n.parentCount > 1 ? (
                    <text
                      x={x0 + CARD_W - 9}
                      y={y0 + 54}
                      textAnchor="end"
                      fill="#7dd3fc"
                      style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, fontWeight: 600 }}
                    >
                      {n.parentCount}p merge
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      ) : null}
    </div>
  );
}

export function DagLegend({ className }: { className?: string }) {
  const [showGuide, setShowGuide] = useState(false);

  const roles: VisualRole[] = ["tip", "chain", "blue", "red", "genesis"];

  return (
    <div className={cn("w-full space-y-2 text-xs text-muted", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {roles.map((r) => {
            const meta = ROLE_META[r];
            return (
              <li key={r} className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-2.5 shrink-0 rounded-sm border border-black/20",
                    r === "tip" && "ring-2 ring-amber-400/50",
                    r === "genesis" && "border-white/80",
                  )}
                  style={{ background: meta.color }}
                  aria-hidden
                />
                <span className="font-medium text-fg">{meta.label}</span>
                <span className="text-[11px] text-subtle">({meta.shortDesc})</span>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-3">
          <span className="hidden md:inline-flex items-center gap-2 font-mono text-[11px] text-subtle">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-0.5 w-3.5 bg-gold" />
              <span>Main link</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-0.5 w-3.5 bg-sky-400" />
              <span>Merge</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-0.5 w-3.5 border-t border-dashed border-rose-500" />
              <span>Fork</span>
            </span>
          </span>

          <button
            type="button"
            onClick={() => setShowGuide((v) => !v)}
            aria-expanded={showGuide}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface/80 px-2 py-0.5 font-mono text-[11px] text-muted transition-colors hover:border-gold/40 hover:text-fg"
          >
            <HelpCircle className="size-3 text-gold" />
            <span>{showGuide ? "Hide guide" : "How to read"}</span>
          </button>
        </div>
      </div>

      {showGuide ? (
        <div className="rounded-lg border border-border/80 bg-surface/70 px-3.5 py-2.5 text-xs leading-relaxed text-muted">
          <p>
            <strong className="text-fg">How Kovanica&apos;s BlockDAG works:</strong> Unlike a
            single-file blockchain that throws away simultaneous blocks, Kovanica lets multiple
            miners produce blocks in parallel and weaves them together from{" "}
            <strong className="text-fg">left (older) → right (newest tip)</strong>.
          </p>
          <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
            <li>
              <strong className="text-gold">Gold (Main Chain &amp; Tip):</strong> The primary
              backbone chosen by GHOSTDAG (highest cumulative work).
            </li>
            <li>
              <strong className="text-sky-400">Blue (Parallel Blocks):</strong> Mined at the same
              time and merged straight into consensus — zero wasted work.
            </li>
            <li>
              <strong className="text-rose-400">Red (Late / Fork):</strong> Arrived outside the K=5
              parallel window; still recorded, ordered after blue blocks.
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Pure left-to-right multi-lane DAG layout:
 * - X-axis = height/round progression (older on the left, newest tip on the right)
 * - Lane 0 (center) = Genesis & Main Chain backbone
 * - Lanes -1, +1, -2, +2 = Parallel Blue blocks above/below the backbone
 * - Outer lanes = Red / Fork blocks diverging cleanly from the backbone
 */
export function layoutBlocksHorizontal(
  blocks: Block[],
  measuredW: number,
  measuredH: number,
  selectedTipId: string | null = null,
) {
  const sorted = [...blocks].sort((a, b) => a.height - b.height || a.id.localeCompare(b.id));

  // Determine the single active tip block (prefer explicit selectedTipId, else rightmost chain/non-red block)
  let resolvedTipId: string | null =
    selectedTipId && sorted.some((b) => b.id === selectedTipId) ? selectedTipId : null;
  if (!resolvedTipId && sorted.length > 0) {
    const chainBlocks = sorted.filter((b) => b.colour === "chain");
    const candidate = chainBlocks.length > 0 ? chainBlocks[chainBlocks.length - 1] : sorted[sorted.length - 1];
    resolvedTipId = candidate.colour === "genesis" ? null : candidate.id;
  }

  const byHeight = new Map<number, Block[]>();
  for (const b of sorted) {
    const list = byHeight.get(b.height) ?? [];
    list.push(b);
    byHeight.set(b.height, list);
  }

  const uniqueHeights = Array.from(byHeight.keys()).sort((a, b) => a - b);

  // Assign lanes per height column so main chain stays centered at lane 0,
  // parallel blue blocks fan out (-1, +1, -2, +2), and red forks sit outside them.
  const laneById = new Map<string, number>();
  let minLane = 0;
  let maxLane = 0;

  for (const h of uniqueHeights) {
    const layer = byHeight.get(h) ?? [];
    const backbone = layer.filter((b) => b.colour === "genesis" || b.colour === "chain");
    const blues = layer.filter((b) => b.colour === "blue");
    const reds = layer.filter((b) => b.colour === "red");

    const usedLanes = new Set<number>();

    // Backbone at lane 0 (if >1 chain block at same height, offset extras)
    backbone.forEach((b, idx) => {
      const lane = idx === 0 ? 0 : idx % 2 === 1 ? Math.ceil(idx / 2) : -Math.ceil(idx / 2);
      laneById.set(b.id, lane);
      usedLanes.add(lane);
      minLane = Math.min(minLane, lane);
      maxLane = Math.max(maxLane, lane);
    });

    const nextFreeLane = (preferNegativeFirst: boolean) => {
      for (let dist = 1; dist <= 20; dist++) {
        const first = preferNegativeFirst ? -dist : dist;
        const second = preferNegativeFirst ? dist : -dist;
        if (!usedLanes.has(first)) return first;
        if (!usedLanes.has(second)) return second;
      }
      return 0;
    };

    blues.forEach((b, idx) => {
      const lane = nextFreeLane(idx % 2 === 0);
      laneById.set(b.id, lane);
      usedLanes.add(lane);
      minLane = Math.min(minLane, lane);
      maxLane = Math.max(maxLane, lane);
    });

    reds.forEach((b, idx) => {
      const lane = nextFreeLane(idx % 2 === 1);
      laneById.set(b.id, lane);
      usedLanes.add(lane);
      minLane = Math.min(minLane, lane);
      maxLane = Math.max(maxLane, lane);
    });
  }

  const maxAbsLane = Math.max(Math.abs(minLane), Math.abs(maxLane), 1);
  const contentW = PAD_LEFT + Math.max(uniqueHeights.length - 1, 0) * COL_GAP + PAD_RIGHT;
  const contentH = PAD_Y * 2 + maxAbsLane * 2 * ROW_GAP;
  const width = Math.max(measuredW || 720, contentW);
  const height = Math.max(measuredH || 360, contentH);
  const centerY = height / 2;

  const columns: { height: number; x: number }[] = [];
  const pos = new Map<string, PositionedNode>();

  uniqueHeights.forEach((h, colIdx) => {
    const x = PAD_LEFT + colIdx * COL_GAP;
    columns.push({ height: h, x });
    const layer = byHeight.get(h) ?? [];
    for (const b of layer) {
      const lane = laneById.get(b.id) ?? 0;
      const y = centerY + lane * ROW_GAP;
      const role: VisualRole =
        b.colour === "genesis"
          ? "genesis"
          : b.id === resolvedTipId
            ? "tip"
            : b.colour;
      pos.set(b.id, {
        id: b.id,
        x,
        y,
        lane,
        colIdx,
        colour: b.colour,
        role,
        height: b.height,
        blueScore: b.blueScore,
        txCount: b.txs?.length ?? 0,
        parentCount: b.parents?.length ?? 0,
        nonce: b.nonce,
        timestamp: b.timestamp,
      });
    }
  });

  const edges: PositionedEdge[] = [];
  for (const b of sorted) {
    const to = pos.get(b.id);
    if (!to) continue;
    for (const p of b.parents) {
      const from = pos.get(p);
      if (!from) continue;

      const startX = from.x + CARD_W / 2 + 2;
      const startY = from.y;
      const endX = to.x - CARD_W / 2 - 5;
      const endY = to.y;
      const dx = Math.max(36, Math.abs(endX - startX) * 0.48);

      const isFork = b.colour === "red";
      const isBackbone =
        !isFork &&
        (b.selectedParent === p ||
          ((b.colour === "chain" || to.role === "tip") &&
            (from.colour === "chain" || from.colour === "genesis")));

      edges.push({
        key: `${p}->${b.id}`,
        d: `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`,
        kind: isFork ? "fork" : isBackbone ? "backbone" : "merge",
      });
    }
  }

  const tipNode = resolvedTipId ? pos.get(resolvedTipId) : null;
  const tipX = tipNode ? tipNode.x : columns.length > 0 ? columns[columns.length - 1].x : width / 2;

  return { width, height, centerY, tipX, columns, nodes: [...pos.values()], edges };
}
