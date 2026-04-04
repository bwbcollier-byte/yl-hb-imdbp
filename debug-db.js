require('dotenv').config();
const { supabase } = require('./db');

async function checkDB() {
    console.log("🔬 Checking IMDB identifiers in hb_socials...\n");

    // Get some known celebrities that should have reps
    const celebNames = ['Pedro Pascal', 'George Clooney', 'Sean Bean', 'Jude Law', 'Tom Cruise', 'Bella Ramsey', 'Jennifer Coolidge', 'Donald Glover', 'Cara Delevingne', 'Rupert Grint'];
    
    for (const name of celebNames) {
        const { data: talent } = await supabase.from('hb_talent').select('id, name, soc_imdb').eq('name', name).single();
        if (!talent) { console.log(`❌ ${name}: Not found in hb_talent`); continue; }
        
        const { data: social } = await supabase.from('hb_socials').select('identifier, type, url').eq('linked_talent', talent.id).eq('type', 'IMDB').single();
        
        console.log(`📋 ${name}`);
        console.log(`   soc_imdb: ${talent.soc_imdb}`);
        console.log(`   social identifier: ${social?.identifier || 'NOT FOUND'}`);
        console.log(`   social url: ${social?.url || 'N/A'}`);
        console.log(`   Expected URL: https://pro.imdb.com/name/${social?.identifier}/`);
        console.log('');
    }

    // Also check: what does the induction query actually return?
    console.log("\n🔬 Checking what the induction query returns (first 5)...\n");
    const { data: talents } = await supabase
        .from('hb_talent')
        .select('id, name')
        .not('soc_imdb', 'is', null)
        .is('contacts_updated', null)
        .limit(5);
    
    if (talents) {
        for (const t of talents) {
            const { data: social } = await supabase.from('hb_socials').select('identifier, url').eq('linked_talent', t.id).eq('type', 'IMDB').single();
            console.log(`📋 ${t.name} -> identifier: ${social?.identifier || 'MISSING'} | url: ${social?.url || 'N/A'}`);
        }
    }
}

checkDB();
