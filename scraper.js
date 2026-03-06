/**
 * scraper.js — Rate-limited IMDbPro page fetcher using Cheerio
 */

const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

// ─── Session Headers ────────────────────────────────────────────────
const sanitize = (val) => {
    let s = (val || '').trim().replace(/\r?\n|\r/g, '');
    // Remove surrounding quotes if they exist
    if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
    return s;
};

const COOKIE      = sanitize(process.env.IMDBPRO_COOKIE);
const USER_AGENT  = sanitize(process.env.IMDBPRO_USER_AGENT) || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const SESSION_ID  = sanitize(process.env.IMDBPRO_SESSION_ID);

/**
 * Scrapes an IMDbPro search list or discover page for NM IDs.
 *
 * @param {string} url  The Discover People or search results URL
 * @returns {string[]}  Array of NM IDs (nmXXXXXXX)
 */
async function fetchDiscoverIds(url) {
    if (!COOKIE) {
        throw new Error('IMDBPRO_COOKIE is not set.');
    }

    const headers = {
        'Cookie':             COOKIE,
        'User-Agent':         USER_AGENT,
        'Accept':             'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Encoding':    'gzip, deflate, br, zstd',
        'Accept-Language':    'en-GB,en-US;q=0.9,en;q=0.8',
        'Cache-Control':      'max-age=0',
        'Referer':            'https://pro.imdb.com/',
        'Sec-Ch-Ua':          '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        'Sec-Ch-Ua-Mobile':   '?0',
        'Sec-Ch-Ua-Platform': '"macOS"',
        'Sec-Fetch-Dest':     'document',
        'Sec-Fetch-Mode':     'navigate',
        'Sec-Fetch-Site':     'same-origin',
        'Sec-Fetch-User':     '?1',
        'Upgrade-Insecure-Requests': '1'
    };
    if (SESSION_ID) headers['x-amzn-session-id'] = SESSION_ID;

    const response = await axios.get(url, { 
        headers, 
        timeout: 30000, 
        validateStatus: (s) => true 
    });

    console.log(`   📡 Status: ${response.status}`);

    if (typeof response.data !== 'string') {
        throw new Error(`Invalid response data type: ${typeof response.data}`);
    }

    const $ = cheerio.load(response.data);
    const pageTitle = $('title').text().trim();
    console.log(`   📄 Page Title: "${pageTitle}"`);

    // Check for login redirect
    if (response.data.includes('Sign in') && response.data.includes('ap_email') || pageTitle.includes('Sign In')) {
        throw new Error('Session invalid — page redirected to IMDb login.');
    }

    const ids = new Set();

    // 1. Classic scan of links & data attributes
    $('a').each((i, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/\/[nN][mM]\d{2,}/); 
        if (match) {
            const idMatch = match[0].match(/[nN][mM]\d+/);
            if (idMatch) ids.add(idMatch[0].toLowerCase());
        }

        const constId = $(el).attr('data-const-id');
        if (constId && constId.toLowerCase().startsWith('nm')) ids.add(constId.toLowerCase());
    });

    // 2. Scan JSON blobs (__NEXT_DATA__)
    const scriptContent = $('script#__NEXT_DATA__[type="application/json"]').html();
    if (scriptContent) {
        const matches = scriptContent.match(/[nN][mM]\d{6,}/g);
        if (matches) {
            matches.forEach(m => ids.add(m.toLowerCase()));
        }
    }

    // 3. Fallback: Scan whole HTML as a safety measure
    const pageMatches = response.data.match(/[nN][mM]\d{6,}/g);
    if (pageMatches) {
        pageMatches.forEach(m => ids.add(m.toLowerCase()));
    }

    const results = Array.from(ids);

    if (results.length === 0) {
        console.warn('   ⚠️  No IDs found in response body.');
        console.log('   📄 Body Preview (first 1000 chars):');
        console.log('   -------------------------------------------------');
        console.log(response.data.slice(0, 1000).replace(/\s+/g, ' '));
        console.log('   -------------------------------------------------');
    }
    
    return results;
}

// ─── Helpers ────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Returns a random int between min and max (inclusive), in ms */
function getRandomDelay(min = 8000, max = 15000) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─── Core Fetcher ───────────────────────────────────────────────────
/**
 * Fetch an IMDbPro page and extract the __NEXT_DATA__ JSON payload.
 *
 * @param {string} url  Full IMDbPro URL
 * @returns {object}    The parsed __NEXT_DATA__ object (full root, not just pageProps)
 */
async function fetchPage(url) {
    if (!COOKIE) {
        throw new Error('IMDBPRO_COOKIE is not set in .env — authentication will fail.');
    }

    const headers = {
        'Cookie':             COOKIE,
        'User-Agent':         USER_AGENT,
        'Accept':             'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language':    'en-US,en;q=0.9',
        'Cache-Control':     'no-cache',
        'Sec-Fetch-Dest':    'document',
        'Sec-Fetch-Mode':    'navigate',
        'Sec-Fetch-Site':    'none',
    };

    // Only add session ID if provided
    if (SESSION_ID) {
        headers['x-amzn-session-id'] = SESSION_ID;
    }

    const response = await axios.get(url, {
        headers,
        timeout: 30000,               // 30s timeout
        maxRedirects: 5,
        validateStatus: (s) => s < 400 // treat 3xx as OK
    });

    // Check for login redirect or blocked page
    if (typeof response.data !== 'string') {
        throw new Error(`Response is not HTML (got ${typeof response.data}). Possible auth failure.`);
    }
    if (response.data.includes('Sign in') && response.data.includes('ap_email')) {
        throw new Error('Session expired — page returned IMDb login form.');
    }

    const $ = cheerio.load(response.data);
    const scriptContent = $('script#__NEXT_DATA__[type="application/json"]').html();

    if (!scriptContent) {
        // Dump a snippet of the page so we can debug
        const title = $('title').text();
        throw new Error(`__NEXT_DATA__ not found on page. Page title: "${title}"`);
    }

    const parsed = JSON.parse(scriptContent);
    return parsed;
}

/**
 * Convenience wrapper that returns only props.pageProps from the __NEXT_DATA__.
 */
async function fetchPageProps(url) {
    const data = await fetchPage(url);
    const pageProps = data?.props?.pageProps;
    if (!pageProps) {
        throw new Error('Parsed __NEXT_DATA__ but props.pageProps is missing or empty.');
    }
    return pageProps;
}

module.exports = { fetchPage, fetchPageProps, fetchDiscoverIds, sleep, getRandomDelay };
