/** Fixed-timestep game loop. A frame over 16ms is a bug, not a shrug. */
export function loop(update: (dt: number) => void) {
  const STEP = 1000 / 60;
  let last = performance.now();
  const tick = (now: number) => {
    while (now - last >= STEP) {
      update(STEP);
      last += STEP;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
