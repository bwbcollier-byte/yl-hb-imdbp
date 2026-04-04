require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');

const COOKIE = process.env.IMDBPRO_COOKIE;

function parseCookies(s) {
    return s.split(';').map(c => {
        const [n, ...r] = c.trim().split('=');
        return { name: n.trim(), value: r.join('=').trim(), domain: '.imdb.com', path: '/' };
    }).filter(c => c.name && c.value);
}

async function debug() {
    const nmId = 'nm1403271'; // Pedro Pascal - known A-lister with many reps
    console.log(`🔬 Deep debugging Pedro Pascal (${nmId})...\n`);
    
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    if (COOKIE) await page.setCookie(...parseCookies(COOKIE));

    const urls = [
        `https://pro.imdb.com/name/${nmId}/`,
        `https://pro.imdb.com/name/${nmId}/contacts`
    ];

    for (const url of urls) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📄 Loading: ${url}`);
        console.log(`${'='.repeat(60)}`);
        
        try {
            // Navigate with retry for WAF
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
                    break;
                } catch (navErr) {
                    console.log(`   ⚠️ Nav attempt ${attempt+1} failed: ${navErr.message}`);
                    await new Promise(r => setTimeout(r, 3000));
                }
            }

            // Take screenshot
            const ssName = `debug_${url.includes('contacts') ? 'contacts' : 'overview'}.png`;
            await page.screenshot({ path: ssName, fullPage: false });
            console.log(`   📸 Screenshot: ${ssName}`);

            // Check current URL (did we get redirected?)
            const currentUrl = page.url();
            console.log(`   🔗 Current URL: ${currentUrl}`);

            // Check page title
            const title = await page.title();
            console.log(`   📋 Title: ${title}`);

            // Extract __NEXT_DATA__ info
            const analysis = await page.evaluate(() => {
                const result = {
                    hasNextData: false,
                    nextDataKeys: [],
                    pagePropsKeys: [],
                    mainColumnDataKeys: [],
                    representationInfo: null,
                    allCompanyLinks: [],
                    bodyTextSample: '',
                    allAgencyPaths: []
                };

                const nextData = document.querySelector('#__NEXT_DATA__');
                if (nextData) {
                    result.hasNextData = true;
                    try {
                        const json = JSON.parse(nextData.innerHTML);
                        result.nextDataKeys = Object.keys(json);
                        
                        if (json.props?.pageProps) {
                            result.pagePropsKeys = Object.keys(json.props.pageProps);
                            
                            if (json.props.pageProps.mainColumnData) {
                                result.mainColumnDataKeys = Object.keys(json.props.pageProps.mainColumnData);
                                
                                const rep = json.props.pageProps.mainColumnData.representation;
                                if (rep) {
                                    result.representationInfo = {
                                        type: typeof rep,
                                        keys: Object.keys(rep),
                                        edgeCount: rep.edges?.length || 0,
                                        totalCount: rep.total || rep.totalCount || null,
                                        firstEdge: rep.edges?.[0] ? JSON.stringify(rep.edges[0]).substring(0, 500) : null
                                    };
                                }
                            }
                        }

                        // Recursive search for ANY mention of "agency" at any depth
                        const agencyPaths = [];
                        const findAgency = (obj, path = '') => {
                            if (!obj || typeof obj !== 'object') return;
                            if (agencyPaths.length > 20) return; // limit
                            for (const [key, val] of Object.entries(obj)) {
                                const currentPath = path ? `${path}.${key}` : key;
                                if (key === 'agency' || key === 'Agency' || key === 'agencies') {
                                    agencyPaths.push({ path: currentPath, type: typeof val, preview: JSON.stringify(val)?.substring(0, 200) });
                                }
                                if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                                    findAgency(val, currentPath);
                                } else if (Array.isArray(val)) {
                                    val.slice(0, 3).forEach((item, i) => findAgency(item, `${currentPath}[${i}]`));
                                }
                            }
                        };
                        findAgency(json.props?.pageProps);
                        result.allAgencyPaths = agencyPaths;
                    } catch (e) {
                        result.parseError = e.message;
                    }
                }

                // Check for company links in DOM
                document.querySelectorAll('a[href*="/company/"]').forEach(l => {
                    result.allCompanyLinks.push({
                        href: l.getAttribute('href'),
                        text: l.innerText.trim().substring(0, 100)
                    });
                });

                // Get a sample of visible text to see what page we're actually on
                result.bodyTextSample = document.body?.innerText?.substring(0, 500) || '';

                return result;
            });

            console.log(`\n   📦 Has __NEXT_DATA__: ${analysis.hasNextData}`);
            if (analysis.parseError) console.log(`   ❌ Parse Error: ${analysis.parseError}`);
            console.log(`   🔑 Next Data Keys: [${analysis.nextDataKeys.join(', ')}]`);
            console.log(`   🔑 PageProps Keys: [${analysis.pagePropsKeys.join(', ')}]`);
            console.log(`   🔑 MainColumnData Keys: [${analysis.mainColumnDataKeys.join(', ')}]`);
            
            if (analysis.representationInfo) {
                console.log(`\n   🎯 REPRESENTATION FOUND!`);
                console.log(`      Type: ${analysis.representationInfo.type}`);
                console.log(`      Keys: [${analysis.representationInfo.keys.join(', ')}]`);
                console.log(`      Edge Count: ${analysis.representationInfo.edgeCount}`);
                console.log(`      Total: ${analysis.representationInfo.totalCount}`);
                if (analysis.representationInfo.firstEdge) {
                    console.log(`      First Edge: ${analysis.representationInfo.firstEdge}`);
                }
            } else {
                console.log(`\n   ⚠️ No 'representation' key in mainColumnData`);
            }

            if (analysis.allAgencyPaths.length > 0) {
                console.log(`\n   🏢 Agency paths found in JSON:`);
                analysis.allAgencyPaths.forEach(p => {
                    console.log(`      ${p.path} (${p.type}): ${p.preview}`);
                });
            } else {
                console.log(`\n   ⚠️ No "agency" key found anywhere in JSON`);
            }

            if (analysis.allCompanyLinks.length > 0) {
                console.log(`\n   🔗 Company links in DOM:`);
                analysis.allCompanyLinks.forEach(l => console.log(`      ${l.href} -> "${l.text}"`));
            } else {
                console.log(`\n   ⚠️ No company links found in DOM`);
            }

            console.log(`\n   📝 Page text sample:\n      "${analysis.bodyTextSample.substring(0, 300)}..."`);

        } catch (e) {
            console.error(`   💥 Error: ${e.message}`);
        }
    }

    await browser.close();
    console.log('\n✅ Debug complete.');
}

debug();
