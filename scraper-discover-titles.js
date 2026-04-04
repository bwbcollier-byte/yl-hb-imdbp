const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const COOKIE = process.env.IMDBPRO_COOKIE;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getRandomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

let _browser = null;
async function getBrowser() {
    if (!_browser) _browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    return _browser;
}
async function closeBrowser() {
    if (_browser) { await _browser.close(); _browser = null; }
}

/**
 * Fetches titles from IMDbPro Discover Title pages.
 * 
 * @param {string} baseUrl - Base URL including query params (e.g. ?sortOrder=BOX_OFFICE_GROSS_DESC&type=movie)
 * @param {number} pageNum - Page number to fetch (1-based)
 * @returns {Array} Array of title objects
 */
async function fetchDiscoverTitlesPage(baseUrl, pageNum = 1) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    let pageData = null;

    try {
        if (COOKIE) {
            await page.setCookie(...COOKIE.split(';').map(c => {
                const [n, ...r] = c.trim().split('=');
                return { name: n.trim(), value: r.join('=').trim(), domain: '.imdb.com', path: '/' };
            }).filter(c => c.name && c.value));
        }

        const url = `${baseUrl}&pageNumber=${pageNum}`;

        for (let attempt = 0; attempt < 10; attempt++) {
            try {
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
                await sleep(4000);

                pageData = await page.evaluate(() => {
                    let results = [];
                    let links = document.querySelectorAll('a[href*="/title/tt"]');
                    let seen = new Set();
                    
                    for (let link of links) {
                        let href = link.getAttribute('href');
                        let match = href.match(/\/title\/(tt\d+)/);
                        if (!match) continue;
                        let ttId = match[1];
                        if (seen.has(ttId)) continue;
                        seen.add(ttId);
                        
                        let truncFull = link.querySelector('.a-truncate-full');
                        let title = truncFull ? truncFull.textContent.trim() : link.textContent.trim().replace(/\s+/g, ' ');
                        if (title.length < 2) continue;
            
                        let card = link.closest('[class*="Card"], [class*="card"], [class*="result"]');
                        let snippet = card ? card.innerText.substring(0, 200).replace(/\n/g, ' ') : '';
                        
                        // Try to find image
                        let img = card ? card.querySelector('img[src*="media-amazon"]') : null;
                        let imgSrc = img ? img.src : null;
                        
                        results.push({
                            soc_imdb_id: ttId,
                            title,
                            image: imgSrc,
                            snippet
                        });
                    }
                    return results;
                });

                if (pageData && pageData.length > 0) break;
            } catch (e) {
                // WAF/timeout — retry
            }
        }

    } finally {
        await page.close();
    }

    return pageData || [];
}

module.exports = { fetchDiscoverTitlesPage, closeBrowser, sleep, getRandomDelay };
