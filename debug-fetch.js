require('dotenv').config();
const fs = require('fs');
const COOKIE = process.env.IMDBPRO_COOKIE;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function debugFetch() {
    const nmId = process.argv[2] || 'nm0002064'; // Giancarlo Esposito by default
    const url = `https://pro.imdb.com/name/${nmId}/contacts`;
    console.log(`\n🔬 Debug fetch: ${url}`);
    console.log(`🍪 Cookie length: ${COOKIE?.length || 0} chars`);
    console.log(`🍪 Cookie starts with: ${COOKIE?.substring(0, 50)}...`);

    const response = await fetch(url, {
        headers: {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9',
            'cookie': COOKIE,
            'user-agent': USER_AGENT,
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"macOS"',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'none',
            'sec-fetch-user': '?1',
            'upgrade-insecure-requests': '1'
        }
    });

    console.log(`📡 Status: ${response.status}`);
    console.log(`📡 Headers:`, Object.fromEntries(response.headers.entries()));

    const html = await response.text();
    console.log(`📄 HTML length: ${html.length} chars`);

    // Save full HTML to file for inspection
    fs.writeFileSync('debug-output.html', html);
    console.log(`💾 Full HTML saved to debug-output.html`);

    // Quick checks
    const hasNextData = html.includes('__NEXT_DATA__');
    const hasContactsSection = html.includes('contacts-section');
    const hasNoContacts = html.includes('no-contacts-section');
    const hasRepCard = html.includes('representation-card');
    const hasAccordion = html.includes('ipc-accordion');
    const hasCompanyLink = html.includes('/company/co');
    const hasSignIn = html.includes('Sign In');
    const titleMatch = html.match(/<title>(.*?)<\/title>/);

    console.log(`\n📊 Content Analysis:`);
    console.log(`   Title: "${titleMatch?.[1] || 'NOT FOUND'}"`);
    console.log(`   __NEXT_DATA__: ${hasNextData}`);
    console.log(`   contacts-section: ${hasContactsSection}`);
    console.log(`   no-contacts-section: ${hasNoContacts}`);
    console.log(`   representation-card: ${hasRepCard}`);
    console.log(`   ipc-accordion: ${hasAccordion}`);
    console.log(`   /company/co links: ${hasCompanyLink}`);
    console.log(`   Sign In redirect: ${hasSignIn}`);

    // If __NEXT_DATA__ exists, show its structure
    if (hasNextData) {
        const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
        if (match) {
            const data = JSON.parse(match[1]);
            console.log(`\n🔑 __NEXT_DATA__ top-level keys:`, Object.keys(data.props?.pageProps || {}));
            if (data.props?.pageProps?.mainColumnData) {
                console.log(`🔑 mainColumnData keys:`, Object.keys(data.props.pageProps.mainColumnData));
            }
        }
    }

    // Show first 500 chars of body content
    const bodyMatch = html.match(/<body[^>]*>([\s\S]{0,2000})/);
    if (bodyMatch) {
        console.log(`\n📋 Body start (first 500 chars):\n${bodyMatch[1].substring(0, 500)}`);
    }
}

debugFetch().catch(e => console.error('💥', e.message));
