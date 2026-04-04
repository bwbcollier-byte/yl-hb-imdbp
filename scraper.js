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

async function fetchPageProps(url) {
    const nmId = url.match(/nm\d+/)?.[0];
    if (!nmId) return [];
    const br = await getBrowser();

    // Fresh page per talent to avoid WAF session corruption
    const page = await br.newPage();
    if (COOKIE) await page.setCookie(...parseCookies(COOKIE));

    const targets = [
        `https://pro.imdb.com/name/${nmId}/`,
        `https://pro.imdb.com/name/${nmId}/contacts`
    ];
    let allFound = [];

    try {
        for (const target of targets) {
            try {
                await page.goto(target, { waitUntil: 'networkidle2', timeout: 20000 });

                const data = await page.evaluate(() => {
                    let reps = [];
                    const nextData = document.querySelector('#__NEXT_DATA__');
                    if (nextData) {
                        try {
                            const json = JSON.parse(nextData.innerHTML);
                            const scan = (o) => {
                                if (!o || typeof o !== 'object') return;
                                if (o.agency?.company?.id) {
                                    reps.push({
                                        type: o.relationshipType?.text || o.typeName || 'AGENT',
                                        company: {
                                            id: o.agency.company.id,
                                            name: o.agency.company.companyText?.text || o.agency.company.name
                                        },
                                        agents: (o.agency.agents || []).map(a => ({
                                            id: a.name?.id || a.id,
                                            name: a.name?.nameText?.text || a.name
                                        })).filter(a => a.id && a.name)
                                    });
                                }
                                Object.values(o).forEach(scan);
                            };
                            scan(json.props?.pageProps);
                        } catch (e) {}
                    }
                    if (reps.length === 0) {
                        document.querySelectorAll('a[href*="/company/co"]').forEach(l => {
                            reps.push({
                                type: 'REPR',
                                company: {
                                    id: l.getAttribute('href').split('/')[2],
                                    name: l.innerText.trim()
                                }
                            });
                        });
                    }
                    return reps;
                });

                allFound = [...allFound, ...data];
                if (allFound.length > 0) break;
            } catch (e) {
                // WAF challenge or nav error — try next URL
            }
        }
    } finally {
        await page.close();
    }

    // Deduplicate by company ID
    const seen = new Set();
    return allFound.filter(r => {
        if (!r.company?.id || seen.has(r.company.id)) return false;
        seen.add(r.company.id);
        return true;
    });
}

module.exports = {
    fetchPageProps,
    closeBrowser,
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    getRandomDelay: (min, max) => Math.floor(Math.random() * (max - min + 1) + min)
};
