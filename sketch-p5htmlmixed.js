// sketch.js (p5.js)
// GDELT Moon Tone Dashboard
//
// moon_value = clamp((-tone + 5) / 10, 0, 1)
// phase      = moon_value * 15  (0=new, 15=full)
//
// tone +5 or more → phase 0  → new moon (all dark)
// tone 0          → phase 7.5 → half moon (right half lit)
// tone -5 or less → phase 15 → full moon (all lit)
//
// Run: node server.js before opening.
// r = refresh cache, Shift+R = force re-fetch.

const PROXY = "http://localhost:3000";
const REGIONS = ["portland", "oregon", "us", "world"];

let state = {
  loading: true,
  loadingMsg: "Loading…",
  error: null,
  scores:  { world: null, us: null, oregon: null, portland: null },
  samples: { world: null, us: null, oregon: null, portland: null },
  fetchedAt: null,
  fileUrl: null,
};

function moonValue(tone) {
  if (tone === null || !isFinite(tone)) return null;
  return Math.max(0, Math.min(1, (-tone + 5) / 10));
}

function moonPhase(tone) {
  const mv = moonValue(tone);
  return mv === null ? null : mv * 15;
}

// ──────────────────────────────────────────────
// drawMoon(x, y, size, col, phase)
//
// phase 0–30 where 0=new, 15=full, 30=new again
//
// Rendering approach:
//   We use the canvas 2D clip API to draw within the moon circle.
//   Inside the clip:
//     1. Fill entire circle dark (shadow side)
//     2. Fill a vertical half-circle on the appropriate side (lit half)
//     3. Overlay a squashed ellipse to carve/add the terminator curve
//
//   Phase mapping (0–15 = waxing, right side lit):
//     phase 0    → lit ellipse width = 0  (new moon, all dark)
//     phase 7.5  → lit ellipse width = r  (half moon, right half lit)
//     phase 15   → lit ellipse width = 2r (full moon, all lit)
//   Phase 15–30 = waning, left side lit, same geometry mirrored.
// ──────────────────────────────────────────────
function drawMoon(x, y, size, col, phase) {
  const r = size / 2;
  const p = ((phase % 30) + 30) % 30; // normalise to 0–30

  // Waxing: 0–15 (right side lit), Waning: 15–30 (left side lit)
  const waxing = p <= 15;
  const t      = waxing ? p / 15 : (30 - p) / 15; // 0→1 illumination fraction

  const ctx = drawingContext;
  push();
  translate(x, y);
  noStroke();

  ctx.save();

  // Clip everything to moon circle
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TWO_PI);
  ctx.clip();

  // Step 1: fill entire circle dark
  fill(22, 22, 32);
  rect(-r, -r, size, size);

  // Step 2: fill the lit semicircle (right half for waxing, left for waning)
  // Draw a half-disc on the lit side
  ctx.beginPath();
  if (waxing) {
    // Right half: arc from -PI/2 to PI/2 (right side)
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
  } else {
    // Left half: arc from PI/2 to 3*PI/2 (left side)
    ctx.arc(0, 0, r, Math.PI / 2, Math.PI * 1.5);
    ctx.closePath();
  }
  ctx.fillStyle = `rgb(${red(col)},${green(col)},${blue(col)})`;
  ctx.fill();

  // Step 3: draw the terminator ellipse
  // At t=0 (new): terminator covers the entire lit semicircle → ellipse width = r (covers half)
  // At t=0.5 (quarter): terminator is a vertical line → ellipse width = 0
  // At t=1 (full): terminator is off the other side → ellipse width = r on dark side
  //
  // terminator x-radius: r * (1 - 2*t)  ranges from +r (new) through 0 (quarter) to -r (full)
  // When positive: dark ellipse overlays lit side (crescent)
  // When negative: lit ellipse extends into dark side (gibbous)

  const terminatorRx = r * (1 - 2 * t); // positive = crescent, negative = gibbous

  if (Math.abs(terminatorRx) > 0.5) {
    if (terminatorRx > 0) {
      // Crescent phase: dark ellipse overlays the lit semicircle
      ctx.beginPath();
      ctx.ellipse(0, 0, terminatorRx, r, 0, 0, TWO_PI);
      ctx.fillStyle = `rgb(22,22,32)`;
      ctx.fill();
    } else {
      // Gibbous phase: lit ellipse extends into the dark semicircle
      ctx.beginPath();
      ctx.ellipse(0, 0, -terminatorRx, r, 0, 0, TWO_PI);
      ctx.fillStyle = `rgb(${red(col)},${green(col)},${blue(col)})`;
      ctx.fill();
    }
  }

  ctx.restore();

  // Soft outer glow
  noFill();
  const glowAlpha = map(t, 0, 1, 20, 70);
  stroke(red(col), green(col), blue(col), glowAlpha);
  strokeWeight(3);
  ellipse(0, 0, size + 6, size + 6);
  noStroke();

  pop();
}

// ──────────────────────────────────────────────
// Layout constants
// ──────────────────────────────────────────────
const LABELS = { world: "World", us: "US", oregon: "Oregon", portland: "Portland" };
const MOON_COLORS = {
  portland: [255, 210, 140],  // warm amber
  oregon:   [200, 230, 255],  // cool blue-white
  us:       [230, 230, 230],  // silver
  world:    [255, 255, 210],  // pale yellow
};

const MOON_SIZE = 100;
const COL_W     = 190;
const START_X   = 95;
const ROW_Y     = 175;

function setup() {
  createCanvas(COL_W * 4 + 60, 370);
  textFont("monospace");
  noLoop();
  fetchTones();
}

function draw() {
  background(12, 12, 20);

  // Title bar
  fill(160);
  textSize(14);
  textAlign(LEFT);
  text("GDELT Moon Tone  ·  " + (state.fileUrl ? state.fileUrl.split("/").pop() : "—"), 20, 26);

  if (state.loading) {
    fill(160);
    textSize(16);
    textAlign(CENTER);
    text(state.loadingMsg, width / 2, height / 2);
    textAlign(LEFT);
    redraw();
    return;
  }

  if (state.error) {
    fill(255, 100, 100);
    textSize(13);
    textAlign(CENTER);
    text("Error: " + state.error, width / 2, height / 2);
    textAlign(LEFT);
    return;
  }

  for (let i = 0; i < REGIONS.length; i++) {
    const key   = REGIONS[i];
    const tone  = state.scores[key];
    const n     = state.samples[key];
    const phase = (tone !== null && isFinite(tone)) ? moonPhase(tone) : null;
    const mv    = moonValue(tone);
    const cx    = START_X + i * COL_W;

    const [r, g, b] = MOON_COLORS[key];
    drawMoon(cx, ROW_Y, MOON_SIZE, color(r, g, b), phase !== null ? phase : 7.5);

    // Label
    fill(160);
    textSize(13);
    textAlign(CENTER);
    text(LABELS[key], cx, ROW_Y + MOON_SIZE / 2 + 22);

    // Tone
    if (tone !== null && isFinite(tone)) {
      const tStr = (tone >= 0 ? "+" : "") + nf(tone, 1, 2);
      fill(tone > 1 ? color(100, 220, 130) : tone < -1 ? color(255, 120, 120) : color(210));
      textSize(13);
      text(tStr, cx, ROW_Y + MOON_SIZE / 2 + 38);
    }

    // moon_value × 15 and phase
    if (mv !== null) {
      fill(130, 160, 210);
      textSize(11);
      text(`mv:${nf(mv * 15, 1, 2)}  ph:${nf(phase, 1, 1)}`, cx, ROW_Y + MOON_SIZE / 2 + 52);
    }

    // Article count
    fill(80);
    textSize(11);
    text(n !== null ? `${n} articles` : "—", cx, ROW_Y + MOON_SIZE / 2 + 65);
  }

  textAlign(LEFT);
  fill(70);
  textSize(11);
  const ts = state.fetchedAt ? new Date(state.fetchedAt).toLocaleString() : "—";
  text(`${ts}   ·   r=refresh   Shift+R=re-fetch   0=new  15=full  30=new`, 20, height - 10);
}

function keyPressed() {
  if (key === "r") fetchTones(false);
  if (key === "R") fetchTones(true);
}

async function fetchTones(forceRefresh = false) {
  state.loading = true;
  state.error = null;
  state.loadingMsg = forceRefresh ? "Re-fetching from GDELT…" : "Loading from server cache…";
  redraw();

  try {
    const url  = forceRefresh ? `${PROXY}/tone?refresh=1` : `${PROXY}/tone`;
    const res  = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    for (const key of REGIONS) {
      state.scores[key]  = data[key]?.avgTone ?? null;
      state.samples[key] = data[key]?.n ?? null;
    }
    state.fetchedAt = data.fetchedAt;
    state.fileUrl   = data.fileUrl;

  } catch (e) {
    state.error = (e && e.message) ? e.message : String(e);
  } finally {
    state.loading = false;
    redraw();
  }
}
