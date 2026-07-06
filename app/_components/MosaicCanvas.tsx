"use client";

import { useEffect, useRef, useState } from "react";
import { MosaicEngine } from "@/lib/mosaic/engine";
import { MosaicData } from "@/lib/mosaic/mosaicData";
import type { HudState, TileClick, ViewMode } from "@/lib/mosaic/types";
import { Globe3D } from "@/lib/mosaic3d/globe3d";
import { Hud } from "./ui/Hud";
import { TileInspector } from "./ui/TileInspector";
import { ViewToggle } from "./ui/ViewToggle";

// Generate the "ME" placeholder photo used by the ?own= demo deep-link.
function demoPhoto(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, "#ff5e62");
  g.addColorStop(1, "#ffd452");
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  x.fillStyle = "#fff";
  x.font = "bold 90px sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText("ME", 128, 128);
  return c;
}

export default function MosaicCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef<MosaicData | null>(null);
  const engineRef = useRef<MosaicEngine | null>(null);
  const globeRef = useRef<Globe3D | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [selected, setSelected] = useState<TileClick | null>(null);
  const [mode, setMode] = useState<ViewMode>("2d");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    const data = new MosaicData();
    dataRef.current = data;
    const cb = { onHud: setHud, onTileSelect: (t: TileClick) => setSelected(t) };
    const engine = new MosaicEngine(host, data, cb);
    engineRef.current = engine;

    const ensureGlobe = async () => {
      if (!globeRef.current) {
        const g = new Globe3D(host, data, cb);
        globeRef.current = g;
        await g.init();
      }
      return globeRef.current;
    };

    const params = new URLSearchParams(window.location.search);
    const wantMode: ViewMode = params.get("mode") === "3d" ? "3d" : "2d";
    const own = params.get("own");
    const focus = params.get("tile");
    const ownIdx = own !== null && Number.isFinite(Number(own)) ? Number(own) : null;
    const focusIdx = focus !== null && Number.isFinite(Number(focus)) ? Number(focus) : null;

    void (async () => {
      await engine.init();
      if (cancelled) return;
      if (ownIdx !== null) data.setPhoto(demoPhoto(), ownIdx);

      if (wantMode === "3d") {
        const g = await ensureGlobe();
        if (cancelled) return;
        engine.setActive(false);
        g?.setActive(true);
        setMode("3d");
        if (ownIdx !== null) g?.focusTile(ownIdx);
        else if (focusIdx !== null) g?.focusTile(focusIdx);
      } else {
        if (ownIdx !== null) engine.focusTile(ownIdx);
        else if (focusIdx !== null) engine.focusTile(focusIdx);
      }
    })();

    return () => {
      cancelled = true;
      engineRef.current?.destroy();
      globeRef.current?.destroy();
      engineRef.current = null;
      globeRef.current = null;
      dataRef.current = null;
    };
  }, []);

  const changeMode = (m: ViewMode) => {
    if (m === mode) return;
    setSelected(null);
    setMode(m);
    void (async () => {
      if (m === "3d") {
        if (!globeRef.current) {
          const host = hostRef.current;
          const data = dataRef.current;
          if (!host || !data) return;
          const g = new Globe3D(host, data, { onHud: setHud, onTileSelect: (t) => setSelected(t) });
          globeRef.current = g;
          await g.init();
        }
        engineRef.current?.setActive(false);
        globeRef.current?.setActive(true);
      } else {
        globeRef.current?.setActive(false);
        engineRef.current?.setActive(true);
      }
    })();
  };

  const handleUpload = async (file: File) => {
    if (!selected || !dataRef.current) return;
    const bitmap = await createImageBitmap(file);
    dataRef.current.setPhoto(bitmap, selected.index);
    setSelected(null);
  };

  const focusOwned = () => {
    if (hud?.owned == null) return;
    if (mode === "3d") globeRef.current?.focusTile(hud.owned);
    else engineRef.current?.focusTile(hud.owned);
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05060f] text-white select-none">
      <div ref={hostRef} className="absolute inset-0 [&>canvas]:absolute [&>canvas]:inset-0 [&>canvas]:h-full [&>canvas]:w-full" />

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
