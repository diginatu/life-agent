import type { FilesystemAdapter } from "../adapters/filesystem.ts";

interface ServerDeps {
  fs: FilesystemAdapter;
  port?: number;
  logDir?: string;
}

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Life Agent Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; max-width: 800px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 1.5rem; margin-bottom: 16px; }
    .controls { display: flex; gap: 12px; align-items: center; margin-bottom: 24px; }
    .controls input[type="date"] { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; padding: 6px 12px; font-size: 0.9rem; }
    .controls button { background: #3b82f6; color: white; border: none; border-radius: 6px; padding: 6px 16px; cursor: pointer; font-size: 0.9rem; }
    .controls button:hover { background: #2563eb; }
    .tabs { display: flex; gap: 8px; margin-bottom: 16px; }
    .tabs button { background: #1e293b; color: #94a3b8; border: 1px solid #334155; border-radius: 6px; padding: 6px 16px; cursor: pointer; }
    .tabs button.active { background: #334155; color: #e2e8f0; }
    .timeline { display: flex; flex-direction: column; gap: 12px; }
    .entry { background: #1e293b; border-radius: 8px; padding: 16px; border-left: 4px solid #334155; }
    .entry.active { border-left-color: #f59e0b; }
    .entry.passive { border-left-color: #22c55e; }
    .entry-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .entry-time { color: #94a3b8; font-size: 0.85rem; }
    .entry-action { font-weight: 600; font-size: 0.85rem; }
    .entry-action.active { color: #f59e0b; }
    .entry-action.passive { color: #22c55e; }
    .entry-details { color: #94a3b8; font-size: 0.85rem; }
    .entry-message { margin-top: 8px; padding: 8px 12px; background: #334155; border-radius: 6px; font-size: 0.85rem; }
    .digest { background: #1e293b; border-radius: 8px; padding: 24px; white-space: pre-wrap; line-height: 1.6; }
    .empty { text-align: center; color: #64748b; padding: 48px; }
    .error { color: #ef4444; font-size: 0.85rem; margin-top: 4px; }
  </style>
</head>
<body>
  <h1>Life Agent Dashboard</h1>
  <div class="controls">
    <input type="date" id="date-picker">
    <button onclick="loadData()">Load</button>
  </div>
  <div class="tabs">
    <button class="active" onclick="showTab('timeline', this)">Timeline</button>
    <button onclick="showTab('digest', this)">Digest</button>
  </div>
  <div id="timeline" class="timeline"></div>
  <div id="digest" class="digest" style="display:none"></div>

  <script>
    const PASSIVE = new Set(["none"]);
    const datePicker = document.getElementById("date-picker");
    datePicker.value = new Date().toISOString().slice(0, 10);

    function showTab(tab, btn) {
      document.getElementById("timeline").style.display = tab === "timeline" ? "flex" : "none";
      document.getElementById("digest").style.display = tab === "digest" ? "block" : "none";
      document.querySelectorAll(".tabs button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    }

    async function loadData() {
      const date = datePicker.value;
      try {
        const res = await fetch("/api/log/" + date);
        const entries = await res.json();
        renderTimeline(entries);
      } catch (e) {
        document.getElementById("timeline").innerHTML = '<div class="empty">Failed to load data</div>';
      }
    }

    function renderTimeline(entries) {
      const container = document.getElementById("timeline");
      if (entries.length === 0) {
        container.innerHTML = '<div class="empty">No entries for this date</div>';
        return;
      }
      container.innerHTML = entries.map(e => {
        const action = e.decision?.action ?? "unknown";
        const isActive = !PASSIVE.has(action);
        const cls = isActive ? "active" : "passive";
        const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "?";
        const scene = e.summary?.scene ?? "";
        const activity = e.summary?.activityGuess ?? "";
        const reason = e.decision?.reason ?? "";
        const msgHtml = e.message
          ? '<div class="entry-message">' + esc(e.message.body) + '</div>'
          : '';
        const errHtml = (e.errors && e.errors.length)
          ? '<div class="error">' + e.errors.map(esc).join('; ') + '</div>'
          : '';
        return '<div class="entry ' + cls + '">'
          + '<div class="entry-header">'
          + '<span class="entry-time">' + esc(time) + '</span>'
          + '<span class="entry-action ' + cls + '">' + esc(action) + '</span>'
          + '</div>'
          + '<div class="entry-details">' + esc(scene) + (activity ? ' — ' + esc(activity) : '') + '</div>'
          + '<div class="entry-details">' + esc(reason) + '</div>'
          + msgHtml + errHtml
          + '</div>';
      }).join("");
    }

    function esc(s) {
      const d = document.createElement("div");
      d.textContent = s;
      return d.innerHTML;
    }

    loadData();
  </script>
</body>
</html>`;

export function createServer(deps: ServerDeps) {
  const { fs, port = 3000, logDir = "./logs" } = deps;

  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);

      // API: get log entries for a date
      const logMatch = url.pathname.match(/^\/api\/log\/(\d{4}-\d{2}-\d{2})$/);
      if (logMatch) {
        const date = logMatch[1]!;
        const entries = await fs.readLastNLines(logDir, date, 10000);
        return Response.json(entries);
      }

      // Dashboard HTML
      if (url.pathname === "/") {
        return new Response(HTML_PAGE, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });
}
