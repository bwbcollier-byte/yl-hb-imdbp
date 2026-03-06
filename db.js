/**
 * db.js — Supabase client and specific upsert helpers for relational data
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL || '', SUPABASE_KEY || '');

/**
 * Remove undefined keys from an object to keep Supabase happy.
 */
function clean(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) out[k] = v;
    }
    return out;
}

/**
 * Upsert a Talent Profile. Returns the database UUID of the record.
 */
async function upsertTalent(data) {
    const payload = clean(data);
    const { data: result, error } = await supabase
        .from('talent_profiles')
        .upsert(payload, { onConflict: 'imdb_id' })
        .select('id')
        .single();

    if (error) {
        console.error('   ❌ Error upserting talent:', error.message);
        return null;
    }
    return result.id;
}

/**
 * Upsert social profiles. Checks for existence by (talent_id, social_type)
 */
async function upsertSocials(socials) {
    for (const social of socials) {
        const payload = clean(social);
        
        // Find existing record
        const { data: existing, error: findError } = await supabase
            .from('social_profiles')
            .select('id')
            .eq('talent_id', payload.talent_id)
            .eq('social_type', payload.social_type)
            .maybeSingle();

        if (findError) {
            console.error(`   ❌ Error finding social ${payload.social_type}:`, findError.message);
            continue;
        }

        if (existing) {
            // Update
            const { error: updateError } = await supabase
                .from('social_profiles')
                .update(payload)
                .eq('id', existing.id);
            if (!updateError) console.log(`      ✅ Updated Social: ${payload.social_type}`);
            else console.error(`      ❌ Update fail: ${payload.social_type}`, updateError.message);
        } else {
            // Insert
            const { error: insertError } = await supabase
                .from('social_profiles')
                .insert(payload);
            if (!insertError) console.log(`      ✅ Added Social: ${payload.social_type}`);
            else console.error(`      ❌ Insert fail: ${payload.social_type}`, insertError.message);
        }
    }
}

/**
 * Upsert a Company Profile.
 */
async function upsertCompany(data) {
    const payload = clean(data);
    const { error } = await supabase
        .from('crm_companies')
        .upsert(payload, { onConflict: 'id_imdb' });

    if (error) console.error('   ❌ Error upserting company:', error.message);
}

/**
 * Upsert a Contact (Agent/Rep).
 */
async function upsertContact(data) {
    const payload = clean(data);
    const { error } = await supabase
        .from('crm_contacts')
        .upsert(payload, { onConflict: 'id_imdb' });

    if (error) console.error('   ❌ Error upserting contact:', error.message);
}

module.exports = {
    supabase,
    upsertTalent,
    upsertSocials,
    upsertCompany,
    upsertContact
};
