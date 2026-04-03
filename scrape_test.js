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

// Use a REAL User Agent - Chrome 145 is a future version and likely flags bot detection
const REAL_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const COOKIE_STRING = sanitize(process.env.IMDBPRO_COOKIE);

function parseCookies(cookieStr, domain) {
    return cookieStr.split(';').map(c => {
        const [name, ...rest] = c.trim().split('=');
        if (!name || rest.length === 0) return null;
        return {
            name: name.trim(),
            value: rest.join('=').trim(),
            domain: domain,
            path: '/'
        };
    }).filter(c => c !== null);
}

async function scrapeProfileWithBrowser(nmId) {
    console.log(`\n⏳ Launching browser for ${nmId}...`);
    
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: 'new', // Change to false if you want to see it happen
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
        ]
    });

    try {
        const page = await browser.newPage();
        
        // Use a realistic user agent
        await page.setUserAgent(REAL_USER_AGENT);
        await page.setViewport({ width: 1440, height: 900 });

        // Set the cookies BEFORE navigating
        const cookies = parseCookies(COOKIE_STRING, '.imdb.com');
        console.log(`   🍪 Applying ${cookies.length} session cookies...`);
        await page.setCookie(...cookies);

        const url = `https://pro.imdb.com/name/${nmId}/`;
        console.log(`   📍 Navigating to: ${url}`);
        
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        if (response) {
            console.log(`   Status: ${response.status()}`);
        }

        // Wait a few seconds for React to boot up and check auth
        await new Promise(r => setTimeout(r, 4000));

        const pageTitle = await page.title();
        console.log(`   📄 Page Title: "${pageTitle}"`);

        if (pageTitle.includes('Log In') || pageTitle.includes('Sign in')) {
            console.error('🔴 AUTH ERROR: Cookies might be expired or invalid. Redirected to login.');
            await page.screenshot({ path: `./auth_error_${nmId}.png` });
            return null;
        }

        // Wait for the contacts section
        console.log('   ⏳ Waiting for contacts section...');
        const sectionSelector = '[data-testid="contacts-section"]';
        const sectionFound = await page.waitForSelector(sectionSelector, { timeout: 15000 }).catch(() => null);

        if (!sectionFound) {
            console.log('   ⚠️  Contacts section not found. Checking if page content exists...');
            const bodyLength = await page.evaluate(() => document.body.innerText.length);
            console.log(`   Body length: ${bodyLength} chars`);
            await page.screenshot({ path: `./no_contacts_${nmId}.png` });
            return {};
        }

        // Extraction logic
        const contacts = await page.evaluate(() => {
            const section = document.querySelector('[data-testid="contacts-section"]');
            if (!section) return null;

            const results = {};
            const cards = section.querySelectorAll('[data-testid*="-card"]');
            
            cards.forEach(card => {
                const titleEl = card.querySelector('.ipc-accordion__item__title, .ipc-title__text');
                const groupName = titleEl ? titleEl.innerText.trim() : "Details";
                
                const items = [];
                const listItems = card.querySelectorAll('li[role="menuitem"], a[role="menuitem"]');
                
                listItems.forEach(item => {
                    const cloned = item.cloneNode(true);
                    cloned.querySelectorAll('button, svg').forEach(el => el.remove());
                    
                    let value = cloned.innerText.trim().replace(/\s+/g, ' ');
                    if (!value || value === 'Edit' || value.includes('Representative')) return;

                    let type = 'Other';
                    const testId = item.getAttribute('data-testid') || "";
                    if (testId.includes('email')) type = 'Email';
                    else if (testId.includes('phone')) type = 'Phone';
                    else if (testId.includes('address')) type = 'Address';
                    else if (testId.includes('website')) type = 'Website';
                    else if (testId.includes('agent-name')) type = 'Agent';
                    
                    items.push({ type, value });
                });

                if (items.length > 0) {
                    results[groupName] = (results[groupName] || []).concat(items);
                }
            });

            return results;
        });

        if (contacts && Object.keys(contacts).length > 0) {
            console.log('✅ Contacts extracted successfully!');
            console.log(JSON.stringify(contacts, null, 2));
        }

        return contacts;

    } catch (error) {
        console.error(`💥 Error processing ${nmId}:`, error.message);
        return null;
    } finally {
        await browser.close();
    }
}

async function main() {
    // nm2858875 is Sydney Sweeney (your example)
    const testId = 'nm2858875';
    const data = await scrapeProfileWithBrowser(testId);
    
    if (data) {
        fs.writeFileSync('./test_result.json', JSON.stringify(data, null, 2));
        console.log('\n💾 Test result saved to test_result.json');
    }
}

main();
