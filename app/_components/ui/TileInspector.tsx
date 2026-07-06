"use client";

import { useRef } from "react";
import type { TileClick } from "@/lib/mosaic/types";
import { STATE_MINE, STATE_OTHER } from "@/lib/mosaic/types";

export function TileInspector({
  tile,
  owned,
  onClose,
  onUpload,
}: {
  tile: TileClick;
  owned: number | null;
  onClose: () => void;
  onUpload: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const isMine = tile.state === STATE_MINE || tile.index === owned;
  const isTaken = tile.state === STATE_OTHER && !isMine;

  const pick = () => fileRef.current?.click();
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
  };

  return (
    <div className="pointer-events-auto absolute inset-0 flex flex-col justify-end">
      {/* scrim */}
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />

      {/* sheet */}
      <div
        className="relative w-full rounded-t-3xl border-t border-white/10 bg-[#0b0e1c]/95 p-5 shadow-2xl"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/20" />

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Tile #{tile.index.toLocaleString()}</h2>
            <p className="text-xs text-white/50">
              column {tile.tx.toLocaleString()}, row {tile.ty.toLocaleString()}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-medium ${
              isMine
                ? "bg-amber-400/20 text-amber-200"
                : isTaken
                  ? "bg-rose-400/15 text-rose-200"
                  : "bg-emerald-400/15 text-emerald-200"
            }`}
          >
            {isMine ? "Yours" : isTaken ? "Taken" : "Available"}
          </span>
        </div>

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

        <div className="mt-5">
          {isTaken ? (
            <p className="rounded-xl bg-white/5 p-4 text-sm text-white/60">
              This tile belongs to someone else. Its photo stays private — you only see a blurred hint.
            </p>
          ) : (
            <>
              <div className="mb-4 flex items-baseline justify-between">
                <span className="text-sm text-white/60">Price</span>
                <span className="text-xl font-semibold text-white">$5</span>
              </div>
              <button
                onClick={pick}
                className="h-14 w-full rounded-2xl bg-gradient-to-r from-sky-400 to-indigo-500 text-base font-semibold text-white shadow-lg shadow-indigo-500/30 active:scale-[0.99]"
              >
                {isMine ? "Replace photo" : "Upload photo & claim"}
              </button>
              <p className="mt-2 text-center text-[11px] text-white/40">
                {isMine ? "Your photo is shown sharp on your tile." : "Your photo appears only on this tile."}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
