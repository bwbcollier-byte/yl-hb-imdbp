/**
 * debug-dump.js — Dumps the full IMDbPro Discover response to a file for analysis
 */
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const sanitize = (val) => {
    let s = (val || '').trim().replace(/\r?\n|\r/g, '');
    if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
    return s;
};

const COOKIE = sanitize(process.env.IMDBPRO_COOKIE);
const USER_AGENT = sanitize(process.env.IMDBPRO_USER_AGENT) || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const SESSION_ID = sanitize(process.env.IMDBPRO_SESSION_ID);

async function main() {
    const url = 'https://pro.imdb.com/discover/people/?profession=any&sortOrder=STARMETER_ASC&ref_=nmnw_nv_ppl_stm';

    const headers = {
        'Cookie': COOKIE,
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
    };
    if (SESSION_ID) headers['x-amzn-session-id'] = SESSION_ID;

    console.log('Fetching page...');
    const response = await axios.get(url, { headers, timeout: 30000 });
    
    // Save full HTML
    fs.writeFileSync('/tmp/imdbpro-discover-dump.html', response.data);
    console.log(`Saved ${response.data.length} bytes to /tmp/imdbpro-discover-dump.html`);

    // Check for __NEXT_DATA__
    const nextDataMatch = response.data.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
        console.log('✅ Found __NEXT_DATA__ script tag!');
        fs.writeFileSync('/tmp/imdbpro-next-data.json', nextDataMatch[1]);
        console.log('Saved to /tmp/imdbpro-next-data.json');
    } else {
        console.log('❌ No __NEXT_DATA__ found.');
    }

    // Search for ANY nm references
    const nmMatches = response.data.match(/nm\d+/gi);
    console.log(`NM matches in full body: ${nmMatches ? nmMatches.length : 0}`);
    if (nmMatches) {
        const unique = [...new Set(nmMatches)];
        console.log(`Unique NM IDs: ${unique.length}`);
        console.log('First 10:', unique.slice(0, 10));
    }

    // Search for common patterns
    const patterns = ['__NEXT_DATA__', 'discoverResults', 'nameConst', 'resultList', 'searchResults', 'personId', 'const_id'];
    for (const p of patterns) {
        const idx = response.data.indexOf(p);
        console.log(`Pattern "${p}": ${idx >= 0 ? `FOUND at position ${idx}` : 'not found'}`);
    }

    // Check for API/fetch URLs that the JS might call
    const apiMatches = response.data.match(/https?:\/\/[^\s"']+api[^\s"']*/gi);
    if (apiMatches) {
        const unique = [...new Set(apiMatches)].slice(0, 10);
        console.log('\nAPI URLs found in page:');
        unique.forEach(u => console.log(`  ${u}`));
    }
}

main().catch(e => console.error('Error:', e.message));
