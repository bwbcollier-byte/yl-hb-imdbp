const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const COOKIE = process.env.IMDBPRO_COOKIE;
const MAX_PAGES = parseInt(process.env.STAFF_MAX_PAGES || '10', 10); // 10 pages = 1000 staff max per company
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
 * Fetches all staff from a company's /staff/ page via __NEXT_DATA__ JSON parsing.
 * Handles WAF retry and pagination via cursor-based URL navigation.
 * 
 * @param {string} companyImdbId - e.g. "co0002521"
 * @param {string} companyName - Company display name for logging
 * @param {string} companyLogo - Logo URL from hb_companies
 * @param {string} companyUuid - UUID from hb_companies for linked_company
 * @returns {Array} Array of contact objects ready for hb_contacts upsert
 */
async function fetchCompanyStaff(companyImdbId, companyName, companyLogo, companyUuid) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    let allStaff = [];

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
            let url = `https://pro.imdb.com/company/${companyImdbId}/staff/`;
            if (cursor) url += `?after=${cursor}`;

            let pageData = null;
            let maxRetries = 10;

            // WAF-resilient retry loop
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    await sleep(3000);

                    pageData = await page.evaluate(() => {
                        const nd = document.querySelector('#__NEXT_DATA__');
                        if (!nd) return null;
                        const json = JSON.parse(nd.innerHTML);

                        // Deep search for keyStaff
                        function search(obj, key) {
                            if (!obj || typeof obj !== 'object') return null;
                            if (key in obj) return obj[key];
                            for (let k in obj) { let res = search(obj[k], key); if (res) return res; }
                            return null;
                        }

                        let ks = search(json, 'keyStaff');
                        if (!ks || !ks.edges) return null;

                        let staff = ks.edges.map(edge => {
                            let node = edge.node;
                            let nameObj = node.name || {};
                            let nameText = nameObj.nameText ? nameObj.nameText.text : null;
                            let nmId = nameObj.id || null;
                            let imageUrl = nameObj.primaryImage ? nameObj.primaryImage.url : null;
                            let meterRank = nameObj.meterRank ? nameObj.meterRank.currentRank : null;

                            // Employment details
                            let employment = node.summary && node.summary.employment ? node.summary.employment : [];
                            let role = null;
                            let location = null;
                            if (employment.length > 0) {
                                let emp = employment[0];
                                let parts = [];
                                if (emp.title && emp.title.text) parts.push(emp.title.text);
                                if (emp.occupation && emp.occupation.text) parts.push(emp.occupation.text);
                                role = parts.join(' - ');
                                if (emp.branch && emp.branch.text) location = emp.branch.text;
                            }

                            let nameParts = nameText ? nameText.split(' ') : [];
                            let firstName = nameParts[0] || null;
                            let lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

                            return {
                                name_full: nameText,
                                first_name: firstName,
                                last_name: lastName,
                                role: role,
                                location: location,
                                soc_imdb_id: nmId,
                                soc_imdb: nmId ? 'https://pro.imdb.com/name/' + nmId + '/' : null,
                                image_profile: imageUrl,
                                imdb_rank: meterRank
                            };
                        });

                        return {
                            staff: staff,
                            hasNextPage: ks.pageInfo ? ks.pageInfo.hasNextPage : false,
                            endCursor: ks.pageInfo ? ks.pageInfo.endCursor : null
                        };
                    });

                    if (pageData) break;
                } catch (e) {
                    // WAF redirect or navigation error — retry
                }
            }

            if (!pageData || !pageData.staff || pageData.staff.length === 0) {
                console.log(`      📄 Page ${pageNum}: No staff data found, stopping.`);
                break;
            }

            // Attach company metadata to each contact
            for (let s of pageData.staff) {
                s.company_name = companyName;
                s.company_logo = companyLogo;
                s.linked_company = companyUuid;
            }

            allStaff.push(...pageData.staff);
            console.log(`      📄 Page ${pageNum}: +${pageData.staff.length} staff (total: ${allStaff.length})`);

            hasNextPage = pageData.hasNextPage;
            cursor = pageData.endCursor;
            pageNum++;

            if (hasNextPage) await sleep(getRandomDelay(2000, 4000));
        }
    } finally {
        await page.close();
    }

    return allStaff;
}

module.exports = { fetchCompanyStaff, closeBrowser, sleep, getRandomDelay };
