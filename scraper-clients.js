const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const COOKIE = process.env.IMDBPRO_COOKIE;
const MAX_PAGES = parseInt(process.env.CLIENTS_MAX_PAGES || '10', 10); // 10 pages = 1000 clients max per company
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
 * Fetches client roster from a company's /clients/ page via __NEXT_DATA__ JSON parsing.
 * Each client includes: name, nmId, image, meter rank, and their assigned agents at this company.
 * 
 * @param {string} companyImdbId - e.g. "co0002521"
 * @returns {Array} Array of client objects with nested agents
 */
async function fetchCompanyClients(companyImdbId) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    let allClients = [];

    try {
        if (COOKIE) {
            await page.setCookie(...COOKIE.split(';').map(c => {
                const [n, ...r] = c.trim().split('=');
                return { name: n.trim(), value: r.join('=').trim(), domain: '.imdb.com', path: '/' };
            }).filter(c => c.name && c.value));
        }

        let hasNextPage = true;
        let cursor = null;
        let pageNum = 1;

        while (hasNextPage && pageNum <= MAX_PAGES) {
            let url = `https://pro.imdb.com/company/${companyImdbId}/clients/`;
            if (cursor) url += `?after=${cursor}`;

            let pageData = null;
            let maxRetries = 10;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    await sleep(3000);

                    pageData = await page.evaluate(() => {
                        const nd = document.querySelector('#__NEXT_DATA__');
                        if (!nd) return null;
                        const json = JSON.parse(nd.innerHTML);

                        function search(obj, key) {
                            if (!obj || typeof obj !== 'object') return null;
                            if (key in obj) return obj[key];
                            for (let k in obj) { let res = search(obj[k], key); if (res) return res; }
                            return null;
                        }

                        let cl = search(json, 'clients');
                        if (!cl || !cl.edges) return null;

                        let clients = cl.edges.map(edge => {
                            let node = edge.node;
                            let client = node.client || {};
                            let nameText = client.nameText ? client.nameText.text : null;
                            let nmId = client.id || null;
                            let imageUrl = client.primaryImage ? client.primaryImage.url : null;
                            let meterRank = client.meterRank ? client.meterRank.currentRank : null;

                            // Parse agents assigned to this client at this company
                            let agents = [];
                            if (node.agents && node.agents.length > 0) {
                                agents = node.agents.map(a => ({
                                    nmId: a.name ? a.name.id : null,
                                    name: a.name && a.name.nameText ? a.name.nameText.text : null,
                                    type: a.relationshipType ? a.relationshipType.relationshipTypeId : null
                                }));
                            }

                            let nameParts = nameText ? nameText.split(' ') : [];
                            let firstName = nameParts[0] || null;
                            let lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

                            return {
                                name: nameText,
                                first_name: firstName,
                                last_name: lastName,
                                soc_imdb_id: nmId,
                                image: imageUrl,
                                imdb_rank: meterRank,
                                agents: agents
                            };
                        });

                        return {
                            clients: clients,
                            hasNextPage: cl.pageInfo ? cl.pageInfo.hasNextPage : false,
                            endCursor: cl.pageInfo ? cl.pageInfo.endCursor : null,
                            total: cl.total || null
                        };
                    });

                    if (pageData) break;
                } catch (e) {
                    // WAF / navigation error — retry
                }
            }

            if (!pageData || !pageData.clients || pageData.clients.length === 0) {
                console.log(`      📄 Page ${pageNum}: No client data found, stopping.`);
                break;
            }

            allClients.push(...pageData.clients);
            let totalStr = pageData.total ? ` / ~${pageData.total}` : '';
            console.log(`      📄 Page ${pageNum}: +${pageData.clients.length} clients (total: ${allClients.length}${totalStr})`);

            hasNextPage = pageData.hasNextPage;
            cursor = pageData.endCursor;
            pageNum++;

            if (hasNextPage) await sleep(getRandomDelay(2000, 4000));
        }
    } finally {
        await page.close();
    }

    return allClients;
}

module.exports = { fetchCompanyClients, closeBrowser, sleep, getRandomDelay };
