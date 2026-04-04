require('dotenv').config();
const { fetchCompanyStaff, closeBrowser } = require('./scraper-staff');

(async () => {
    try {
        const staff = await fetchCompanyStaff('co0002521', 'CAA', null, null);
        console.log(`\n✅ Total staff: ${staff.length}`);
        if (staff.length > 0) {
            console.log('First:', staff[0].name_full, '-', staff[0].role);
            console.log('Last:', staff[staff.length-1].name_full, '-', staff[staff.length-1].role);
        }
    } finally {
        await closeBrowser();
    }
})();
