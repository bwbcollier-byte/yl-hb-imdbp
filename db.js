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
    
    // 1. Check for existing record by imdb_id
    const { data: existing, error: findError } = await supabase
        .from('talent_profiles')
        .select('id')
        .eq('imdb_id', payload.imdb_id)
        .maybeSingle();

    if (findError) {
        console.error('   ❌ Error searching for talent:', findError.message);
        return null;
    }

    if (existing) {
        // 2. Update existing record
        const { data: updated, error: updateError } = await supabase
            .from('talent_profiles')
            .update(payload)
            .eq('id', existing.id)
            .select('id')
            .single();

        if (updateError) {
            console.error('   ❌ Error updating talent:', updateError.message);
            return null;
        }
        return updated.id;
    } else {
        // 3. Insert new record
        const { data: inserted, error: insertError } = await supabase
            .from('talent_profiles')
            .insert(payload)
            .select('id')
            .single();

        if (insertError) {
            console.error('   ❌ Error inserting talent:', insertError.message);
            return null;
        }
        return inserted.id;
    }
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
    
    // Check for existing
    const { data: existing, error: findError } = await supabase
        .from('crm_companies')
        .select('id')
        .eq('id_imdb', payload.id_imdb)
        .maybeSingle();

    if (findError) {
        console.error('   ❌ Error searching for company:', findError.message);
        return;
    }

    if (existing) {
        const { error: updateError } = await supabase
            .from('crm_companies')
            .update(payload)
            .eq('id', existing.id);
        if (updateError) console.error('   ❌ Error updating company:', updateError.message);
    } else {
        const { error: insertError } = await supabase
            .from('crm_companies')
            .insert(payload);
        if (insertError) console.error('   ❌ Error inserting company:', insertError.message);
    }
}

/**
 * Upsert a Contact (Agent/Rep).
 */
async function upsertContact(data) {
    const payload = clean(data);
    
    // Check for existing
    const { data: existing, error: findError } = await supabase
        .from('crm_contacts')
        .select('id')
        .eq('id_imdb', payload.id_imdb)
        .maybeSingle();

    if (findError) {
        console.error('   ❌ Error searching for contact:', findError.message);
        return;
    }

    if (existing) {
        const { error: updateError } = await supabase
            .from('crm_contacts')
            .update(payload)
            .eq('id', existing.id);
        if (updateError) console.error('   ❌ Error updating contact:', updateError.message);
    } else {
        const { error: insertError } = await supabase
            .from('crm_contacts')
            .insert(payload);
        if (insertError) console.error('   ❌ Error inserting contact:', insertError.message);
    }
}

module.exports = {
    supabase,
    upsertTalent,
    upsertSocials,
    upsertCompany,
    upsertContact
};
