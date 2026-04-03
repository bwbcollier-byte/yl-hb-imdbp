/**
 * scrape_profile_puppeteer.js — Uses a headless browser to scrape specialized contact data
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
require('dotenv').config();

const sanitize = (val) => {
    let s = (val || '').trim().replace(/\r?\n|\r/g, '');
    if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
    return s;
};

const COOKIE_STRING = sanitize(process.env.IMDBPRO_COOKIE);
const USER_AGENT = sanitize(process.env.IMDBPRO_USER_AGENT) || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

function parseCookies(cookieStr, domain) {
    return cookieStr.split(';').map(c => {
        const [name, ...rest] = c.trim().split('=');
        return {
            name: name.trim(),
            value: rest.join('=').trim(),
            domain: domain,
            path: '/'
        };
    }).filter(c => c.name && c.value);
}

async function scrapeProfileWithBrowser(nmId) {
    console.log(`\n⏳ Launching browser for ${nmId}...`);
    
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    });

    try {
        const page = await browser.newPage();
        // await page.setUserAgent(USER_AGENT);
        // await page.setViewport({ width: 1920, height: 1080 });

        // const cookies = parseCookies(COOKIE_STRING, '.imdb.com');
        // await page.setCookie(...cookies);

        const url = `https://pro.imdb.com/name/${nmId}/`;
        console.log(`   📍 Navigating to: ${url}`);
        
        let response;
        try {
            response = await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
        } catch (e) {
            console.error(`🔴 Initial navigation failed: ${e.message}`);
        }
        
        if (response) {
            console.log(`   Status: ${response.status()}`);
        } else {
            console.log('   ⚠️  No response returned.');
        }

        const pageTitle = await page.title();
        console.log(`   📄 Page Title: "${pageTitle}"`);
        if (pageTitle.includes('Log In') || pageTitle.includes('Sign in')) {
             console.error('🔴 AUTH ERROR: Redirected to login page.');
             await page.screenshot({ path: `./debug_auth_needed_${nmId}.png` });
             return null;
        }

        // Wait for contacts section
        console.log('   ⏳ Waiting for contacts section (React components)...');
        const sectionFound = await page.waitForSelector('[data-testid="contacts-section"]', { timeout: 25000 }).catch(() => null);
        
        if (!sectionFound) {
             console.log('   ⚠️  Contacts section NOT found after 25s.');
             await page.screenshot({ path: `./debug_not_found_${nmId}.png` });
        }

        // Extra wait for React content stabilization
        await new Promise(r => setTimeout(r, 2000));

        const contacts = await page.evaluate(() => {
            const section = document.querySelector('[data-testid="contacts-section"]');
            if (!section) return null;

            const data = {};
            // Updated selectors to be more robust based on user snippet
            const cardTestIds = ['direct-contact-card', 'employment-card', 'representation-card'];
            const cards = section.querySelectorAll('.ipc-list-card, [data-testid*="-card"]');
            
            cards.forEach(card => {
                const titleEl = card.querySelector('.ipc-accordion__item__title, .ipc-title__text');
                const groupTitle = titleEl ? titleEl.innerText.trim() : "Other";
                
                const items = [];
                // Look for menu items or list items
                const itemNodes = card.querySelectorAll('li[role="menuitem"], a[role="menuitem"], .ipc-list__item');
                
                itemNodes.forEach(item => {
                    const clone = item.cloneNode(true);
                    clone.querySelectorAll('button, .ipc-icon-button').forEach(b => b.remove());
                    
                    let text = "";
                    const textEl = clone.querySelector('.ipc-list-item__text');
                    if (textEl) text = textEl.innerText.trim();
                    else text = clone.innerText.trim();
                    
                    text = text.replace(/\s+/g, ' ');

                    if (!text || text === 'Representative' || text.startsWith('Representatives (')) return;

                    const testId = item.getAttribute('data-testid') || "";
                    let type = 'Other';
                    if (testId.includes('email') || item.querySelector('.ipc-icon--email')) type = 'Email';
                    else if (testId.includes('phone') || item.querySelector('.ipc-icon--phone')) type = 'Phone';
                    else if (testId.includes('address') || item.querySelector('.ipc-icon--place')) type = 'Address';
                    else if (testId.includes('website') || item.querySelector('.ipc-icon--globe')) type = 'Website';
                    else if (testId.includes('agent-name') || item.querySelector('.ipc-icon--person')) type = 'Person';
                    else if (testId.includes('fax') || item.querySelector('.ipc-icon--fax')) type = 'Fax';
                    
                    items.push({ type, value: text });
                });

                if (items.length > 0) {
                    data[groupTitle] = (data[groupTitle] || []).concat(items);
                }
            });

            return data;
        });

        if (contacts) {
            console.log('✅ Contacts extracted!');
            console.log(JSON.stringify(contacts, null, 2));
        }

        return contacts;
    } finally {
        await browser.close();
    }
}

async function main() {
    const ids = ['nm2858875']; // Sydney Sweeney test profile
    const results = [];
    
    for (const id of ids) {
        const contactData = await scrapeProfileWithBrowser(id);
        results.push({ id, contacts: contactData });
    }
    
    fs.writeFileSync('./puppeteer_contacts.json', JSON.stringify(results, null, 2));
    console.log('\n💾 Done. Results in puppeteer_contacts.json');
}

main().catch(err => console.error('💥 Error:', err.message));
