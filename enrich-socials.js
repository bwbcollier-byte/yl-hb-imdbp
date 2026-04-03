/**
 * enrich-socials.js (Improved)
 * Enrich talent profiles from existing social_profiles data.
 * Skips records that don't have new data to contribute to avoid loops.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const LOG_FILE = '/tmp/enrich-socials-log.txt';

function log(msg) {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] ${msg}\n`;
    console.log(msg);
    fs.appendFileSync(LOG_FILE, message);
}

async function enrichFromSocials(type) {
    log(`🔍 Filtering for ${type} records with actionable data...`);
    
    let processed = 0;
    let skippedIds = new Set(); // To avoid retrying the same failures in one session

    while (true) {
        // Fetch records where description or image is missing
        const { data, error } = await supabase
            .from('social_profiles')
            .select(`
                id,
                talent_id,
                social_about,
                social_image,
                talent_profiles!talent_id!inner (
                    id,
                    description,
                    profile_image
                )
            `)
            .eq('social_type', type)
            .or('social_about.neq."",social_image.neq.""') // Ensure social HAS something
            .or('description.is.null,description.eq."",profile_image.is.null,profile_image.eq.""', { foreignTable: 'talent_profiles' })
            .limit(200);

        if (error) {
            log(`❌ Error: ${error.message}`);
            break;
        }

        const actionable = data.filter(row => {
            if (skippedIds.has(row.talent_id)) return false;
            const tp = row.talent_profiles;
            const hasNewDesc = (!tp.description || tp.description === '') && (row.social_about && row.social_about !== '');
            const hasNewImg = (!tp.profile_image || tp.profile_image === '') && (row.social_image && row.social_image !== '');
            return hasNewDesc || hasNewImg;
        });

        if (actionable.length === 0) {
            log(`✅ No more actionable ${type} records found.`);
            break;
        }

        log(`📦 Processing ${actionable.length} actionable records...`);
        
        for (const row of actionable) {
            const tp = row.talent_profiles;
            const updateData = {};
            
            if (!tp.description && row.social_about) updateData.description = row.social_about;
            if (!tp.profile_image && row.social_image) updateData.profile_image = row.social_image;

            if (Object.keys(updateData).length > 0) {
                updateData.updated_at = new Date().toISOString();
                const { error: updateError } = await supabase
                    .from('talent_profiles')
                    .update(updateData)
                    .eq('id', tp.id);
                
                if (!updateError) {
                    processed++;
                } else {
                    log(`   ⚠️ Fail ${tp.id}: ${updateError.message}`);
                    skippedIds.add(tp.id);
                }
            } else {
                skippedIds.add(tp.id);
            }
        }
        
        log(`✨ Total Updated this session: ${processed}`);
        await new Promise(r => setTimeout(r, 500));
    }
}

(async () => {
    try {
        log('--- Improved Enrichment Run Started ---');
        await enrichFromSocials('Spotify');
        log('--- Enrichment Run Completed ---');
        process.exit(0);
    } catch (e) {
        log(`💥 Crash: ${e}`);
        process.exit(1);
    }
})();
