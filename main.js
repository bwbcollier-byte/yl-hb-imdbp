/**
 * main.js — IMDbPro Scraper Pipeline
 *
 * Usage:
 *   1. Copy .env.example → .env and fill in your session cookies + Supabase creds
 *   2. Add URLs to the `URLS` array below
 *   3. Run:  node main.js
 *
 * Supported types:
 *   'talent'  → scrapes /name/nmXXX/ → upserts into talent_profiles
 *   'company' → scrapes /company/coXXX/ → upserts into crm_companies
 *                (also bulk-extracts embedded staff → crm_contacts)
 *   'contact' → scrapes /name/nmXXX/ for an agent → upserts into crm_contacts
 */

const { fetchPageProps, sleep, getRandomDelay } = require('./scraper');
const {
    mapTalentProfile,
    mapCompanyProfile,
    mapContactProfile,
    extractContactsFromCompany
} = require('./mapper');
const { upsertData } = require('./db');
const { updateWorkflowHeartbeat } = require('./airtable-heartbeat');
require('dotenv').config();

// ─── URL Queue ──────────────────────────────────────────────────────
// If URLS_JSON is provided as an environment variable, use it.
// Otherwise, fall back to the hardcoded list below.
let URLS = [];
try {
    if (process.env.URLS_JSON) {
        URLS = JSON.parse(process.env.URLS_JSON);
    }
} catch (e) {
    console.error('❌ Failed to parse URLS_JSON environment variable:', e.message);
}

// Hardcoded fallback URLs (only used if URLS_JSON is missing or empty)
if (URLS.length === 0) {
    URLS = [
        // { url: 'https://pro.imdb.com/name/nm0000138/', type: 'talent' },
        // { url: 'https://pro.imdb.com/company/co0002521/', type: 'company' },
    ];
}

// ─── Utility ────────────────────────────────────────────────────────
/** Extract the IMDb ID (nm..., co...) from a URL */
function extractIdFromUrl(url) {
    const match = url.match(/(nm\d+|co\d+)/);
    return match ? match[1] : null;
}

// ─── Pipeline ───────────────────────────────────────────────────────
async function processTalent(pageProps, imdbId) {
    const mapped = mapTalentProfile(pageProps);
    if (!mapped?.imdb_id) {
        console.log('   ⚠️  Could not extract imdb_id from talent page.');
        return;
    }
    const result = await upsertData('talent_profiles', mapped, 'imdb_id');
    if (result) {
        console.log(`   ✅ Talent upserted: ${mapped.name} (${mapped.imdb_id})`);
        if (mapped.com_talent_agent) console.log(`      Agent: ${mapped.com_talent_agent}`);
        if (mapped.com_management)   console.log(`      Mgmt:  ${mapped.com_management}`);
    }
}

async function processCompany(pageProps, imdbId) {
    const mapped = mapCompanyProfile(pageProps, imdbId);
    if (!mapped?.id_imdb) {
        console.log('   ⚠️  Could not extract id_imdb from company page.');
        return;
    }
    const result = await upsertData('crm_companies', mapped, 'id_imdb');
    if (result) {
        console.log(`   ✅ Company upserted: ${mapped.company_name} (${mapped.id_imdb})`);
    }

    // Also extract any embedded staff contacts
    const contacts = extractContactsFromCompany(pageProps);
    if (contacts.length > 0) {
        console.log(`   📇 Found ${contacts.length} embedded contacts — upserting to crm_contacts...`);
        for (const contact of contacts) {
            const cResult = await upsertData('crm_contacts', contact, 'id_imdb');
            if (cResult) {
                console.log(`      ✅ Contact: ${contact.name_full} (${contact.role || 'n/a'})`);
            }
        }
    }
}

async function processContact(pageProps, imdbId, companyName) {
    const mapped = mapContactProfile(pageProps, imdbId, companyName);
    if (!mapped?.id_imdb) {
        console.log('   ⚠️  Could not extract id_imdb from contact page.');
        return;
    }
    const result = await upsertData('crm_contacts', mapped, 'id_imdb');
    if (result) {
        console.log(`   ✅ Contact upserted: ${mapped.name_full} @ ${mapped.company_name || '(no company)'}`);
    }
}

// ─── Main Loop ──────────────────────────────────────────────────────
async function main() {
    if (URLS.length === 0) {
        console.log('⚠️  No URLs in queue. Add entries to the URLS array in main.js.');
        console.log('   Example:');
        console.log("   { url: 'https://pro.imdb.com/name/nm0000138/', type: 'talent' }");
        return;
    }

    console.log(`\n🚀 IMDbPro Scraper — ${URLS.length} URL(s) queued`);
    console.log('─'.repeat(60));
    await updateWorkflowHeartbeat('Running', `Queue initialized with ${URLS.length} URLs.`);

    let successCount = 0;
    let failCount    = 0;

    for (let i = 0; i < URLS.length; i++) {
        const { url, type, companyName } = URLS[i];
        const imdbId = extractIdFromUrl(url);

        console.log(`\n[${i + 1}/${URLS.length}] ${type.toUpperCase()} → ${url}`);

        try {
            const pageProps = await fetchPageProps(url);

            switch (type) {
                case 'talent':
                    await processTalent(pageProps, imdbId);
                    break;
                case 'company':
                    await processCompany(pageProps, imdbId);
                    break;
                case 'contact':
                    await processContact(pageProps, imdbId, companyName);
                    break;
                default:
                    console.log(`   ❓ Unknown type "${type}" — skipping.`);
            }

            successCount++;
            await updateWorkflowHeartbeat('Running', `Processing Queue: ${successCount} Success / ${failCount} Errors.`);
        } catch (err) {
            failCount++;
            console.error(`   ❌ Error: ${err.message}`);
            await updateWorkflowHeartbeat('Running', `Processing Queue: ${successCount} Success / ${failCount} Errors.`);
        }

        // Rate limit: random 8–15 second delay between requests
        if (i < URLS.length - 1) {
            const delay = getRandomDelay(8000, 15000);
            console.log(`   ⏳ Waiting ${(delay / 1000).toFixed(1)}s...`);
            await sleep(delay);
        }
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`🏁 Done!  Success: ${successCount}  |  Failed: ${failCount}  |  Total: ${URLS.length}`);
    await updateWorkflowHeartbeat('Ready', `Success: ${successCount}  |  Errors: ${failCount}`);
}

// ─── Entry ──────────────────────────────────────────────────────────
if (require.main === module) {
    main().catch(err => {
        console.error('💥 Fatal error:', err);
        process.exit(1);
    });
}

module.exports = { main };
