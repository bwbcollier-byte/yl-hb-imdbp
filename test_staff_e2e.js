require('dotenv').config();
const { fetchCompanyStaff, closeBrowser, sleep } = require('./scraper-staff');

(async () => {
    try {
        // Test on a small company first
        const staff = await fetchCompanyStaff('co0442916', 'Expression! Arts Management', null, null);
        console.log(`\n✅ Total staff: ${staff.length}`);
        if (staff.length > 0) {
            console.log('Sample:', JSON.stringify(staff[0], null, 2));
        }
    } finally {
        await closeBrowser();
    }
})();
