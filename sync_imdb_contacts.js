/**
 * sync_imdb_contacts.js — Full pipeline to sync IMDbPro contacts to Airtable
 */
const puppeteer = require('puppeteer-core');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config({ path: '../.env' });
require('dotenv').config({ path: './.env' });

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = 'appYIBrymzdLczP69';
const TABLE_ID = 'tblCtdS0OePR21CCj';
const VIEW_ID = 'viw2PDZIm6bQ2JvVv';

const COOKIE_STRING = process.env.IMDBPRO_COOKIE;
const REAL_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

if (!AIRTABLE_API_KEY || !COOKIE_STRING) {
    console.error('🔴 Missing credentials in .env');
    process.exit(1);
}

/**
 * Fuzzy map IMDb categories to Airtable columns
 */
function getColumnName(imdbCategory) {
    const cat = (imdbCategory || '').toUpperCase();
    if (cat.includes('MANAGER')) return 'management_contacts';
    if (cat.includes('COMMERCIAL')) return 'agenctcommercial_contacts';
    if (cat.includes('PUBLICIST')) return 'publicist_contacts';
    if (cat.includes('LEGAL')) return 'legal_contacts';
    if (cat.includes('PERSONAL APPEARANCE')) return 'appearance_contacts';
    return null;
}

function parseCookies(cookieStr, domain) {
    return cookieStr.split(';').map(c => {
        const [name, ...rest] = c.trim().split('=');
        if (!name || rest.length === 0) return null;
        return { name: name.trim(), value: rest.join('=').trim(), domain, path: '/' };
    }).filter(c => c !== null);
}

async function getAirtableRecords() {
    let records = [];
    let offset = null;
    console.log('📡 Fetching records from Airtable...');
    try {
        do {
            const res = await axios.get(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
                headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
                params: { view: VIEW_ID, fields: ['Soc IMDb Id', 'all_contacts', 'check_contacts'], offset }
            });
            records = records.concat(res.data.records);
            offset = res.data.offset;
        } while (offset);
        
        // Only process records where check_contacts (Date field) is empty
        const toScrape = records.filter(r => r.fields['Soc IMDb Id'] && !r.fields['check_contacts']);
        console.log(`✅ Total records in view: ${records.length}. Remaining to check: ${toScrape.length}`);
        return toScrape;
    } catch (e) {
        console.error('🔴 Airtable Fetch Error:', e.message);
        return [];
    }
}

async function updateAirtable(recordId, fields) {
    try {
        await axios.patch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${recordId}`, { fields }, {
            headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' }
        });
        console.log(`   ✅ Airtable updated for record ${recordId}`);
    } catch (e) {
        console.error(`   ❌ Failed to update Airtable: ${e.response?.data?.error?.message || e.message}`);
    }
}

async function scrapeProfile(browser, nmId) {
    const page = await browser.newPage();
    try {
        await page.setUserAgent(REAL_USER_AGENT);
        const cookies = parseCookies(COOKIE_STRING, '.imdb.com');
        await page.setCookie(...cookies);

        const url = `https://pro.imdb.com/name/${nmId}/`;
        console.log(`\n🔍 Scraping Detail: ${nmId}`);
        
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } catch (navigateErr) {
            console.error(`   ⚠️ Navigation timeout for ${nmId}. Skipping...`);
            return null;
        }

        const pageTitle = await page.title();
        if (pageTitle.includes('Log In') || pageTitle.includes('Sign in')) {
            throw new Error('AUTH_EXPIRED');
        }

        await page.waitForSelector('[data-testid="contacts-section"]', { timeout: 10000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));

        const data = await page.evaluate(() => {
            const section = document.querySelector('[data-testid="contacts-section"]');
            if (!section) return null;

            const results = {};
            const cards = section.querySelectorAll('[data-testid*="-card"]');
            
            cards.forEach(card => {
                const titleEl = card.querySelector('.ipc-accordion__item__title, .ipc-title__text');
                const groupName = titleEl ? titleEl.innerText.trim().toUpperCase() : "OTHER";
                
                const items = [];
                const listItems = card.querySelectorAll('li[role="menuitem"], a[role="menuitem"], .ipc-list__item');
                
                listItems.forEach(item => {
                    const cloned = item.cloneNode(true);
                    cloned.querySelectorAll('button, svg').forEach(el => el.remove());
                    
                    let text = cloned.innerText.trim().replace(/\s+/g, ' ');
                    if (!text || text === 'Edit' || text.includes('Representative')) return;

                    const linkEl = item.tagName === 'A' ? item : item.querySelector('a');
                    const href = linkEl ? linkEl.href : null;

                    const testId = item.getAttribute('data-testid') || "";
                    let type = 'Other';
                    if (testId.includes('email')) type = 'Email';
                    else if (testId.includes('phone')) type = 'Phone';
                    else if (testId.includes('address')) type = 'Address';
                    else if (testId.includes('website')) type = 'Website';
                    else if (testId.includes('agent-name')) type = 'Agent';
                    
                    items.push({ type, text, href });
                });

                if (items.length > 0) {
                    results[groupName] = (results[groupName] || []).concat(items);
                }
            });
            return results;
        });

        return data;
    } catch (e) {
        console.error(`   ❌ Error scraping ${nmId}: ${e.message}`);
        return null;
    } finally {
        await page.close();
    }
}

async function run() {
    const toScrape = await getAirtableRecords();
    if (toScrape.length === 0) {
        console.log('✅ No records need scraping.');
        return;
    }

    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const currentDate = new Date().toISOString().split('T')[0];

    try {
        for (let i = 0; i < toScrape.length; i++) {
            const record = toScrape[i];
            let nmId = record.fields['Soc IMDb Id'];
            if (nmId.includes('imdb.com')) {
                const m = nmId.match(/nm\d+/);
                if (m) nmId = m[0];
            }
            nmId = nmId.replace(/\//g, '').trim();

            console.log(`[${i + 1}/${toScrape.length}] Processing ${nmId}...`);

            const contacts = await scrapeProfile(browser, nmId);
            
            const fieldsToUpdate = {
                check_contacts: currentDate
            };

            if (contacts && Object.keys(contacts).length > 0) {
                fieldsToUpdate.all_contacts = JSON.stringify(contacts, null, 2);

                for (const [imdbGroupName, items] of Object.entries(contacts)) {
                    const colName = getColumnName(imdbGroupName);
                    if (colName) {
                        const summary = items.map(item => {
                            return item.href ? `${item.text} (${item.href})` : item.text;
                        }).join('\n');
                        
                        fieldsToUpdate[colName] = (fieldsToUpdate[colName] || '') + (fieldsToUpdate[colName] ? '\n---\n' : '') + summary;
                    }
                }
            } else {
                console.log(`   ⚠️  No contacts extracted for ${nmId}`);
                fieldsToUpdate.all_contacts = 'NO_CONTACTS_FOUND';
            }

            await updateAirtable(record.id, fieldsToUpdate);

            // Random delay to avoid detection
            const delay = Math.floor(Math.random() * 4000) + 3000;
            await new Promise(r => setTimeout(r, delay));
        }
    } catch (err) {
        if (err.message === 'AUTH_EXPIRED') {
            console.error('🔴 Session expired. Please update IMDBPRO_COOKIE.');
        } else {
            console.error('💥 Unexpected Global Error:', err.message);
        }
    } finally {
        await browser.close();
        console.log('🏁 Process finished.');
    }
}

run();
