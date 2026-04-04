require('dotenv').config();
const { fetchStarmeterPage, closeBrowser, sleep, getRandomDelay } = require('./scraper-starmeter');
const { supabase } = require('./db');

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_SLEEP_MS = 300;
const START_PAGE = parseInt(process.env.STARMETER_START_PAGE || '1', 10);

// In-memory cache to prevent duplicate creation within the same run
const talentCache = new Map();

async function fetchTmdbByImdbId(imdbId) {
    if (!TMDB_API_KEY) return null;
    try {
        const findRes = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
        if (!findRes.ok) return null;
        const findData = await findRes.json();
        if (!findData.person_results || findData.person_results.length === 0) return null;
        const tmdbId = findData.person_results[0].id;

        const personRes = await fetch(`https://api.themoviedb.org/3/person/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`);
        if (!personRes.ok) return null;
        const person = await personRes.json();

        return {
            tmdb_id: String(tmdbId),
            name: person.name,
            biography: person.biography || null,
            birthday: person.birthday || null,
            gender: person.gender,
            place_of_birth: person.place_of_birth || null,
            popularity: person.popularity || null,
            profile_path: person.profile_path ? `https://image.tmdb.org/t/p/original${person.profile_path}` : null,
            known_for_department: person.known_for_department || null
        };
    } catch { return null; }
}

function mapGender(g) {
    if (g === 1) return 'Female';
    if (g === 2) return 'Male';
    if (g === 3) return 'Non-binary';
    return null;
}

async function findOrCreateTalent(person) {
    if (!person.soc_imdb_id) return null;

    // 0. In-memory cache check
    if (talentCache.has(person.soc_imdb_id)) {
        return { talentId: talentCache.get(person.soc_imdb_id), isNew: false };
    }

    // 1. Check hb_socials for existing IMDB profile
    const { data: existingSocial } = await supabase
        .from('hb_socials')
        .select('id, linked_talent')
        .eq('type', 'IMDB')
        .eq('identifier', person.soc_imdb_id)
        .limit(1)
        .maybeSingle();

    if (existingSocial && existingSocial.linked_talent) {
        talentCache.set(person.soc_imdb_id, existingSocial.linked_talent);

        // Update the rank if we have a newer one from starmeter
        if (person.imdb_rank) {
            await supabase.from('hb_socials').update({ rank: person.imdb_rank }).eq('id', existingSocial.id);
        }

        return { talentId: existingSocial.linked_talent, isNew: false };
    }

    // 2. TMDB enrichment
    let tmdbData = null;
    if (TMDB_API_KEY) {
        tmdbData = await fetchTmdbByImdbId(person.soc_imdb_id);
        await sleep(TMDB_SLEEP_MS);
    }

    // 3. Create talent record
    const talentPayload = {
        name: person.name,
        image: tmdbData?.profile_path || person.image || null,
        status: 'Active',
        category: 'Film & TV',
        biography: tmdbData?.biography || null,
        gender: mapGender(tmdbData?.gender) || null,
        birth_location: tmdbData?.place_of_birth || null,
        act_type: tmdbData?.known_for_department || person.profession || null
    };

    const { data: talent, error: talentErr } = await supabase
        .from('hb_talent')
        .insert(talentPayload)
        .select('id')
        .single();

    if (talentErr) {
        console.log(`      ⚠️ Insert error (${person.name}): ${talentErr.message}`);
        return null;
    }

    // 4. Create IMDB social profile
    const { data: imdbSocial, error: imdbErr } = await supabase
        .from('hb_socials')
        .insert({
            type: 'IMDB',
            identifier: person.soc_imdb_id,
            name: person.name,
            social_url: `https://imdb.com/name/${person.soc_imdb_id}`,
            rank: person.imdb_rank || null,
            image: tmdbData?.profile_path || person.image || null,
            linked_talent: talent.id
        })
        .select('id')
        .single();

    if (!imdbErr && imdbSocial) {
        await supabase.from('hb_talent').update({ soc_imdb: imdbSocial.id }).eq('id', talent.id);
    }

    // 5. Create TMDB social profile if enriched
    if (tmdbData && tmdbData.tmdb_id) {
        const { data: tmdbSocial, error: tmdbErr } = await supabase
            .from('hb_socials')
            .insert({
                type: 'TMDB',
                identifier: tmdbData.tmdb_id,
                name: person.name,
                social_url: `https://www.themoviedb.org/person/${tmdbData.tmdb_id}`,
                rank: tmdbData.popularity ? Math.round(tmdbData.popularity) : null,
                image: tmdbData.profile_path || null,
                linked_talent: talent.id
            })
            .select('id')
            .single();

        if (!tmdbErr && tmdbSocial) {
            await supabase.from('hb_talent').update({ soc_tmdb: tmdbSocial.id }).eq('id', talent.id);
        }
    }

    let label = tmdbData ? '🎬' : '📋';
    console.log(`      ${label} #${person.imdb_rank || '?'} ${person.name}${tmdbData ? ` (TMDB: ${tmdbData.tmdb_id})` : ''}`);

    talentCache.set(person.soc_imdb_id, talent.id);
    return { talentId: talent.id, isNew: true };
}

async function main() {
    if (!TMDB_API_KEY) console.log('⚠️  No TMDB_API_KEY — talent will be created without TMDB enrichment.\n');

    const maxPages = parseInt(process.env.STARMETER_MAX_PAGES || '10', 10);
    console.log(`⭐ IMDbPro Starmeter Discovery (starting page ${START_PAGE}, max pages ${maxPages})`);
    console.log('='.repeat(50));

    let createdTotal = 0;
    let existingTotal = 0;
    let updatedTotal = 0;
    let failedTotal = 0;
    let scannedTotal = 0;

    try {
        for (let pageNum = START_PAGE; pageNum < START_PAGE + maxPages; pageNum++) {
            console.log(`\n📄 Fetching Page ${pageNum}...`);
            const people = await fetchStarmeterPage(pageNum);

            if (!people || people.length === 0) {
                console.log(`✅ No more people found at page ${pageNum}. Stopping.`);
                break;
            }

            scannedTotal += people.length;
            console.log(`🎯 ${people.length} people scraped. Processing...\n`);

            for (let i = 0; i < people.length; i++) {
                const person = people[i];
                const result = await findOrCreateTalent(person);

                if (!result) {
                    failedTotal++;
                    continue;
                }

                if (result.isNew) {
                    createdTotal++;
                } else {
                    existingTotal++;
                    if (person.imdb_rank) updatedTotal++;
                    console.log(`      ✅ #${person.imdb_rank || '?'} ${person.name} (exists${person.imdb_rank ? ', rank updated' : ''})`);
                }
            }

            console.log(`   📊 P${pageNum} summary | New: ${createdTotal} | Existing: ${existingTotal} | Rank Updates: ${updatedTotal} | Failed: ${failedTotal}`);

            if (people.length < 50) {
                console.log(`   🔸 Less than 50 people on page, assuming it's the last page.`);
                break;
            }

            await sleep(getRandomDelay(2000, 4000));
        }

        console.log(`\n${'='.repeat(50)}`);
        console.log(`✅ Run Complete.`);
        console.log(`   🆕 Created:       ${createdTotal}`);
        console.log(`   📂 Already Exist: ${existingTotal}`);
        console.log(`   📈 Ranks Updated: ${updatedTotal}`);
        console.log(`   ❌ Failed:        ${failedTotal}`);
        console.log(`   📊 Total Scanned: ${scannedTotal}`);
    } finally {
        await closeBrowser();
    }
}

main();
