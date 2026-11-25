// Shared helpers: safe URL handling and a polite fetch.
const dns = require('dns').promises;
const net = require('net');

const UA = 'Mozilla/5.0 (compatible; YellowBeaconHealthTest/1.0)';

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:');
}

// Only public http(s) sites. Stops the tool being used to poke at private networks.
async function cleanUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new Error('Type a website address first.');
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let u;
  try { u = new URL(raw); } catch (_) { throw new Error('That does not look like a website address.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https addresses work.');
  if (u.username || u.password) throw new Error('Remove the username and password from the address.');
  if (!u.hostname.includes('.') && !net.isIP(u.hostname)) throw new Error('That does not look like a public website.');
  const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('We could not find that website. Check the spelling.');
  if (addrs.some(a => privateIp(a.address))) throw new Error('That address is not a public website.');
  return u;
}

async function get(url, ua, ms = 9000) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'user-agent': ua || UA, accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
    const body = (await r.text()).slice(0, 1500000);
    return { ok: r.ok, status: r.status, url: r.url, headers: Object.fromEntries(r.headers), body, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e), body: '', headers: {}, ms: Date.now() - t0 };
  }
}

module.exports = { cleanUrl, get, UA };
