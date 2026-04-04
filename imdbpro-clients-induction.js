require('dotenv').config();
const { fetchCompanyClients, closeBrowser, sleep, getRandomDelay } = require('./scraper-clients');
const { supabase } = require('./db');

const LIMIT = 20; // Companies per batch (fewer because clients are heavy)

/**
 * Find or create a talent record from an IMDbPro client node.
 * Uses hb_socials IMDB identifier to check for existing talent.
 * Returns the talent UUID.
 */
async function findOrCreateTalent(client) {
    if (!client.soc_imdb_id) return null;

    // 1. Check if we already have an IMDB social profile for this nmId
    const { data: existingSocial } = await supabase
        .from('hb_socials')
        .select('id, linked_talent')
        .eq('type', 'IMDB')
        .eq('identifier', client.soc_imdb_id)
        .limit(1)
        .maybeSingle();

    if (existingSocial && existingSocial.linked_talent) {
        return existingSocial.linked_talent;
    }

    // 2. Create the talent record
    const talentPayload = {
        name: client.name,
        image: client.image || null,
        status: 'Active',
        category: 'Film & TV'
    };

    const { data: talent, error: talentErr } = await supabase
        .from('hb_talent')
        .insert(talentPayload)
        .select('id')
        .single();

    if (talentErr) {
        console.log(`      ⚠️ Talent insert error (${client.name}): ${talentErr.message}`);
        return null;
    }

    // 3. Create the IMDB social profile and link it
    const socialPayload = {
        type: 'IMDB',
        identifier: client.soc_imdb_id,
        name: client.name,
        social_url: `https://imdb.com/name/${client.soc_imdb_id}`,
        rank: client.imdb_rank || null,
        image: client.image || null,
        linked_talent: talent.id
    };

    const { data: social, error: socialErr } = await supabase
        .from('hb_socials')
        .insert(socialPayload)
        .select('id')
        .single();

    if (socialErr) {
        console.log(`      ⚠️ Social insert error (${client.name}): ${socialErr.message}`);
    } else {
        // Link the social profile UUID back to hb_talent.soc_imdb
        await supabase.from('hb_talent').update({ soc_imdb: social.id }).eq('id', talent.id);
    }

    return talent.id;
}

/**
 * Process a single company's client roster.
 */
async function processCompany(company) {
    console.log(`\n🏢 ${company.name} (${company.soc_imdb_id})`);

    try {
        const clients = await fetchCompanyClients(company.soc_imdb_id);

        if (!clients || clients.length === 0) {
            console.log(`   🤷 No clients found.`);
            await supabase.from('hb_companies').update({
                check_imdbp_clients: new Date().toISOString()
            }).eq('id', company.id);
            return true;
        }

        console.log(`   🎬 ${clients.length} clients found. Processing...`);

        let created = 0;
        let existing = 0;
        let linked = 0;

        for (const client of clients) {
            if (!client.soc_imdb_id) continue;

            // Find or create the talent
            const { data: existingCheck } = await supabase
                .from('hb_socials')
                .select('linked_talent')
                .eq('type', 'IMDB')
                .eq('identifier', client.soc_imdb_id)
                .limit(1)
                .maybeSingle();

            let talentId;
            if (existingCheck && existingCheck.linked_talent) {
                talentId = existingCheck.linked_talent;
                existing++;
            } else {
                talentId = await findOrCreateTalent(client);
                if (talentId) created++;
            }

            if (!talentId) continue;

            // Link agent contacts from this client node to the talent
            if (client.agents && client.agents.length > 0) {
                // Look up agent contact IDs from hb_contacts by soc_imdb_id
                let agentContactIds = [];
                for (const agent of client.agents) {
                    if (!agent.nmId) continue;
                    const { data: contact } = await supabase
                        .from('hb_contacts')
                        .select('id')
                        .eq('soc_imdb_id', agent.nmId)
                        .limit(1)
                        .maybeSingle();
                    if (contact) agentContactIds.push(contact.id);
                }

                // Update talent with this company link + agent contacts
                let updatePayload = { updated_at: new Date().toISOString() };

                // Add the company to agenct_companies array
                const { data: currentTalent } = await supabase
                    .from('hb_talent')
                    .select('agenct_companies, agenct_contacts, companies_all, contacts_all')
                    .eq('id', talentId)
                    .single();

                if (currentTalent) {
                    let existingCompanies = currentTalent.agenct_companies || [];
                    let existingContacts = currentTalent.agenct_contacts || [];
                    let allCompanies = currentTalent.companies_all || [];
                    let allContacts = currentTalent.contacts_all || [];

                    if (!existingCompanies.includes(company.id)) {
                        existingCompanies.push(company.id);
                        updatePayload.agenct_companies = existingCompanies;
                    }
                    if (!allCompanies.includes(company.id)) {
                        allCompanies.push(company.id);
                        updatePayload.companies_all = allCompanies;
                    }

                    if (agentContactIds.length > 0) {
                        let merged = [...new Set([...existingContacts, ...agentContactIds])];
                        updatePayload.agenct_contacts = merged;
                        let mergedAll = [...new Set([...allContacts, ...agentContactIds])];
                        updatePayload.contacts_all = mergedAll;
                    }

                    await supabase.from('hb_talent').update(updatePayload).eq('id', talentId);
                    linked++;
                }
            }
        }

        console.log(`   ✅ Created: ${created} | Existing: ${existing} | Linked: ${linked}`);

        // Mark company as clients-checked
        await supabase.from('hb_companies').update({
            check_imdbp_clients: new Date().toISOString()
        }).eq('id', company.id);

        return true;
    } catch (e) {
        console.error(`   ❌ ${e.message}`);
        return false;
    }
}

async function main() {
    try {
        const { data: companies } = await supabase
            .from('hb_companies')
            .select('id, name, soc_imdb_id')
            .not('soc_imdb_id', 'is', null)
            .is('check_imdbp_clients', null)
            .limit(LIMIT);

        if (!companies?.length) return console.log('✅ All companies client-checked.');
        console.log(`📋 ${companies.length} companies queued for client roster extraction\n`);

        for (const company of companies) {
            await processCompany(company);
            await sleep(getRandomDelay(3000, 6000));
        }
    } finally {
        await closeBrowser();
    }
}

main();
