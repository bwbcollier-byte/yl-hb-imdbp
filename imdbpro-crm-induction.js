require('dotenv').config();
const { fetchPageProps, closeBrowser, sleep, getRandomDelay } = require('./scraper');
const { supabase } = require('./db');

const LIMIT = 100;

async function findOrCreateCompany(co, category) {
    if (!co || !co.id) return null;
    const { data: existing } = await supabase.from('hb_companies').select('id').eq('soc_imdb_id', co.id).limit(1).maybeSingle();
    if (existing) return existing.id;
    
    const { data: inserted, error } = await supabase
        .from('hb_companies')
        .insert({ soc_imdb_id: co.id, name: co.name, company_type: category, status: 'Active' })
        .select('id')
        .single();
    
    if (error) {
        console.log(`   ⚠️ Insert error for Company ${co.name}: ${error.message}`);
        return null;
    }
    return inserted.id;
}

async function findOrCreateContact(person, companyId, companyName, category) {
    if (!person || !person.id) return null;
    const { data: existing } = await supabase.from('hb_contacts').select('id').eq('soc_imdb_id', person.id).limit(1).maybeSingle();
    
    if (existing) return existing.id;

    // IMDB returns full name, split it for the DB
    let name_full = person.name || 'Unknown';
    let parts = name_full.split(' ');
    let first_name = parts[0] || '';
    let last_name = parts.slice(1).join(' ') || '';

    const { data: inserted, error } = await supabase
        .from('hb_contacts')
        .insert({ 
            soc_imdb_id: person.id, 
            name_full: name_full,
            first_name: first_name,
            last_name: last_name,
            linked_company: companyId,
            company_name: companyName,
            role: category, 
            status: 'Lead',
            is_active: true
        })
        .select('id')
        .single();
    
    if (error) {
        console.log(`   ⚠️ Insert error for Contact ${name_full}: ${error.message}`);
        return null;
    }
    return inserted.id;
}

function getArrayPrefix(category) {
    if (category.includes('MANAGER')) return 'management';
    if (category.includes('PUBLICIST')) return 'publicist';
    if (category.includes('LEGAL')) return 'legal';
    if (category.includes('APPEARANCE')) return 'appearance';
    if (category.includes('COMMERCIAL')) return 'agenctcommercial';
    // Catch-all is standard agent
    return 'agenct';
}

async function processTalentContacts(talent) {
    const { data: social } = await supabase.from('hb_socials').select('identifier').eq('linked_talent', talent.id).eq('type', 'IMDB').maybeSingle();
    if (!social || !social.identifier) {
        // Mark as updated so we don't get stuck in a loop trying to fetch this person forever
        await supabase.from('hb_talent').update({ contacts_updated: new Date().toISOString() }).eq('id', talent.id);
        return false;
    }
    
    const url = "https://pro.imdb.com/name/" + social.identifier + "/";
    console.log(`\n🔍 ${talent.name}`);
    
    try {
        const reps = await fetchPageProps(url);
        if (!reps || reps.length === 0) {
            console.log("   🤷 No contacts listed.");
            await supabase.from('hb_talent').update({ contacts_updated: new Date().toISOString() }).eq('id', talent.id);
            return true;
        }

        // Initialize arrays
        let updateData = {
            agenct_companies: [], agenct_contacts: [],
            agenctcommercial_companies: [], agenctcommercial_contacts: [],
            management_companies: [], management_contacts: [],
            appearance_companies: [], appearance_contacts: [],
            legal_companies: [], legal_contacts: [],
            publicist_companies: [], publicist_contacts: []
        };
        let companyCount = 0;
        let contactCount = 0;

        for (const rep of reps) {
            const category = (rep.type || 'REPRESENTATIVE').toUpperCase();
            const prefix = getArrayPrefix(category);
            
            // 1. Process Company
            const companyId = await findOrCreateCompany(rep.company, category);
            if (companyId) {
                console.log(`   🏢 ${category} -> ${rep.company.name}`);
                updateData[`${prefix}_companies`].push(companyId);
                companyCount++;
                
                // 2. Process Individual Agents under this company
                if (rep.agents && rep.agents.length > 0) {
                    for (const agent of rep.agents) {
                        const contactId = await findOrCreateContact(agent, companyId, rep.company.name, category);
                        if (contactId) {
                            console.log(`      👤 Agent -> ${agent.name}`);
                            updateData[`${prefix}_contacts`].push(contactId);
                            contactCount++;
                        }
                    }
                }
            }
        }
        
        // Finalize unique constraints & prep update object
        let finalUpsert = { contacts_updated: new Date().toISOString() };
        for (const key of Object.keys(updateData)) {
            finalUpsert[key] = [...new Set(updateData[key])];
        }

        await supabase.from('hb_talent').update(finalUpsert).eq('id', talent.id);
        
        console.log(`   ✅ Synced. Companies: ${companyCount} | Individual Contacts: ${contactCount}`);
        return true;
    } catch (e) { 
        console.error("   ❌ " + e.message); 
        return false; 
    }
}

async function main() {
    try {
        const { data: talents } = await supabase.from('hb_talent').select('id, name').not('soc_imdb', 'is', null).is('contacts_updated', null).limit(LIMIT);
        if (!talents?.length) return console.log('✅ Done.');
        console.log(`📋 ${talents.length} targets queued`);
        for (const talent of talents) { 
            await processTalentContacts(talent); 
            await sleep(getRandomDelay(2000, 4000)); 
        }
    } finally { await closeBrowser(); }
}
main();
