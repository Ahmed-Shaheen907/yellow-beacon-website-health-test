# Yellow Beacon Website Health Test

A free website health test. Paste a website address and get a plain score for:

- **Mobile speed** (Google PageSpeed Insights / Lighthouse, plus basic speed checks read from the page)
- **SEO** (title, description, headings, indexing, sitemap, share tags, alt text)
- **AI search** (AI crawler access, readable text, structured data, FAQ content, llms.txt)

Each check says what was found and how to fix it. The top fixes are listed first.

## How it works

- `index.html`: the page (white background, mustard highlights). No build step.
- `api/audit.js`: fetches the page like a crawler and runs the SEO, speed basics and AI search checks.
- `api/speed.js`: asks Google PageSpeed Insights for a real mobile Lighthouse run.
- `api/_lib.js`: address cleaning. Only public websites are allowed; private and local addresses are refused.

## Deploy

Deploys on Vercel with no settings. Set one environment variable for the mobile speed score:

- `PSI_API_KEY`: a free Google API key with the PageSpeed Insights API enabled. Without it, Google's shared free quota is often used up and the tool shows the basic speed checks only.

## Run the checks from the command line

```
node -e "require('./api/audit.js')({query:{url:'example.com'}},{setHeader(){},status(){return this},json(o){console.log(JSON.stringify(o,null,2))}})"
```
