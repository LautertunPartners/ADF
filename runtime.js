// Stand-in for the dashboard runtime: datasets, calcs, drawings, the perspective setting.
(() => {
  const store = {}, calcs = [], draws = {}, ons = [];
  let side = 'adf';
  try { side = localStorage.getItem('adf-side') === 'jd' ? 'jd' : 'adf'; } catch (e) {}
  const css = getComputedStyle(document.documentElement);
  window.dash = {
    data: (id) => store[id] || { status: 'loading', data: [] },
    calc: (id, o) => calcs.push({ id, ...o }),
    loader() {},
    draw: (n, f) => { draws[n] = f; },
    onData: (f) => ons.push(f),
    params: () => ({ side }),
    setParams: (p) => { if (p.side) { side = p.side; try { localStorage.setItem('adf-side', side); } catch (e) {} } render(); },
    refresh: (id) => { if (id === 'live') loadLive(); },
    setLink: (id) => { try { history.replaceState(null, '', '#' + id); } catch (e) {} render(); },
    colors: [css.getPropertyValue('--series-1').trim(), css.getPropertyValue('--series-2').trim()],
  };
  const recompute = () => calcs.forEach((c) => {
    const ins = c.inputs.map((i) => dash.data(i));
    if (ins.every((d) => d.status === 'ok')) store[c.id] = { status: 'ok', data: c.fn(...ins.map((d) => d.data)) };
    else store[c.id] = { status: ins.find((d) => d.status !== 'ok').status, data: [] };
  });
  const render = () => {
    ons.forEach((f) => f());
    document.querySelectorAll('[data-draw]').forEach((el) => { if (!el.closest('[hidden]') && draws[el.dataset.draw]) draws[el.dataset.draw](el); });
  };
  const set = (id, d) => { store[id] = d; recompute(); render(); };
  window.addEventListener('resize', () => render());

  // Normal distribution helpers for chance to cover.
  const erf = (x) => { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); };
  const cdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  const inv = (p) => { // Acklam's approximation
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  };

  const PATH = { NFL: 'nfl', CFB: 'college-football' };
  const SIGMA = { NFL: [13.5, 13.5], CFB: [15.5, 16.0] }; // std dev of full-game final margin and total
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/';
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const names = (t) => new Set(['displayName', 'shortDisplayName', 'location', 'name', 'abbreviation', 'nickname'].map((k) => norm(t[k])).filter(Boolean));
  const flip = (l) => (l.startsWith('-') ? '+' + l.slice(1) : '-' + l.replace(/^\+/, ''));
  const getJSON = (u) => fetch(u, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); });

  async function grade(picks) {
    const boards = {};
    await Promise.all([...new Set(picks.map((p) => p.league + '|' + p.game_date))].map(async (k) => {
      const [lg, dt] = k.split('|');
      boards[k] = (await getJSON(`${ESPN}${PATH[lg]}/scoreboard?dates=${dt.replace(/-/g, '')}${lg === 'CFB' ? '&groups=80&limit=400' : ''}`)).events || [];
    }));
    const wpCache = {};
    const rows = await Promise.all(picks.map(async (p0) => {
      const p = { ...p0 }, line = String(p.line).trim(), ln = Number(line);
      let e = null, comps = null;
      for (const ev of boards[p.league + '|' + p.game_date]) {
        const cs = {}; ev.competitions[0].competitors.forEach((c) => { cs[c.homeAway] = c; });
        const an = names(cs.away.team), hn = names(cs.home.team);
        if (an.has(norm(p.away)) && hn.has(norm(p.home))) { e = ev; comps = cs; break; }
        if (an.has(norm(p.home)) && hn.has(norm(p.away))) { e = ev; comps = cs; [p.away, p.home] = [p.home, p.away]; break; }
      }
      let john, adf;
      if (p.bet_type === 'Spread') { const opp = norm(p.side) === norm(p.away) ? p.home : p.away; john = `${p.side} ${line}`; adf = `${opp} ${flip(line)}`; }
      else { john = `${p.away}/${p.home} ${p.bet_type} ${line}`; adf = `${p.away}/${p.home} ${p.bet_type === 'Over' ? 'Under' : 'Over'} ${line}`; }
      const row = { id: p.id, league: p.league, kickoff: '', away: p.away, home: p.home, away_score: null, home_score: null, state: 'missing', clock: 'Game not found on ESPN', john_pick: john, adf_pick: adf, john_cover_pct: null, john_result: '' };
      if (!e) return row;
      const st = e.status.type, asc = Number(comps.away.score || 0), hsc = Number(comps.home.score || 0);
      Object.assign(row, { kickoff: e.date, state: st.state, clock: st.shortDetail || '' });
      if (st.state !== 'pre') Object.assign(row, { away_score: asc, home_score: hsc });
      const [sdM, sdT] = SIGMA[p.league];
      const sideHome = norm(p.side) === norm(p.home), m = sideHome ? hsc - asc : asc - hsc;
      if (st.state === 'post') {
        const v = p.bet_type === 'Spread' ? m + ln : (asc + hsc - ln) * (p.bet_type === 'Over' ? 1 : -1);
        row.john_result = v > 0 ? 'W' : v < 0 ? 'L' : 'P';
        row.john_cover_pct = v > 0 ? 100 : v < 0 ? 0 : 50;
      } else if (st.state === 'in') {
        const period = e.status.period || 0, frac = (period <= 4 ? Math.max(0, (4 - period) * 900 + (e.status.clock || 0)) : 0) / 3600;
        let pc;
        if (p.bet_type === 'Spread') {
          const sd = Math.max(sdM * Math.sqrt(frac), 3);
          let mu = m - ln * frac; // pregame line sets the expected margin for the time left
          try {
            wpCache[e.id] = wpCache[e.id] || getJSON(`${ESPN}${PATH[p.league]}/summary?event=${e.id}`);
            const wp = (await wpCache[e.id]).winprobability || [];
            if (wp.length && frac > 0.03) {
              const ph = wp[wp.length - 1].homeWinPercentage, ps = sideHome ? ph : 1 - ph;
              if (ps > 0.02 && ps < 0.98) mu = sd * inv(ps); // final margin implied by ESPN's win probability
            }
          } catch (err) {}
          pc = cdf((mu + ln) / sd);
        } else {
          const sd = Math.max(sdT * Math.sqrt(frac), 3), po = cdf((asc + hsc - ln * (1 - frac)) / sd);
          pc = p.bet_type === 'Over' ? po : 1 - po;
        }
        row.john_cover_pct = Math.round(pc * 100);
      }
      return row;
    }));
    const now = new Date().toISOString();
    rows.forEach((r) => { r.updated_at = now; });
    return rows.sort((a, b) => (a.kickoff || '9').localeCompare(b.kickoff || '9') || a.id.localeCompare(b.id));
  }
  window.adfGrade = grade;

  let timer = null;
  async function loadLive() {
    if (store.live && store.live.status === 'ok') store.live.refreshing = true;
    try {
      const picks = await getJSON('live.json');
      const rows = picks.length ? await grade(picks) : [];
      set('live', { status: 'ok', data: rows, updatedAt: new Date().toISOString() });
      clearTimeout(timer);
      if (rows.some((r) => r.state === 'in' || (r.state === 'pre' && new Date(r.kickoff) - Date.now() < 15 * 60000))) timer = setTimeout(loadLive, 120000);
    } catch (err) {
      set('live', { status: 'error', data: [], message: String(err) });
    }
  }
  window.adfStart = () => {
    render();
    getJSON('bets.json').then((b) => set('bets', { status: 'ok', data: b })).catch((err) => set('bets', { status: 'error', data: [], message: String(err) }));
    loadLive();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && store.live && Date.now() - new Date(store.live.updatedAt || 0) > 120000) loadLive(); });
  };
})();
