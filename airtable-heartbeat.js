async function updateWorkflowHeartbeat(status, message) {
    const { AIRTABLE_PAT, AIRTABLE_BASE_ID, AIRTABLE_RECORD_ID } = process.env;
    if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID || !AIRTABLE_RECORD_ID) return;
    try {
        const url = "https://api.airtable.com/v0/" + AIRTABLE_BASE_ID + "/" + AIRTABLE_RECORD_ID;
        await fetch(url, {
            method: 'PATCH',
            headers: { 'Authorization': 'Bearer ' + AIRTABLE_PAT, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { 'Status': status, 'Details': message } })
        });
    } catch (e) { console.error('❌ Heartbeat Error:', e.message); }
}
module.exports = { updateWorkflowHeartbeat };
