require('dotenv').config()
const express = require('express')
const app = express()
const PORT = process.env.PORT || 3000

// Root route – quick sanity check
app.get('/', (_req, res) => {
  res.send('Hello. This website is actively in construction, due to finish by the start of December. Thanks!')
})

// /board route – fake leaderboard page
app.get('/board', (_req, res) => {
  res.send(`<!doctype html>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>leagueTracker001 — Board</title>
  <style>
    body{font-family:system-ui;margin:0;padding:24px}
    table{width:100%;border-collapse:collapse}
    th,td{padding:8px;border-bottom:1px solid #eee;text-align:left}
  </style>
  <h1>League of Legends Live Tracker — Leaderboard (Current Progress)</h1>
  <table><thead><tr><th>Riot ID</th><th>Platform</th><th>Rank</th><th>LP</th><th>W-L</th><th>Status</th></tr></thead>
  <tbody>
    <tr><td>Cosmic chi#NA1</td><td>na1</td><td>EMERALD IV</td><td>34</td><td>117W-94L</td><td>⚫︎ Offline</td></tr>
    <tr><td>ElielaNoix#NA1</td><td>na1</td><td>GOLD IV</td><td>72</td><td>70W-65L</td><td>🟢 Live</td></tr>
  </tbody></table>`)
})

app.listen(PORT, () => console.log(`Server up on http://localhost:${PORT}`))
