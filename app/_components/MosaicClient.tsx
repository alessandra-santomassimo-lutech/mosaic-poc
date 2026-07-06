"use client";

import dynamic from "next/dynamic";

// PixiJS touches WebGL/window, so it must never run during SSR. `ssr: false`
// dynamic imports are only allowed inside a Client Component (Next.js 16).
const MosaicCanvas = dynamic(() => import("./MosaicCanvas"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 grid place-items-center bg-[#05060f] text-sky-300">
      <div className="animate-pulse text-sm tracking-widest uppercase">Loading mosaic…</div>
    </div>
  ),
});

export default function MosaicClient() {
  return <MosaicCanvas />;
}
