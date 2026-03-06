/**
 * scraper.js — Rate-limited IMDbPro page fetcher using Cheerio
 */

const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

// ─── Session Headers ────────────────────────────────────────────────
const sanitize = (val) => (val || '').trim().replace(/\r?\n|\r/g, '');

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
    const headers = {
        'Cookie':             COOKIE,
        'User-Agent':         USER_AGENT,
        'Accept':             'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    };
    if (SESSION_ID) headers['x-amzn-session-id'] = SESSION_ID;

    const response = await axios.get(url, { headers });
    const $ = cheerio.load(response.data);
    
    // Most IMDb search pages contain IDs in links with data-const-id or within <a> hrefs
    const ids = new Set();
    
    // Look for data-const-id or links containing /nm/
    $('a').each((i, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/\/name\/(nm\d+)/);
        if (match) ids.add(match[1]);
        
        const constId = $(el).attr('data-const-id');
        if (constId && constId.startsWith('nm')) ids.add(constId);
    });

    return Array.from(ids);
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
