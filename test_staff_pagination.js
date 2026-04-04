require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const COOKIE = process.env.IMDBPRO_COOKIE;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    console.log("Starting...");
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    if (COOKIE) await page.setCookie(...COOKIE.split(';').map(c => {
        const [n, ...r] = c.trim().split('=');
        return { name: n.trim(), value: r.join('=').trim(), domain: '.imdb.com', path: '/' };
    }).filter(c => c.name && c.value));
    
    let cnt = 0;
    page.on('response', async res => {
        if (res.url().includes('graphql')) {
            try {
                let json = await res.json();
                cnt++;
                console.log("GraphQL response!", Object.keys(json));
            } catch(e) {}
        }
    });

    try {
        console.log("Navigating...");
        await page.goto('https://pro.imdb.com/company/co0002521/staff/', { waitUntil: 'load', timeout: 30000 });
        await sleep(3000);
        
        let html = await page.content();
        console.log("Page loaded. Length:", html.length);
        
        const seeMore = await page.evaluate(() => {
            let btns = Array.from(document.querySelectorAll('button'));
            let target = btns.find(b => b.innerText && b.innerText.toLowerCase().includes('see more'));
            if(target) {
               target.click();
               return true;
            }
            return false;
        });
        
        console.log("Clicked See More?", seeMore);
        if(seeMore) await sleep(4000);
        
    } catch (e) {
        console.log("Error:", e.message);
    }
    
    await browser.close();
    console.log("Done. GraphQL responses:", cnt);
})();
