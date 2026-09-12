#!/usr/bin/env node
'use strict';

/*
  Echo Chain — local party game server.

  Runs entirely on your own computer (or a host like Render). No Claude
  needed, no Anthropic service in the loop.

  Usage:
    node server.js
  Then open the printed address in a browser.

  Everything is kept in memory and disappears when you stop the server
  (Ctrl+C) — every run is a fresh party.

  OPTIONAL: paid hosting access
  ------------------------------
  Set these environment variables to require a one-time payment before
  someone can host a lobby (joining a lobby always stays free):
    STRIPE_SECRET_KEY   your Stripe secret key (sk_test_... or sk_live_...)
    ACCESS_SECRET       any long random string you make up yourself —
                         keep it the same across restarts, or previously
                         issued access codes will stop working
    PRICE_CENTS         optional, defaults to 500 (i.e. $5.00)
    CURRENCY            optional, defaults to "usd"
    PRODUCT_NAME        optional, defaults to "Echo Chain — Host Access"
  If STRIPE_SECRET_KEY and ACCESS_SECRET aren't both set, hosting stays
  free and no paywall is shown. See README.txt for full setup steps.
*/

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');
const MAX_BODY_BYTES = 15 * 1024 * 1024; // 15MB safety cap per request (drawings/audio are base64)

// ---------- optional paid-access config ----------
const ACCESS_SECRET = process.env.ACCESS_SECRET || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const PAYMENTS_ENABLED = !!(ACCESS_SECRET && STRIPE_SECRET_KEY);
const PRICE_CENTS = parseInt(process.env.PRICE_CENTS || '500', 10);
const CURRENCY = (process.env.CURRENCY || 'usd').toLowerCase();
const PRODUCT_NAME = process.env.PRODUCT_NAME || 'Echo Chain — Host Access';

let stripeClient = null;
let stripeLoadError = null;
function getStripe(){
  if(stripeClient) return stripeClient;
  if(stripeLoadError) return null;
  try{
    const Stripe = require('stripe');
    stripeClient = Stripe(STRIPE_SECRET_KEY);
    return stripeClient;
  }catch(e){
    stripeLoadError = e;
    return null;
  }
}

// A purchase "access code" is just a signed token: the Stripe checkout
// session id, plus an HMAC so we can trust it without needing our own
// database. Stripe itself is the permanent record of the payment.
function signToken(payload){
  const h = crypto.createHmac('sha256', ACCESS_SECRET).update(payload).digest('hex');
  return Buffer.from(payload + '.' + h, 'utf8').toString('base64url');
}
function verifyToken(token){
  try{
    const decoded = Buffer.from(String(token), 'base64url').toString('utf8');
    const idx = decoded.lastIndexOf('.');
    if(idx === -1) return null;
    const payload = decoded.slice(0, idx);
    const sig = decoded.slice(idx + 1);
    const expected = crypto.createHmac('sha256', ACCESS_SECRET).update(payload).digest('hex');
    const a = Buffer.from(sig, 'utf8'), b = Buffer.from(expected, 'utf8');
    if(a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return payload; // the original Stripe checkout session id
  }catch(e){ return null; }
}

// In-memory key-value store, mirroring the shape of Claude's artifact
// storage API (get / set / list-by-prefix / delete) so the game client
// barely changed when it moved off Claude.
const store = new Map();

function sendJson(res, status, obj){
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readJsonBody(req){
  return new Promise((resolve, reject)=>{
    const chunks = [];
    let size = 0;
    req.on('data', (chunk)=>{
      size += chunk.length;
      if(size > MAX_BODY_BYTES){
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', ()=>{
      try{
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      }catch(e){ reject(e); }
    });
    req.on('error', reject);
  });
}

function getLanAddresses(){
  const nets = os.networkInterfaces();
  const addrs = [];
  for(const name of Object.keys(nets)){
    for(const net of (nets[name] || [])){
      if(net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  return addrs;
}

const server = http.createServer(async (req, res)=>{
  let url;
  try{
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  }catch(e){
    return sendJson(res, 400, { error: 'bad request' });
  }
  const pathname = url.pathname;

  try{
    // ---- tiny key/value API used by the game client ----
    if(pathname === '/api/get' && req.method === 'GET'){
      const key = url.searchParams.get('key') || '';
      if(store.has(key)) return sendJson(res, 200, { value: store.get(key) });
      return sendJson(res, 404, { error: 'not found' });
    }

    if(pathname === '/api/set' && req.method === 'POST'){
      const body = await readJsonBody(req);
      if(!body || typeof body.key !== 'string' || !body.key){
        return sendJson(res, 400, { error: 'missing key' });
      }
      const value = typeof body.value === 'string' ? body.value : JSON.stringify(body.value);
      store.set(body.key, value);
      return sendJson(res, 200, { ok: true });
    }

    if(pathname === '/api/list' && req.method === 'GET'){
      const prefix = url.searchParams.get('prefix') || '';
      const keys = [...store.keys()].filter(k => k.startsWith(prefix));
      return sendJson(res, 200, { keys });
    }

    if(pathname === '/api/delete' && req.method === 'POST'){
      const body = await readJsonBody(req);
      if(body && typeof body.key === 'string') store.delete(body.key);
      return sendJson(res, 200, { ok: true });
    }

    // ---- paid-access endpoints (only meaningful if PAYMENTS_ENABLED) ----
    if(pathname === '/api/config' && req.method === 'GET'){
      return sendJson(res, 200, {
        paymentsEnabled: PAYMENTS_ENABLED,
        priceCents: PRICE_CENTS,
        currency: CURRENCY,
        productName: PRODUCT_NAME,
        serverBuild: 'v2-serves-static-files'
      });
    }

    if(pathname === '/api/checkout' && req.method === 'POST'){
      if(!PAYMENTS_ENABLED) return sendJson(res, 400, { error: 'Payments are not configured on this server.' });
      const stripe = getStripe();
      if(!stripe) return sendJson(res, 500, { error: 'The "stripe" package isn\'t installed. Run "npm install" in this folder, then restart the server.' });
      try{
        const proto = req.headers['x-forwarded-proto'] || 'http';
        const origin = `${proto}://${req.headers.host}`;
        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          payment_method_types: ['card'],
          line_items: [{
            price_data: {
              currency: CURRENCY,
              product_data: { name: PRODUCT_NAME },
              unit_amount: PRICE_CENTS
            },
            quantity: 1
          }],
          success_url: `${origin}/?paid_session={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/`
        });
        return sendJson(res, 200, { url: session.url });
      }catch(e){
        return sendJson(res, 500, { error: e.message || 'Could not start checkout' });
      }
    }

    if(pathname === '/api/verify-purchase' && req.method === 'GET'){
      if(!PAYMENTS_ENABLED) return sendJson(res, 400, { error: 'Payments are not configured on this server.' });
      const stripe = getStripe();
      if(!stripe) return sendJson(res, 500, { error: 'The "stripe" package isn\'t installed. Run "npm install" in this folder, then restart the server.' });
      const sessionId = url.searchParams.get('session_id') || '';
      if(!sessionId) return sendJson(res, 400, { error: 'missing session_id' });
      try{
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if(session && session.payment_status === 'paid'){
          return sendJson(res, 200, { token: signToken(session.id) });
        }
        return sendJson(res, 402, { error: 'That payment has not completed yet.' });
      }catch(e){
        return sendJson(res, 500, { error: e.message || 'Could not verify payment' });
      }
    }

    if(pathname === '/api/check-token' && req.method === 'POST'){
      if(!PAYMENTS_ENABLED) return sendJson(res, 200, { valid: true }); // no paywall configured — everyone's "valid"
      const body = await readJsonBody(req);
      const payload = verifyToken(body && body.token);
      return sendJson(res, 200, { valid: !!payload });
    }

    // ---- everything else: serve static files from public/ (images, sounds),
    // falling back to the single-page game client for the app route itself ----
    if(req.method === 'GET'){
      const MIME_TYPES = {
        '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
        '.gif':'image/gif', '.svg':'image/svg+xml', '.webp':'image/webp',
        '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg',
        '.html':'text/html; charset=utf-8'
      };
      let requestedPath;
      try{
        requestedPath = path.resolve(PUBLIC_DIR, '.' + decodeURIComponent(pathname));
      }catch(e){
        return sendJson(res, 400, { error: 'bad path' });
      }
      // guard against path traversal (e.g. /../../server.js)
      if(!requestedPath.startsWith(PUBLIC_DIR)){
        return sendJson(res, 400, { error: 'bad path' });
      }
      fs.stat(requestedPath, (statErr, stat)=>{
        if(!statErr && stat.isFile()){
          const ext = path.extname(requestedPath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          fs.readFile(requestedPath, (readErr, data)=>{
            if(readErr){ res.writeHead(500, {'Content-Type':'text/plain'}); res.end('Error reading file'); return; }
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
          });
          return;
        }
        // not a real static file — fall back to the SPA page itself
        fs.readFile(INDEX_FILE, (err, data)=>{
          if(err){
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Could not load public/index.html — make sure this file sits next to server.js.');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        });
      });
      return;
    }

    return sendJson(res, 404, { error: 'not found' });
  }catch(e){
    return sendJson(res, 500, { error: e.message || 'server error' });
  }
});

server.on('error', (err)=>{
  if(err.code === 'EADDRINUSE'){
    console.error(`\n  Port ${PORT} is already in use. Try: PORT=8081 node server.js\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, ()=>{
  const lan = getLanAddresses();
  console.log('');
  console.log('  🎮  Echo Chain is running! (server build: v2-serves-static-files)');
  console.log('  ─────────────────────────');
  console.log(`  On this computer:   http://localhost:${PORT}`);
  if(lan.length){
    lan.forEach(ip => console.log(`  Same WiFi network:  http://${ip}:${PORT}`));
    console.log('');
    console.log('  Share the "same WiFi network" address with friends on your WiFi.');
  } else {
    console.log('  Could not detect a WiFi/LAN address — make sure you\'re connected to a network');
    console.log('  if you want other people\'s devices to reach this game.');
  }
  console.log('');
  console.log('  Note: browsers only allow microphone access on "localhost" or over');
  console.log('  HTTPS. The host (on localhost) can record voice normally; other');
  console.log('  players joining over the WiFi address will be offered the');
  console.log('  type-your-impression fallback instead unless you set up HTTPS.');
  console.log('');
  if(PAYMENTS_ENABLED){
    console.log(`  💳  Payments: ON — hosting a lobby costs $${(PRICE_CENTS/100).toFixed(2)} ${CURRENCY.toUpperCase()}.`);
    if(!getStripe()) console.log('      ⚠️  But the "stripe" package isn\'t installed — run "npm install" first!');
  } else if(ACCESS_SECRET || STRIPE_SECRET_KEY){
    console.log('  💳  Payments: partially configured — set BOTH STRIPE_SECRET_KEY and');
    console.log('      ACCESS_SECRET to turn on the paywall. Hosting is free for now.');
  } else {
    console.log('  💳  Payments: OFF — hosting is free. See README.txt to turn on paid access.');
  }
  console.log('');
  console.log('  Press Ctrl+C to stop hosting. Everything resets on the next run.');
  console.log('');
});
