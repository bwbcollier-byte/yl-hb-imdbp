const fetch = require('node-fetch');

/**
 * Updates the workflow status and message in Airtable for heartbeat monitoring.
 * @param {string} status - The status (e.g., 'Running', 'Ready', 'Errors')
 * @param {string} message - A descriptive message of the current state
 */
async function updateWorkflowHeartbeat(status, message) {
    const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
    const AIRTABLE_RECORD_ID = process.env.AIRTABLE_RECORD_ID;

    if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID || !AIRTABLE_RECORD_ID) {
        console.warn('⚠️ Airtable heartbeat skipped: Missing environment variables.');
        return;
    }

    try {
        const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Workflows/${AIRTABLE_RECORD_ID}`;
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fields: {
                    'Status': status,
                    'Last Heartbeat Message': message,
                    'Last Heartbeat': new Date().toISOString()
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('❌ Airtable Heartbeat Error:', errorData);
        } else {
            console.log(`📡 Heartbeat: ${status}`);
        }
    } catch (error) {
        console.error('❌ Failed to update Airtable heartbeat:', error.message);
    }
}

module.exports = { updateWorkflowHeartbeat };
