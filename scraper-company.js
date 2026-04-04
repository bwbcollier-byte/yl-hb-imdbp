const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const COOKIE = process.env.IMDBPRO_COOKIE;
let browser = null;

function parseCookies(s) {
    return s.split(';').map(c => {
        const [n, ...r] = c.trim().split('=');
        return { name: n.trim(), value: r.join('=').trim(), domain: '.imdb.com', path: '/' };
    }).filter(c => c.name && c.value);
}

async function getBrowser() {
    if (browser && browser.connected) return browser;
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    return browser;
}

async function closeBrowser() {
    if (browser) { await browser.close(); browser = null; }
}

async function fetchCompanyProps(url) {
    const coId = url.match(/co\d+/)?.[0];
    if (!coId) return null;
    const br = await getBrowser();

    const page = await br.newPage();
    if (COOKIE) await page.setCookie(...parseCookies(COOKIE));

    let companyData = {};

    try {
        // We attempt up to 3 times to bypass the initial WAF challenge navigation
        for (let i = 0; i < 3; i++) {
            try {
                await page.goto(`https://pro.imdb.com/company/${coId}/`, { waitUntil: 'networkidle2', timeout: 20000 });

                companyData = await page.evaluate(() => {
                    let data = {
                        url: null,
                        location: null,
                        meterRank: null,
                        logoUrl: null
                    };
                    
                    const nextData = document.querySelector('#__NEXT_DATA__');
                    if (nextData) {
                        try {
                            const json = JSON.parse(nextData.innerHTML);
                            
                            const scan = (o) => {
                                if (!o || typeof o !== 'object') return;
                                
                                // Extract meter rank
                                if (o.meterRank && o.meterRank.currentRank !== undefined && data.meterRank === null) {
                                    data.meterRank = o.meterRank.currentRank;
                                }
                                
                                // Extract website URL
                                if (o.website && o.website.url) {
                                   data.url = o.website.url;
                                }
                                
                                // Extract physical address text
                                if (o.physicalAddress && o.physicalAddress.text) {
                                   data.location = o.physicalAddress.text;
                                }
                                
                                // Extract primary image / logo
                                if (o.primaryImage && o.primaryImage.url && data.logoUrl === null) {
                                    data.logoUrl = o.primaryImage.url;
                                }

                                Object.values(o).forEach(scan);
                            };
                            scan(json.props?.pageProps);
                        } catch (e) {}
                    }
                    return data;
                });
                
                // If we successfully executed the evaluation, break out of loop
                break;
            } catch (e) {
                // WAF or Network error, we just loop and try again since the page redirect is now cleared
            }
        }
    } finally {
        await page.close();
    }

    return companyData;
}

module.exports = {
    fetchCompanyProps,
    closeBrowser,
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    getRandomDelay: (min, max) => Math.floor(Math.random() * (max - min + 1) + min)
};
