/**
 * index.js — IMDbPro Discover & Scraping Orchestrator
 */

const { fetchDiscoverIds, fetchPageProps, sleep, getRandomDelay } = require('./scraper');
const { 
    mapTalentProfile, 
    mapSocialProfiles, 
    mapCompanyProfile, 
    mapContactProfile 
} = require('./mapper');
const { 
    upsertTalent, 
    upsertSocials, 
    upsertCompany, 
    upsertContact 
} = require('./db');
const { updateWorkflowHeartbeat } = require('./airtable-heartbeat');
require('dotenv').config();

// CONFIG: The Discover page to start from
const DISCOVER_URL = process.env.DISCOVER_URL || 'https://pro.imdb.com/discover/people/?profession=any&sortOrder=STARMETER_ASC&ref_=nmnw_nv_ppl_stm';

async function processNmId(nmId) {
    const url = `https://pro.imdb.com/name/${nmId}/`;
    console.log(`\n🔍 Processing Detail: ${nmId} -> ${url}`);

    try {
        const pageProps = await fetchPageProps(url);
        
        // 1. Map & Upsert Talent
        const talentData = mapTalentProfile(pageProps);
        if (!talentData) throw new Error('Failed to map talent data');
        
        const talentUuid = await upsertTalent(talentData);
        if (!talentUuid) throw new Error('Failed to upsert talent or retrieve UUID');
        console.log(`   ✅ Talent OK: ${talentData.name} (${talentUuid})`);

        // 2. Map & Upsert Socials
        const socials = mapSocialProfiles(pageProps, talentUuid, nmId);
        if (socials.length > 0) {
            await upsertSocials(socials);
        }

        // 3. Companies & Contacts (Representation section)
        const main = pageProps?.mainColumnData;
        const repEdges = main?.representation?.edges || [];

        for (const edge of repEdges) {
            const node = edge?.node;
            const companyNode = node?.agency?.company;
            
            if (companyNode) {
                // Upsert Company
                const companyId = companyNode.id;
                const mappedCompany = mapCompanyProfile(companyNode, companyId);
                if (mappedCompany) {
                    await upsertCompany(mappedCompany);
                    console.log(`   🏢 Company OK: ${mappedCompany.company_name}`);

                    // Upsert Agents/Contacts nested here
                    const agents = node?.agents || [];
                    for (const agent of agents) {
                        const mappedContact = mapContactProfile(agent, agent.id, mappedCompany.company_name);
                        if (mappedContact) {
                            await upsertContact(mappedContact);
                            console.log(`      👤 Agent OK: ${mappedContact.name_full}`);
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error(`   ❌ Error processing ${nmId}:`, error.message);
    }
}

async function main() {
    console.log('🚀 Starting IMDbPro Discover Pipeline...');
    console.log(`📍 List Page: ${DISCOVER_URL}`);
    await updateWorkflowHeartbeat('Running', `Discovering profiles starting from ${DISCOVER_URL}...`);

    try {
        // Step 1: Fetch list of IDs
        const nmIds = await fetchDiscoverIds(DISCOVER_URL);
        console.log(`📝 Found ${nmIds.length} talent profiles in list.`);
        await updateWorkflowHeartbeat('Running', `Found ${nmIds.length} talent profiles. Starting deep scrapes...`);

        if (nmIds.length === 0) {
            console.log('⚠️  No IDs found. Check your session cookies or Discover URL.');
            return;
        }

        // Step 2: Loop IDs sequentially with random sleep
        for (let i = 0; i < nmIds.length; i++) {
            const nmId = nmIds[i];
            console.log(`\n[${i + 1}/${nmIds.length}]`);
            
            await processNmId(nmId);
            await updateWorkflowHeartbeat('Running', `Processed ${i + 1}/${nmIds.length} profiles from Discovery list.`);

            // Sequential Sleep
            if (i < nmIds.length - 1) {
                const delay = getRandomDelay(8000, 15000);
                console.log(`   ⏳ Sleeping ${Math.round(delay/1000)}s...`);
                await sleep(delay);
            }
        }
        await updateWorkflowHeartbeat('Ready', `Success: Completed ${nmIds.length} profiles from discovery list.`);

    } catch (error) {
        console.error('💥 Pipeline error:', error.message);
    }

    console.log('\n🏁 Pipeline finished.');
}

main().catch(console.error);
