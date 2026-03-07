/**
 * CRM Enrichment Pipeline for IMDbPro
 * Pulls incomplete companies and contacts from Supabase and scrapes their specific pages.
 */
require('dotenv').config();
const { fetchPageProps, sleep } = require('./scraper');
const { mapCompanyProfile, mapContactProfile } = require('./mapper');
const { supabase } = require('./db');

async function enrichCompanies() {
    console.log('🏢 Starting CRM Company Enrichment...');

    // Get companies that have not been enriched today and need it (e.g., missing address/phone/logo)
    // For simplicity, we limit to 50 least recently updated companies
    const { data: companies, error } = await supabase
        .from('crm_companies')
        .select('*')
        .not('id_imdb', 'is', null)
        .order('updated_at', { ascending: true })
        .limit(50);

    if (error) {
        console.error('❌ Error fetching companies from DB:', error.message);
        return;
    }

    if (!companies || companies.length === 0) {
        console.log('✅ No companies to enrich.');
        return;
    }

    console.log(`📋 Found ${companies.length} companies to enrich.`);

    for (let i = 0; i < companies.length; i++) {
        const comp = companies[i];
        const url = `https://pro.imdb.com/company/${comp.id_imdb}/`;
        console.log(`\n[${i + 1}/${companies.length}] 🔍 Enriching Company: ${comp.id_imdb} -> ${url}`);

        try {
            const pageProps = await fetchPageProps(url);
            
            if (!pageProps || !pageProps.data || !pageProps.data.company) {
                console.log(`   ⚠️  No company data found on page for ${comp.id_imdb}`);
                await sleep(5000);
                continue;
            }

            const rawCompanyData = pageProps.data.company;
            const mappedCompany = mapCompanyProfile(rawCompanyData, comp.id_imdb);

            if (mappedCompany) {
                const { data, error: updateError } = await supabase
                    .from('crm_companies')
                    .update(mappedCompany)
                    .eq('id_imdb', comp.id_imdb)
                    .select()
                    .single();

                if (updateError) {
                    console.error(`   ❌ DB Update Error for company ${comp.id_imdb}:`, updateError.message);
                } else {
                    console.log(`   ✅ Company Enriched: ${mappedCompany.company_name} (${data.id})`);
                }
            }
        } catch (e) {
            console.error(`   ❌ Scraping Error for ${comp.id_imdb}:`, e.message);
        }

        // Delay between 5 and 10 seconds
        const delay = Math.floor(Math.random() * 5000) + 5000;
        console.log(`   ⏳ Sleeping ${Math.round(delay/1000)}s...`);
        await sleep(delay);
    }
}

async function enrichContacts() {
    console.log('\n👤 Starting CRM Contact Enrichment...');

    // Similar logic for contacts missing detail data
    const { data: contacts, error } = await supabase
        .from('crm_contacts')
        .select('*')
        .not('id_imdb', 'is', null)
        .order('updated_at', { ascending: true })
        .limit(50);

    if (error) {
        console.error('❌ Error fetching contacts from DB:', error.message);
        return;
    }

    if (!contacts || contacts.length === 0) {
        console.log('✅ No contacts to enrich.');
        return;
    }

    console.log(`📋 Found ${contacts.length} contacts to enrich.`);

    for (let i = 0; i < contacts.length; i++) {
        const row = contacts[i];
        const url = `https://pro.imdb.com/name/${row.id_imdb}/`;
        console.log(`\n[${i + 1}/${contacts.length}] 🔍 Enriching Contact: ${row.id_imdb} -> ${url}`);

        try {
            const pageProps = await fetchPageProps(url);
            
            if (!pageProps || !pageProps.aboveTheFold) {
                console.log(`   ⚠️  No aboveTheFold data found for ${row.id_imdb}`);
                await sleep(5000);
                continue;
            }

            // `aboveTheFold` and `mainColumnData` exist for agents too
            const node = {
                ...pageProps.aboveTheFold,
                ...pageProps.mainColumnData
            };

            const mappedContact = mapContactProfile(node, row.id_imdb, row.company_name);

            if (mappedContact) {
                const { data, error: updateError } = await supabase
                    .from('crm_contacts')
                    .update(mappedContact)
                    .eq('id_imdb', row.id_imdb)
                    .select()
                    .single();

                if (updateError) {
                    console.error(`   ❌ DB Update Error for contact ${row.id_imdb}:`, updateError.message);
                } else {
                    console.log(`   ✅ Contact Enriched: ${mappedContact.name_full} (${data.id})`);
                }
            }

        } catch (e) {
            console.error(`   ❌ Scraping Error for ${row.id_imdb}:`, e.message);
        }

        const delay = Math.floor(Math.random() * 5000) + 5000;
        console.log(`   ⏳ Sleeping ${Math.round(delay/1000)}s...`);
        await sleep(delay);
    }
}

(async () => {
    try {
        await enrichCompanies();
        await enrichContacts();
        console.log('\n🎉 CRM Enrichment complete!');
        process.exit(0);
    } catch (e) {
        console.error('\n💥 Critical Error in CRM Enrichment pipeline:', e.message);
        process.exit(1);
    }
})();
