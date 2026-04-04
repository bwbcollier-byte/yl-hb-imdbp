require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');

const COOKIE = process.env.IMDBPRO_COOKIE;

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    if (COOKIE) await page.setCookie(...COOKIE.split(';').map(c => {
        const [n, ...r] = c.trim().split('=');
        return { name: n.trim(), value: r.join('=').trim(), domain: '.imdb.com', path: '/' };
    }).filter(c => c.name && c.value));
    
    for (let i = 0; i < 3; i++) {
        try {
            await page.goto('https://pro.imdb.com/company/co0002521/', { waitUntil: 'networkidle2', timeout: 20000 });
            const html = await page.evaluate(() => {
                const d = document.querySelector('#__NEXT_DATA__');
                return d ? d.innerHTML : null;
            });
            if (html) { fs.writeFileSync('company_caa_data.json', JSON.stringify(JSON.parse(html), null, 2)); break; }
        } catch (e) {}
    }
    
    // fetch staff
    for (let i = 0; i < 3; i++) {
        try {
            await page.goto('https://pro.imdb.com/company/co0002521/staff/', { waitUntil: 'networkidle2', timeout: 20000 });
            const html = await page.evaluate(() => {
                const d = document.querySelector('#__NEXT_DATA__');
                return d ? d.innerHTML : null;
            });
            if (html) { fs.writeFileSync('company_caa_staff.json', JSON.stringify(JSON.parse(html), null, 2)); break; }
        } catch (e) {}
    }

    // fetch clients
    for (let i = 0; i < 3; i++) {
        try {
            await page.goto('https://pro.imdb.com/company/co0002521/clients/', { waitUntil: 'networkidle2', timeout: 20000 });
            const html = await page.evaluate(() => {
                const d = document.querySelector('#__NEXT_DATA__');
                return d ? d.innerHTML : null;
            });
            if (html) { fs.writeFileSync('company_caa_clients.json', JSON.stringify(JSON.parse(html), null, 2)); break; }
        } catch (e) {}
    }
    await browser.close();
    console.log("Dump finished");
})();
