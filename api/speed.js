// Real mobile speed test, run by Google PageSpeed Insights (Lighthouse).
const { cleanUrl } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const u = await cleanUrl(req.query.url);
    const key = process.env.PSI_API_KEY ? '&key=' + encodeURIComponent(process.env.PSI_API_KEY) : '';
    const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(u.href)}&strategy=mobile&category=performance${key}`;
    const r = await fetch(api, { signal: AbortSignal.timeout(55000) });
    const j = await r.json();
    if (!r.ok || !j.lighthouseResult) {
      const quota = r.status === 429 || /quota/i.test(JSON.stringify(j.error || ''));
      return res.status(200).json({ error: quota ? 'The free Google speed test is busy right now. Try again in a minute.' : 'The speed test could not finish for this page.' });
    }
    const L = j.lighthouseResult, a = L.audits, num = id => (a[id] && a[id].numericValue != null ? a[id].numericValue : null);
    res.status(200).json({
      score: Math.round((L.categories.performance.score || 0) * 100),
      fcp: num('first-contentful-paint'), lcp: num('largest-contentful-paint'), tbt: num('total-blocking-time'),
      cls: num('cumulative-layout-shift'), si: num('speed-index'), bytes: num('total-byte-weight'),
    });
  } catch (e) {
    res.status(200).json({ error: e.message || 'The speed test could not finish.' });
  }
};
