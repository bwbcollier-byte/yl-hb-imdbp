require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const COOKIE = process.env.IMDBPRO_COOKIE;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    if (COOKIE) await page.setCookie(...COOKIE.split(';').map(c => {
        const [n, ...r] = c.trim().split('=');
        return { name: n.trim(), value: r.join('=').trim(), domain: '.imdb.com', path: '/' };
    }).filter(c => c.name && c.value));
    
    // Use the same retry loop pattern from scraper-company.js
    let result = null;
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            await page.goto('https://pro.imdb.com/company/co0002521/staff/', { waitUntil: 'domcontentloaded', timeout: 15000 });
            await sleep(3000);
            
            result = await page.evaluate(() => {
                const nd = document.querySelector('#__NEXT_DATA__');
                if (!nd) return { error: 'no __NEXT_DATA__' };
                const json = JSON.parse(nd.innerHTML);
                
                // Find keyStaff
                function search(obj, key) {
                    if(!obj || typeof obj !== 'object') return null;
                    if(key in obj) return obj[key];
                    for(let k in obj) { let res = search(obj[k], key); if(res) return res; }
                    return null;
                }
                let ks = search(json, 'keyStaff');
                if (!ks) return { error: 'no keyStaff found' };
                return {
                    edgeCount: ks.edges ? ks.edges.length : 0,
                    hasNextPage: ks.pageInfo ? ks.pageInfo.hasNextPage : false,
                    endCursor: ks.pageInfo ? ks.pageInfo.endCursor : null,
                    firstNode: ks.edges && ks.edges[0] ? ks.edges[0].node.name.nameText.text : null
                };
            });
            
            if (result && !result.error) break;
            console.log('Attempt', attempt, 'result:', result);
        } catch(e) {
            console.log('Attempt', attempt, 'error:', e.message);
        }
    }
    
    console.log('Result:', JSON.stringify(result, null, 2));
    await browser.close();
})();
