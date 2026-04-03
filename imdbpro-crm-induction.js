/**
 * imdbpro-crm-induction.js — Master CRM Discovery & Enrichment Pipeline
 * Scans hb_talent for profiles missing CRM contacts,
 * follows the soc_imdb UUID pointer from hb_talent into the hb_socials table,
 * pulls the id_imdb (nmID string) from hb_socials,
 * deep-scrapes their representation (Agents, Managers, Publicists) from IMDbPro,
 * and populates the hb_contacts and hb_companies tables in Supabase.
 */
require('dotenv').config();
const { fetchPageProps, sleep, getRandomDelay } = require('./scraper');
const { 
    mapTalentProfile, 
    mapCompanyProfile, 
    mapContactProfile 
} = require('./mapper');
const { supabase } = require('./db');
const { updateWorkflowHeartbeat } = require('./airtable-heartbeat');

// CONFIG: How many talents to process in one run
const LIMIT = 20;

async function processTalentContacts(talent) {
    // nmID induction: Following the soc_imdb link into hb_socials
    // The actual nmID string is stored in the id_imdb column of hb_socials.
    const nmId = talent.hb_socials?.id_imdb;

    if (!nmId) {
        console.error(`   ⚠️ Skipping ${talent.name}: No id_imdb found in linked hb_socials record.`);
        return false;
    }

    const url = `https://pro.imdb.com/name/${nmId}/`;
    console.log(`\n🔍 Scraping Representation: ${talent.name} (${nmId}) -> ${url}`);
    
    try {
        const pageProps = await fetchPageProps(url);
        if (!pageProps) throw new Error('Failed to fetch IMDbPro pageProps');

        const main = pageProps?.mainColumnData;
        const repEdges = main?.representation?.edges || [];
        
        let updates = {
            contacts_all: [],
            contacts_updated: new Date().toISOString(),
            appearance_contacts: [], legal_contacts: [], publicist_contacts: [], agenct_contacts: [], agenctcommercial_contacts: [], management_contacts: [],
            appearance_companies: [], legal_companies: [], publicist_companies: [], agenct_companies: [], agenctcommercial_companies: [], management_companies: []
        };

        for (const edge of repEdges) {
            const node = edge?.node;
            const category = (node?.typeName || 'OTHER').toUpperCase();
            const companyNode = node?.agency?.company;
            
            // Map IMDb Category to hb_talent column names
            let contactCol = 'agenct_contacts', companyCol = 'agenct_companies';
            if (category.includes('MANAGER')) { contactCol = 'management_contacts'; companyCol = 'management_companies'; }
            else if (category.includes('COMMERCIAL')) { contactCol = 'agenctcommercial_contacts'; companyCol = 'agenctcommercial_companies'; }
            else if (category.includes('PUBLICIST')) { contactCol = 'publicist_contacts'; companyCol = 'publicist_companies'; }
            else if (category.includes('LEGAL')) { contactCol = 'legal_contacts'; companyCol = 'legal_companies'; }
            else if (category.includes('APPEARANCE')) { contactCol = 'appearance_contacts'; companyCol = 'appearance_companies'; }

            if (companyNode) {
                const companyIdImdb = companyNode.id;
                const mappedCompany = mapCompanyProfile(companyNode, companyIdImdb);
                
                if (mappedCompany) {
                    const { data: companyRecord, error: companyErr } = await supabase
                        .from('hb_companies')
                        .upsert(mappedCompany, { onConflict: 'id_imdb' })
                        .select()
                        .single();
                    
                    if (companyErr) console.error(`   ❌ Company Error (${mappedCompany.company_name}):`, companyErr.message);
                    else if (companyRecord) {
                        console.log(`   🏢 Company OK: ${mappedCompany.company_name}`);
                        if (!updates[companyCol].includes(companyRecord.id)) updates[companyCol].push(companyRecord.id);

                        const agents = node?.agents || [];
                        for (const agent of agents) {
                            const mappedContact = mapContactProfile(agent, agent.id, mappedCompany.company_name);
                            if (mappedContact) {
                                mappedContact.linked_company = companyRecord.id;
                                const { data: contactRecord, error: contactErr } = await supabase
                                    .from('hb_contacts')
                                    .upsert(mappedContact, { onConflict: 'id_imdb' })
                                    .select()
                                    .single();

                                if (contactErr) console.error(`      ❌ Contact Error (${mappedContact.name_full}):`, contactErr.message);
                                else if (contactRecord) {
                                    console.log(`      👤 Agent OK: ${mappedContact.name_full} (${mappedContact.role || 'n/a'})`);
                                    if (!updates[contactCol].includes(contactRecord.id)) updates[contactCol].push(contactRecord.id);
                                    updates.contacts_all.push({
                                        id: contactRecord.id,
                                        name: contactRecord.name_full,
                                        role: contactRecord.role,
                                        company: mappedCompany.company_name,
                                        category: category
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        // Finalize Talent Links
        const { error: updateErr } = await supabase
            .from('hb_talent')
            .update(updates)
            .eq('id', talent.id);

        if (updateErr) console.error(`   ❌ Failed to update hb_talent for ${talent.name}:`, updateErr.message);
        else console.log(`   ✅ Talent CRM Linked: ${talent.name} (${updates.contacts_all.length} total contacts)`);

        return true;
    } catch (error) {
        console.error(`   ❌ Error processing ${talent.name}:`, error.message);
        return false;
    }
}

async function main() {
    console.log('🚀 Starting IMDbPro CRM Induction Pipeline (Supreme Sync Mode)...');
    await updateWorkflowHeartbeat('Running', 'Joining hb_talent with hb_socials using relational pointers...');

    try {
        // Corrected Joint select: Following the pointer from hb_talent.soc_imdb (UUID) to hb_socials.id_imdb (nmId)
        const { data: talents, error: fetchErr } = await supabase
            .from('hb_talent')
            .select(`
                id, 
                name, 
                hb_socials!soc_imdb(id_imdb)
            `)
            .not('soc_imdb', 'is', null)
            .is('contacts_updated', null)
            .limit(LIMIT);

        if (fetchErr) throw fetchErr;

        if (!talents || talents.length === 0) {
            console.log('✅ No new talent profiles need CRM induction.');
            await updateWorkflowHeartbeat('Ready', 'Idle: All talent records are CRM-enriched.');
            return;
        }

        console.log(`📋 Found ${talents.length} talent profiles for CRM induction.`);
        await updateWorkflowHeartbeat('Running', `Processing ${talents.length} profiles for CRM induction...`);

        let successCount = 0;

        for (let i = 0; i < talents.length; i++) {
            const talent = talents[i];
            console.log(`\n[${i + 1}/${talents.length}]`);
            
            const success = await processTalentContacts(talent);
            if (success) successCount++;

            await updateWorkflowHeartbeat('Running', `Processed ${i + 1}/${talents.length} profiles. Successful inductions: ${successCount}`);

            // Rate limit delay between 8 and 15 seconds
            if (i < talents.length - 1) {
                const delay = getRandomDelay(8000, 15000);
                console.log(`   ⏳ Sleeping ${Math.round(delay/1000)}s...`);
                await sleep(delay);
            }
        }

        await updateWorkflowHeartbeat('Ready', `Success: CRM Induction complete for ${successCount} talents.`);

    } catch (error) {
        console.error('💥 Pipeline error:', error.message);
        await updateWorkflowHeartbeat('Errors', `Pipeline Error: ${error.message}`);
    }

    console.log('\n🏁 CRM Induction finished.');
}

main().catch(console.error);
