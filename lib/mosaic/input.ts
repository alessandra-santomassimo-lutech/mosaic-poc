// Unified pointer input: mouse + touch. Emits high-level gestures the active
// view interprets (2D pans/zooms; 3D orbits/dollies). One finger = drag; two
// fingers = pinch-zoom around the midpoint; wheel = zoom at the cursor.

export interface GestureHandlers {
  onDragStart?: () => void;
  onDrag?: (dx: number, dy: number, x: number, y: number) => void;
  onDragEnd?: (vx: number, vy: number) => void; // velocity px/frame for inertia
  onPinch?: (scale: number, cx: number, cy: number) => void; // scale relative to last event
  onWheel?: (deltaScale: number, x: number, y: number) => void;
  onTap?: (x: number, y: number) => void;
}

interface Pt {
  x: number;
  y: number;
}

export class InputController {
  private readonly pointers = new Map<number, Pt>();
  private lastPinchDist = 0;
  private lastMid: Pt = { x: 0, y: 0 };
  private dragging = false;
  private moved = 0;
  private downPos: Pt = { x: 0, y: 0 };
  private lastVel: Pt = { x: 0, y: 0 };

  constructor(private readonly el: HTMLElement, private readonly h: GestureHandlers) {
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("pointerleave", this.onUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.style.touchAction = "none";
  }

  private local(e: PointerEvent): Pt {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    this.el.setPointerCapture?.(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      this.dragging = true;
      this.moved = 0;
      this.downPos = p;
      this.lastVel = { x: 0, y: 0 };
      this.h.onDragStart?.();
    } else if (this.pointers.size === 2) {
      this.dragging = false;
      const [a, b] = [...this.pointers.values()];
      this.lastPinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  };

  private onMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.lastPinchDist > 0) {
        this.h.onPinch?.(dist / this.lastPinchDist, mid.x, mid.y);
        // Two-finger drag also pans/orbits via the midpoint.
        this.h.onDrag?.(mid.x - this.lastMid.x, mid.y - this.lastMid.y, mid.x, mid.y);
      }
      this.lastPinchDist = dist;
      this.lastMid = mid;
      return;
    }

    if (this.dragging) {
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.lastVel = { x: dx, y: dy };
      this.h.onDrag?.(dx, dy, p.x, p.y);
    }
  };

  private onUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);

    if (this.pointers.size < 2) this.lastPinchDist = 0;

    if (this.dragging && this.pointers.size === 0) {
      this.dragging = false;
      if (this.moved < 6) {
        this.h.onTap?.(this.downPos.x, this.downPos.y);
      } else {
        this.h.onDragEnd?.(this.lastVel.x, this.lastVel.y);
      }
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = this.el.getBoundingClientRect();
    // Normalize: wheel up (negative deltaY) => zoom in (>1).
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.h.onWheel?.(factor, e.clientX - r.left, e.clientY - r.top);
  };

  destroy(): void {
    const el = this.el;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onUp);
    el.removeEventListener("pointerleave", this.onUp);
    el.removeEventListener("wheel", this.onWheel);
  }
}
