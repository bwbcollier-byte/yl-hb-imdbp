require('dotenv').config();
const { getBrowser, closeBrowser } = require('./scraper');
const fs = require('fs');

async function debug() {
    const url = "https://pro.imdb.com/name/nm0644022/contacts";
    console.log("🔭 Debugging Bob Odenkirk (nm0644022)...");
    
    // We modify your scraper just for this test to expose getBrowser
    const { fetchPageProps } = require('./scraper');
    const puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());
    
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const COOKIE = process.env.IMDBPRO_COOKIE;
    
    const parseCookies = (s) => s.split(';').map(c => {
        const [n, ...r] = c.trim().split('=');
        return { name: n.trim(), value: r.join('=').trim(), domain: '.imdb.com', path: '/' };
    }).filter(c => c.name && c.value);
    
    await page.setCookie(...parseCookies(COOKIE));
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    const html = await page.content();
    fs.writeFileSync('bob_odenkirk_raw.html', html);
    console.log("💾 Raw HTML saved to bob_odenkirk_raw.html");
    
    const hasNextData = html.includes('__NEXT_DATA__');
    console.log(`📦 Has __NEXT_DATA__: ${hasNextData}`);

    await browser.close();
}
debug();
