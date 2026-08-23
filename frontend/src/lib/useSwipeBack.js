import { useCallback, useRef, useState } from 'react';

/**
 * Swipe right to go back, the way a phone messaging app does.
 *
 * The panel follows your thumb so the gesture is visible while it happens, and
 * only completes past a distance worth committing to. Anything shorter springs
 * back, so a half-swipe never loses your place.
 *
 * The hard part is not stealing vertical scrolling: a thread is read by
 * dragging up and down, and a gesture that hijacks that is worse than no
 * gesture at all. The direction is therefore decided once, on the first few
 * pixels of movement, and a drag that starts vertical stays vertical for its
 * whole life.
 *
 * @param {() => void} onBack   - called when the swipe completes
 * @param {boolean}    [enabled] - pass false to switch the gesture off
 * @returns {{handlers: Object, style: Object, dragging: boolean}}
 */
export default function useSwipeBack(onBack, enabled = true) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Mirrors dx, because touchend needs the final distance and reading it from
  // state there would see the value from before the last move.
  const st = useRef({ x0: 0, y0: 0, axis: null, active: false, dx: 0 });

  /** Below this, the movement is too small to say which way it is going. */
  const AXIS_LOCK_PX = 8;
  /** Past this, the swipe counts as deliberate. */
  const COMPLETE_PX = 90;

  const isPhone = () =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

  const onTouchStart = useCallback((e) => {
    // Two fingers is a pinch or a scroll, never a back gesture.
    if (!enabled || e.touches.length !== 1 || !isPhone()) return;
    const t = e.touches[0];
    st.current = { x0: t.clientX, y0: t.clientY, axis: null, active: true, dx: 0 };
    setDragging(true);
  }, [enabled]);

  const onTouchMove = useCallback((e) => {
    const s = st.current;
    if (!s.active) return;
    const t = e.touches[0];
    const moveX = t.clientX - s.x0;
    const moveY = t.clientY - s.y0;

    if (!s.axis) {
      if (Math.abs(moveX) < AXIS_LOCK_PX && Math.abs(moveY) < AXIS_LOCK_PX) return;
      s.axis = Math.abs(moveX) > Math.abs(moveY) ? 'x' : 'y';
      // Decided as a scroll: stand down for the rest of this gesture.
      if (s.axis === 'y') { s.active = false; setDragging(false); return; }
    }

    // Rightward only, and with resistance past the commit point so it feels
    // like it is pulling against something rather than sliding off.
    const raw = Math.max(0, moveX);
    s.dx = raw > COMPLETE_PX ? COMPLETE_PX + (raw - COMPLETE_PX) * 0.35 : raw;
    setDx(s.dx);
  }, []);

  const finish = useCallback(() => {
    const s = st.current;
    if (!s.active) { setDragging(false); return; }
    s.active = false;
    setDragging(false);
    const completed = s.dx >= COMPLETE_PX;
    s.dx = 0;
    setDx(0);
    if (completed) onBack?.();
  }, [onBack]);

  return {
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd: finish,
      onTouchCancel: finish,
    },
    style: {
      transform: dx ? `translateX(${dx}px)` : undefined,
      // Snap back under its own power; follow the thumb exactly while held.
      transition: dragging ? 'none' : 'transform 180ms ease-out',
      // Let the browser own vertical scrolling; we only ever read horizontal.
      touchAction: 'pan-y',
    },
    dragging,
  };
}
