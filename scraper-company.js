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
                        logoUrl: null,
                        description: null,
                        phone: null,
                        locations_other: [],
                        country: null
                    };
                    
                    const nextData = document.querySelector('#__NEXT_DATA__');
                    if (nextData) {
                        try {
                            const json = JSON.parse(nextData.innerHTML);
                            
                            const scan = (o) => {
                                if (!o || typeof o !== 'object') return;
                                
                                // Extract meter rank
                                if (o.meterRankingHistory && o.meterRankingHistory.ranks && o.meterRankingHistory.ranks.length > 0 && !data.meterRank) {
                                    data.meterRank = o.meterRankingHistory.ranks[0].rank;
                                }
                                if (o.meterRank && o.meterRank.currentRank && !data.meterRank) {
                                    data.meterRank = o.meterRank.currentRank;
                                }

                                // Extract website URL
                                if (o.website && o.website.url && !data.url) {
                                   data.url = o.website.url;
                                }

                                if (o.country && o.country.id && !data.country) {
                                    if (o.country.id.length === 2) data.country = o.country.id;
                                }
                                if (o.bio && o.bio.displayableArticle && o.bio.displayableArticle.body && !data.description) {
                                    let textHtml = o.bio.displayableArticle.body.plaidHtml;
                                    if (textHtml) data.description = textHtml.replace(/<[^>]+>/g, '\n').replace(/\n\s*\n/g, '\n\n').trim();
                                }
                                
                                // Extract Branches / Phones
                                if (o.branches && o.branches.edges && o.branches.edges.length > 0) {
                                    let topBranch = o.branches.edges[0].node;
                                    if (topBranch && topBranch.directContact && topBranch.directContact.phoneNumbers && topBranch.directContact.phoneNumbers.length > 0 && !data.phone) {
                                        data.phone = topBranch.directContact.phoneNumbers[0].value;
                                    }
                                    for (let i = 1; i < o.branches.edges.length; i++) {
                                        let b = o.branches.edges[i].node;
                                        if (b.directContact && b.directContact.physicalAddress && b.directContact.physicalAddress.text) {
                                            data.locations_other.push(b.directContact.physicalAddress.text);
                                        }
                                    }
                                }

                                if (o.physicalAddress && o.physicalAddress.text && !data.location) {
                                    data.location = o.physicalAddress.text;
                                } else if (o.branches && o.branches.edges && o.branches.edges.length > 0 && !data.location) {
                                    let top = o.branches.edges[0].node;
                                    if (top.directContact && top.directContact.physicalAddress && top.directContact.physicalAddress.text) {
                                        data.location = top.directContact.physicalAddress.text;
                                    }
                                }

                                // Extract primary image / logo
                                if (o.primaryImage && o.primaryImage.url && !data.logoUrl) {
                                    data.logoUrl = o.primaryImage.url;
                                }

                                Object.values(o).forEach(scan);
                            };
                            scan(json.props?.pageProps);
                            
                            // Stringify locations_other
                            if (data.locations_other && data.locations_other.length > 0) {
                                data.locations_other = JSON.stringify(data.locations_other);
                            } else {
                                data.locations_other = null;
                            }
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
