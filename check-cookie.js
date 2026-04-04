require('dotenv').config();
const { fetchPageProps, closeBrowser } = require('./scraper');

async function check() {
    console.log("🩺 Checking IMDbPro Connection Status...");
    try {
        // Checking Tom Cruise (Always has reps)
        const reps = await fetchPageProps("https://pro.imdb.com/name/nm0000129/");
        if (reps.length > 0) {
            console.log(`✅ SUCCESS! Found ${reps.length} representation entries for Tom Cruise.`);
            console.log("🚀 Your IMDBPRO_COOKIE is alive and healthy.");
        } else {
            console.log("❌ FAILURE: Cookie is likely EXPIRED or INVALID.");
            console.log("🤷 Result count is 0. You are being served the Public/Guest view.");
        }
    } catch (e) {
        console.error("💥 Error during check: " + e.message);
    } finally {
        await closeBrowser();
    }
}
check();
