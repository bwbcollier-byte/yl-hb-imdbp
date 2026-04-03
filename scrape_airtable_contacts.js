const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
// Load environment variables from both the root env and the local env
require('dotenv').config({ path: '../.env' });
require('dotenv').config({ path: './.env' });

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = 'appYIBrymzdLczP69';
const AIRTABLE_TABLE_ID = 'tblCtdS0OePR21CCj';
const AIRTABLE_VIEW = 'viw2PDZIm6bQ2JvVv';

let IMDBPRO_COOKIE = process.env.IMDBPRO_COOKIE || "";
let IMDBPRO_USER_AGENT = process.env.IMDBPRO_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

if (IMDBPRO_COOKIE.startsWith('"') && IMDBPRO_COOKIE.endsWith('"')) IMDBPRO_COOKIE = IMDBPRO_COOKIE.slice(1, -1);
if (IMDBPRO_USER_AGENT.startsWith('"') && IMDBPRO_USER_AGENT.endsWith('"')) IMDBPRO_USER_AGENT = IMDBPRO_USER_AGENT.slice(1, -1);

if (!AIRTABLE_API_KEY) {
  console.error('🔴 Missing AIRTABLE_API_KEY in ../.env');
  process.exit(1);
}
if (!IMDBPRO_COOKIE) {
  console.error('🔴 Missing IMDBPRO_COOKIE in .env');
  process.exit(1);
}

const headers = {
    'User-Agent': IMDBPRO_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'max-age=0',
    'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"macOS"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cookie': IMDBPRO_COOKIE
};

async function getAirtableRecords() {
    let records = [];
    let offset = null;
    console.log('Fetching records from Airtable...');
    
    do {
         const response = await axios.get(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`, {
             headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
             params: {
                 view: AIRTABLE_VIEW,
                 fields: ['Soc IMDb Id'],
                 offset: offset
             }
         });
         const data = response.data;
         records = records.concat(data.records);
         offset = data.offset;
    } while (offset);
    
    return records.filter(r => r.fields['Soc IMDb Id']);
}

function parseContactHTML(html) {
    const $ = cheerio.load(html);
    const contactSection = $('[data-testid="contacts-section"]');
    if (!contactSection.length) {
        return null; // No contact section found
    }

    const contacts = {};

    contactSection.find('.ipc-list-card').each((_, card) => {
        const groupTitle = $(card).find('.ipc-accordion__item__title').text().trim();
        if (!groupTitle) return;

        const items = [];
        $(card).find('.ipc-list__item, a.ipc-list__item').each((_, item) => {
            // Remove icon buttons (e.g. "Copy section to clipboard", "i" info buttons)
            // Need to clone the element so we don't destroy DOM for other passes if any
            const cloned = $(item).clone();
            cloned.find('.ipc-icon-button').remove();
            
            // Text extraction
            let text = cloned.find('.ipc-list-item__text').text().replace(/\s+/g, ' ').trim();
            if (!text) text = cloned.text().replace(/\s+/g, ' ').trim();
            
            // Clean up appended labels
            text = text.replace(/Fax/g, ' (Fax)').trim();
            
            if (!text || text === 'Representative' || text.startsWith('Representatives (')) return;

            let type = 'Other';
            if (cloned.find('.ipc-icon--email').length) type = 'Email';
            else if (cloned.find('.ipc-icon--phone').length) type = 'Phone';
            else if (cloned.find('.ipc-icon--place').length) type = 'Address';
            else if (cloned.find('.ipc-icon--globe').length) type = 'Website';
            else if (cloned.find('.ipc-icon--person').length) type = 'Person';
            else if (cloned.find('.ipc-icon--fax').length) type = 'Fax';
            
            items.push({ type, value: text });
        });
        
        contacts[groupTitle] = items;
    });

    return contacts;
}

async function scrapeProfile(recordId, imdbId) {
    console.log(`\n⏳ Scraping ${imdbId} ...`);
    try {
        const url = `https://pro.imdb.com/name/${imdbId}/`;
        
        // Ensure cookie string doesn't have literal quotes wrapped around it
        let cleanedCookie = IMDBPRO_COOKIE;
        if (cleanedCookie.startsWith('"') && cleanedCookie.endsWith('"')) {
            cleanedCookie = cleanedCookie.slice(1, -1);
        }

        const res = await axios.get(url, { 
            headers: {
                ...headers,
                'Cookie': cleanedCookie
            },
            validateStatus: () => true // Catch all statuses
        });
        
        console.log(`   Status: ${res.status}`);
        console.log(`   Length: ${res.data ? res.data.length : 0} bytes`);

        const html = res.data;
        if (!html || html.length < 500) {
            console.error('🔴 Empty or too short response. We might be blocked.');
            fs.writeFileSync(`./debug_blocked_${imdbId}.html`, html || "");
            return null;
        }

        const $ = cheerio.load(html);
        const title = $('title').text();
        const bodyText = $('body').text();

        if (title.includes('Log In') || bodyText.includes('Join IMDbPro') || bodyText.includes('Sign in')) {
            console.error('🔴 Authentication error. Your IMDbPro cookie is likely expired.');
            fs.writeFileSync(`./debug_auth_needed_${imdbId}.html`, html);
            process.exit(1);
        }

        const contacts = parseContactHTML(html);
        if (contacts && Object.keys(contacts).length > 0) {
            console.log('✅ Found contacts!');
            return contacts;
        } else {
            console.log('⚠️ No contacts section found.');
            return {};
        }

    } catch (e) {
        console.error(`🔴 Error scraping ${imdbId}:`, e.message);
        return null;
    }
}

async function main() {
   const testProfiles = [
       { id: 'custom_test', fields: { 'Soc IMDb Id': 'nm2858875' } }
   ];
   const records = await getAirtableRecords();
   console.log(`Found ${records.length} records in Airtable.`);
   
   const allToProcess = [...testProfiles, ...records];
   const results = [];
   const limit = 2; // Keep it small for debugging

   for (let i = 0; i < Math.min(allToProcess.length, limit); i++) {
        const record = allToProcess[i];
        let imdbId = record.fields['Soc IMDb Id'];
        
        if (imdbId.includes('imdb.com')) {
             const match = imdbId.match(/nm\d+/);
             if (match) imdbId = match[0];
        } else if (imdbId.includes('/')) {
             imdbId = imdbId.replace(/\//g, '');
        }

        const contactData = await scrapeProfile(record.id, imdbId);
        
        results.push({
             _airtableId: record.id,
             imdbId: imdbId,
             contacts: contactData
        });
        
        if (i < limit - 1) await new Promise(r => setTimeout(r, 3000));
   }
   
   fs.writeFileSync('./contacts_output.json', JSON.stringify(results, null, 2));
   console.log(`\n💾 Saved results to contacts_output.json`);
}

// Update parseContactHTML with more robust selectors from user's snippet
function parseContactHTML(html) {
    const $ = cheerio.load(html);
    const contactSection = $('[data-testid="contacts-section"]');

    // Save for debug if section is missing but title seems plausible
    if (!contactSection.length) {
        fs.writeFileSync('./debug_no_contacts.html', html);
        return null;
    }

    const contacts = {};

    contactSection.find('.ipc-list-card, [data-testid*="-card"]').each((_, card) => {
        let groupTitle = $(card).find('.ipc-accordion__item__title, .ipc-title__text').first().text().trim();
        if (!groupTitle) {
            // Fallback: look for previous header if Title matches "Contacts"
            groupTitle = "Unknown Group";
        }

        const items = [];
        $(card).find('li[role="menuitem"], a[role="menuitem"]').each((_, item) => {
            const cloned = $(item).clone();
            cloned.find('.ipc-icon-button, button').remove();
            
            let text = cloned.find('.ipc-list-item__text').text().trim();
            if (!text) text = cloned.text().trim();
            
            // Clean multi-whitespace
            text = text.replace(/\s+/g, ' ');

            if (!text || text === 'Representative' || text.startsWith('Representatives (')) return;

            // Type detection based on data-testid or icons
            const testId = $(item).attr('data-testid') || "";
            let type = 'Other';
            if (testId.includes('email') || cloned.find('.ipc-icon--email').length) type = 'Email';
            else if (testId.includes('phone') || cloned.find('.ipc-icon--phone').length) type = 'Phone';
            else if (testId.includes('address') || cloned.find('.ipc-icon--place').length) type = 'Address';
            else if (testId.includes('website') || cloned.find('.ipc-icon--globe').length) type = 'Website';
            else if (testId.includes('agent-name') || cloned.find('.ipc-icon--person').length) type = 'Person';
            else if (testId.includes('fax') || cloned.find('.ipc-icon--fax').length) type = 'Fax';
            
            items.push({ type, value: text });
        });
        
        if (items.length > 0) {
            contacts[groupTitle] = (contacts[groupTitle] || []).concat(items);
        }
    });

    return contacts;
}

main();
