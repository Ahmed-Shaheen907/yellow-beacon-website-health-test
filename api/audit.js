// SEO and AI search checks. Reads the page the way a search crawler or an AI bot does.
const { cleanUrl, get } = require('./_lib');

const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'anthropic-ai', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot'];
const GPT_UA = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)';

function parseRobots(txt) {
  const groups = []; let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
    if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
    else if (cur && (k === 'disallow' || k === 'allow')) cur.rules.push([k, v]);
  }
  return groups;
}
function blocked(groups, bot) {
  const g = groups.find(x => x.agents.includes(bot.toLowerCase())) || groups.find(x => x.agents.includes('*'));
  if (!g) return false;
  return g.rules.some(([k, v]) => k === 'disallow' && v === '/') && !g.rules.some(([k, v]) => k === 'allow' && v === '/');
}

const strip = s => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->/gi, ' ');
const text = s => strip(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : ''; };
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
const meta = (html, key, val) => { const t = tags(html, 'meta').find(x => attr(x, key).toLowerCase() === val.toLowerCase()); return t ? attr(t, 'content') : ''; };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const u = await cleanUrl(req.query.url);
    const home = await get(u.href);
    if (!home.status) return res.status(200).json({ error: 'We could not open that website. It may be down or blocking visitors.' });
    const origin = new URL(home.url).origin;
    const [robots, sitemap, llms, gpt] = await Promise.all([
      get(origin + '/robots.txt'), get(origin + '/sitemap.xml'), get(origin + '/llms.txt'), get(home.url, GPT_UA),
    ]);
    const html = home.body;
    const checks = [];
    const add = (cat, name, status, weight, found, fix) => checks.push({ cat, name, status, weight, found, fix: status === 'pass' ? '' : fix });

    // ----- read the page
    const title = ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
    const desc = meta(html, 'name', 'description');
    const robotsMeta = meta(html, 'name', 'robots');
    const viewport = meta(html, 'name', 'viewport');
    const canonical = (tags(html, 'link').find(t => /canonical/i.test(attr(t, 'rel'))) || '') && attr(tags(html, 'link').find(t => /canonical/i.test(attr(t, 'rel'))), 'href');
    const lang = attr((html.match(/<html\b[^>]*>/i) || [''])[0], 'lang');
    const ogTitle = meta(html, 'property', 'og:title'), ogImage = meta(html, 'property', 'og:image'), tw = meta(html, 'name', 'twitter:card');
    const favicon = tags(html, 'link').some(t => /icon/i.test(attr(t, 'rel')));
    const heads = [...strip(html).matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => ({ l: +m[1], t: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }));
    const h1 = heads.filter(h => h.l === 1);
    const imgs = tags(strip(html), 'img');
    const noAlt = imgs.filter(i => !attr(i, 'alt').trim()).length;
    const body = text(html);
    const words = body ? body.split(' ').length : 0;
    const links = tags(strip(html), 'a').map(a => attr(a, 'href')).filter(Boolean);
    const internal = links.filter(h => (h.startsWith('/') && !h.startsWith('//')) || h.includes(new URL(home.url).hostname)).length;
    const lists = (strip(html).match(/<(ul|ol)\b/gi) || []).length, tables = (strip(html).match(/<table\b/gi) || []).length;
    const ldBlocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => { try { return JSON.parse(m[1]); } catch (_) { return null; } }).filter(Boolean);
    const ldTypes = []; const walk = o => { if (!o) return; if (Array.isArray(o)) return o.forEach(walk); if (typeof o === 'object') { if (o['@type']) [].concat(o['@type']).forEach(t => ldTypes.push(t)); Object.values(o).forEach(walk); } }; ldBlocks.forEach(walk);
    const ldText = JSON.stringify(ldBlocks);
    const hasSameAs = ldText.includes('sameAs');
    const hasDate = /dateModified|datePublished/.test(ldText) || !!meta(html, 'property', 'article:modified_time') || !!meta(html, 'property', 'article:published_time');
    const firstP = ([...strip(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).find(p => p.split(' ').length > 12)) || '';
    const rg = robots.ok ? parseRobots(robots.body) : [];

    // ----- SEO
    const S = 'SEO';
    const tl = title.length, dl = desc.length;
    add(S, 'Page title', tl >= 25 && tl <= 65 ? 'pass' : tl ? 'warn' : 'fail', 10, tl ? `"${title.slice(0, 70)}" (${tl} characters)` : 'missing', 'Write a clear title of 30 to 60 characters. Put the main topic first.');
    add(S, 'Meta description', dl >= 70 && dl <= 165 ? 'pass' : dl ? 'warn' : 'fail', 8, dl ? dl + ' characters' : 'missing', 'Write a 120 to 160 character summary that makes people want to click.');
    add(S, 'One H1 heading', h1.length === 1 ? 'pass' : 'fail', 8, h1.length ? `${h1.length} found: "${h1[0].t.slice(0, 60)}"` : 'none', 'Use exactly one H1 that says what the page is about.');
    let skip = false, prev = 0; for (const h of heads) { if (prev && h.l > prev + 1) skip = true; prev = h.l; }
    add(S, 'Heading order', !skip && heads.length >= 3 ? 'pass' : 'warn', 4, `${heads.length} headings${skip ? ', levels skipped' : ''}`, 'Use H2 for sections and H3 inside them. Do not skip levels.');
    const noindex = /noindex/i.test(robotsMeta) || /noindex/i.test(home.headers['x-robots-tag'] || '');
    add(S, 'Can be listed on Google', noindex ? 'fail' : 'pass', 12, noindex ? 'noindex is set' : 'no restriction', 'Remove the noindex tag. Google will not list the page while it is there.');
    add(S, 'Canonical link', canonical ? 'pass' : 'warn', 4, canonical || 'missing', 'Add a canonical link so copies of the page do not compete with each other.');
    add(S, 'robots.txt', robots.ok && /user-agent/i.test(robots.body) ? 'pass' : 'warn', 4, robots.ok ? 'found' : 'missing', 'Add a robots.txt file that points to your sitemap.');
    add(S, 'Search engines allowed in', blocked(rg, 'Googlebot') ? 'fail' : 'pass', 10, blocked(rg, 'Googlebot') ? 'robots.txt blocks Google' : 'allowed', 'Your robots.txt blocks the whole site. Remove the line "Disallow: /".');
    const sitemapOk = (sitemap.ok && /<urlset|<sitemapindex/i.test(sitemap.body)) || /sitemap:/i.test(robots.body || '');
    add(S, 'XML sitemap', sitemapOk ? 'pass' : 'warn', 6, sitemapOk ? 'found' : 'not found at /sitemap.xml', 'Publish a sitemap at /sitemap.xml and submit it in Google Search Console.');
    add(S, 'Page language set', lang ? 'pass' : 'warn', 2, lang || 'missing', 'Add lang="en" (or your language) to the html tag.');
    add(S, 'Share preview tags', ogTitle && ogImage ? 'pass' : ogTitle || ogImage ? 'warn' : 'fail', 4, [ogTitle && 'og:title', ogImage && 'og:image', tw && 'twitter:card'].filter(Boolean).join(', ') || 'none', 'Add og:title, og:description and og:image so links look good when shared.');
    add(S, 'Image descriptions (alt text)', !imgs.length || noAlt === 0 ? 'pass' : noAlt / imgs.length < 0.2 ? 'warn' : 'fail', 5, `${noAlt} of ${imgs.length} images have no alt text`, 'Describe each meaningful image in its alt attribute.');
    add(S, 'Enough real text', words >= 400 ? 'pass' : words >= 150 ? 'warn' : 'fail', 8, words + ' words in the page source', 'Add clear text about what you do, who it is for and proof it works.');
    add(S, 'Links to other pages', internal >= 5 ? 'pass' : 'warn', 3, internal + ' links', 'Link to your other key pages so people and crawlers can move around.');
    add(S, 'Mobile viewport and icon', /width=device-width/.test(viewport) && favicon ? 'pass' : 'warn', 3, `${/width=device-width/.test(viewport) ? 'viewport set' : 'viewport missing'}, ${favicon ? 'icon set' : 'icon missing'}`, 'Add a viewport meta tag and a favicon.');
    add(S, 'Secure (HTTPS)', home.url.startsWith('https://') ? 'pass' : 'fail', 5, home.url.startsWith('https://') ? 'HTTPS' : 'not HTTPS', 'Serve the whole site over HTTPS.');

    // ----- Speed basics we can read without a browser
    const P = 'Speed basics';
    const enc = home.headers['content-encoding'] || '';
    const kb = Math.round(Buffer.byteLength(html) / 1024);
    const blocking = tags((html.match(/<head[\s\S]*?<\/head>/i) || [''])[0], 'script').filter(t => attr(t, 'src') && !/\b(async|defer)\b/i.test(t) && !/module/i.test(attr(t, 'type'))).length;
    const legacy = imgs.filter(i => /\.(jpe?g|png|gif)(\?|$)/i.test(attr(i, 'src'))).length;
    const noDims = imgs.filter(i => !(attr(i, 'width') && attr(i, 'height'))).length;
    add(P, 'Server answers quickly', home.ms <= 800 ? 'pass' : home.ms <= 1800 ? 'warn' : 'fail', 20, home.ms + ' ms to get the page', 'The server is slow. Add caching or a CDN, or move to faster hosting.');
    add(P, 'Page text is compressed', enc ? 'pass' : kb < 20 ? 'pass' : 'fail', 15, enc ? 'compressed (' + enc + ')' : kb + ' KB sent uncompressed', 'Turn on gzip or Brotli on your server.');
    add(P, 'Page source size', kb <= 150 ? 'pass' : kb <= 400 ? 'warn' : 'fail', 15, kb + ' KB of HTML', 'The page code is heavy. Remove unused code and inline junk.');
    add(P, 'Scripts do not block the page', blocking === 0 ? 'pass' : blocking <= 2 ? 'warn' : 'fail', 20, blocking + ' blocking scripts in the head', 'Add defer or async to scripts in the head so the page can draw first.');
    add(P, 'Images in modern format', !imgs.length || legacy / imgs.length < 0.3 ? 'pass' : legacy / imgs.length < 0.7 ? 'warn' : 'fail', 15, `${legacy} of ${imgs.length} images are JPG, PNG or GIF`, 'Convert images to WebP or AVIF. It usually cuts image weight by half.');
    add(P, 'Images have width and height', noDims === 0 ? 'pass' : noDims <= 3 ? 'warn' : 'fail', 15, noDims + ' images without a size', 'Add width and height to images so the page does not jump while loading.');

    // ----- AI search
    const A = 'AI search';
    const blk = AI_BOTS.filter(b => blocked(rg, b));
    const critical = blk.filter(b => ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot'].includes(b));
    add(A, 'AI crawlers allowed', critical.length ? 'fail' : blk.length ? 'warn' : 'pass', 14, blk.length ? 'blocked: ' + blk.join(', ') : robots.ok ? 'none blocked' : 'no robots.txt, so all allowed', 'Blocked bots cannot read or quote you. Allow the ones behind AI answers: OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot.');
    const gptOk = gpt.status === home.status && gpt.body.length > html.length * 0.5;
    add(A, 'Firewall lets AI bots in', gptOk ? 'pass' : 'fail', 12, `answered an AI bot request with ${gpt.status}${gptOk ? '' : ' (different from normal visitors)'}`, 'Your firewall or CDN is turning AI bots away. Allow verified AI crawlers.');
    add(A, 'Text readable without JavaScript', words >= 200 ? 'pass' : words >= 80 ? 'warn' : 'fail', 14, words + ' words in the raw page', 'Most AI crawlers do not run JavaScript. Put the text in the page source (static or server rendered).');
    const tset = [...new Set(ldTypes)];
    add(A, 'Structured data (JSON-LD)', tset.length ? 'pass' : 'fail', 12, tset.length ? tset.join(', ') : 'none', 'Add JSON-LD: Organization or LocalBusiness, plus Service, FAQPage and Article where they fit.');
    add(A, 'Who you are is machine readable', tset.some(t => /Organization|LocalBusiness|Person/.test(t)) && hasSameAs ? 'pass' : 'warn', 6, hasSameAs ? 'sameAs links present' : 'no sameAs links', 'List your LinkedIn, Instagram and YouTube in the Organization sameAs field so AI can confirm who you are.');
    const qs = heads.filter(h => /\?$/.test(h.t)).length;
    add(A, 'Question and answer content', tset.includes('FAQPage') || qs ? 'pass' : /faq|frequently asked/i.test(body) ? 'warn' : 'fail', 10, tset.includes('FAQPage') ? 'FAQPage markup' : qs + ' question headings', 'Add a section that answers real customer questions. Make each question a heading and answer in 2 to 3 sentences.');
    const fpw = firstP ? firstP.split(' ').length : 0;
    add(A, 'Clear opening statement', fpw >= 12 && fpw <= 60 ? 'pass' : 'warn', 6, fpw ? fpw + ' words in the first paragraph' : 'no clear intro paragraph', 'Open with one or two plain sentences: who you are, what you do, who it is for. AI quotes these.');
    add(A, 'Lists and tables', lists + tables >= 3 ? 'pass' : 'warn', 4, `${lists} lists, ${tables} tables`, 'Use lists and tables for steps, prices and comparisons. AI can lift them easily.');
    add(A, 'Freshness date', hasDate ? 'pass' : 'warn', 4, hasDate ? 'date found' : 'none', 'Add datePublished and dateModified and keep key pages updated.');
    const llmsOk = llms.ok && llms.body.length > 30 && !/<html/i.test(llms.body);
    add(A, 'llms.txt file', llmsOk ? 'pass' : 'warn', 3, llmsOk ? 'found' : 'missing', 'Optional and cheap: add /llms.txt with a short description and links to your key pages.');
    add(A, 'Sitemap helps AI find pages', sitemap.ok && /<loc>/.test(sitemap.body) ? 'pass' : 'warn', 4, sitemap.ok ? (sitemap.body.match(/<loc>/g) || []).length + ' URLs' : 'no sitemap', 'A sitemap helps AI search tools find all your pages.');

    // ----- scores
    const pts = { pass: 1, warn: 0.5, fail: 0 };
    const categories = [...new Set(checks.map(c => c.cat))].map(name => {
      const list = checks.filter(c => c.cat === name), w = list.reduce((s, c) => s + c.weight, 0);
      const score = Math.round(list.reduce((s, c) => s + c.weight * pts[c.status], 0) / w * 100);
      return { name, score, verdict: score >= 80 ? 'Good' : score >= 55 ? 'Needs work' : 'Bad', checks: list };
    });
    res.status(200).json({ url: home.url, categories });
  } catch (e) {
    res.status(200).json({ error: e.message || 'Something went wrong. Try again.' });
  }
};
