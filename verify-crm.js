require('dotenv').config();
const { supabase } = require('./db');

async function verify() {
    console.log("📍 Auditing Hypebase CRM Induction...");
    
    const { data: talent } = await supabase
        .from('hb_talent')
        .select('name, agenct_companies, management_companies, contacts_updated')
        .not('contacts_updated', 'is', null)
        .order('contacts_updated', { ascending: false })
        .limit(10);

    if (!talent || talent.length === 0) {
        console.log("🤷 No records found in hb_talent yet.");
    } else {
        console.table(talent.map(t => ({
            Talent: t.name,
            Agents: t.agenct_companies?.length || 0,
            Managers: t.management_companies?.length || 0,
            Updated: t.contacts_updated
        })));
    }

    const { count: companyCount } = await supabase
        .from('hb_companies')
        .select('*', { count: 'exact', head: true });

    const { count: contactCount } = await supabase
        .from('hb_contacts')
        .select('*', { count: 'exact', head: true });

    console.log(`\n🏢 CRM Companies in Register: ${companyCount}`);
    console.log(`👤 CRM Contacts (Staff) in Register: ${contactCount}`);
}
verify();
