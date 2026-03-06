/**
 * db.js — Supabase client and upsert helper
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('⚠️  SUPABASE_URL or SUPABASE_SERVICE_KEY missing from .env');
}

const supabase = createClient(SUPABASE_URL || '', SUPABASE_KEY || '');

/**
 * Upsert a single row (or array of rows) into a table.
 *
 * @param {string}       tableName    e.g. 'talent_profiles'
 * @param {object|array} data         Row(s) to upsert
 * @param {string}       conflictKey  Column for ON CONFLICT, e.g. 'imdb_id'
 * @returns {object|null}             Upserted row(s) or null on error
 */
async function upsertData(tableName, data, conflictKey) {
    // Remove keys with undefined values — Supabase rejects them
    const clean = (row) => {
        const out = {};
        for (const [k, v] of Object.entries(row)) {
            if (v !== undefined) out[k] = v;
        }
        return out;
    };

    const payload = Array.isArray(data) ? data.map(clean) : clean(data);

    const { data: result, error } = await supabase
        .from(tableName)
        .upsert(payload, { onConflict: conflictKey, ignoreDuplicates: false })
        .select();

    if (error) {
        console.error(`   ❌ DB upsert error on ${tableName}:`, error.message);
        // Return null instead of throwing so the pipeline can continue
        return null;
    }

    return result;
}

module.exports = { supabase, upsertData };
