/* Statistiche partite BGG – nessuna dipendenza a parte Chart.js */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtInt = n => Number(n).toLocaleString("it-IT");
  const fmtDec = n => n === null || n === undefined ? "—" : n.toLocaleString("it-IT", { maximumFractionDigits: 1 });
  const pct = (a, b) => b ? Math.round((a / b) * 100) + "%" : "—";
  const fmtDate = d => d ? new Date(d + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const fmtMin = m => { if (!m) return "—"; const h = Math.floor(m / 60), r = Math.round(m % 60); return h ? `${h}h ${String(r).padStart(2, "0")}m` : `${r} min`; };
  // solo numeri "puliti" (es. 3, 120, -5, 7.5): "46,26", "3-1", "61/59" non sono punteggi validi
  const num = s => /^\s*-?\d+(\.\d+)?\s*$/.test(String(s ?? "")) ? parseFloat(s) : null;
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const norm = s => (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const DAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  const monthLabel = k => { const [y, m] = k.split("-"); return `${MONTHS[+m - 1]} ${y.slice(2)}`; };

  let CONFIG, DATA, charts = [];
  const state = { tab: "overview", pairGame: null, pick: ["", "", "", ""], year: "", sort: "rate" };
  try { Object.assign(state, JSON.parse(localStorage.getItem("bggstats") || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem("bggstats", JSON.stringify(state)); } catch (e) {} };

  /* ---------- caricamento ---------- */
  async function init() {
    CONFIG = await (await fetch("config.json", { cache: "no-store" })).json();
    try { DATA = await (await fetch("data/plays.json", { cache: "no-store" })).json(); }
    catch (e) { DATA = { username: CONFIG.username, updated: null, plays: [] }; }
    $("#xmlInput").addEventListener("change", onXml);
    $("#pubBtn").addEventListener("click", () => { try { localStorage.removeItem(LIVE_KEY); } catch (e) {} location.reload(); });
    await loadLive();
    prepare();
    render();
  }

  const gameIdx = key => CONFIG.games.findIndex(g => g.key === key);
  const gameVar = key => `var(--g${(gameIdx(key) % 8) + 1})`;
  const gameHex = key => css(`--g${(gameIdx(key) % 8) + 1}`);
  const gameOf = key => CONFIG.games.find(g => g.key === key) || { key, label: key, icon: "🎲" };

  function gameKey(name) {
    const n = norm(name);
    const g = CONFIG.games.find(g => g.match.some(p => new RegExp(p).test(n)));
    return g ? g.key : null;
  }

  /* Dati live dal pulsante nei preferiti: arrivano nel link (#live=...), mai a un server. */
  const LIVE_KEY = "bggstats-live";
  async function loadLive() {
    let live = null;
    if (location.hash.startsWith("#live=")) {
      try {
        const b64 = location.hash.slice(6).replace(/-/g, "+").replace(/_/g, "/");
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const raw = JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
        // si salvano tutte le partite (anche degli altri giochi), così cambiando config.json non serve riscaricare
        live = { username: raw.u, updated: raw.t, live: true, raw: raw.p };
        try { localStorage.setItem(LIVE_KEY, JSON.stringify(live)); } catch (e) {}
      } catch (e) { alert("Non riesco a leggere i dati live: " + e.message); }
      history.replaceState(null, "", location.pathname + location.search);
    } else {
      try { live = JSON.parse(localStorage.getItem(LIVE_KEY) || "null"); } catch (e) {}
    }
    if (!live || !live.raw || (DATA.updated && live.updated <= DATA.updated)) return;
    const others = {}, plays = [];
    for (const [id, date, quantity, length, inc, location, bggName, bggId, pls] of live.raw) {
      const game = gameKey(bggName);
      if (!game) { others[bggName] = (others[bggName] || 0) + (quantity || 1); continue; }
      plays.push({ id, date, quantity, length, incomplete: !!inc, location, bggName, bggId, comments: "", game,
        players: pls.map(([name, score, win, color, start]) => ({ name: (name || "?").trim(), username: "", score, win: !!win, color, start })) });
    }
    plays.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    DATA = { username: live.username, updated: live.updated, live: true, plays, others };
  }

  async function onXml(ev) {
    const byId = new Map(DATA.plays.map(p => [p.id, p]));
    DATA.others = DATA.others || {};
    for (const file of ev.target.files) {
      const doc = new DOMParser().parseFromString(await file.text(), "text/xml");
      for (const p of doc.querySelectorAll("play")) {
        const item = p.querySelector("item");
        const name = item?.getAttribute("name") || "";
        const key = gameKey(name);
        if (!key) { DATA.others[name] = (DATA.others[name] || 0) + +(p.getAttribute("quantity") || 1); continue; }
        byId.set(+p.getAttribute("id"), {
          id: +p.getAttribute("id"), date: p.getAttribute("date"),
          quantity: +(p.getAttribute("quantity") || 1), length: +(p.getAttribute("length") || 0),
          incomplete: p.getAttribute("incomplete") === "1", location: p.getAttribute("location") || "",
          game: key, bggName: name, bggId: +(item?.getAttribute("objectid") || 0),
          comments: p.querySelector("comments")?.textContent?.trim() || "",
          players: [...p.querySelectorAll("players > player")].map(pl => ({
            name: (pl.getAttribute("name") || pl.getAttribute("username") || "?").trim(),
            username: pl.getAttribute("username") || "", score: pl.getAttribute("score") || "",
            win: pl.getAttribute("win") === "1", color: pl.getAttribute("color") || "", start: pl.getAttribute("startposition") || "",
          })),
        });
      }
    }
    DATA.plays = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    DATA.updated = new Date().toISOString();
    ev.target.value = "";
    prepare();
    render();
  }

  /** pl.v = punteggio valido o null; pl.bad = perché non è valido. */
  function prepare() {
    for (const p of DATA.plays) {
      const max = gameOf(p.game).maxScore;
      for (const pl of p.players) {
        const v = num(pl.score);
        pl.bad = pl.score === "" ? "" : v === null ? "non è un numero" : max !== undefined && v > max ? `supera il massimo (${max})` : "";
        pl.v = pl.bad ? null : v;
      }
    }
  }

  /* ---------- calcoli ---------- */
  const plays = key => DATA.plays.filter(p => (!key || p.game === key) && !p.incomplete && (!state.year || p.date.startsWith(state.year)));
  const periodo = () => state.year ? `nel ${state.year}` : "negli ultimi 12 mesi";
  const calTitle = () => state.year ? `Calendario ${state.year}` : "Calendario degli ultimi 12 mesi";
  const qty = p => p.quantity || 1;
  const sumQ = l => l.reduce((a, p) => a + qty(p), 0);

  function playerStats(list) {
    const m = new Map();
    for (const p of list) for (const pl of p.players) {
      const s = m.get(pl.name) || { name: pl.name, games: 0, wins: 0, scores: [], last: "" };
      s.games += qty(p); if (pl.win) s.wins += qty(p);
      if (pl.v !== null && pl.v !== undefined) s.scores.push(pl.v);
      if (p.date > s.last) s.last = p.date;
      m.set(pl.name, s);
    }
    return [...m.values()].map(s => ({
      ...s, rate: s.games ? s.wins / s.games : 0,
      avg: s.scores.length ? s.scores.reduce((a, b) => a + b, 0) / s.scores.length : null,
      best: s.scores.length ? Math.max(...s.scores) : null,
    })).sort((a, b) => b.games - a.games || b.wins - a.wins);
  }

  function monthKeys(first, last) {
    let [y, m] = first.split("-").map(Number); const out = [];
    while (`${y}-${String(m).padStart(2, "0")}` <= last) { out.push(`${y}-${String(m).padStart(2, "0")}`); if (++m > 12) { m = 1; y++; } }
    return out;
  }
  function countBy(list, f) { const m = new Map(); for (const p of list) { const k = f(p); m.set(k, (m.get(k) || 0) + qty(p)); } return m; }
  function lastMonths(n) {
    const d = new Date(); const end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    d.setDate(1); d.setMonth(d.getMonth() - (n - 1)); return monthKeys(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, end);
  }
  const weekday = date => (new Date(date + "T00:00:00").getDay() + 6) % 7;

  /** Squadre di una partita a 4: {split:[[a,b],[c,d]], winner, scores} o null. */
  function teams(p) {
    const ps = p.players;
    if (ps.length !== 4) return null;
    const groupBy = f => { const g = new Map(); ps.forEach(pl => { const k = f(pl); g.set(k, [...(g.get(k) || []), pl]); }); return [...g.values()]; };
    let split = null;
    const byColor = groupBy(pl => norm(pl.color));
    if (ps.every(pl => pl.color) && byColor.length === 2 && byColor.every(g => g.length === 2)) split = byColor;
    if (!split) { const w = ps.filter(pl => pl.win); if (w.length === 2) split = [w, ps.filter(pl => !pl.win)]; }
    if (!split) { const byScore = groupBy(pl => pl.score); if (ps.every(pl => pl.score !== "") && byScore.length === 2 && byScore.every(g => g.length === 2)) split = byScore; }
    if (!split) return null;
    let winner = null;
    const w0 = split[0].some(pl => pl.win), w1 = split[1].some(pl => pl.win);
    if (w0 !== w1) winner = w0 ? 0 : 1;
    else {
      const s0 = Math.max(...split[0].map(pl => pl.v ?? -Infinity)), s1 = Math.max(...split[1].map(pl => pl.v ?? -Infinity));
      if (s0 !== s1 && Number.isFinite(Math.max(s0, s1))) winner = s0 > s1 ? 0 : 1;
    }
    const score = t => { const v = t.map(pl => pl.v).filter(x => x !== null && x !== undefined); return v.length ? Math.max(...v) : null; };
    return { split: split.map(t => t.map(pl => pl.name).sort()), winner, scores: split.map(score) };
  }
  const pairKey = arr => [...arr].sort((a, b) => a.localeCompare(b)).join(" & ");

  /* ---------- grafici ---------- */
  function baseOpts() {
    const grid = css("--border"), muted = css("--muted");
    return {
      maintainAspectRatio: false, animation: { duration: 400 },
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false, labels: { color: muted, usePointStyle: true, pointStyle: "rectRounded", boxWidth: 10, padding: 14 } },
        tooltip: { backgroundColor: css("--surface"), titleColor: css("--text"), bodyColor: css("--text"), borderColor: grid, borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true } },
      scales: {
        x: { grid: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkip: true, autoSkipPadding: 14 }, border: { display: false } },
        y: { grid: { color: grid }, ticks: { color: muted, precision: 0 }, border: { display: false }, beginAtZero: true },
      },
    };
  }
  function chart(canvas, cfg) { if (typeof Chart === "undefined" || !canvas) return; charts.push(new Chart(canvas, cfg)); }
  const barDs = (data, color, label = "Partite") => ({ label, data, backgroundColor: color, borderRadius: 4, borderSkipped: "start", maxBarThickness: 26 });

  /* ---------- rendering ---------- */
  function render() {
    charts.forEach(c => c.destroy()); charts = [];
    $("#user").textContent = DATA.username || CONFIG.username;
    $("#pubBtn").hidden = !DATA.live;
    $("#updated").textContent = DATA.updated ? (DATA.live ? "dati live del " : "aggiornato il ") + new Date(DATA.updated).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" }) : "dati non ancora scaricati";
    $("#empty").hidden = DATA.plays.length > 0;

    const tabs = [{ key: "overview", label: "Panoramica", icon: "📊" },
      ...CONFIG.games.map(g => ({ key: g.key, label: g.label, icon: g.icon, n: sumQ(plays(g.key)), c: gameVar(g.key) })),
      { key: "pairs", label: "Coppie", icon: "🤝" }];
    if (!tabs.some(t => t.key === state.tab)) state.tab = "overview";
    $("#tabs").innerHTML = tabs.map(t => `<button class="tab${t.key === state.tab ? " active" : ""}" data-k="${t.key}" ${t.c ? `style="--c:${t.c}"` : ""}>
      <span>${t.icon}</span>${esc(t.label)}${t.n !== undefined ? `<span class="n">${t.n}</span>` : ""}</button>`).join("");
    $("#tabs").querySelectorAll(".tab").forEach(b => b.onclick = () => go(b.dataset.k));
    const act = $("#tabs .active"); if (act) $("#tabs").scrollLeft = act.offsetLeft - 16;

    const years = [...new Set(DATA.plays.map(p => p.date.slice(0, 4)))].sort().reverse();
    if (state.year && !years.includes(state.year)) state.year = "";
    $("#yearSel").innerHTML = `<option value="">📅 Tutti gli anni</option>` + years.map(y => `<option value="${y}" ${y === state.year ? "selected" : ""}>📅 ${y}</option>`).join("");
    $("#yearSel").onchange = e => { state.year = e.target.value; save(); render(); };

    const v = $("#view");
    if (!DATA.plays.length) { v.innerHTML = ""; return; }
    if (state.tab === "overview") renderOverview(v);
    else if (state.tab === "pairs") renderPairs(v);
    else renderGame(v, state.tab);
    v.querySelectorAll("th[data-sort]").forEach(th => th.onclick = () => { state.sort = th.dataset.sort; save(); const y = scrollY; render(); scrollTo(0, y); });
  }
  function go(k) { state.tab = k; save(); render(); window.scrollTo({ top: 0 }); }

  const kpi = (icon, l, v, s = "", c = "") => `<div class="kpi" ${c ? `style="--c:${c}"` : ""}><div class="l">${icon} ${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;

  /** Calendario stile GitHub degli ultimi 12 mesi: una casella per giorno, colore più intenso = più partite. */
  function heatmap(list, color) {
    const counts = countBy(list, p => p.date);
    let end = new Date(); end.setHours(0, 0, 0, 0);
    let start = new Date(end); start.setDate(start.getDate() - 364);
    if (state.year) { start = new Date(+state.year, 0, 1); const ye = new Date(+state.year, 11, 31); if (ye < end) end = ye; }
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const max = Math.max(1, ...[...counts.values()]);
    const shade = l => l === 0 ? "var(--heat0)" : l === 4 ? "var(--c)" : `color-mix(in oklab, var(--c) ${[0, 30, 55, 80][l]}%, var(--heat0))`;
    let cells = "", days = 0, total = 0;
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const n = counts.get(k) || 0; if (n) { days++; total += n; }
      const lvl = n === 0 ? 0 : n / max > .75 ? 4 : n / max > .5 ? 3 : n / max > .25 ? 2 : 1;
      cells += `<i style="background:${shade(lvl)}" title="${fmtDate(k)}: ${n} partit${n === 1 ? "a" : "e"}"></i>`;
    }
    return `<div style="--c:${color}"><div class="heat-wrap"><div class="heat">${cells}</div></div>
      <div class="heat-legend"><span>${fmtInt(total)} partite in ${days} giorni ${periodo()}</span><span style="flex:1"></span>meno
      ${[0, 1, 2, 3, 4].map(l => `<i style="background:${shade(l)}"></i>`).join("")} più</div></div>`;
  }

  function renderOverview(v) {
    const all = plays();
    const total = sumQ(all);
    const minutes = all.reduce((a, p) => a + p.length * qty(p), 0);
    const days = new Set(all.map(p => p.date)).size;
    const last12 = state.year ? monthKeys(`${state.year}-01`, `${state.year}-12`) : lastMonths(12);
    const tiles = CONFIG.games.map(g => {
      const l = plays(g.key), n = sumQ(l), bm = countBy(l, p => p.date.slice(0, 7));
      const sp = last12.map(k => bm.get(k) || 0), mx = Math.max(1, ...sp);
      const top = playerStats(l).filter(s => s.games >= Math.max(3, Math.ceil(n * .05))).sort((a, b) => b.rate - a.rate)[0];
      return `<button class="card gtile${n ? "" : " zero"}" data-k="${g.key}" style="--c:${gameVar(g.key)}">
        <div class="ic">${g.icon}</div><div class="nm">${esc(g.label)}</div>
        <div class="num">${fmtInt(n)}<small>partite</small></div>
        <div class="meta">${n ? `ultima ${fmtDate(l[l.length - 1].date)}` : "nessuna partita trovata"}</div>
        <div class="meta">${top ? `👑 ${esc(top.name)} ${pct(top.wins, top.games)}` : "&nbsp;"}</div>
        <div class="spark" title="${state.year || "ultimi 12 mesi"}">${sp.map((x, i) => `<i style="height:${(x / mx) * 100}%" title="${monthLabel(last12[i])}: ${x}"></i>`).join("")}</div>
      </button>`;
    }).join("");
    const fav = CONFIG.games.map(g => ({ g, n: sumQ(plays(g.key)) })).sort((a, b) => b.n - a.n)[0];
    const ps = playerStats(all);
    const others = Object.entries(DATA.others || {}).sort((a, b) => b[1] - a[1]);

    v.innerHTML = `
      <section class="hero" style="--c:var(--g1)" data-icon="🎲">
        <div class="eyebrow">Tutti i giochi scelti${state.year ? " · " + state.year : ""}</div>
        <div class="big">${fmtInt(total)}<small>partite</small></div>
        <div class="line">dal ${fmtDate(all[0]?.date)} al ${fmtDate(all[all.length - 1]?.date)}</div>
        <div class="chips"><span class="chip">📅 ${fmtInt(days)} giorni di gioco</span><span class="chip">⏱️ ${fmtMin(minutes)} registrati</span>
          <span class="chip">👥 ${ps.length} giocatori</span>${fav?.n ? `<span class="chip">${fav.g.icon} più giocato: ${esc(fav.g.label)}</span>` : ""}</div>
      </section>
      <div class="grid g4" style="margin-bottom:16px">${tiles}</div>
      <div class="card"><h2>Partite per mese, per gioco</h2><div class="chart-box"><canvas id="cm"></canvas></div></div>
      <div class="card"><h2>${calTitle()}</h2>${heatmap(all, "var(--g1)")}</div>
      <div class="card"><h2>Classifica giocatori (tutti i giochi)</h2>${playersTable(ps, false, "var(--g1)", Math.max(3, Math.ceil(total * .02)))}</div>
      ${others.length ? `<div class="card"><h2>🔎 Altri giochi registrati su BGG (non inclusi)</h2>
        <p class="note" style="margin:0 0 10px">Se qui c'è una versione di un gioco che volevi contare (es. un'altra edizione di Ticket to Ride), dimmelo e la aggiungo.</p>
        <div>${others.map(([n, c]) => `<span class="pill">${esc(n)} <strong>${c}</strong></span>`).join("")}</div></div>` : ""}`;
    v.querySelectorAll(".gtile").forEach(t => t.onclick = () => go(t.dataset.k));

    if (all.length) {
      const keys = monthKeys(all[0].date.slice(0, 7), all[all.length - 1].date.slice(0, 7));
      const ds = CONFIG.games.map(g => { const bm = countBy(plays(g.key), p => p.date.slice(0, 7)); return { ...barDs(keys.map(k => bm.get(k) || 0), gameHex(g.key), g.label), borderRadius: 2, borderColor: css("--surface"), borderWidth: { top: 2 } }; })
        .filter(d => d.data.some(x => x));
      const o = baseOpts(); o.scales.x.stacked = o.scales.y.stacked = true; o.plugins.legend.display = true; o.plugins.legend.position = "bottom";
      o.plugins.tooltip.filter = i => i.parsed.y > 0;
      chart($("#cm"), { type: "bar", data: { labels: keys.map(monthLabel), datasets: ds }, options: o });
    }
  }

  /** Classifica ordinabile (clic sulle intestazioni). Con "% vitt." chi ha meno di minGames partite va in fondo. */
  function sortStats(stats, minGames) {
    const k = state.sort, val = s => k === "rate" ? s.rate : (s[k] ?? -Infinity);
    const ok = s => k !== "rate" || s.games >= minGames;
    return [...stats].sort((a, b) => (ok(b) - ok(a)) || (val(b) - val(a)) || (b.games - a.games));
  }
  function playersTable(stats, withScore = true, color = "var(--accent)", minGames = 1) {
    if (!stats.length) return '<p class="muted">Nessun giocatore registrato.</p>';
    if (!withScore && ["avg", "best"].includes(state.sort)) state.sort = "rate";
    const rows = sortStats(stats, minGames);
    const below = s => state.sort === "rate" && s.games < minGames;
    const medal = (s, i) => below(s) ? '<span class="rank">–</span>' : ["🥇", "🥈", "🥉"][i] || `<span class="rank">${i + 1}</span>`;
    const th = (k, label) => `<th class="num sortable${state.sort === k ? " on" : ""}" data-sort="${k}" title="Ordina per ${label}">${label}${state.sort === k ? " ▼" : ""}</th>`;
    return `<div class="table-wrap" style="--c:${color}"><table><thead><tr><th>Giocatore</th>${th("games", "Partite")}${th("wins", "Vittorie")}${th("rate", "% vitt.")}<th></th>
      ${withScore ? th("avg", "Punti medi") + th("best", "Record") : ""}<th>Ultima</th></tr></thead><tbody>
      ${rows.map((s, i) => `<tr class="${below(s) ? "dim" : ""}"><td>${medal(s, i)} ${esc(s.name)}</td><td class="num">${fmtInt(s.games)}</td><td class="num">${fmtInt(s.wins)}</td><td class="num"><strong>${pct(s.wins, s.games)}</strong></td>
        <td style="width:18%"><div class="bar"><i style="width:${s.rate * 100}%"></i></div></td>
        ${withScore ? `<td class="num">${fmtDec(s.avg)}</td><td class="num">${s.best === null ? "—" : fmtDec(s.best)}</td>` : ""}
        <td>${fmtDate(s.last)}</td></tr>`).join("")}</tbody></table></div>
      ${state.sort === "rate" && rows.some(below) ? `<p class="note">In grigio chi ha meno di ${minGames} partite: è in fondo anche con una % alta.</p>` : ""}`;
  }

  function podium(stats, minGames, color) {
    const top = stats.filter(s => s.games >= minGames).sort((a, b) => b.rate - a.rate || b.games - a.games).slice(0, 3);
    if (!top.length) return '<p class="muted">Servono più partite per il podio.</p>';
    const order = [1, 0, 2].filter(i => top[i]);
    return `<div class="podium" style="--c:${color}">${order.map(i => `<div class="pod p${i + 1}">
      <div class="who">${esc(top[i].name)}</div><div class="rate">${pct(top[i].wins, top[i].games)}</div><div class="pc">${top[i].wins} su ${top[i].games}</div>
      <div class="step">${["🥇", "🥈", "🥉"][i]}</div></div>`).join("")}</div>
      <p class="note">Miglior % di vittorie, minimo ${minGames} partite.</p>`;
  }

  function renderGame(v, key) {
    const g = gameOf(key), c = gameVar(key), hex = gameHex(key);
    const l = plays(key);
    if (!l.length) {
      v.innerHTML = `<section class="hero" style="--c:${c}" data-icon="${g.icon}"><div class="eyebrow">${g.icon} ${esc(g.label)}</div><div class="big">0<small>partite</small></div>
        <div class="line">Nessuna partita trovata con questo nome. Guarda in Panoramica → "Altri giochi registrati su BGG": se c'è il nome giusto, dimmelo.</div></section>`;
      return;
    }
    const n = sumQ(l);
    const timed = l.filter(p => p.length > 0);
    const minutes = timed.reduce((a, p) => a + p.length, 0);
    const stats = playerStats(l);
    const minGames = Math.max(3, Math.ceil(n * .05));
    const allScores = l.flatMap(p => p.players.map(pl => ({ name: pl.name, v: pl.v, date: p.date }))).filter(x => x.v !== null && x.v !== undefined);
    const best = [...allScores].sort((a, b) => b.v - a.v)[0];
    const days = new Set(l.map(p => p.date));
    const maxDay = [...countBy(l, p => p.date)].sort((a, b) => b[1] - a[1])[0];
    const wd = Array(7).fill(0); l.forEach(p => wd[weekday(p.date)] += qty(p));
    const favDay = wd.indexOf(Math.max(...wd));
    const locs = [...countBy(l, p => p.location || "(non indicato)")].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const sizes = [...countBy(l, p => p.players.length)].sort((a, b) => a[0] - b[0]);
    const names = [...countBy(l, p => p.bggName)].sort((a, b) => b[1] - a[1]);
    const isTeam = CONFIG.teamGames.includes(key);

    v.innerHTML = `
      <section class="hero" style="--c:${c}" data-icon="${g.icon}">
        <div class="eyebrow">${g.icon} ${esc(g.label)}${state.year ? " · " + state.year : ""}</div>
        <div class="big">${fmtInt(n)}<small>partite</small></div>
        <div class="line">dal ${fmtDate(l[0].date)} al ${fmtDate(l[l.length - 1].date)}</div>
        <div class="chips"><span class="chip">📅 ${days.size} giorni</span><span class="chip">👥 ${stats.length} giocatori</span>
          ${timed.length ? `<span class="chip">⏱️ ${fmtMin(minutes / timed.length)} a partita</span>` : ""}
          ${isTeam ? `<button class="chip" id="goPairs" style="cursor:pointer;color:inherit;font:inherit;font-weight:600">🤝 Statistiche coppie →</button>` : ""}</div>
      </section>
      <div class="kpis">
        ${kpi("🏆", "Punteggio record", best ? fmtDec(best.v) : "—", best ? `${esc(best.name)} · ${fmtDate(best.date)}` : "", c)}
        ${kpi("🔥", "Giornata record", maxDay ? `${maxDay[1]} partite` : "—", maxDay ? fmtDate(maxDay[0]) : "", c)}
        ${kpi("📆", "Giorno preferito", DAYS[favDay], `${wd[favDay]} partite`, c)}
        ${kpi("⏱️", "Tempo totale", fmtMin(minutes), timed.length < l.length ? `${l.length - timed.length} partite senza durata` : "", c)}
      </div>
      <div class="grid g2" style="margin-bottom:16px">
        <div class="card"><h2>Podio</h2>${podium(stats, minGames, c)}</div>
        <div class="card"><h2>Corsa alle vittorie</h2><div class="chart-box sm"><canvas id="race"></canvas></div></div>
      </div>
      <div class="card"><h2>Classifica giocatori</h2>${playersTable(stats, true, c, minGames)}</div>
      <div class="card"><h2>Partite per mese</h2><div class="chart-box"><canvas id="cm"></canvas></div></div>
      <div class="card"><h2>${calTitle()}</h2>${heatmap(l, c)}</div>
      <div class="grid g3" style="margin-bottom:16px">
        <div class="card"><h3>Giorno della settimana</h3><div class="chart-box sm"><canvas id="cw"></canvas></div></div>
        <div class="card"><h3>Per anno</h3><div class="chart-box sm"><canvas id="cy"></canvas></div></div>
        <div class="card"><h3>Numero di giocatori</h3><table><tbody>${sizes.map(([k, x]) => `<tr><td>${k} giocatori</td><td class="num">${fmtInt(x)}</td><td style="width:40%;--c:${c}"><div class="bar"><i style="width:${(x / n) * 100}%"></i></div></td></tr>`).join("")}</tbody></table>
          <h3 style="margin-top:16px">Luoghi</h3><table><tbody>${locs.map(([k, x]) => `<tr><td>${esc(k)}</td><td class="num">${fmtInt(x)}</td></tr>`).join("")}</tbody></table></div>
      </div>
      ${oddScoresCard(l)}
      <div class="card"><h2>Ultime partite</h2>${playsTable(l.slice(-15).reverse())}
        <p class="note">Versioni BGG incluse: ${names.map(([k, x]) => `<span class="pill">${esc(k)} <strong>${x}</strong></span>`).join("")}</p></div>`;
    $("#goPairs")?.addEventListener("click", () => { state.pairGame = key; go("pairs"); });

    const keys = monthKeys(l[0].date.slice(0, 7), l[l.length - 1].date.slice(0, 7)), bm = countBy(l, p => p.date.slice(0, 7));
    chart($("#cm"), { type: "bar", data: { labels: keys.map(monthLabel), datasets: [barDs(keys.map(k => bm.get(k) || 0), hex)] }, options: baseOpts() });
    chart($("#cw"), { type: "bar", data: { labels: DAYS, datasets: [barDs(wd, hex)] }, options: baseOpts() });
    const ys = [...countBy(l, p => p.date.slice(0, 4))].sort();
    chart($("#cy"), { type: "bar", data: { labels: ys.map(y => y[0]), datasets: [barDs(ys.map(y => y[1]), hex)] }, options: baseOpts() });

    // corsa alle vittorie: vittorie cumulate dei 5 giocatori con più partite
    const racers = stats.slice(0, 5).map(s => s.name);
    const dates = [...days].sort();
    const cum = racers.map(() => 0), series = racers.map(() => []);
    const winsOn = new Map(); l.forEach(p => p.players.forEach(pl => { if (pl.win) { const k = p.date + "|" + pl.name; winsOn.set(k, (winsOn.get(k) || 0) + qty(p)); } }));
    dates.forEach(d => racers.forEach((r, i) => { cum[i] += winsOn.get(d + "|" + r) || 0; series[i].push(cum[i]); }));
    const o = baseOpts(); o.plugins.legend.display = true; o.plugins.legend.position = "bottom";
    o.elements = { point: { radius: 0, hoverRadius: 5 }, line: { borderWidth: 2, tension: .25 } };
    chart($("#race"), { type: "line", data: { labels: dates.map(fmtDate), datasets: racers.map((r, i) => ({ label: r, data: series[i], borderColor: css(`--g${i + 1}`), backgroundColor: css(`--g${i + 1}`) })) }, options: o });
  }

  /** Punteggi non validi: esclusi da medie e record, da correggere su BGG. */
  function oddScoresCard(list) {
    const odd = list.flatMap(p => p.players.filter(pl => pl.bad).map(pl => ({ p, pl })));
    if (!odd.length) return "";
    return `<div class="card"><h2>⚠️ Punteggi da controllare (${odd.length})</h2>
      <p class="note" style="margin:0 0 10px">Questi punteggi non sono usati per medie e record. Clicca la data per aprire la partita su BGG e correggerla.</p>
      <div class="table-wrap"><table><thead><tr><th>Data</th><th>Giocatore</th><th>Punteggio scritto</th><th>Motivo</th></tr></thead><tbody>
      ${odd.reverse().map(o => `<tr><td><a href="https://boardgamegeek.com/play/details/${o.p.id}" target="_blank" rel="noopener">${fmtDate(o.p.date)}</a></td>
        <td>${esc(o.pl.name)}</td><td><code>${esc(o.pl.score)}</code></td><td class="muted">${o.pl.bad}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  function playsTable(list) {
    return `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Giocatori (punti)</th><th>Vincitore</th><th>Luogo</th></tr></thead><tbody>
      ${list.map(p => `<tr><td><a href="https://boardgamegeek.com/play/details/${p.id}" target="_blank" rel="noopener">${fmtDate(p.date)}</a>${qty(p) > 1 ? ` <span class="muted">×${qty(p)}</span>` : ""}</td>
        <td class="wrapcell">${p.players.map(pl => `<span class="${pl.win ? "win" : ""}">${esc(pl.name)}${pl.score !== "" ? ` <span class="muted">${esc(pl.score)}</span>` : ""}</span>`).join(", ")}</td>
        <td>${p.players.some(pl => pl.win) ? "🏆 " + esc(p.players.filter(pl => pl.win).map(pl => pl.name).join(" & ")) : '<span class="muted">—</span>'}</td>
        <td>${esc(p.location) || '<span class="muted">—</span>'}</td></tr>`).join("")}</tbody></table></div>`;
  }

  /* ---------- coppie ---------- */
  function renderPairs(v) {
    const games = CONFIG.teamGames;
    if (!games.includes(state.pairGame)) state.pairGame = games[0];
    const key = state.pairGame, g = gameOf(key), c = gameVar(key);
    const four = plays(key).filter(p => p.players.length === 4);
    const withTeams = four.map(p => ({ p, t: teams(p) })).filter(x => x.t);
    const players = playerStats(four).map(s => s.name);

    const opts = i => `<option value="">— scegli —</option>` + players.map(n => `<option ${state.pick[i] === n ? "selected" : ""} ${state.pick.some((x, j) => j !== i && x === n) ? "disabled" : ""}>${esc(n)}</option>`).join("");
    v.innerHTML = `
      <section class="hero" style="--c:${c}" data-icon="🤝">
        <div class="eyebrow">🤝 Coppie · ${g.icon} ${esc(g.label)}</div>
        <div class="big">${fmtInt(sumQ(withTeams.map(x => x.p)))}<small>partite a coppie</small></div>
        <div class="line">Coppie riconosciute dal campo Team/colore, dai due vincitori o dai punteggi uguali.</div>
      </section>
      <div class="card">
        <div class="pickers">
          <label>Gioco<select id="pg">${games.map(k => `<option value="${k}" ${k === key ? "selected" : ""}>${gameOf(k).icon} ${esc(gameOf(k).label)}</option>`).join("")}</select></label>
          ${[0, 1, 2, 3].map(i => `<label>Giocatore ${i + 1}<select data-i="${i}" class="pp">${opts(i)}</select></label>`).join("")}
        </div>
      </div>
      <div id="pairOut"></div>
      <div class="card"><h2>Classifica coppie · ${esc(g.label)}</h2><div id="pairRank"></div></div>`;

    $("#pg").onchange = e => { state.pairGame = e.target.value; save(); render(); };
    v.querySelectorAll(".pp").forEach(s => s.onchange = e => { state.pick[+s.dataset.i] = e.target.value; save(); render(); });

    const rank = new Map();
    for (const { p, t } of withTeams) t.split.forEach((team, i) => {
      const k = pairKey(team); const r = rank.get(k) || { k, games: 0, wins: 0, last: "" };
      r.games += qty(p); if (t.winner === i) r.wins += qty(p); if (p.date > r.last) r.last = p.date; rank.set(k, r);
    });
    const minPair = 3;
    const rr = [...rank.values()].map(r => ({ ...r, rate: r.wins / r.games })).sort((a, b) => ((b.games >= minPair) - (a.games >= minPair)) || b.rate - a.rate || b.games - a.games);
    $("#pairRank").innerHTML = rr.length ? `<div class="table-wrap" style="--c:${c}"><table><thead><tr><th>Coppia</th><th class="num">Partite</th><th class="num">Vittorie</th><th class="num">% vitt.</th><th></th><th>Ultima</th></tr></thead><tbody>
      ${rr.map((r, i) => `<tr class="${r.games < minPair ? "dim" : ""}"><td>${r.games < minPair ? '<span class="rank">–</span>' : ["🥇", "🥈", "🥉"][i] || `<span class="rank">${i + 1}</span>`} ${esc(r.k)}</td><td class="num">${fmtInt(r.games)}</td><td class="num">${fmtInt(r.wins)}</td><td class="num"><strong>${pct(r.wins, r.games)}</strong></td><td style="width:18%"><div class="bar"><i style="width:${(r.wins / r.games) * 100}%"></i></div></td><td>${fmtDate(r.last)}</td></tr>`).join("")}
      </tbody></table></div><p class="note">Ordinata per % di vittorie; in grigio le coppie con meno di ${minPair} partite.</p>` : '<p class="muted">Nessuna partita con coppie riconoscibili.</p>';

    const pick = state.pick.filter(Boolean);
    const out = $("#pairOut");
    if (new Set(pick).size !== 4) { out.innerHTML = `<div class="card empty"><p>👆 Scegli 4 giocatori per vedere le tre possibili combinazioni di coppie.</p></div>`; return; }

    const set = new Set(pick);
    const mine = withTeams.filter(({ p }) => p.players.every(pl => set.has(pl.name)) && new Set(p.players.map(pl => pl.name)).size === 4);
    const [a, b, cc, d] = pick;
    const splits = [[[a, b], [cc, d]], [[a, cc], [b, d]], [[a, d], [b, cc]]];
    const cards = splits.map(([t1, t2]) => {
      const k1 = pairKey(t1);
      const rel = mine.filter(({ t }) => t.split.some(s => pairKey(s) === k1));
      const s = { n: 0, w1: 0, w2: 0, pts1: [], pts2: [], last: "", list: [] };
      for (const { p, t } of rel) {
        const i1 = t.split.findIndex(x => pairKey(x) === k1), i2 = 1 - i1;
        s.n += qty(p);
        if (t.winner === i1) s.w1 += qty(p); else if (t.winner === i2) s.w2 += qty(p);
        if (t.scores[i1] !== null) s.pts1.push(t.scores[i1]); if (t.scores[i2] !== null) s.pts2.push(t.scores[i2]);
        s.last = p.date; s.list.push(t.winner === i1 ? 1 : t.winner === i2 ? 2 : 0);
      }
      let st = 0; const who = s.list[s.list.length - 1];
      for (let i = s.list.length - 1; i >= 0 && s.list[i] === who && who; i--) st++;
      const avg = x => x.length ? fmtDec(x.reduce((q, r) => q + r, 0) / x.length) : "—";
      const lead = s.w1 === s.w2 ? 0 : s.w1 > s.w2 ? 1 : 2;
      return `<div class="card split">
        <div class="vs">
          <div class="team t1${lead === 1 ? " leader" : ""}">${lead === 1 ? '<div class="crown">👑 in vantaggio</div>' : ""}<div class="names">🔵 ${esc(t1.join(" & "))}</div><div class="w">${s.w1}</div><div class="muted">${pct(s.w1, s.n)} · punti medi ${avg(s.pts1)}</div></div>
          <div class="x">VS</div>
          <div class="team t2 r${lead === 2 ? " leader" : ""}">${lead === 2 ? '<div class="crown">👑 in vantaggio</div>' : ""}<div class="names">${esc(t2.join(" & "))} 🟠</div><div class="w">${s.w2}</div><div class="muted">${pct(s.w2, s.n)} · punti medi ${avg(s.pts2)}</div></div>
        </div>
        ${s.n ? `<div class="duel"><i style="width:${(s.w1 / s.n) * 100}%"></i><i style="width:${(s.w2 / s.n) * 100}%;margin-left:auto"></i></div>` : ""}
        <div class="meta"><span>🎮 ${fmtInt(s.n)} partite</span><span>📅 ultima ${fmtDate(s.last)}</span>
          ${st > 1 ? `<span>🔥 ${st} vittorie di fila per ${esc((who === 1 ? t1 : t2).join(" & "))}</span>` : ""}
          ${s.list.length ? `<span>ultime: ${s.list.slice(-10).map(x => x === 1 ? "🔵" : x === 2 ? "🟠" : "⚪").join("")}</span>` : ""}</div>
      </div>`;
    });
    const tot = sumQ(mine.map(x => x.p));
    const ind = playerStats(mine.map(x => x.p)).sort((x, y) => y.rate - x.rate);
    out.innerHTML = `<div class="kpis">${kpi("🎮", "Partite tra questi 4", fmtInt(tot), "", c)}${ind.map((s, i) => kpi(["🥇", "🥈", "🥉", "4️⃣"][i] || "", esc(s.name), pct(s.wins, s.games), `${s.wins} vittorie su ${s.games}`, c)).join("")}</div>
      <div class="stack">${cards.join("")}</div>
      ${mine.length ? `<div class="card"><h2>Partite tra questi 4</h2>${playsTable(mine.map(x => x.p).slice(-20).reverse())}</div>` : ""}`;
  }

  init();
})();
