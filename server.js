require('dotenv').config();
console.log("ENV check: RIOT_API_KEY =", process.env.RIOT_API_KEY ? "Loaded" : "NOT FOUND");
console.log("RIOT key prefix (Render):", (process.env.RIOT_API_KEY || "").slice(0, 8));
const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();

const PORT = process.env.PORT || 3000;
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 15);
const RIOT_API_KEY = process.env.RIOT_API_KEY;

if (!RIOT_API_KEY) {
  console.warn('RIOT_API_KEY missing. Set it locally in .env and on Render Environment.');
}

const PLATFORM_TO_REGIONAL = {
  NA1: 'AMERICAS', BR1: 'AMERICAS', LA1: 'AMERICAS', LA2: 'AMERICAS', OC1: 'AMERICAS',
  EUW1: 'EUROPE', EUN1: 'EUROPE', TR1: 'EUROPE', RU: 'EUROPE',
  KR: 'ASIA', JP1: 'ASIA'
};

const api = axios.create({ timeout: 10000 });
api.interceptors.request.use(cfg => {
  cfg.headers = cfg.headers || {};
  cfg.headers['X-Riot-Token'] = RIOT_API_KEY;
  return cfg;
});

const platformBase = r => `https://${r.toLowerCase()}.api.riotgames.com`;
const regionalBase = r => `https://${PLATFORM_TO_REGIONAL[r]}.api.riotgames.com`;

// Load players from players.json
let players = [];
try {
  players = JSON.parse(fs.readFileSync('players.json', 'utf-8'));
} catch (e) {
  players = [{ region: 'NA1', gameName: 'SummonerName', tagLine: 'NA1' }];
}

// In-memory store of latest data
const state = new Map(); // key: `${region}:${gameName}#${tagLine}` -> data record

async function resolveIdentity(region, gameName, tagLine) {
  const acc = await api.get(
    `${regionalBase(region)}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );
  const puuid = acc.data.puuid;
  const summ = await api.get(`${platformBase(region)}/lol/summoner/v4/summoners/by-puuid/${puuid}`);
  return { puuid, summonerId: summ.data.id };
}

async function fetchRank(region, summonerId) {
  const res = await api.get(`${platformBase(region)}/lol/league/v4/entries/by-summoner/${summonerId}`);
  const solo = (res.data || []).find(e => e.queueType === 'RANKED_SOLO_5x5');
  if (!solo) return null;
  return {
    tier: solo.tier,
    division: solo.rank,
    lp: solo.leaguePoints,
    wins: solo.wins,
    losses: solo.losses
  };
}

async function fetchLive(region, summonerId) {
  try {
    await api.get(`${platformBase(region)}/lol/spectator/v5/active-games/by-summoner/${summonerId}`);
    return true;
  } catch (e) {
    if (e.response && e.response.status === 404) return false; // not in game
    throw e;
  }
}

async function pollOnce() {
  for (const p of players) {
    const key = `${p.region}:${p.gameName}#${p.tagLine}`;
    let rec = state.get(key) || {
      region: p.region, game_name: p.gameName, tag_line: p.tagLine,
      puuid: null, summoner_id: null, tier: null, division: null,
      lp: null, wins: null, losses: null, live: false, updated_at: null, error: null
    };
    try {
      if (!rec.puuid || !rec.summoner_id) {
        const ids = await resolveIdentity(p.region, p.game_name || p.gameName, p.tag_line || p.tagLine);
        rec.puuid = ids.puuid;
        rec.summoner_id = ids.summonerId;
      }
      const rank = await fetchRank(rec.region, rec.summoner_id);
      if (rank) {
        rec.tier = rank.tier;
        rec.division = rank.division;
        rec.lp = rank.lp;
        rec.wins = rank.wins;
        rec.losses = rank.losses;
      }
      rec.live = await fetchLive(rec.region, rec.summoner_id);
      rec.updated_at = new Date().toISOString();
      rec.error = null;
      state.set(key, rec);
      await new Promise(r => setTimeout(r, 150)); // gentle pacing
    } catch (err) {
      const msg = err?.response ? `${err.response.status} ${err.response.statusText}` : (err.code || err.message);
      rec.error = msg;
      state.set(key, rec);
    }
  }
}

setInterval(() => { pollOnce().catch(()=>{}); }, POLL_SECONDS * 1000);
pollOnce().catch(()=>{});

// Root healthcheck
app.get('/', (_req, res) => {
  res.send('League website server is running successfully! Try /board or /api/players');
});

// JSON API (this is the one you were hitting)
app.get('/api/players', (_req, res) => {
  const rows = [...state.values()].map(r => ({
    region: r.region,
    game_name: r.game_name,
    tag_line: r.tag_line,
    riotId: `${r.game_name}#${r.tag_line}`,
    tier: r.tier, division: r.division, lp: r.lp,
    wins: r.wins, losses: r.losses, live: !!r.live,
    updated_at: r.updated_at, error: r.error
  }));
  res.json(rows);
});

// Simple live board that reads /api/players
app.get('/board', (_req, res) => {
  res.type('html').send(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>League of Legends — Live LP</title>
<style>
  body{font-family:system-ui,-apple-system,Inter,Arial;margin:24px}
  .board-header{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left}
  th{font-weight:600}
  .pill{padding:2px 8px;border-radius:999px;font-size:12px;display:inline-block;border:1px solid #ddd}
  .pill.on{border-color:#2ecc71}
  .tier{opacity:.8;font-size:12px}
</style>
<div class="board-header">
  <h2>LoL Friends — Live LP</h2>
  <button id="refreshBtn">Refresh</button>
  <span id="lastUpdated">—</span>
</div>
<table id="playersTable">
  <thead><tr><th>Player</th><th>Region</th><th>Tier</th><th>Div</th><th>LP</th><th>W-L</th><th>Winrate</th><th>Live</th><th>Error</th></tr></thead>
  <tbody></tbody>
</table>
<p style="font-size:12px;opacity:.7">Auto-refreshes every 15s.</p>
<script>
  const tbody = document.querySelector('#playersTable tbody');
  const lastUpdated = document.querySelector('#lastUpdated');
  const REFRESH_MS = 15000;
  function pct(w,l){const g=(w||0)+(l||0);return g?Math.round((w/g)*100)+'%':'—';}
  function fmt(r){return (r.riotId)||((r.game_name&&r.tag_line)?(r.game_name+'#'+r.tag_line):'—');}
  async function load(){
    try{
      const res = await fetch('/api/players',{cache:'no-store'});
      const rows = await res.json();
      rows.sort((a,b)=>(b.lp??0)-(a.lp??0));
      tbody.innerHTML = rows.map(r=>{
        const wr=pct(r.wins,r.losses);
        const liveCls = r.live ? 'pill on' : 'pill';
        const tier = r.tier ? r.tier[0]+r.tier.slice(1).toLowerCase() : '—';
        const div = r.division || '—';
        const lp = (typeof r.lp==='number') ? r.lp : '—';
        const wl = (r.wins!=null&&r.losses!=null) ? \`\${r.wins}-\${r.losses}\` : '—';
        return \`<tr>
          <td><strong>\${fmt(r)}</strong></td>
          <td>\${r.region||'—'}</td>
          <td><span class="tier">\${tier}</span></td>
          <td>\${div}</td>
          <td>\${lp}</td>
          <td>\${wl}</td>
          <td>\${wr}</td>
          <td><span class="\${liveCls}">\${r.live?'LIVE':'—'}</span></td>
          <td>\${r.error||''}</td>
        </tr>\`;
      }).join('');
      lastUpdated.textContent = 'Updated: ' + new Date().toLocaleTimeString();
    }catch(e){
      lastUpdated.textContent = 'Failed to load';
      console.error(e);
    }
  }
  document.getElementById('refreshBtn').addEventListener('click', load);
  load(); setInterval(load, REFRESH_MS);
</script>`);
});

app.listen(PORT, () => console.log(`Server up on http://localhost:${PORT}`));
