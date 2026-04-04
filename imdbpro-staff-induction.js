require('dotenv').config();
const { fetchCompanyStaff, closeBrowser, sleep, getRandomDelay } = require('./scraper-staff');
const { supabase } = require('./db');

const LIMIT = 50; // Companies per batch

async function processCompany(company) {
    console.log(`\n🏢 ${company.name} (${company.soc_imdb_id})`);

    try {
        const staff = await fetchCompanyStaff(
            company.soc_imdb_id,
            company.name,
            company.logo || null,
            company.id
        );

        if (!staff || staff.length === 0) {
            console.log(`   🤷 No staff found.`);
            // Still mark as checked so we don't retry indefinitely
            await supabase.from('hb_companies').update({
                check_imdbp_staff: new Date().toISOString()
            }).eq('id', company.id);
            return true;
        }

        console.log(`   👥 ${staff.length} staff members found. Upserting...`);

        let upserted = 0;
        let skipped = 0;

        for (const person of staff) {
            if (!person.soc_imdb_id) { skipped++; continue; }

            const payload = {
                name_full: person.name_full,
                first_name: person.first_name,
                last_name: person.last_name,
                role: person.role,
                location: person.location,
                company_name: person.company_name,
                company_logo: person.company_logo,
                linked_company: person.linked_company,
                soc_imdb: person.soc_imdb,
                soc_imdb_id: person.soc_imdb_id,
                image_profile: person.image_profile,
                imdb_rank: person.imdb_rank,
                updated_at: new Date().toISOString()
            };

            const { error } = await supabase
                .from('hb_contacts')
                .upsert(payload, { onConflict: 'soc_imdb_id' });

            if (error) {
                console.error(`   ❌ Error upserting ${person.name_full}: ${error.message}`);
                skipped++;
            } else {
                upserted++;
            }
        }

        console.log(`   ✅ Upserted: ${upserted} | Skipped: ${skipped}`);

        // Mark this company as staff-checked
        await supabase.from('hb_companies').update({
            check_imdbp_staff: new Date().toISOString()
        }).eq('id', company.id);

        return true;
    } catch (e) {
        console.error(`   ❌ ${e.message}`);
        return false;
    }
}

async function main() {
    try {
        // Target companies that have an IMDB ID and haven't been staff-checked yet
        const { data: companies } = await supabase
            .from('hb_companies')
            .select('id, name, soc_imdb_id, logo')
            .not('soc_imdb_id', 'is', null)
            .is('check_imdbp_staff', null)
            .limit(LIMIT);

        if (!companies?.length) return console.log('✅ All companies staff-checked.');
        console.log(`📋 ${companies.length} companies queued for staff extraction\n`);

        for (const company of companies) {
            await processCompany(company);
            await sleep(getRandomDelay(3000, 6000));
        }
    } finally {
        await closeBrowser();
    }
}

main();
