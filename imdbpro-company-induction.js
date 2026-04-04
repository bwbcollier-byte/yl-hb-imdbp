require('dotenv').config();
const { fetchCompanyProps, closeBrowser, sleep, getRandomDelay } = require('./scraper-company');
const { supabase } = require('./db');

const LIMIT = 100;

async function processCompany(company) {
    const url = "https://pro.imdb.com/company/" + company.soc_imdb_id + "/";
    console.log(`\n🏢 ${company.name} (${company.soc_imdb_id})`);
    
    try {
        const enrichedData = await fetchCompanyProps(url);
        
        if (!enrichedData || Object.keys(enrichedData).length === 0) {
            console.log("   🤷 No extra data found.");
            return true;
        }

        let updatePayload = {
            updated_at: new Date().toISOString(),
            check_imdbp: new Date().toISOString()
        };

        if (enrichedData.url) {
            updatePayload.soc_website = enrichedData.url;
            console.log(`   🌐 Website: ${enrichedData.url}`);
        }
        if (enrichedData.location) {
            updatePayload.location = enrichedData.location;
            console.log(`   📍 Location: ${enrichedData.location}`);
        }
        if (enrichedData.meterRank) {
            updatePayload.imdb_rank = enrichedData.meterRank;
            console.log(`   📈 Rank: ${enrichedData.meterRank}`);
        }
        if (enrichedData.logoUrl && !company.logo) {
            // We only set logo if the DB doesn't already have one
            updatePayload.logo = enrichedData.logoUrl;
            console.log(`   🖼️  Logo found`);
        }
        if (enrichedData.description) {
            updatePayload.description = enrichedData.description;
            console.log(`   📝 Description (About) retrieved`);
        }
        if (enrichedData.phone) {
            updatePayload.phone = enrichedData.phone;
            console.log(`   📞 Phone: ${enrichedData.phone}`);
        }
        if (enrichedData.locations_other) {
            updatePayload.locations_other = enrichedData.locations_other;
        }
        if (enrichedData.country) {
            updatePayload.country = enrichedData.country;
            console.log(`   🌎 Country: ${enrichedData.country}`);
        }

        // Always update so we don't infinitely retry the same records
        await supabase.from('hb_companies').update(updatePayload).eq('id', company.id);
        
        console.log(`   ✅ Enriched.`);
        return true;
    } catch (e) { 
        console.error("   ❌ " + e.message); 
        return false; 
    }
}

async function main() {
    try {
        // Find companies that have an IMDB ID but haven't been fully enriched yet (e.g. missing website or location)
        // We'll use a crude 'where location is null' or 'soc_website is null' 
        const { data: companies } = await supabase
            .from('hb_companies')
            .select('id, name, soc_imdb_id, logo')
            .not('soc_imdb_id', 'is', null)
            .is('check_imdbp', null) // Target companies that haven't been newly scanned
            .limit(LIMIT);

        if (!companies?.length) return console.log('✅ Done.');
        console.log(`📋 ${companies.length} targets queued`);
        
        for (const company of companies) { 
            await processCompany(company); 
            await sleep(getRandomDelay(2000, 4000)); 
        }
    } finally { 
        await closeBrowser(); 
    }
}

main();
