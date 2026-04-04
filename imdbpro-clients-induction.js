require('dotenv').config();
const { fetchCompanyClients, closeBrowser, sleep, getRandomDelay } = require('./scraper-clients');
const { supabase } = require('./db');

const LIMIT = 20; // Companies per batch
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_SLEEP_MS = 300; // TMDB rate limit: ~40 req/10s

// In-memory cache: nmId -> talentId. Prevents duplicate creation when the same
// person appears as a client at multiple companies within the same batch run.
const talentCache = new Map();

/**
 * Look up a person on TMDB using their IMDB nmId.
 * Returns full person data including biography, birthday, gender, place_of_birth, etc.
 */
async function fetchTmdbByImdbId(imdbId) {
    if (!TMDB_API_KEY) return null;
    try {
        // Step 1: Find the TMDB person ID from the IMDB nmId
        const findRes = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
        if (!findRes.ok) return null;
        const findData = await findRes.json();

        if (!findData.person_results || findData.person_results.length === 0) return null;
        const tmdbId = findData.person_results[0].id;

        // Step 2: Get the full person details
        const personRes = await fetch(`https://api.themoviedb.org/3/person/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`);
        if (!personRes.ok) return null;
        const person = await personRes.json();

        return {
            tmdb_id: String(tmdbId),
            name: person.name,
            biography: person.biography || null,
            birthday: person.birthday || null,
            deathday: person.deathday || null,
            gender: person.gender, // 1=Female, 2=Male, 3=Non-binary
            place_of_birth: person.place_of_birth || null,
            popularity: person.popularity || null,
            profile_path: person.profile_path ? `https://image.tmdb.org/t/p/original${person.profile_path}` : null,
            known_for_department: person.known_for_department || null,
            imdb_id: person.imdb_id || imdbId
        };
    } catch (e) {
        return null;
    }
}

/**
 * Map TMDB gender integer to readable string
 */
function mapGender(g) {
    if (g === 1) return 'Female';
    if (g === 2) return 'Male';
    if (g === 3) return 'Non-binary';
    return null;
}

/**
 * Find or create a talent record from an IMDbPro client node.
 * Uses hb_socials IMDB identifier to check for existing talent.
 * If creating new, also calls TMDB to enrich the profile.
 * Returns the talent UUID.
 */
async function findOrCreateTalent(client) {
    if (!client.soc_imdb_id) return null;

    // 0. Check in-memory cache first (handles same-batch duplicates)
    if (talentCache.has(client.soc_imdb_id)) {
        return { talentId: talentCache.get(client.soc_imdb_id), isNew: false };
    }

    // 1. Check if we already have an IMDB social profile for this nmId
    const { data: existingSocial } = await supabase
        .from('hb_socials')
        .select('id, linked_talent')
        .eq('type', 'IMDB')
        .eq('identifier', client.soc_imdb_id)
        .limit(1)
        .maybeSingle();

    if (existingSocial && existingSocial.linked_talent) {
        talentCache.set(client.soc_imdb_id, existingSocial.linked_talent);
        return { talentId: existingSocial.linked_talent, isNew: false };
    }

    // 2. Call TMDB to enrich the profile before inserting
    let tmdbData = null;
    if (TMDB_API_KEY) {
        tmdbData = await fetchTmdbByImdbId(client.soc_imdb_id);
        await sleep(TMDB_SLEEP_MS);
    }

    // 3. Create the talent record with TMDB-enriched data
    const talentPayload = {
        name: client.name,
        image: tmdbData?.profile_path || client.image || null,
        status: 'Active',
        category: 'Film & TV',
        biography: tmdbData?.biography || null,
        gender: mapGender(tmdbData?.gender) || null,
        birth_location: tmdbData?.place_of_birth || null,
        act_type: tmdbData?.known_for_department || null
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

    // 4. Create the IMDB social profile and link it
    const imdbSocialPayload = {
        type: 'IMDB',
        identifier: client.soc_imdb_id,
        name: client.name,
        social_url: `https://imdb.com/name/${client.soc_imdb_id}`,
        rank: client.imdb_rank || null,
        image: tmdbData?.profile_path || client.image || null,
        linked_talent: talent.id
    };

    const { data: imdbSocial, error: imdbErr } = await supabase
        .from('hb_socials')
        .insert(imdbSocialPayload)
        .select('id')
        .single();

    if (!imdbErr && imdbSocial) {
        await supabase.from('hb_talent').update({ soc_imdb: imdbSocial.id }).eq('id', talent.id);
    }

    // 5. Create a TMDB social profile if we got TMDB data
    if (tmdbData && tmdbData.tmdb_id) {
        const tmdbSocialPayload = {
            type: 'TMDB',
            identifier: tmdbData.tmdb_id,
            name: client.name,
            social_url: `https://www.themoviedb.org/person/${tmdbData.tmdb_id}`,
            rank: tmdbData.popularity ? Math.round(tmdbData.popularity) : null,
            image: tmdbData.profile_path || null,
            linked_talent: talent.id
        };

        const { data: tmdbSocial, error: tmdbErr } = await supabase
            .from('hb_socials')
            .insert(tmdbSocialPayload)
            .select('id')
            .single();

        if (!tmdbErr && tmdbSocial) {
            await supabase.from('hb_talent').update({ soc_tmdb: tmdbSocial.id }).eq('id', talent.id);
        }
    }

    let enrichLabel = tmdbData ? '🎬' : '📋';
    console.log(`      ${enrichLabel} Created: ${client.name}${tmdbData ? ` (TMDB: ${tmdbData.tmdb_id})` : ''}`);

    talentCache.set(client.soc_imdb_id, talent.id);
    return { talentId: talent.id, isNew: true };
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

            const result = await findOrCreateTalent(client);
            if (!result) continue;

            const { talentId, isNew } = result;
            if (isNew) created++;
            else existing++;

            // Link agent contacts from this client node to the talent
            if (client.agents && client.agents.length > 0) {
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

                // Update talent with company link + agent contacts
                const { data: currentTalent } = await supabase
                    .from('hb_talent')
                    .select('agenct_companies, agenct_contacts, companies_all, contacts_all')
                    .eq('id', talentId)
                    .single();

                if (currentTalent) {
                    let updatePayload = { updated_at: new Date().toISOString() };

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
                        updatePayload.agenct_contacts = [...new Set([...existingContacts, ...agentContactIds])];
                        updatePayload.contacts_all = [...new Set([...allContacts, ...agentContactIds])];
                    }

                    await supabase.from('hb_talent').update(updatePayload).eq('id', talentId);
                    linked++;
                }
            }
        }

        console.log(`   ✅ Created: ${created} | Existing: ${existing} | Linked: ${linked}`);

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
    if (!TMDB_API_KEY) console.log('⚠️  No TMDB_API_KEY set — new talent will be created without TMDB enrichment.\n');

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
