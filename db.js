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
 * Looks up the talent via hb_socials (IMDB type) — skips insert if no social link exists.
 */
async function upsertTalent(data) {
    const raw = clean(data);

    // 1. Find talent UUID via hb_socials where type = 'IMDB'
    const { data: social, error: socialError } = await supabase
        .from('hb_socials')
        .select('linked_talent')
        .eq('type', 'IMDB')
        .eq('identifier', raw.imdb_id)
        .maybeSingle();

    if (socialError) {
        console.error('   ❌ Error looking up IMDB social:', socialError.message);
        return null;
    }

    if (!social) {
        console.log('   ⏭ No hb_socials IMDB entry found — skipping talent upsert');
        return null;
    }

    const talentId = social.linked_talent;

    // 2. Build hb_talent payload — remap columns, drop imdb_id
    const { imdb_id, description, profile_image, ...rest } = raw;
    const payload = clean({
        ...rest,
        biography: description,
        image: profile_image,
    });

    // 3. Update hb_talent by id
    const { data: updated, error: updateError } = await supabase
        .from('hb_talent')
        .update(payload)
        .eq('id', talentId)
        .select('id')
        .single();

    if (updateError) {
        console.error('   ❌ Error updating talent:', updateError.message);
        return null;
    }
    return updated.id;
}

/**
 * Upsert social profiles into hb_socials. Checks for existence by (linked_talent, type).
 */
async function upsertSocials(socials) {
    for (const social of socials) {
        const raw = clean(social);

        // Remap legacy field names → hb_socials column names
        const { talent_id, social_type, social_id, social_about, social_image, social_url, ...rest } = raw;
        const payload = clean({
            ...rest,
            linked_talent: talent_id,
            type: social_type,
            identifier: social_id,
            description: social_about,
            image: social_image,
            social_url,
        });

        // Find existing record
        const { data: existing, error: findError } = await supabase
            .from('hb_socials')
            .select('id')
            .eq('linked_talent', payload.linked_talent)
            .eq('type', payload.type)
            .maybeSingle();

        if (findError) {
            console.error(`   ❌ Error finding social ${payload.type}:`, findError.message);
            continue;
        }

        if (existing) {
            // Update
            const { error: updateError } = await supabase
                .from('hb_socials')
                .update(payload)
                .eq('id', existing.id);
            if (!updateError) console.log(`      ✅ Updated Social: ${payload.type}`);
            else console.error(`      ❌ Update fail: ${payload.type}`, updateError.message);
        } else {
            // Insert
            const { error: insertError } = await supabase
                .from('hb_socials')
                .insert(payload);
            if (!insertError) console.log(`      ✅ Added Social: ${payload.type}`);
            else console.error(`      ❌ Insert fail: ${payload.type}`, insertError.message);
        }
    }
}

/**
 * Upsert a Company Profile into hb_companies.
 */
async function upsertCompany(data) {
    const raw = clean(data);

    // Remap id_imdb → soc_imdb_id
    const { id_imdb, ...rest } = raw;
    const payload = clean({ ...rest, soc_imdb_id: id_imdb });

    // Check for existing
    const { data: existing, error: findError } = await supabase
        .from('hb_companies')
        .select('id')
        .eq('soc_imdb_id', payload.soc_imdb_id)
        .maybeSingle();

    if (findError) {
        console.error('   ❌ Error searching for company:', findError.message);
        return;
    }

    if (existing) {
        const { error: updateError } = await supabase
            .from('hb_companies')
            .update(payload)
            .eq('id', existing.id);
        if (updateError) console.error('   ❌ Error updating company:', updateError.message);
    } else {
        const { error: insertError } = await supabase
            .from('hb_companies')
            .insert(payload);
        if (insertError) console.error('   ❌ Error inserting company:', insertError.message);
    }
}

/**
 * Upsert a Contact (Agent/Rep) into hb_contacts.
 */
async function upsertContact(data) {
    const raw = clean(data);

    // Remap id_imdb → soc_imdb_id
    const { id_imdb, ...rest } = raw;
    const payload = clean({ ...rest, soc_imdb_id: id_imdb });

    // Check for existing
    const { data: existing, error: findError } = await supabase
        .from('hb_contacts')
        .select('id')
        .eq('soc_imdb_id', payload.soc_imdb_id)
        .maybeSingle();

    if (findError) {
        console.error('   ❌ Error searching for contact:', findError.message);
        return;
    }

    if (existing) {
        const { error: updateError } = await supabase
            .from('hb_contacts')
            .update(payload)
            .eq('id', existing.id);
        if (updateError) console.error('   ❌ Error updating contact:', updateError.message);
    } else {
        const { error: insertError } = await supabase
            .from('hb_contacts')
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
