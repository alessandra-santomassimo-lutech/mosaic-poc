"use client";

import type { HudState } from "@/lib/mosaic/types";

export function Hud({ hud, onFocusOwned }: { hud: HudState | null; onFocusOwned: () => void }) {
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 p-3"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))", paddingLeft: "max(0.75rem, env(safe-area-inset-left))" }}
    >
      <div className="pointer-events-auto w-[15rem] max-w-[70vw] rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-md">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold tracking-tight text-sky-200">Mosaic</span>
          <span className="text-[10px] uppercase tracking-widest text-white/40">1M tiles</span>
        </div>

        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-white/70">
          <dt className="text-white/40">Zoom</dt>
          <dd className="text-right tabular-nums">{hud ? `${hud.zoomPct}%` : "—"}</dd>
          <dt className="text-white/40">FPS</dt>
          <dd className="text-right tabular-nums">{hud?.fps ?? "—"}</dd>
          <dt className="text-white/40">Chunks live</dt>
          <dd className="text-right tabular-nums">{hud?.residentChunks ?? "—"}</dd>
          <dt className="text-white/40">Chunks loaded</dt>
          <dd className="text-right tabular-nums">{hud?.loadedChunks ?? "—"}</dd>
        </dl>

        {hud?.owned != null ? (
          <button
            onClick={onFocusOwned}
            className="mt-3 h-11 w-full rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-xs font-semibold text-black shadow-lg shadow-orange-500/20 active:scale-[0.98]"
          >
            Find my tile
          </button>
        ) : (
          <p className="mt-3 text-[11px] leading-snug text-white/40">Tap any tile to claim it.</p>
        )}
      </div>
    </div>
  );
}
