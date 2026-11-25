/* Statistiche partite BGG – nessuna dipendenza a parte Chart.js */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtInt = n => Number(n).toLocaleString("it-IT");
  const pct = (a, b) => b ? Math.round((a / b) * 100) + "%" : "—";
  const fmtDate = d => d ? new Date(d + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const fmtMin = m => { if (!m) return "—"; const h = Math.floor(m / 60), r = Math.round(m % 60); return h ? `${h}h ${String(r).padStart(2, "0")}m` : `${r} min`; };
  const num = s => { const v = parseFloat(String(s).replace(",", ".")); return Number.isFinite(v) ? v : null; };
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const norm = s => (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

  let CONFIG, DATA, charts = [];
  const state = { tab: "overview", pairGame: null, pick: ["", "", "", ""] };
  try { Object.assign(state, JSON.parse(localStorage.getItem("bggstats") || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem("bggstats", JSON.stringify(state)); } catch (e) {} };

  /* ---------- caricamento ---------- */
  async function init() {
    CONFIG = await (await fetch("config.json")).json();
    try { DATA = await (await fetch("data/plays.json", { cache: "no-store" })).json(); }
    catch (e) { DATA = { username: CONFIG.username, updated: null, plays: [] }; }
    $("#xmlInput").addEventListener("change", onXml);
    $("#pubBtn").addEventListener("click", () => { try { localStorage.removeItem(LIVE_KEY); } catch (e) {} location.reload(); });
    await loadLive();
    render();
  }

  /* ---------- dati live dal pulsante nei preferiti (passati nel link, mai a un server) ---------- */
  const LIVE_KEY = "bggstats-live";
  async function loadLive() {
    let live = null;
    if (location.hash.startsWith("#live=")) {
      try {
        const b64 = location.hash.slice(6).replace(/-/g, "+").replace(/_/g, "/");
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const raw = JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
        const plays = raw.p.map(([id, date, quantity, length, inc, location, bggName, bggId, pls]) => ({
          id, date, quantity, length, incomplete: !!inc, location, bggName, bggId, comments: "", game: gameKey(bggName),
          players: pls.map(([name, score, win, color, start]) => ({ name: (name || "?").trim(), username: "", score, win: !!win, color, start })),
        })).filter(p => p.game).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
        live = { username: raw.u, updated: raw.t, plays, live: true };
        try { localStorage.setItem(LIVE_KEY, JSON.stringify(live)); } catch (e) {}
      } catch (e) { alert("Non riesco a leggere i dati live: " + e.message); }
      history.replaceState(null, "", location.pathname + location.search);
    } else {
      try { live = JSON.parse(localStorage.getItem(LIVE_KEY) || "null"); } catch (e) {}
    }
    if (live && (!DATA.updated || live.updated > DATA.updated)) DATA = live;
  }

  function gameKey(name) {
    const n = norm(name);
    const g = CONFIG.games.find(g => g.match.some(p => new RegExp(p).test(n)));
    return g ? g.key : null;
  }

  async function onXml(ev) {
    const byId = new Map(DATA.plays.map(p => [p.id, p]));
    for (const file of ev.target.files) {
      const doc = new DOMParser().parseFromString(await file.text(), "text/xml");
      for (const p of doc.querySelectorAll("play")) {
        const item = p.querySelector("item");
        const name = item?.getAttribute("name") || "";
        const key = gameKey(name);
        if (!key) continue;
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
    render();
  }

  /* ---------- calcoli ---------- */
  const plays = key => DATA.plays.filter(p => (!key || p.game === key) && !p.incomplete);
  const qty = p => p.quantity || 1;
  const label = key => CONFIG.games.find(g => g.key === key)?.label || key;

  function playerStats(list) {
    const m = new Map();
    for (const p of list) for (const pl of p.players) {
      const s = m.get(pl.name) || { name: pl.name, games: 0, wins: 0, scores: [], last: "" };
      s.games += qty(p); if (pl.win) s.wins += qty(p);
      const v = num(pl.score); if (v !== null) s.scores.push(v);
      if (p.date > s.last) s.last = p.date;
      m.set(pl.name, s);
    }
    return [...m.values()].map(s => ({
      ...s, rate: s.games ? s.wins / s.games : 0,
      avg: s.scores.length ? s.scores.reduce((a, b) => a + b, 0) / s.scores.length : null,
      best: s.scores.length ? Math.max(...s.scores) : null,
    })).sort((a, b) => b.games - a.games || b.wins - a.wins);
  }

  function byMonth(list) {
    if (!list.length) return { labels: [], values: [] };
    const counts = new Map();
    for (const p of list) { const k = p.date.slice(0, 7); counts.set(k, (counts.get(k) || 0) + qty(p)); }
    const first = list[0].date.slice(0, 7), last = list[list.length - 1].date.slice(0, 7);
    let [y, m] = first.split("-").map(Number);
    const labels = [], values = [];
    while (`${y}-${String(m).padStart(2, "0")}` <= last) {
      const k = `${y}-${String(m).padStart(2, "0")}`;
      labels.push(k); values.push(counts.get(k) || 0);
      if (++m > 12) { m = 1; y++; }
    }
    return { labels, values };
  }

  /** Squadre di una partita a 4: [[a,b],[c,d]] con indice della squadra vincitrice, o null. */
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
      const s0 = Math.max(...split[0].map(pl => num(pl.score) ?? -Infinity)), s1 = Math.max(...split[1].map(pl => num(pl.score) ?? -Infinity));
      if (s0 !== s1 && Number.isFinite(Math.max(s0, s1))) winner = s0 > s1 ? 0 : 1;
    }
    const score = t => { const v = t.map(pl => num(pl.score)).filter(x => x !== null); return v.length ? Math.max(...v) : null; };
    return { split: split.map(t => t.map(pl => pl.name).sort()), winner, scores: split.map(score) };
  }

  const pairKey = arr => [...arr].sort((a, b) => a.localeCompare(b)).join(" & ");

  /* ---------- rendering ---------- */
  function render() {
    charts.forEach(c => c.destroy()); charts = [];
    $("#user").textContent = DATA.username || CONFIG.username;
    $("#pubBtn").hidden = !DATA.live;
    $("#updated").textContent = DATA.updated ? (DATA.live ? "dati live del " : "aggiornato il ") + new Date(DATA.updated).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" }) : "dati non ancora scaricati";
    $("#empty").hidden = DATA.plays.length > 0;

    const tabs = [{ key: "overview", label: "Panoramica" }, ...CONFIG.games.map(g => ({ key: g.key, label: g.label, n: plays(g.key).reduce((a, p) => a + qty(p), 0) })), { key: "pairs", label: "Coppie" }];
    if (!tabs.some(t => t.key === state.tab)) state.tab = "overview";
    $("#tabs").innerHTML = tabs.map(t => `<button class="tab${t.key === state.tab ? " active" : ""}" data-k="${t.key}">${esc(t.label)}${t.n !== undefined ? `<span class="n">${t.n}</span>` : ""}</button>`).join("");
    $("#tabs").querySelectorAll(".tab").forEach(b => b.onclick = () => { state.tab = b.dataset.k; save(); render(); window.scrollTo({ top: 0 }); });

    const v = $("#view");
    if (!DATA.plays.length) { v.innerHTML = ""; return; }
    if (state.tab === "overview") renderOverview(v);
    else if (state.tab === "pairs") renderPairs(v);
    else renderGame(v, state.tab);
  }

  const kpi = (l, v, s = "") => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;

  function barChart(canvas, labels, values, color, horizontal = false) {
    if (typeof Chart === "undefined" || !canvas) return;
    const grid = css("--border"), muted = css("--muted");
    charts.push(new Chart(canvas, {
      type: "bar",
      data: { labels, datasets: [{ data: values, backgroundColor: color, borderRadius: 3, maxBarThickness: 28 }] },
      options: {
        indexAxis: horizontal ? "y" : "x", maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed[horizontal ? "x" : "y"]} partite` } } },
        scales: {
          x: { grid: { display: horizontal, color: grid }, ticks: { color: muted, maxRotation: 0, autoSkip: true, autoSkipPadding: 12 }, border: { display: false } },
          y: { grid: { display: !horizontal, color: grid }, ticks: { color: muted, precision: 0 }, border: { display: false }, beginAtZero: true },
        },
      },
    }));
  }

  function renderOverview(v) {
    const all = plays();
    const total = all.reduce((a, p) => a + qty(p), 0);
    const minutes = all.reduce((a, p) => a + p.length, 0);
    const days = new Set(all.map(p => p.date)).size;
    const rows = CONFIG.games.map(g => {
      const l = plays(g.key), n = l.reduce((a, p) => a + qty(p), 0);
      const top = playerStats(l).filter(s => s.games >= 3).sort((a, b) => b.rate - a.rate)[0];
      return { g, n, last: l.length ? l[l.length - 1].date : "", top };
    });
    const max = Math.max(1, ...rows.map(r => r.n));
    v.innerHTML = `
      <div class="kpis">
        ${kpi("Partite totali", fmtInt(total))}
        ${kpi("Giorni di gioco", fmtInt(days))}
        ${kpi("Tempo registrato", fmtMin(minutes))}
        ${kpi("Prima partita", fmtDate(all[0]?.date), "ultima " + fmtDate(all[all.length - 1]?.date))}
      </div>
      <div class="card"><h2>Partite per gioco</h2><div class="table-wrap"><table>
        <thead><tr><th>Gioco</th><th class="num">Partite</th><th></th><th>Ultima</th><th>Miglior % vittorie (min 3)</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td><a href="#" data-k="${r.g.key}" class="lnk">${esc(r.g.label)}</a></td><td class="num">${fmtInt(r.n)}</td>
          <td style="width:30%"><div class="bar"><i style="width:${(r.n / max) * 100}%"></i></div></td>
          <td>${fmtDate(r.last)}</td><td>${r.top ? `${esc(r.top.name)} <span class="muted">${pct(r.top.wins, r.top.games)}</span>` : '<span class="muted">—</span>'}</td></tr>`).join("")}</tbody>
      </table></div></div>
      <div class="card"><h2>Partite per mese</h2><div class="chart-box"><canvas id="cm"></canvas></div></div>
      <div class="card"><h2>Classifica giocatori (tutti i giochi)</h2>${playersTable(playerStats(all), false)}</div>`;
    v.querySelectorAll(".lnk").forEach(a => a.onclick = e => { e.preventDefault(); state.tab = a.dataset.k; save(); render(); });
    const m = byMonth(all); barChart($("#cm"), m.labels, m.values, css("--c1"));
  }

  function playersTable(stats, withScore = true) {
    if (!stats.length) return '<p class="muted">Nessun giocatore registrato.</p>';
    return `<div class="table-wrap"><table><thead><tr><th>Giocatore</th><th class="num">Partite</th><th class="num">Vittorie</th><th class="num">% vitt.</th><th></th>
      ${withScore ? '<th class="num">Punti medi</th><th class="num">Record</th>' : ""}<th>Ultima</th></tr></thead><tbody>
      ${stats.map(s => `<tr><td>${esc(s.name)}</td><td class="num">${fmtInt(s.games)}</td><td class="num">${fmtInt(s.wins)}</td><td class="num">${pct(s.wins, s.games)}</td>
        <td style="width:18%"><div class="bar"><i style="width:${s.rate * 100}%"></i></div></td>
        ${withScore ? `<td class="num">${s.avg === null ? "—" : s.avg.toLocaleString("it-IT", { maximumFractionDigits: 1 })}</td><td class="num">${s.best === null ? "—" : fmtInt(s.best)}</td>` : ""}
        <td>${fmtDate(s.last)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function renderGame(v, key) {
    const l = plays(key);
    if (!l.length) { v.innerHTML = `<div class="card empty"><h2>${esc(label(key))}</h2><p>Nessuna partita registrata per questo gioco.</p></div>`; return; }
    const n = l.reduce((a, p) => a + qty(p), 0);
    const timed = l.filter(p => p.length > 0);
    const minutes = timed.reduce((a, p) => a + p.length, 0);
    const stats = playerStats(l);
    const allScores = l.flatMap(p => p.players.map(pl => ({ name: pl.name, v: num(pl.score), date: p.date }))).filter(x => x.v !== null);
    const best = allScores.sort((a, b) => b.v - a.v)[0];
    const locs = new Map(); l.forEach(p => { const k = p.location || "(non indicato)"; locs.set(k, (locs.get(k) || 0) + qty(p)); });
    const locRows = [...locs].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const sizes = new Map(); l.forEach(p => sizes.set(p.players.length, (sizes.get(p.players.length) || 0) + qty(p)));
    const years = new Map(); l.forEach(p => { const y = p.date.slice(0, 4); years.set(y, (years.get(y) || 0) + qty(p)); });
    const names = [...new Set(l.map(p => p.bggName))];
    const isTeam = CONFIG.teamGames.includes(key);

    v.innerHTML = `
      <div class="kpis">
        ${kpi("Partite", fmtInt(n), `${new Set(l.map(p => p.date)).size} giorni diversi`)}
        ${kpi("Durata media", fmtMin(timed.length ? minutes / timed.length : 0), timed.length ? `totale ${fmtMin(minutes)}` : "durata non registrata")}
        ${kpi("Giocatori diversi", stats.length)}
        ${kpi("Punteggio record", best ? fmtInt(best.v) : "—", best ? `${esc(best.name)} · ${fmtDate(best.date)}` : "")}
        ${kpi("Ultima partita", fmtDate(l[l.length - 1].date), "prima " + fmtDate(l[0].date))}
      </div>
      ${isTeam ? `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><span>Statistiche per coppie disponibili per ${esc(label(key))}.</span><button class="btn" id="goPairs">Apri Coppie →</button></div>` : ""}
      <div class="card"><h2>Classifica giocatori</h2>${playersTable(stats)}</div>
      <div class="card"><h2>Partite per mese</h2><div class="chart-box"><canvas id="cm"></canvas></div></div>
      <div class="grid g3">
        <div class="card"><h3>Per anno</h3><div class="chart-box" style="height:200px"><canvas id="cy"></canvas></div></div>
        <div class="card"><h3>Numero di giocatori</h3><table><tbody>${[...sizes].sort((a, b) => a[0] - b[0]).map(([k, c]) => `<tr><td>${k} giocatori</td><td class="num">${fmtInt(c)}</td><td class="num muted">${pct(c, n)}</td></tr>`).join("")}</tbody></table></div>
        <div class="card"><h3>Luoghi</h3><table><tbody>${locRows.map(([k, c]) => `<tr><td>${esc(k)}</td><td class="num">${fmtInt(c)}</td></tr>`).join("")}</tbody></table></div>
      </div>
      <div class="card"><h2>Ultime partite</h2>${playsTable(l.slice(-15).reverse())}
        <p class="note">Nomi BGG inclusi: ${names.map(esc).join(", ")}</p></div>`;
    $("#goPairs")?.addEventListener("click", () => { state.tab = "pairs"; state.pairGame = key; save(); render(); });
    const m = byMonth(l); barChart($("#cm"), m.labels, m.values, css("--c1"));
    const ys = [...years].sort(); barChart($("#cy"), ys.map(y => y[0]), ys.map(y => y[1]), css("--c3"));
  }

  function playsTable(list) {
    return `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Giocatori (punti)</th><th>Vincitore</th><th>Luogo</th></tr></thead><tbody>
      ${list.map(p => `<tr><td>${fmtDate(p.date)}${qty(p) > 1 ? ` <span class="muted">×${qty(p)}</span>` : ""}</td>
        <td class="wrapcell">${p.players.map(pl => `<span class="${pl.win ? "win" : ""}">${esc(pl.name)}${pl.score !== "" ? ` <span class="muted">${esc(pl.score)}</span>` : ""}</span>`).join(", ")}</td>
        <td>${esc(p.players.filter(pl => pl.win).map(pl => pl.name).join(" & ")) || '<span class="muted">—</span>'}</td>
        <td>${esc(p.location) || '<span class="muted">—</span>'}</td></tr>`).join("")}</tbody></table></div>`;
  }

  /* ---------- coppie ---------- */
  function renderPairs(v) {
    const games = CONFIG.teamGames;
    if (!games.includes(state.pairGame)) state.pairGame = games[0];
    const key = state.pairGame;
    const l = plays(key);
    const four = l.filter(p => p.players.length === 4);
    const withTeams = four.map(p => ({ p, t: teams(p) })).filter(x => x.t);
    const players = playerStats(four).map(s => s.name);

    const opts = (i) => `<option value="">— scegli —</option>` + players.map(n => `<option ${state.pick[i] === n ? "selected" : ""} ${state.pick.some((x, j) => j !== i && x === n) ? "disabled" : ""}>${esc(n)}</option>`).join("");
    v.innerHTML = `
      <div class="card">
        <h2>Statistiche per coppie</h2>
        <div class="pickers">
          <label>Gioco<select id="pg">${games.map(g => `<option value="${g}" ${g === key ? "selected" : ""}>${esc(label(g))}</option>`).join("")}</select></label>
          ${[0, 1, 2, 3].map(i => `<label>Giocatore ${i + 1}<select data-i="${i}" class="pp">${opts(i)}</select></label>`).join("")}
        </div>
        <p class="note">${fmtInt(four.reduce((a, p) => a + qty(p), 0))} partite a 4 giocatori, di cui ${fmtInt(withTeams.reduce((a, x) => a + qty(x.p), 0))} con coppie riconoscibili
          (dal campo <em>colore/squadra</em>, dai due vincitori o dai punteggi uguali).</p>
      </div>
      <div id="pairOut"></div>
      <div class="card"><h2>Classifica coppie · ${esc(label(key))}</h2><div id="pairRank"></div></div>`;

    $("#pg").onchange = e => { state.pairGame = e.target.value; save(); render(); };
    v.querySelectorAll(".pp").forEach(s => s.onchange = e => { state.pick[+s.dataset.i] = e.target.value; save(); render(); });

    // classifica di tutte le coppie
    const rank = new Map();
    for (const { p, t } of withTeams) t.split.forEach((team, i) => {
      const k = pairKey(team); const r = rank.get(k) || { k, games: 0, wins: 0, last: "" };
      r.games += qty(p); if (t.winner === i) r.wins += qty(p); if (p.date > r.last) r.last = p.date; rank.set(k, r);
    });
    const rr = [...rank.values()].sort((a, b) => b.games - a.games || b.wins - a.wins);
    $("#pairRank").innerHTML = rr.length ? `<div class="table-wrap"><table><thead><tr><th>Coppia</th><th class="num">Partite</th><th class="num">Vittorie</th><th class="num">% vitt.</th><th></th><th>Ultima</th></tr></thead><tbody>
      ${rr.map(r => `<tr><td>${esc(r.k)}</td><td class="num">${fmtInt(r.games)}</td><td class="num">${fmtInt(r.wins)}</td><td class="num">${pct(r.wins, r.games)}</td><td style="width:18%"><div class="bar"><i style="width:${(r.wins / r.games) * 100}%"></i></div></td><td>${fmtDate(r.last)}</td></tr>`).join("")}
      </tbody></table></div>` : '<p class="muted">Nessuna partita con coppie riconoscibili.</p>';

    const pick = state.pick.filter(Boolean);
    const out = $("#pairOut");
    if (new Set(pick).size !== 4) { out.innerHTML = `<div class="card empty"><p>Scegli 4 giocatori per vedere le tre possibili combinazioni di coppie.</p></div>`; return; }

    const set = new Set(pick);
    const mine = withTeams.filter(({ p }) => p.players.every(pl => set.has(pl.name)) && new Set(p.players.map(pl => pl.name)).size === 4);
    const [a, b, c, d] = pick;
    const splits = [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]];
    const cards = splits.map(([t1, t2]) => {
      const k1 = pairKey(t1), k2 = pairKey(t2);
      const rel = mine.filter(({ t }) => t.split.some(s => pairKey(s) === k1));
      const s = { n: 0, w1: 0, w2: 0, pts1: [], pts2: [], last: "", streak: "", list: [] };
      for (const { p, t } of rel) {
        const i1 = t.split.findIndex(x => pairKey(x) === k1), i2 = 1 - i1;
        s.n += qty(p);
        if (t.winner === i1) s.w1 += qty(p); else if (t.winner === i2) s.w2 += qty(p);
        if (t.scores[i1] !== null) s.pts1.push(t.scores[i1]); if (t.scores[i2] !== null) s.pts2.push(t.scores[i2]);
        s.last = p.date; s.list.push(t.winner === i1 ? 1 : t.winner === i2 ? 2 : 0);
      }
      // serie in corso
      let st = 0, who = s.list[s.list.length - 1];
      for (let i = s.list.length - 1; i >= 0 && s.list[i] === who && who; i--) st++;
      const avg = x => x.length ? (x.reduce((q, r) => q + r, 0) / x.length).toLocaleString("it-IT", { maximumFractionDigits: 1 }) : "—";
      const lead = s.w1 === s.w2 ? 0 : s.w1 > s.w2 ? 1 : 2;
      return `<div class="card split">
        <div class="vs">
          <div class="team${lead === 1 ? " leader" : ""}"><div class="names">${esc(t1.join(" & "))}</div><div class="w">${s.w1}</div><div class="muted">${pct(s.w1, s.n)} · punti medi ${avg(s.pts1)}</div></div>
          <div class="x">VS</div>
          <div class="team r${lead === 2 ? " leader" : ""}"><div class="names">${esc(t2.join(" & "))}</div><div class="w">${s.w2}</div><div class="muted">${pct(s.w2, s.n)} · punti medi ${avg(s.pts2)}</div></div>
        </div>
        ${s.n ? `<div class="duel"><i style="width:${(s.w1 / s.n) * 100}%"></i><i style="width:${(s.w2 / s.n) * 100}%;margin-left:auto"></i></div>` : ""}
        <div class="meta"><span>${fmtInt(s.n)} partite</span><span>ultima ${fmtDate(s.last)}</span>
          ${st > 1 ? `<span>serie in corso: ${st} vittorie di ${esc((who === 1 ? t1 : t2).join(" & "))}</span>` : ""}</div>
      </div>`;
    });
    const tot = mine.reduce((q, x) => q + qty(x.p), 0);
    const ind = playerStats(mine.map(x => x.p));
    out.innerHTML = `<div class="kpis">${kpi("Partite tra questi 4", fmtInt(tot))}${ind.sort((x, y) => y.rate - x.rate).map(s => kpi(esc(s.name), pct(s.wins, s.games), `${s.wins} vittorie su ${s.games}`)).join("")}</div>
      ${cards.join("")}
      ${mine.length ? `<div class="card"><h2>Partite tra questi 4</h2>${playsTable(mine.map(x => x.p).slice(-20).reverse())}</div>` : ""}`;
  }

  init();
})();
