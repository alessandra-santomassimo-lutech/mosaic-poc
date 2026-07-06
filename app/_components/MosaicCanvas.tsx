"use client";

import { useEffect, useRef, useState } from "react";
import { MosaicEngine } from "@/lib/mosaic/engine";
import type { HudState, TileClick, ViewMode } from "@/lib/mosaic/types";
import { Hud } from "./ui/Hud";
import { TileInspector } from "./ui/TileInspector";
import { ViewToggle } from "./ui/ViewToggle";

export default function MosaicCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MosaicEngine | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [selected, setSelected] = useState<TileClick | null>(null);
  const [mode, setMode] = useState<ViewMode>("2d");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new MosaicEngine(host, {
      onHud: setHud,
      onTileSelect: (t) => setSelected(t),
    });
    engineRef.current = engine;
    // Optional deep-links: ?mode=3d starts on the globe; ?tile=N flies to a tile.
    const params = new URLSearchParams(window.location.search);
    const initialMode: ViewMode = params.get("mode") === "3d" ? "3d" : "2d";
    const focus = params.get("tile");
    const own = params.get("own");
    void engine.init().then(() => {
      if (own !== null && Number.isFinite(Number(own))) engine.demoOwn(Number(own));
      if (initialMode !== "2d") {
        setMode(initialMode);
        engine.setMode(initialMode);
      } else if (own !== null && Number.isFinite(Number(own))) {
        engine.focusTile(Number(own));
      } else if (focus !== null && Number.isFinite(Number(focus))) {
        engine.focusTile(Number(focus));
      }
    });
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const changeMode = (m: ViewMode) => {
    setMode(m);
    setSelected(null);
    engineRef.current?.setMode(m);
  };

  const handleUpload = async (file: File) => {
    if (!selected) return;
    await engineRef.current?.applyPhoto(selected.index, file);
    setSelected(null);
  };

  const focusOwned = () => {
    if (hud?.owned == null) return;
    setMode("2d");
    engineRef.current?.focusTile(hud.owned);
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05060f] text-white select-none">
      <div ref={hostRef} className="absolute inset-0" />

      {/* overlay: pointer-events off so gestures reach the canvas; controls re-enable */}
      <div className="pointer-events-none absolute inset-0">
        <Hud hud={hud} onFocusOwned={focusOwned} />
        <ViewToggle mode={mode} onChange={changeMode} />
        {selected && (
          <TileInspector
            tile={selected}
            owned={hud?.owned ?? null}
            onClose={() => setSelected(null)}
            onUpload={handleUpload}
          />
        )}
      </div>
    </div>
  );
}
