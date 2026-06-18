const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAILING_LIST_FILE = process.env.RUNECHAIN_WAITLIST_CSV || path.join(os.tmpdir(), 'runechain-waitlist.csv');
const WAITLIST_EXPORT_TOKEN = process.env.WAITLIST_EXPORT_TOKEN || '';
const PREVIEW_PLAY_URL = process.env.RUNECHAIN_PREVIEW_URL || 'https://play.runechaingame.com';

module.exports = function runechainVercelAdapter(req, res) {
  const requestUrl = new URL(originalPathFromRewrite(req.url || '/'), `https://${req.headers.host || 'runechaingame.com'}`);
  const route = requestUrl.pathname;

  if (route === '/healthz') return sendText(res, 200, 'ok', 'text/plain');

  if (route === '/api/waitlist') {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return handleWaitlistSignup(req, res);
  }

  if (route === '/api/waitlist.csv') {
    if (req.method !== 'GET') return sendText(res, 405, 'method not allowed', 'text/plain');
    return handleWaitlistExport(requestUrl, res);
  }

  if (route === '/preview-play') return redirect(res, PREVIEW_PLAY_URL);
  if (route === '/') return sendFile(res, 'landing.html', 'text/html');
  if (route === '/play' || route === '/index.html') return sendFile(res, 'coming-soon.html', 'text/html');
  if (route === '/assets/brand/runechain-lander.png') return sendFile(res, 'assets/brand/runechain-lander.png', 'image/png');

  return sendText(res, 404, 'not found', 'text/plain');
};

function handleWaitlistSignup(req, res) {
  readRequestBody(req, 65536, (err, raw) => {
    if (err) return sendJson(res, 413, { ok: false, error: 'request_too_large' });

    const parsed = parseSignupBody(req, raw);
    if (!parsed.ok) return respondSignup(req, res, 400, { ok: false, error: parsed.error });

    const signup = normalizeSignup(parsed.body, req);
    if (!signup.ok) return respondSignup(req, res, 400, { ok: false, error: signup.error });

    try {
      appendWaitlistCsv(signup.row);
    } catch (writeErr) {
      console.error('waitlist write failed:', writeErr.message);
      return respondSignup(req, res, 500, { ok: false, error: 'waitlist_unavailable' });
    }

    return respondSignup(req, res, 201, { ok: true });
  });
}

function handleWaitlistExport(requestUrl, res) {
  if (!WAITLIST_EXPORT_TOKEN || requestUrl.searchParams.get('token') !== WAITLIST_EXPORT_TOKEN) {
    return sendText(res, 403, 'forbidden', 'text/plain');
  }

  let csv = waitlistCsvHeader();
  try {
    if (fs.existsSync(MAILING_LIST_FILE)) csv = fs.readFileSync(MAILING_LIST_FILE, 'utf8');
  } catch (err) {
    console.error('waitlist export failed:', err.message);
    return sendText(res, 500, 'waitlist unavailable', 'text/plain');
  }

  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="runechain-waitlist.csv"',
    'Cache-Control': 'no-store',
  });
  res.end(csv);
}

function respondSignup(req, res, status, payload) {
  if (isFormPost(req)) {
    res.writeHead(303, { Location: status >= 200 && status < 300 ? '/?joined=1#join' : '/?joined=0#join' });
    return res.end();
  }
  return sendJson(res, status, payload);
}

function appendWaitlistCsv(row) {
  fs.mkdirSync(path.dirname(MAILING_LIST_FILE), { recursive: true });
  if (!fs.existsSync(MAILING_LIST_FILE)) fs.writeFileSync(MAILING_LIST_FILE, waitlistCsvHeader());
  fs.appendFileSync(MAILING_LIST_FILE, row.map(csvCell).join(',') + '\n');
}

function waitlistCsvHeader() {
  return 'created_at,email,source,name,note,ip_hash\n';
}

function normalizeSignup(body, req) {
  const email = sanitizeText(body.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'invalid_email' };
  }
  return {
    ok: true,
    row: [
      new Date().toISOString(),
      email,
      sanitizeText(body.source || 'runechain-lander', 80),
      sanitizeText(body.name, 80),
      sanitizeText(body.note, 180),
      hashIp(req),
    ],
  };
}

function parseSignupBody(req, raw) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type === 'application/json') {
    try {
      return { ok: true, body: JSON.parse(raw || '{}') };
    } catch (_) {
      return { ok: false, error: 'invalid_json' };
    }
  }
  if (type === 'application/x-www-form-urlencoded' || !type) {
    return { ok: true, body: Object.fromEntries(new URLSearchParams(raw)) };
  }
  return { ok: false, error: 'unsupported_content_type' };
}

function readRequestBody(req, maxBytes, callback) {
  let raw = '';
  let received = 0;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    received += Buffer.byteLength(chunk);
    if (received > maxBytes) {
      req.destroy();
      callback(new Error('request_too_large'));
      return;
    }
    raw += chunk;
  });
  req.on('end', () => callback(null, raw));
  req.on('error', callback);
}

function sendFile(res, relativePath, contentType) {
  const fullPath = path.join(ROOT, relativePath);
  fs.readFile(fullPath, (err, data) => {
    if (err) return sendText(res, 404, 'not found', 'text/plain');
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=0, must-revalidate',
    });
    res.end(data);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, body, contentType) {
  res.writeHead(status, {
    'Content-Type': `${contentType}; charset=utf-8`,
    'Cache-Control': status === 200 ? 'public, max-age=0, must-revalidate' : 'no-store',
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
  });
  res.end();
}

function originalPathFromRewrite(url) {
  const parsed = new URL(url || '/', 'https://runechain.local');
  if (!parsed.searchParams.has('path')) return url || '/';

  const rawPath = parsed.searchParams.get('path') || '';
  parsed.searchParams.delete('path');
  const restoredPath = '/' + rawPath.replace(/^\/+/, '');
  const search = parsed.searchParams.toString();
  return restoredPath + (search ? '?' + search : '');
}

function sanitizeText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function csvCell(value) {
  const text = String(value == null ? '' : value);
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function hashIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = forwarded || req.socket.remoteAddress || '';
  if (!raw) return '';
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function isFormPost(req) {
  return String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded');
}
