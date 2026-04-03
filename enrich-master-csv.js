/**
 * enrich-master-csv.js — IMDbPro Enrichment Runner for Master CSV Files
 * 
 * This script reads Master_Talent.csv, identifies records needing IMDbPro enrichment,
 * scrapes their contact/rep data, and updates:
 *   - Master_Talent.csv (linking fields)
 *   - Master_Companies.csv (agency data)
 *   - Master_Contacts.csv (agent data)
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
require('dotenv').config();

const { fetchPageProps, sleep, getRandomDelay } = require('./scraper');
const {
    mapTalentProfile,
    mapCompanyProfile,
    mapContactProfile,
    extractContactsFromCompany
} = require('./mapper');

// --- CONFIGURATION ---
const MASTER_EXPORTS_DIR = '/Users/ben/Documents/Scripts & Tasks/Databases/Master_Exports';
const TALENT_CSV = path.join(MASTER_EXPORTS_DIR, 'Master_Talent.csv');
const COMPANIES_CSV = path.join(MASTER_EXPORTS_DIR, 'Master_Companies.csv');
const CONTACTS_CSV = path.join(MASTER_EXPORTS_DIR, 'Master_Contacts.csv');

// --- FILE HELPERS ---
function loadCSV(filePath) {
    if (!fs.existsSync(filePath)) {
        console.warn(`⚠️  File not found: ${filePath}. Returning empty array.`);
        return [];
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return parse(content, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true
    });
}

function saveCSV(filePath, data) {
    if (data.length === 0) return;
    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(h => {
            let val = row[h] || '';
            if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
                return `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        }).join(','))
    ].join('\n');
    fs.writeFileSync(filePath, csvContent, 'utf-8');
}

// --- CORE PIPELINE ---
async function runEnrichment(limit = null) {
    console.log('🚀 Starting IMDbPro Master CSV Enrichment Pipeline...');

    const talentData = loadCSV(TALENT_CSV);
    const companiesData = loadCSV(COMPANIES_CSV);
    const contactsData = loadCSV(CONTACTS_CSV);

    console.log(`📋 Loaded ${talentData.length.toLocaleString()} talent records.`);

    // 1. Identify targets: has imdb_id but missing representative data
    // We'll look for nm... IDs in the imdb_id column
    const targets = talentData.filter(t => 
        t.imdb_id && t.imdb_id.startsWith('nm') && 
        (!t.com_talent_agent && !t.com_management)
    );

    console.log(`🔍 Found ${targets.length.toLocaleString()} talent records to enrich.`);

    let processList = limit ? targets.slice(0, limit) : targets;
    console.log(`▶️  Processing ${processList.length} records...`);

    let successCount = 0;

    for (let i = 0; i < processList.length; i++) {
        const talent = processList[i];
        const imdbId = talent.imdb_id;
        const url = `https://pro.imdb.com/name/${imdbId}/`;

        console.log(`\n[${i + 1}/${processList.length}] 🔍 Scraping Talent: ${talent.name} (${imdbId})`);

        try {
            const pageProps = await fetchPageProps(url);
            const mappedTalent = mapTalentProfile(pageProps);

            if (!mappedTalent) {
                console.log(`   ⚠️  Failed to map talent data for ${imdbId}`);
                continue;
            }

            // Update Master_Talent row
            const talentIdx = talentData.findIndex(t => t.imdb_id === imdbId);
            if (talentIdx !== -1) {
                talentData[talentIdx].com_management = mappedTalent.com_management;
                talentData[talentIdx].com_talent_agent = mappedTalent.com_talent_agent;
                talentData[talentIdx].com_publicist = mappedTalent.com_publicist;
                talentData[talentIdx].com_legal_representative = mappedTalent.com_legal_representative;
                talentData[talentIdx].imdb_about = mappedTalent.imdb_about;
                talentData[talentIdx].imdb_image = mappedTalent.imdb_image;
                talentData[talentIdx].act_type = mappedTalent.act_type;
                talentData[talentIdx].professions = mappedTalent.professions;
                talentData[talentIdx].last_update = new Date().toISOString();

                // Update processing log
                const now = new Date();
                const proc_date = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
                const proc_entry = `${proc_date} IMDbPro Enrichment Complete`;
                const existingProc = talentData[talentIdx].processing || '';
                talentData[talentIdx].processing = existingProc ? `${existingProc} | ${proc_entry}` : proc_entry;
            }

            // Process Representatives (Companies & Agents)
            if (mappedTalent.structured_reps && mappedTalent.structured_reps.length > 0) {
                console.log(`   📇 Found ${mappedTalent.structured_reps.length} reps. Processing...`);
                
                for (const rep of mappedTalent.structured_reps) {
                    const companyId = rep.companyId;
                    const companyName = rep.company;

                    // 🏢 Handle Company
                    if (companyId) {
                        const existingComp = companiesData.find(c => c.id_imdb === companyId);
                        if (!existingComp) {
                            console.log(`      🏢 Adding new company: ${companyName} (${companyId})`);
                            companiesData.push({
                                name: companyName,
                                company_name: companyName,
                                id_imdb: companyId,
                                identifier: companyId,
                                url_imdbpro: `https://pro.imdb.com/company/${companyId}/`,
                                status: 'todo',
                                created_at: new Date().toISOString(),
                                updated_at: new Date().toISOString()
                            });
                        }
                    }

                    // 👤 Handle Agents
                    if (rep.agents && rep.agents.length > 0) {
                        for (const agent of rep.agents) {
                            const agentId = agent.id;
                            const agentName = agent.name;
                            if (agentId) {
                                const existingContact = contactsData.find(c => c.id_imdb === agentId);
                                if (!existingContact) {
                                    console.log(`      👤 Adding new contact: ${agentName} (${agentId})`);
                                    contactsData.push({
                                        name_full: agentName,
                                        id_imdb: agentId,
                                        company_name: companyName,
                                        url_imdb: `https://pro.imdb.com/name/${agentId}/`,
                                        status: 'todo',
                                        created_at: new Date().toISOString(),
                                        updated_at: new Date().toISOString()
                                    });
                                }
                            }
                        }
                    }
                }
            }

            successCount++;
            
            // Auto-save every 10 successes or at the end
            if (successCount % 10 === 0) {
                console.log('💾 Saving progress to CSV files...');
                saveCSV(TALENT_CSV, talentData);
                saveCSV(COMPANIES_CSV, companiesData);
                saveCSV(CONTACTS_CSV, contactsData);
            }

        } catch (err) {
            console.error(`   ❌ Error for ${imdbId}: ${err.message}`);
        }

        // Delay between 8 and 15 seconds
        const delay = getRandomDelay(8000, 15000);
        console.log(`   ⏳ Sleeping ${(delay / 1000).toFixed(1)}s...`);
        await sleep(delay);
    }

    // Final save
    console.log('💾 Performing final save...');
    saveCSV(TALENT_CSV, talentData);
    saveCSV(COMPANIES_CSV, companiesData);
    saveCSV(CONTACTS_CSV, contactsData);

    console.log(`\n🎉 Enrichment complete! Processed ${successCount} records successfully.`);
}

// --- ARGS ---
const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 10; // Default limit 10 for safety

runEnrichment(limit).catch(err => {
    console.error('💥 Fatal Pipeline Error:', err);
    process.exit(1);
});
