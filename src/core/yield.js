// Yield to the event loop during long generation steps so the loading bar can paint.
// requestAnimationFrame and setTimeout are both throttled in background tabs (rAF stops,
// timers drop to ~1 Hz), which would stall loading; MessageChannel tasks are not throttled.
// Yields are time-sliced: if less than ~24 ms of work happened since the last yield, return
// immediately.
const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const queue = [];
if (channel) channel.port1.onmessage = () => { const r = queue.shift(); if (r) r(); };
let last = 0;

export function yieldUI() {
  const now = performance.now();
  if (now - last < 24) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { last = performance.now(); resolve(); };
    if (channel) { queue.push(done); channel.port2.postMessage(0); } else setTimeout(done, 0);
  });
}
