require('dotenv').config();
const { fetchDiscoverTitlesPage, closeBrowser, sleep, getRandomDelay } = require('./scraper-discover-titles');
const { processMedia } = require('./tmdb-media-induction');
const { supabase } = require('./db');

const START_PAGE = parseInt(process.env.DISCOVER_START_PAGE || '1', 10);
const MAX_PAGES = parseInt(process.env.DISCOVER_MAX_PAGES || '10', 10);
const TARGET_URL = process.env.DISCOVER_URL || 'https://pro.imdb.com/discover/title?sortOrder=BOX_OFFICE_GROSS_DESC&type=movie';

// Extrapolate the media_type from the URL parameter for insertion
let urlType = 'movie';
if (TARGET_URL.includes('type=tvSeries') || TARGET_URL.includes('type=tv')) urlType = 'tv';
else if (TARGET_URL.includes('type=videoGame')) urlType = 'game';

async function findOrCreateMedia(titleData) {
    if (!titleData.soc_imdb_id) return null;

    // 1. Check if media exists
    const { data: existing } = await supabase
        .from('hb_media')
        .select('*')
        .eq('soc_imdb_id', titleData.soc_imdb_id)
        .limit(1)
        .maybeSingle();

    if (existing) {
        // Return existing record wrapper so processMedia can handle it
        return { media: existing, isNew: false };
    }

    // 2. Insert minimal media record
    const payload = {
        soc_imdb_id: titleData.soc_imdb_id,
        name: titleData.title,
        media_type: urlType,
        image: titleData.image || null
    };

    const { data: newMedia, error } = await supabase
        .from('hb_media')
        .insert(payload)
        .select('*')
        .single();

    if (error) {
        console.log(`      ⚠️ Media insert error (${titleData.title}): ${error.message}`);
        return null;
    }

    return { media: newMedia, isNew: true };
}

async function main() {
    console.log(`⭐ IMDbPro Discover Titles (starting page ${START_PAGE}, max pages ${MAX_PAGES})`);
    console.log(`🔗 Target: ${TARGET_URL}`);
    console.log('='.repeat(50));

    let createdTotal = 0;
    let existingTotal = 0;
    let enrichedTotal = 0;
    let skippedTotal = 0;
    let failedTotal = 0;
    let scannedTotal = 0;

    try {
        for (let pageNum = START_PAGE; pageNum < START_PAGE + MAX_PAGES; pageNum++) {
            console.log(`\n📄 Fetching Page ${pageNum}...`);
            const titles = await fetchDiscoverTitlesPage(TARGET_URL, pageNum);

            if (!titles || titles.length === 0) {
                console.log(`✅ No more titles found at page ${pageNum}. Stopping.`);
                break;
            }

            scannedTotal += titles.length;
            console.log(`🎯 ${titles.length} titles scraped. Processing & Enriching...\n`);

            for (let i = 0; i < titles.length; i++) {
                const titleData = titles[i];
                
                // Upsert to hb_media
                const result = await findOrCreateMedia(titleData);
                if (!result) {
                    failedTotal++;
                    continue;
                }

                if (result.isNew) createdTotal++;
                else existingTotal++;

                // TMDb enrichment — games not supported by TMDb, skip entirely
                if (urlType !== 'game') {
                    const enriched = await processMedia(result.media);
                    if (enriched === true) enrichedTotal++;
                    else failedTotal++;
                } else {
                    skippedTotal++;
                }
            }

            console.log(`   📊 P${pageNum} summary | New: ${createdTotal} | Existing: ${existingTotal}${urlType === 'game' ? ` | Inserted: ${createdTotal + existingTotal}` : ` | Enriched: ${enrichedTotal} | Failed: ${failedTotal}`}`);

            if (titles.length < 50) {
                console.log(`   🔸 Less than 50 titles on page, assuming it's the last page.`);
                break;
            }

            await sleep(getRandomDelay(2000, 4000));
        }

        console.log(`\n${'='.repeat(50)}`);
        console.log(`✅ Run Complete.`);
        console.log(`   🆕 Created:          ${createdTotal}`);
        console.log(`   📂 Already Exist:    ${existingTotal}`);
        if (urlType === 'game') {
            console.log(`   🎮 Games Inserted:   ${createdTotal + existingTotal}`);
        } else {
            console.log(`   ✨ TMDB Enriched:    ${enrichedTotal}`);
            console.log(`   ❌ Failed:           ${failedTotal}`);
        }
        console.log(`   📊 Total Scanned:    ${scannedTotal}`);
    } finally {
        await closeBrowser();
    }
}

main();
