#!/usr/bin/env node
/**
 * WC2026 Odds Relay — local CORS proxy
 * Runs on http://localhost:3456
 * Usage: node odds_relay.js
 * No npm install needed — uses only Node.js built-ins.
 */

const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 3456;
const SPORT_KEY = 'soccer_fifa_world_cup_winner';
const REGIONS = 'eu,uk';   // Combined in one API request — counts as 1 of your 500 free requests

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'GET') { res.writeHead(405); res.end('Method not allowed'); return; }

  const parsed = url.parse(req.url, true);

  // Health check
  if (parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'wc2026-odds-relay', version: '2', regions: REGIONS }));
    return;
  }

  // Main odds endpoint: GET /odds?apiKey=XXX
  if (parsed.pathname === '/odds') {
    const apiKey = parsed.query.apiKey;
    if (!apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing apiKey parameter' }));
      return;
    }

    const targetUrl = [
      `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds/`,
      `?apiKey=${apiKey}`,
      `&regions=${REGIONS}`,
      `&markets=outrights`,
      `&oddsFormat=decimal`
    ].join('');

    const redacted = targetUrl.replace(apiKey, apiKey.slice(0,4) + '...');
    console.log(`[${new Date().toISOString()}] Fetching: ${redacted}`);

    const oddsReq = https.get(targetUrl, (oddsRes) => {
      let body = '';
      oddsRes.on('data', chunk => body += chunk);
      oddsRes.on('end', () => {
        const remaining = oddsRes.headers['x-requests-remaining'] || '';
        const used      = oddsRes.headers['x-requests-used'] || '';

        res.writeHead(oddsRes.statusCode, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          ...(remaining && { 'x-requests-remaining': remaining }),
          ...(used      && { 'x-requests-used': used }),
          'x-relay-regions': REGIONS,
        });
        res.end(body);

        try {
          const parsed = JSON.parse(body);
          const events   = Array.isArray(parsed) ? parsed.length : '?';
          const books    = Array.isArray(parsed)
            ? parsed.reduce((n, ev) => n + (ev.bookmakers || []).length, 0)
            : '?';
          console.log(
            `[${new Date().toISOString()}] ` +
            `HTTP ${oddsRes.statusCode} · ${events} events · ` +
            `${books} bookmaker entries · ` +
            `${remaining || '?'} requests remaining`
          );
        } catch (_) {
          console.log(`[${new Date().toISOString()}] HTTP ${oddsRes.statusCode} · ${body.length} bytes`);
        }
      });
    });

    oddsReq.on('error', err => {
      console.error(`[${new Date().toISOString()}] Upstream error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Relay upstream error', detail: err.message }));
      }
    });

    oddsReq.setTimeout(14000, () => {
      console.error(`[${new Date().toISOString()}] Upstream timeout`);
      oddsReq.destroy(new Error('Upstream timed out'));
    });

    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('WC2026 Odds Relay\n  GET /health\n  GET /odds?apiKey=YOUR_KEY\n');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n ╔══════════════════════════════════════════╗');
  console.log(` ║  WC2026 Odds Relay  •  port ${PORT}         ║`);
  console.log(` ║  Regions: ${REGIONS.padEnd(32)}║`);
  console.log(' ╚══════════════════════════════════════════╝\n');
  console.log(`  Health:  http://localhost:${PORT}/health`);
  console.log(`  Odds:    http://localhost:${PORT}/odds?apiKey=YOUR_KEY\n`);
  console.log('  Open wc2026_bracket_editor_v5.html and click "Live betting odds"\n');
  console.log('  Press Ctrl+C to stop.\n');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} already in use — relay may already be running.\n`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
