"use client";

import type { ViewMode } from "@/lib/mosaic/types";

export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <div className="pointer-events-auto flex gap-1 rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-md">
        {(["2d", "3d"] as ViewMode[]).map((m) => (
          <button
            key={m}
            onClick={() => onChange(m)}
            className={`h-11 min-w-[4.5rem] rounded-full px-5 text-sm font-semibold transition-colors ${
              mode === m
                ? "bg-gradient-to-r from-sky-400 to-indigo-500 text-white shadow-lg shadow-indigo-500/30"
                : "text-white/60 active:text-white"
            }`}
          >
            {m === "2d" ? "2D" : "Globe"}
          </button>
        ))}
      </div>
    </div>
  );
}
