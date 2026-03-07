/**
 * discover-puppeteer.js — Uses a headless browser to scrape IMDbPro Discover
 * 
 * IMDbPro's Discover page is fully client-side rendered (React SPA).
 * Axios/Cheerio only gets the empty shell. We need a real browser to 
 * execute the JavaScript and wait for the talent cards to load.
 */
const puppeteer = require('puppeteer-core');
require('dotenv').config();

const sanitize = (val) => {
    let s = (val || '').trim().replace(/\r?\n|\r/g, '');
    if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
    return s;
};

const COOKIE_STRING = sanitize(process.env.IMDBPRO_COOKIE);
const USER_AGENT = sanitize(process.env.IMDBPRO_USER_AGENT) || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

/**
 * Parse cookie string into individual cookie objects for Puppeteer
 */
function parseCookies(cookieStr, domain) {
    return cookieStr.split(';').map(c => {
        const [name, ...rest] = c.trim().split('=');
        return {
            name: name.trim(),
            value: rest.join('=').trim(),
            domain: domain,
            path: '/'
        };
    }).filter(c => c.name && c.value);
}

/**
 * Launches headless Chrome, loads the Discover page, waits for results,
 * and extracts all NM IDs from the rendered DOM.
 */
async function fetchDiscoverIdsWithBrowser(url) {
    console.log('🌐 Launching headless Chrome...');
    
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);

        // Set viewport
        await page.setViewport({ width: 1920, height: 1080 });

        // Set cookies for pro.imdb.com
        const cookies = parseCookies(COOKIE_STRING, '.imdb.com');
        console.log(`   🍪 Setting ${cookies.length} cookies...`);
        await page.setCookie(...cookies);

        // Navigate to the discover page
        console.log(`   📍 Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait for dynamic content to render (talent cards)
        console.log('   ⏳ Waiting for results to load...');
        
        // Give the React app time to hydrate and fetch data
        await page.waitForFunction(() => {
            // Check if any /name/nm links have appeared in the DOM
            const links = document.querySelectorAll('a[href*="/name/nm"]');
            return links.length > 0;
        }, { timeout: 30000 }).catch(() => {
            console.log('   ⚠️  Timeout waiting for talent links. Checking page state...');
        });

        // Extra wait for any stragglers
        await new Promise(r => setTimeout(r, 3000));

        // Extract the page title
        const title = await page.title();
        console.log(`   📄 Page Title: "${title}"`);

        // Extract all NM IDs from the rendered DOM
        const ids = await page.evaluate(() => {
            const nmSet = new Set();
            
            // Method 1: Links with /name/nm
            document.querySelectorAll('a[href*="/name/nm"]').forEach(a => {
                const match = a.href.match(/\/name\/(nm\d+)/);
                if (match) nmSet.add(match[1]);
            });

            // Method 2: data-const-id attributes
            document.querySelectorAll('[data-const-id]').forEach(el => {
                const id = el.getAttribute('data-const-id');
                if (id && id.startsWith('nm')) nmSet.add(id);
            });

            // Method 3: Scan all text for nm IDs as last resort
            const bodyText = document.body.innerHTML;
            const matches = bodyText.match(/nm\d{7,}/g);
            if (matches) matches.forEach(m => nmSet.add(m));

            return Array.from(nmSet);
        });

        console.log(`   ✅ Found ${ids.length} NM IDs in rendered page.`);
        
        if (ids.length === 0) {
            // Take a screenshot for debugging
            await page.screenshot({ path: '/tmp/imdbpro-discover-screenshot.png', fullPage: false });
            console.log('   📸 Screenshot saved to /tmp/imdbpro-discover-screenshot.png');
            
            // Log page content snippet
            const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
            console.log(`   📄 Page text preview: ${bodyText}`);
        }

        return ids;
    } finally {
        await browser.close();
        console.log('   🔒 Browser closed.');
    }
}

module.exports = { fetchDiscoverIdsWithBrowser };

// If run directly, test it
if (require.main === module) {
    const url = process.env.DISCOVER_URL || 'https://pro.imdb.com/discover/people/?profession=any&sortOrder=STARMETER_ASC&ref_=nmnw_nv_ppl_stm';
    fetchDiscoverIdsWithBrowser(url)
        .then(ids => {
            console.log(`\n🎯 Total unique IDs: ${ids.length}`);
            if (ids.length > 0) {
                console.log('First 10:', ids.slice(0, 10));
            }
        })
        .catch(err => console.error('💥 Error:', err.message));
}
