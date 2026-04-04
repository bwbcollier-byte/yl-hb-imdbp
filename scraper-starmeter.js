const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const COOKIE = process.env.IMDBPRO_COOKIE;
const MAX_PAGES = parseInt(process.env.STARMETER_MAX_PAGES || '10', 10); // 10 pages = 500 names
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
 * Fetches people from IMDbPro Discover/Starmeter pages.
 * Paginates via pageNumber URL param.
 * 
 * @param {number} startPage - Page number to start from (1-based)
 * @returns {Array} Array of person objects
 */
async function fetchStarmeterPage(startPage = 1) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    let allPeople = [];

    try {
        if (COOKIE) {
            await page.setCookie(...COOKIE.split(';').map(c => {
                const [n, ...r] = c.trim().split('=');
                return { name: n.trim(), value: r.join('=').trim(), domain: '.imdb.com', path: '/' };
            }).filter(c => c.name && c.value));
        }

        for (let pageNum = startPage; pageNum < startPage + MAX_PAGES; pageNum++) {
            const url = `https://pro.imdb.com/discover/people/?profession=any&sortOrder=STARMETER_ASC&minNumOfReleasedCredits=10&creditBeginYear=2000&pageNumber=${pageNum}&hasClients=false`;

            let pageData = null;

            for (let attempt = 0; attempt < 10; attempt++) {
                try {
                    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
                    await sleep(4000);

                    pageData = await page.evaluate(() => {
                        let primaryLinks = document.querySelectorAll('a[href*="ref_=dsc_pe_res_pri_nm_view"]');
                        let results = [];

                        for (let link of primaryLinks) {
                            let href = link.getAttribute('href');
                            let match = href.match(/\/name\/(nm\d+)/);
                            if (!match) continue;
                            let nmId = match[1];
                            let name = '';
                            // Get the clean name from the truncate span
                            let truncFull = link.querySelector('.a-truncate-full');
                            if (truncFull) name = truncFull.textContent.trim();
                            else name = link.textContent.trim().replace(/\s+/g, ' ');

                            // Navigate up to the card container
                            let card = link;
                            for (let i = 0; i < 8; i++) {
                                card = card.parentElement;
                                if (!card) break;
                            }
                            if (!card) continue;

                            let cardText = card.innerText || '';

                            // Extract image
                            let img = card.querySelector('img[src*="media-amazon"]');
                            let imgSrc = img ? img.src : null;

                            // Extract STARmeter rank
                            let rankMatch = cardText.match(/STARmeter\s+(\d[\d,]*)/i);
                            let rank = rankMatch ? parseInt(rankMatch[1].replace(/,/g, '')) : null;

                            // Extract profession
                            let profMatch = cardText.match(/\n([A-Za-z, ]+)\n[A-Za-z, ]*…?\nSTARmeter/);
                            let profession = profMatch ? profMatch[1].trim() : null;

                            let nameParts = name.split(' ');
                            let firstName = nameParts[0] || null;
                            let lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

                            results.push({
                                soc_imdb_id: nmId,
                                name,
                                first_name: firstName,
                                last_name: lastName,
                                image: imgSrc,
                                imdb_rank: rank,
                                profession
                            });
                        }

                        return results;
                    });

                    if (pageData && pageData.length > 0) break;
                } catch (e) {
                    // WAF/timeout — retry
                }
            }

            if (!pageData || pageData.length === 0) {
                console.log(`      📄 Page ${pageNum}: No results, stopping.`);
                break;
            }

            allPeople.push(...pageData);
            console.log(`      📄 Page ${pageNum}: +${pageData.length} people (total: ${allPeople.length})`);

            if (pageData.length < 50) break; // Last page

            await sleep(getRandomDelay(2000, 4000));
        }
    } finally {
        await page.close();
    }

    return allPeople;
}

module.exports = { fetchStarmeterPage, closeBrowser, sleep, getRandomDelay };
