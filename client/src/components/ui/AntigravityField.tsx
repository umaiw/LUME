'use client';

import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  type ReactNode,
} from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Vec2 {
  x: number;
  y: number;
}

interface Body {
  /** Position (top-left corner of the element) */
  pos: Vec2;
  /** Velocity px/frame (at 60 fps) */
  vel: Vec2;
  /** Cached bounding rect width/height */
  w: number;
  h: number;
  /** Is being dragged right now */
  dragging: boolean;
  /** Last pointer position during drag */
  dragPrev: Vec2;
}

interface AntigravityFieldProps {
  children: ReactNode;
  /** Base speed scalar (default 0.6) */
  speed?: number;
  /** Damping on each collision (0-1, default 0.85) */
  bounceDamping?: number;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const rand = (min: number, max: number) => Math.random() * (max - min) + min;

/** Axis-aligned bounding-box overlap test */
function aabbOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** Resolve overlap between two AABBs by pushing them apart along the shortest axis */
function resolveCollision(a: Body, b: Body, damping: number): void {
  const aCx = a.pos.x + a.w / 2;
  const aCy = a.pos.y + a.h / 2;
  const bCx = b.pos.x + b.w / 2;
  const bCy = b.pos.y + b.h / 2;

  const dx = bCx - aCx;
  const dy = bCy - aCy;

  const overlapX = (a.w + b.w) / 2 - Math.abs(dx);
  const overlapY = (a.h + b.h) / 2 - Math.abs(dy);

  if (overlapX <= 0 || overlapY <= 0) return;

  if (overlapX < overlapY) {
    const sign = dx > 0 ? 1 : -1;
    const push = overlapX / 2 + 0.5;
    a.pos.x -= sign * push;
    b.pos.x += sign * push;
    // swap & damp horizontal velocities
    const tmpVx = a.vel.x;
    a.vel.x = b.vel.x * damping;
    b.vel.x = tmpVx * damping;
  } else {
    const sign = dy > 0 ? 1 : -1;
    const push = overlapY / 2 + 0.5;
    a.pos.y -= sign * push;
    b.pos.y += sign * push;
    const tmpVy = a.vel.y;
    a.vel.y = b.vel.y * damping;
    b.vel.y = tmpVy * damping;
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AntigravityField({
  children,
  speed = 0.6,
  bounceDamping = 0.85,
  className = '',
}: AntigravityFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const childRefs = useRef<(HTMLDivElement | null)[]>([]);
  const bodiesRef = useRef<Body[]>([]);
  const rafRef = useRef<number>(0);
  const initializedRef = useRef(false);
  const [ready, setReady] = useState(false);

  /* Convert children to array for stable indexing */
  const items = React.Children.toArray(children);

  /* ---- Initialise bodies once DOM is painted ---- */
  useEffect(() => {
    if (initializedRef.current) return;

    const container = containerRef.current;
    if (!container) return;

    // small timeout to let browser lay out children
    const timer = setTimeout(() => {
      const cRect = container.getBoundingClientRect();
      const bodies: Body[] = [];

      childRefs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const w = r.width;
        const h = r.height;

        // Spread items across the viewport with some randomness
        const cols = Math.ceil(Math.sqrt(items.length));
        const row = Math.floor(i / cols);
        const col = i % cols;
        const cellW = cRect.width / cols;
        const cellH = cRect.height / Math.ceil(items.length / cols);

        const px = cellW * col + rand(16, Math.max(20, cellW - w - 16));
        const py = cellH * row + rand(16, Math.max(20, cellH - h - 16));

        const angle = rand(0, Math.PI * 2);
        const s = speed * rand(0.5, 1.2);

        bodies.push({
          pos: { x: px, y: py },
          vel: { x: Math.cos(angle) * s, y: Math.sin(angle) * s },
          w,
          h,
          dragging: false,
          dragPrev: { x: 0, y: 0 },
        });
      });

      bodiesRef.current = bodies;
      initializedRef.current = true;
      setReady(true);
    }, 80);

    return () => clearTimeout(timer);
  }, [items.length, speed]);

  /* ---- Animation loop ---- */
  useEffect(() => {
    if (!ready) return;

    const container = containerRef.current;
    if (!container) return;

    let prevTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - prevTime) / 16.667, 3); // normalise to 60fps, cap
      prevTime = now;

      const cW = container.clientWidth;
      const cH = container.clientHeight;
      const bodies = bodiesRef.current;

      // Move
      for (const b of bodies) {
        if (b.dragging) continue;
        b.pos.x += b.vel.x * dt;
        b.pos.y += b.vel.y * dt;
      }

      // Wall bounce
      for (const b of bodies) {
        if (b.dragging) continue;
        if (b.pos.x < 0) {
          b.pos.x = 0;
          b.vel.x = Math.abs(b.vel.x) * bounceDamping;
        } else if (b.pos.x + b.w > cW) {
          b.pos.x = cW - b.w;
          b.vel.x = -Math.abs(b.vel.x) * bounceDamping;
        }
        if (b.pos.y < 0) {
          b.pos.y = 0;
          b.vel.y = Math.abs(b.vel.y) * bounceDamping;
        } else if (b.pos.y + b.h > cH) {
          b.pos.y = cH - b.h;
          b.vel.y = -Math.abs(b.vel.y) * bounceDamping;
        }
      }

      // Collision between bodies
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i];
          const b = bodies[j];
          if (
            aabbOverlap(
              a.pos.x, a.pos.y, a.w, a.h,
              b.pos.x, b.pos.y, b.w, b.h,
            )
          ) {
            resolveCollision(a, b, bounceDamping);
          }
        }
      }

      // Minimum speed enforcement so things never stop completely
      const minSpeed = speed * 0.25;
      for (const b of bodies) {
        if (b.dragging) continue;
        const spd = Math.sqrt(b.vel.x ** 2 + b.vel.y ** 2);
        if (spd < minSpeed && spd > 0) {
          const scale = minSpeed / spd;
          b.vel.x *= scale;
          b.vel.y *= scale;
        }
      }

      // Apply transforms
      childRefs.current.forEach((el, i) => {
        if (!el || !bodies[i]) return;
        const b = bodies[i];
        el.style.transform = `translate(${b.pos.x}px, ${b.pos.y}px)`;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [ready, speed, bounceDamping]);

  /* ---- Pointer drag handling ---- */
  const onPointerDown = useCallback(
    (i: number, e: React.PointerEvent) => {
      const body = bodiesRef.current[i];
      if (!body) return;

      // Don't hijack interactions with inputs/buttons/links
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'A' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return;
      }

      body.dragging = true;
      body.vel = { x: 0, y: 0 };
      body.dragPrev = { x: e.clientX, y: e.clientY };

      const el = childRefs.current[i];
      el?.setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (i: number, e: React.PointerEvent) => {
      const body = bodiesRef.current[i];
      if (!body?.dragging) return;

      const dx = e.clientX - body.dragPrev.x;
      const dy = e.clientY - body.dragPrev.y;

      body.pos.x += dx;
      body.pos.y += dy;
      // store velocity based on drag delta for release impulse
      body.vel = { x: dx * 0.4, y: dy * 0.4 };
      body.dragPrev = { x: e.clientX, y: e.clientY };
    },
    [],
  );

  const onPointerUp = useCallback(
    (i: number) => {
      const body = bodiesRef.current[i];
      if (!body) return;
      body.dragging = false;
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className={`antigravity-field ${className}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {items.map((child, i) => (
        <div
          key={i}
          ref={(el) => {
            childRefs.current[i] = el;
          }}
          className="antigravity-item"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            willChange: 'transform',
            cursor: 'grab',
            touchAction: 'none',
            opacity: ready ? 1 : 0,
            transition: ready ? 'opacity 0.5s ease' : 'none',
          }}
          onPointerDown={(e) => onPointerDown(i, e)}
          onPointerMove={(e) => onPointerMove(i, e)}
          onPointerUp={() => onPointerUp(i)}
          onPointerCancel={() => onPointerUp(i)}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
