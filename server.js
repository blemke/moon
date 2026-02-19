// server.js
// Downloads the latest GDELT 2.0 GKG 15-minute CSV zip directly,
// parses it in memory, and returns tone averages per region as JSON.
//
// First run: npm install
//
// Endpoints:
//   GET /tone    → { world, us, oregon, portland } each { avgTone, n }
//   GET /status  → last fetch time and file used
//
// Run: node server.js

const http      = require("http");
const https     = require("https");
const unzipper  = require("unzipper");

const PORT = 3000;
const LASTUPDATE_URL = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt";

// GKG 2.1 tab-delimited columns (0-indexed):
// 15 = V2Tone  (comma-delimited: Tone,Positive,Negative,...)
// 9  = V1Locations
const COL_TONE      = 15;
const COL_LOCATIONS = 9;

let cache = { data: null, fetchedAt: null, fileUrl: null };
let refreshPromise = null;

// -----------------------------------------------
// GET with redirect following, SSL verification disabled
// Returns the response stream
// -----------------------------------------------
function getFollowRedirects(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft === 0) return reject(new Error("Too many redirects"));

    const parsed = new URL(url);
    const agent  = parsed.protocol === "https:" ? https : http;

    agent.get(url, { rejectUnauthorized: false }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith("http")
          ? res.headers.location
          : `${parsed.protocol}//${parsed.host}${res.headers.location}`;
        console.log(`[redirect] → ${next}`);
        resolve(getFollowRedirects(next, redirectsLeft - 1));
      } else if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      } else {
        resolve(res);
      }
    }).on("error", reject);
  });
}

// -----------------------------------------------
// Fetch plain text from URL
// -----------------------------------------------
async function fetchText(url) {
  const res = await getFollowRedirects(url);
  return new Promise((resolve, reject) => {
    let body = "";
    res.on("data", d => body += d);
    res.on("end", () => resolve(body));
    res.on("error", reject);
  });
}

// -----------------------------------------------
// Fetch PKZIP from URL, extract first .csv entry, return text
// -----------------------------------------------
async function fetchAndUnzip(url) {
  const res = await getFollowRedirects(url);
  return new Promise((resolve, reject) => {
    const chunks = [];
    res
      .pipe(unzipper.Parse())
      .on("entry", (entry) => {
        const name = entry.path;
        if (name.endsWith(".csv") || name.endsWith(".CSV")) {
          entry.on("data", d => chunks.push(d));
          entry.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          entry.on("error", reject);
        } else {
          entry.autodrain(); // skip non-CSV entries
        }
      })
      .on("error", reject)
      .on("finish", () => {
        if (chunks.length === 0) reject(new Error("No CSV entry found in zip"));
      });
  });
}

// -----------------------------------------------
// Get latest GKG zip URL from lastupdate.txt
// -----------------------------------------------
async function getLatestGkgUrl() {
  const text = await fetchText(LASTUPDATE_URL);
  const lines = text.trim().split("\n");
  const gkgLine = lines.find(l => l.includes(".gkg.csv.zip"));
  if (!gkgLine) throw new Error("No GKG line in lastupdate.txt");
  return gkgLine.trim().split(/\s+/)[2];
}

// -----------------------------------------------
// Parse GKG text → tone per region
// -----------------------------------------------
function parseGkg(text) {
  const buckets = { world: [], us: [], oregon: [], portland: [] };
  const lines = text.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (cols.length <= COL_TONE) continue;

    const tone = parseFloat((cols[COL_TONE] || "").split(",")[0]);
    if (!isFinite(tone)) continue;

    const loc = (cols[COL_LOCATIONS] || "").toUpperCase();

    buckets.world.push(tone);
    if (loc.includes("UNITED STATES") || loc.includes(",US,") || loc.includes("#US#"))
      buckets.us.push(tone);
    if (loc.includes("OREGON"))
      buckets.oregon.push(tone);
    if (loc.includes("PORTLAND"))
      buckets.portland.push(tone);
  }

  const avg = arr => arr.length
    ? arr.reduce((a, b) => a + b, 0) / arr.length
    : null;

  return {
    world:    { avgTone: avg(buckets.world),    n: buckets.world.length },
    us:       { avgTone: avg(buckets.us),       n: buckets.us.length },
    oregon:   { avgTone: avg(buckets.oregon),   n: buckets.oregon.length },
    portland: { avgTone: avg(buckets.portland), n: buckets.portland.length },
  };
}

// -----------------------------------------------
// Refresh: one download at a time
// -----------------------------------------------
function refresh() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      console.log("[gdelt] fetching lastupdate.txt…");
      const gkgUrl = await getLatestGkgUrl();

      if (cache.fileUrl === gkgUrl && cache.data) {
        console.log("[gdelt] already have latest file, using cache");
        return;
      }

      console.log(`[gdelt] downloading ${gkgUrl}…`);
      const text = await fetchAndUnzip(gkgUrl);
      console.log(`[gdelt] parsing ${(text.length / 1e6).toFixed(1)}MB…`);
      const data = parseGkg(text);
      cache = { data, fetchedAt: new Date(), fileUrl: gkgUrl };
      console.log(`[gdelt] done — world:${data.world.n} us:${data.us.n} oregon:${data.oregon.n} portland:${data.portland.n}`);
    } catch (e) {
      console.error("[gdelt] refresh error:", e.message);
      throw e;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// -----------------------------------------------
// HTTP server
// -----------------------------------------------
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const path = req.url.split("?")[0];

  if (path === "/tone") {
    try {
      if (!cache.data) {
        console.log("[server] no cache yet, waiting for refresh…");
        await refresh();
      }
      res.writeHead(200);
      res.end(JSON.stringify({
        ...cache.data,
        fetchedAt: cache.fetchedAt,
        fileUrl: cache.fileUrl,
      }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (path === "/status") {
    res.writeHead(200);
    res.end(JSON.stringify({
      fetchedAt: cache.fetchedAt,
      fileUrl: cache.fileUrl,
      cached: !!cache.data,
      refreshing: !!refreshPromise,
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found. Use /tone or /status" }));
});

server.listen(PORT, () => {
  console.log(`GDELT tone server at http://localhost:${PORT}`);
  console.log("Endpoints: /tone  /status");
  console.log("Starting initial GKG download…");
  refresh();
  setInterval(refresh, 15 * 60 * 1000);
});
