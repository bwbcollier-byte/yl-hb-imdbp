require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const COOKIE = process.env.IMDBPRO_COOKIE;

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    if (COOKIE) await page.setCookie(...COOKIE.split(';').map(c => {
        const [n, ...r] = c.trim().split('=');
        return { name: n.trim(), value: r.join('=').trim(), domain: '.imdb.com', path: '/' };
    }).filter(c => c.name && c.value));
    
    await page.goto('https://pro.imdb.com/company/co0002521/staff/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait for the specific element that contains React app!
    await new Promise(r => setTimeout(r, 4000));
    
    await page.screenshot({ path: 'staff_page.png', fullPage: true });
    
    await browser.close();
})();
