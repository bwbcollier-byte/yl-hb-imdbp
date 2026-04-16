/**
 * imdb-top-news-scraper.js — Scrapes IMDb Top News (/news/top/)
 * 
 * Uses Puppeteer to load the page, click "50 more" to paginate,
 * then parses article cards and cross-references nm/tt IDs against
 * hb_socials and hb_media to tag linked talent/media in the news table.
 * 
 * Usage:  node imdb-top-news-scraper.js
 * Env:    MAX_PAGES (default 5) — how many "50 more" clicks to perform
 */

require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { supabase } = require('./db');

puppeteer.use(StealthPlugin());

const MAX_PAGES = parseInt(process.env.MAX_PAGES || '5', 10);
const BATCH_SIZE = 20; // upsert in batches for efficiency

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── Date Parsing ───────────────────────────────────────────────────
function parseDateStr(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (!isNaN(d.valueOf())) return d;
    if (dateStr.includes('ago')) {
        const hoursMatch = dateStr.match(/(\d+)\s+hour/);
        const daysMatch  = dateStr.match(/(\d+)\s+day/);
        const minMatch   = dateStr.match(/(\d+)\s+min/);
        const now = new Date();
        if (hoursMatch) now.setHours(now.getHours() - parseInt(hoursMatch[1]));
        if (daysMatch)  now.setDate(now.getDate() - parseInt(daysMatch[1]));
        if (minMatch)   now.setMinutes(now.getMinutes() - parseInt(minMatch[1]));
        return now;
    }
    return null;
}

// ─── Extract articles from the loaded page ──────────────────────────
async function extractArticles(page) {
    return page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.ipc-list-card--border-line'));
        return cards.map(el => {
            const titleLink = el.querySelector('a[data-testid="item-text-with-link"]');
            if (!titleLink) return null;

            const contentDiv = el.querySelector('.ipc-html-content-inner-div');
            const fullText = contentDiv ? contentDiv.innerText : '';
            const sourceMatch = fullText.match(/See full article at (.+)/);
            const listItems = Array.from(el.querySelectorAll('ul.ipc-inline-list li'));
            const dateStr = listItems.length > 0 ? listItems[0].innerText : null;

            const imgEl = el.querySelector('img.ipc-image');
            let imgUrl = imgEl ? (imgEl.src || imgEl.getAttribute('data-src')) : null;
            if (imgUrl && imgUrl.includes('._V1_')) {
                imgUrl = imgUrl.replace(/\._V1_.*?(\.\w+)$/, '._V1_UX1200$1');
            }

            // Extract all IMDb entity links (nm/tt IDs)
            const relatedIds = [];
            if (contentDiv) {
                const links = Array.from(contentDiv.querySelectorAll('a'));
                links.forEach(a => {
                    const href = a.getAttribute('href');
                    const m = href?.match(/\/(nm\d+|tt\d+)\/?/);
                    if (m) relatedIds.push(m[1]);
                });
            }

            return {
                title: titleLink.innerText.trim(),
                text: fullText,
                source: sourceMatch ? sourceMatch[1].trim() : null,
                published: dateStr,
                link: titleLink.href ? titleLink.href.split('?')[0] : null,
                img: imgUrl,
                relatedIds: [...new Set(relatedIds)]
            };
        }).filter(Boolean);
    });
}

// ─── Batch lookup helpers ───────────────────────────────────────────
async function buildNmLookup(nmIds) {
    if (nmIds.length === 0) return {};
    const lookup = {};
    // Query in batches of 100 to avoid URI length limits
    for (let i = 0; i < nmIds.length; i += 100) {
        const batch = nmIds.slice(i, i + 100);
        const { data } = await supabase
            .from('hb_socials')
            .select('identifier, linked_talent')
            .in('identifier', batch);
        if (data) {
            data.forEach(s => { if (s.linked_talent) lookup[s.identifier] = s.linked_talent; });
        }
    }
    return lookup;
}

async function buildTtLookup(ttIds) {
    if (ttIds.length === 0) return {};
    const lookup = {};
    for (let i = 0; i < ttIds.length; i += 100) {
        const batch = ttIds.slice(i, i + 100);
        const { data } = await supabase
            .from('hb_media')
            .select('id, soc_imdb_id')
            .in('soc_imdb_id', batch);
        if (data) {
            data.forEach(m => { if (m.soc_imdb_id) lookup[m.soc_imdb_id] = m.id; });
        }
    }
    return lookup;
}

// ─── Check which articles already exist ─────────────────────────────
async function filterNewArticles(articles) {
    const links = articles.map(a => a.link).filter(Boolean);
    if (links.length === 0) return articles;

    const existing = new Set();
    for (let i = 0; i < links.length; i += 100) {
        const batch = links.slice(i, i + 100);
        const { data } = await supabase
            .from('news')
            .select('source_link')
            .in('source_link', batch);
        if (data) data.forEach(row => existing.add(row.source_link));
    }

    return articles.filter(a => a.link && !existing.has(a.link));
}

// ─── Main Pipeline ──────────────────────────────────────────────────
async function run() {
    console.log(`\n📰 IMDb Top News Scraper`);
    console.log(`   Max "50 more" clicks: ${MAX_PAGES}`);
    console.log('─'.repeat(60));

    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    try {
        // 1. Load the top news page
        console.log('\n🌐 Loading https://www.imdb.com/news/top/ ...');
        await page.goto('https://www.imdb.com/news/top/', { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(3000);

        // 2. Click "50 more" button to load additional articles
        for (let click = 1; click <= MAX_PAGES; click++) {
            try {
                const moreBtn = await page.$('.ipc-see-more__button');
                if (!moreBtn) {
                    console.log(`   ℹ️  No more "50 more" button found after ${click - 1} clicks.`);
                    break;
                }
                await moreBtn.scrollIntoView();
                await moreBtn.click();
                console.log(`   📄 Clicked "50 more" (${click}/${MAX_PAGES})...`);
                await sleep(3000);
            } catch (e) {
                console.log(`   ℹ️  Pagination ended after ${click - 1} clicks: ${e.message}`);
                break;
            }
        }

        // 3. Extract all visible articles
        const allArticles = await extractArticles(page);
        console.log(`\n📦 Extracted ${allArticles.length} total articles from the page.`);

        // 4. Filter out articles we already have
        const newArticles = await filterNewArticles(allArticles);
        console.log(`   ${allArticles.length - newArticles.length} already in database. ${newArticles.length} new to process.`);

        if (newArticles.length === 0) {
            console.log('\n✅ No new articles to insert.');
            await browser.close();
            return;
        }

        // 5. Build lookup maps for nm/tt IDs
        const allNmIds = [...new Set(newArticles.flatMap(a => a.relatedIds.filter(id => id.startsWith('nm'))))];
        const allTtIds = [...new Set(newArticles.flatMap(a => a.relatedIds.filter(id => id.startsWith('tt'))))];

        console.log(`\n🔗 Cross-referencing ${allNmIds.length} talent IDs and ${allTtIds.length} media IDs...`);
        const [nmMap, ttMap] = await Promise.all([buildNmLookup(allNmIds), buildTtLookup(allTtIds)]);
        console.log(`   Found ${Object.keys(nmMap).length} talent matches, ${Object.keys(ttMap).length} media matches.`);

        // 6. Insert new articles
        let insertedCount = 0;
        let errorCount = 0;

        for (let i = 0; i < newArticles.length; i += BATCH_SIZE) {
            const batch = newArticles.slice(i, i + BATCH_SIZE);
            const payloads = batch.map(item => {
                const pubDate = parseDateStr(item.published)?.toISOString() || null;
                const talentUuids = [...new Set(item.relatedIds.map(id => nmMap[id]).filter(Boolean))];
                const mediaUuids = item.relatedIds.map(id => ttMap[id]).filter(Boolean);

                return {
                    article_title: item.title,
                    article: item.text,
                    source_name: item.source || 'IMDb',
                    source_link: item.link,
                    source_favicon: 'https://m.media-amazon.com/images/G/01/imdb/images-ANDW73HA/favicon_desktop_32x32._CB1582158068_.png',
                    image_primary: item.img,
                    published: pubDate,
                    status: 'published',
                    public_visible: true,
                    tagged_talent: talentUuids,
                    tagged_media: mediaUuids,
                    linked_talent_ids: item.relatedIds.filter(id => id.startsWith('nm')),
                    linked_media_ids: item.relatedIds.filter(id => id.startsWith('tt'))
                };
            });

            const { error } = await supabase.from('news').upsert(payloads, { onConflict: 'source_link' });
            if (error) {
                console.error(`   ❌ Batch insert error:`, error.message);
                errorCount += batch.length;
            } else {
                insertedCount += batch.length;
                console.log(`   ✅ Inserted batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} articles)`);
            }
        }

        console.log('\n' + '─'.repeat(60));
        console.log(`🏁 Done! Inserted: ${insertedCount} | Errors: ${errorCount} | Skipped: ${allArticles.length - newArticles.length}`);

    } catch (e) {
        console.error('💥 Fatal error:', e.message);
    } finally {
        await browser.close();
    }
}

run();
