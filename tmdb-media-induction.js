require('dotenv').config();
const { supabase } = require('./db');
const fetch = require('node-fetch');

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_SLEEP_MS = 300;
const LIMIT = 20;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getRandomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

// In-memory cache for talent (tmdbId -> talentId)
const talentCache = new Map();

async function tmdbFetch(endpoint) {
    const url = `https://api.themoviedb.org/3${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${TMDB_API_KEY}&language=en-US`;
    const res = await fetch(url);
    await sleep(TMDB_SLEEP_MS);
    if (!res.ok) return null;
    return await res.json();
}

function mapGender(g) {
    if (g === 1) return 'Female';
    if (g === 2) return 'Male';
    if (g === 3) return 'Non-binary';
    return null;
}

// Ensure the talent exists. Cast member object requires `id` (TMDB ID).
async function findOrCreateTalentFromTmdb(castMember) {
    if (!castMember.id) return null;
    const tmdbId = String(castMember.id);

    if (talentCache.has(tmdbId)) {
        return { talentId: talentCache.get(tmdbId), isNew: false };
    }

    // Check hb_socials by TMDB id first
    const { data: existingTmdbSocial } = await supabase
        .from('hb_socials')
        .select('id, linked_talent')
        .eq('type', 'TMDB')
        .eq('identifier', tmdbId)
        .limit(1)
        .maybeSingle();

    if (existingTmdbSocial && existingTmdbSocial.linked_talent) {
        talentCache.set(tmdbId, existingTmdbSocial.linked_talent);
        return { talentId: existingTmdbSocial.linked_talent, isNew: false };
    }

    // We don't have this person. We need their full TMDB profile to get their IMDB id and bio
    const person = await tmdbFetch(`/person/${tmdbId}`);
    if (!person) return null;

    const imdbId = person.imdb_id;

    // Check if we have an IMDB id and if that exists in db
    if (imdbId) {
        const { data: existingImdbSocial } = await supabase
            .from('hb_socials')
            .select('id, linked_talent')
            .eq('type', 'IMDB')
            .eq('identifier', imdbId)
            .limit(1)
            .maybeSingle();

        if (existingImdbSocial && existingImdbSocial.linked_talent) {
            // Exists by IMDB. Let's create the TMDB social for future, then return
            await supabase.from('hb_socials').insert({
                type: 'TMDB',
                identifier: tmdbId,
                name: person.name,
                social_url: `https://www.themoviedb.org/person/${tmdbId}`,
                rank: person.popularity ? Math.round(person.popularity) : null,
                image: person.profile_path ? `https://image.tmdb.org/t/p/original${person.profile_path}` : null,
                linked_talent: existingImdbSocial.linked_talent
            });

            talentCache.set(tmdbId, existingImdbSocial.linked_talent);
            return { talentId: existingImdbSocial.linked_talent, isNew: false };
        }
    }

    // Person strictly does not exist. Create them.
    const imagePath = person.profile_path ? `https://image.tmdb.org/t/p/original${person.profile_path}` : null;
    
    const talentPayload = {
        name: person.name,
        image: imagePath,
        status: 'Active',
        category: 'Film & TV',
        biography: person.biography || null,
        gender: mapGender(person.gender),
        birth_location: person.place_of_birth || null,
        act_type: person.known_for_department || null
    };

    const { data: talent, error: talentErr } = await supabase
        .from('hb_talent')
        .insert(talentPayload)
        .select('id')
        .single();

    if (talentErr) {
        console.log(`      ⚠️ Talent insert error (${person.name}): ${talentErr.message}`);
        return null;
    }

    // Create Socials
    if (imdbId) {
        const { data: imdbSocial } = await supabase.from('hb_socials').insert({
            type: 'IMDB',
            identifier: imdbId,
            name: person.name,
            social_url: `https://imdb.com/name/${imdbId}`,
            image: imagePath,
            linked_talent: talent.id
        }).select('id').single();
        if (imdbSocial) await supabase.from('hb_talent').update({ soc_imdb: imdbSocial.id }).eq('id', talent.id);
    }

    const { data: tmdbSocial } = await supabase.from('hb_socials').insert({
        type: 'TMDB',
        identifier: tmdbId,
        name: person.name,
        social_url: `https://www.themoviedb.org/person/${tmdbId}`,
        rank: person.popularity ? Math.round(person.popularity) : null,
        image: imagePath,
        linked_talent: talent.id
    }).select('id').single();
    if (tmdbSocial) await supabase.from('hb_talent').update({ soc_tmdb: tmdbSocial.id }).eq('id', talent.id);

    console.log(`      🎬 Created Talent: ${person.name} (TMDB: ${tmdbId})`);
    
    talentCache.set(tmdbId, talent.id);
    return { talentId: talent.id, isNew: true };
}

async function processMedia(media) {
    console.log(`\n🍿 Processing Media: ${media.name || media.soc_imdb_id || media.soc_tmdb_id}`);
    
    let tmdbId = media.soc_tmdb_id;
    let mediaType = media.media_type || 'movie';

    // TMDB does not track video games. We simply skip API enrichment for them.
    if (mediaType === 'game') {
        console.log(`   🎮 Media is a Video Game. Skipping TMDB enrichment as TMDB only tracks Movies and TV.`);
        await supabase.from('hb_media').update({ check_tmdb_enrichment: new Date().toISOString() }).eq('id', media.id);
        return true;
    }

    // 1. Resolve TMDB ID if missing
    if (!tmdbId && media.soc_imdb_id) {
        const findRes = await tmdbFetch(`/find/${media.soc_imdb_id}?external_source=imdb_id`);
        if (findRes) {
            if (findRes.movie_results?.length > 0) {
                tmdbId = findRes.movie_results[0].id;
                mediaType = 'movie';
            } else if (findRes.tv_results?.length > 0) {
                tmdbId = findRes.tv_results[0].id;
                mediaType = 'tv';
            }
        }
    }

    if (!tmdbId) {
        console.log(`   ❌ Could not resolve TMDB ID for media.`);
        await supabase.from('hb_media').update({ check_tmdb_enrichment: new Date().toISOString() }).eq('id', media.id);
        return false;
    }

    // 2. Fetch full media details
    const details = await tmdbFetch(`/${mediaType}/${tmdbId}`);
    if (!details) {
        console.log(`   ❌ Could not fetch TMDB details.`);
        await supabase.from('hb_media').update({ check_tmdb_enrichment: new Date().toISOString() }).eq('id', media.id);
        return false;
    }

    // 3. Prepare enrichment payload
    const genres = details.genres ? details.genres.map(g => g.name) : [];
    const payload = {
        name: details.title || details.name || media.name,
        about: details.overview || null,
        image: details.poster_path ? `https://image.tmdb.org/t/p/original${details.poster_path}` : null,
        date_release: details.release_date || details.first_air_date || null,
        genres: genres.length > 0 ? genres : null,
        running_time: details.runtime || (details.episode_run_time ? details.episode_run_time[0] : null) || null,
        soc_tmdb_id: String(tmdbId),
        media_type: mediaType,
        check_tmdb_enrichment: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    // 4. Fetch Top Cast
    console.log(`   Fetched details for: ${payload.name} (${mediaType}). Checking cast...`);
    const credits = await tmdbFetch(`/${mediaType}/${tmdbId}/credits`);
    let finalTalentIds = media.linked_talent || [];
    let castCreated = 0;
    let castExisting = 0;

    if (credits && credits.cast) {
        // Process top 15 cast members
        const topCast = credits.cast.slice(0, 15);
        for (const castMember of topCast) {
            try {
                const result = await findOrCreateTalentFromTmdb(castMember);
                if (result) {
                    if (result.isNew) castCreated++;
                    else castExisting++;
                    if (!finalTalentIds.includes(result.talentId)) {
                        finalTalentIds.push(result.talentId);
                    }
                }
            } catch (e) {
                console.log(`      ⚠️ Error processing cast member ${castMember.name}: ${e.message}`);
            }
        }
    }

    payload.linked_talent = finalTalentIds;

    // 5. Update media record
    const { error } = await supabase.from('hb_media').update(payload).eq('id', media.id);
    if (error) {
        console.log(`   ❌ Database update error: ${error.message}`);
        return false;
    }

    console.log(`   ✅ Enriched media. Cast -> New: ${castCreated} | Existing: ${castExisting} (Total Cast Linked: ${finalTalentIds.length})`);
    return true;
}

async function main() {
    if (!TMDB_API_KEY) {
        console.error('🔴 TMDB_API_KEY is required for this script.');
        process.exit(1);
    }

    console.log(`📺 IMDbPro Media & Cast Enrichment`);
    console.log('='.repeat(50));

    // Fetch batch of unaudited media records that have at least one ID
    const { data: mediaItems, error } = await supabase
        .from('hb_media')
        .select('*')
        .is('check_tmdb_enrichment', null)
        .or('soc_imdb_id.not.is.null,soc_tmdb_id.not.is.null')
        .limit(LIMIT);

    if (error) {
        console.error('DB Error:', error.message);
        process.exit(1);
    }

    if (!mediaItems || mediaItems.length === 0) {
        return console.log('✅ No pending media items found.');
    }

    console.log(`🎬 Found ${mediaItems.length} media records to enrich.\n`);

    for (const media of mediaItems) {
        await processMedia(media);
        await sleep(getRandomDelay(1000, 2000));
    }
    
    console.log(`\n✅ Media enrichment complete.`);
}

if (require.main === module) {
    main();
}

module.exports = { processMedia };
