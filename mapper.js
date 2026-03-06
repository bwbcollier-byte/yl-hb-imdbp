/**
 * mapper.js — Extract structured data from IMDbPro __NEXT_DATA__ JSON
 *
 * Each function takes the raw `pageProps` object and returns a flat row
 * ready for Supabase upsert.  Heavy use of optional chaining (?.) to
 * avoid crashes on missing nodes.
 */

// ─── Helpers ────────────────────────────────────────────────────────
/** Safely join an array of strings, filtering blanks */
function safeJoin(arr, sep = ', ') {
    if (!Array.isArray(arr)) return null;
    const cleaned = arr.filter(Boolean);
    return cleaned.length > 0 ? cleaned.join(sep) : null;
}

/** Split "First Middle Last" into { first_name, last_name } */
function splitName(fullName) {
    if (!fullName) return { first_name: null, last_name: null };
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return { first_name: parts[0], last_name: null };
    const last_name = parts.pop();
    const first_name = parts.join(' ');
    return { first_name, last_name };
}

// ─── Talent Profile Mapper ──────────────────────────────────────────
/**
 * Maps pageProps from an IMDbPro /name/nmXXXXXXX/ page.
 *
 * Key paths inspected:
 *   aboveTheFold.id
 *   aboveTheFold.nameText.text
 *   aboveTheFold.primaryImage.url
 *   aboveTheFold.professions[].profession.text
 *   aboveTheFold.knownFor.edges[].node.title.titleText.text
 *   mainColumnData.representation.edges[].node.relationshipType.text
 *   mainColumnData.representation.edges[].node.agency.company.companyText.text
 *   mainColumnData.representation.edges[].node.agents[].name.nameText.text
 */
function mapTalentProfile(pageProps) {
    const atf  = pageProps?.aboveTheFold;
    const main = pageProps?.mainColumnData;

    if (!atf?.id) return null;

    // ── Basic Info ──
    const imdb_id    = atf.id;
    const name       = atf?.nameText?.text || null;
    const imdb_image = atf?.primaryImage?.url || null;

    // ── Professions ──
    const professions = safeJoin(
        (atf?.professions || []).map(p => p?.profession?.text)
    );

    // ── Birth Info ──
    const birthday     = atf?.birthDate?.dateComponents
        ? [atf.birthDate.dateComponents.year, atf.birthDate.dateComponents.month, atf.birthDate.dateComponents.day].filter(Boolean).join('-')
        : null;
    const birthyear    = atf?.birthDate?.dateComponents?.year?.toString() || null;
    const location_born = atf?.birthLocation?.text || null;

    // ── Bio ──
    const imdb_about = atf?.bio?.text?.plainText || atf?.bio?.text?.plaidHtml || null;

    // ── Known For ──
    const imdb_known_for_titles = safeJoin(
        (atf?.knownFor?.edges || []).map(e => e?.node?.title?.titleText?.text)
    );

    // ── Representation ──
    const repBuckets = {
        com_management:           [],
        com_talent_agent:         [],
        com_publicist:            [],
        com_legal_representative: []
    };

    const repEdges = main?.representation?.edges || [];
    for (const edge of repEdges) {
        const node    = edge?.node;
        const relType = (node?.relationshipType?.text || '').toLowerCase();
        const company = node?.agency?.company?.companyText?.text;

        if (!company) continue;

        const agentNames = (node?.agents || [])
            .map(a => a?.name?.nameText?.text)
            .filter(Boolean);

        const entry = agentNames.length > 0
            ? `${company} (${agentNames.join(', ')})`
            : company;

        if (relType.includes('manager') || relType.includes('management')) {
            repBuckets.com_management.push(entry);
        } else if (relType.includes('agent')) {
            repBuckets.com_talent_agent.push(entry);
        } else if (relType.includes('publicist')) {
            repBuckets.com_publicist.push(entry);
        } else if (relType.includes('legal') || relType.includes('attorney') || relType.includes('lawyer')) {
            repBuckets.com_legal_representative.push(entry);
        }
    }

    // ── Act Type (Person vs. Group) ──
    const act_type = atf?.entityType || null;

    return {
        imdb_id,
        name,
        professions,
        act_type,
        birthday,
        birthyear,
        location_born,
        imdb_about,
        com_management:           safeJoin(repBuckets.com_management, ' | '),
        com_talent_agent:         safeJoin(repBuckets.com_talent_agent, ' | '),
        com_publicist:            safeJoin(repBuckets.com_publicist, ' | '),
        com_legal_representative: safeJoin(repBuckets.com_legal_representative, ' | '),
        imdb_known_for_titles,
        imdbpro_url: `https://pro.imdb.com/name/${imdb_id}/`,
        imdb_image,
        updated_at:  new Date().toISOString()
    };
}

// ─── Company Profile Mapper ─────────────────────────────────────────
/**
 * Maps pageProps from an IMDbPro /company/coXXXXXXX/ page.
 *
 * Key paths inspected:
 *   aboveTheFold.id (or companyId)
 *   aboveTheFold.companyText.text
 *   mainColumnData.branches[0].physicalAddress.*
 *   mainColumnData.branches[0].directContact.phoneNumbers[0].number
 *   mainColumnData.branches[0].directContact.emailAddresses[0].email
 */
function mapCompanyProfile(pageProps, fallbackId) {
    const atf  = pageProps?.aboveTheFold || pageProps;
    const main = pageProps?.mainColumnData || pageProps;

    const id_imdb = fallbackId || atf?.id || atf?.companyId;
    if (!id_imdb) return null;

    const company_name = atf?.companyText?.text
                      || atf?.nameText?.text
                      || main?.companyText?.text
                      || null;

    // ── Branch / Office Info ──
    const branches = main?.branches || atf?.branches || [];
    const hq       = branches[0]; // Use first branch as HQ

    let address  = null, city = null, state = null, postcode = null;
    let country  = null, phone = null, fax = null, email = null;
    let logo_url = null;

    if (hq) {
        const addr = hq?.physicalAddress;
        if (addr) {
            // Some pages use a single .text field, others have structured fields
            if (addr.streetAddress || addr.city) {
                address  = addr.streetAddress || null;
                city     = addr.city || null;
                state    = addr.stateProvince || addr.state || null;
                postcode = addr.postalCode || null;
                country  = addr.country || null;
            } else if (addr.text) {
                address = addr.text;
            }
        }

        // Phone / Fax
        const phones = hq?.directContact?.phoneNumbers || [];
        for (const p of phones) {
            if (p?.type?.toLowerCase() === 'fax') {
                fax = fax || p.number;
            } else {
                phone = phone || p.number;
            }
        }

        // Email
        const emails = hq?.directContact?.emailAddresses || [];
        email = emails[0]?.email
             || hq?.directContact?.emailAddress
             || null;
    }

    // Logo
    logo_url = atf?.primaryImage?.url || null;

    // Type  (e.g. "Talent Agency", "Production Company")
    const type = safeJoin(
        (atf?.companyTypes || atf?.types || []).map(t => t?.text || t)
    );

    return {
        id_imdb,
        company_name,
        type,
        address,
        city,
        state,
        postcode,
        country,
        phone,
        fax,
        email,
        logo_url,
        url_imdbpro: `https://pro.imdb.com/company/${id_imdb}/`,
        updated_at:  new Date().toISOString()
    };
}

// ─── Contact (Agent / Staff) Mapper ─────────────────────────────────
/**
 * Maps a contact/agent record.
 * Contacts are usually nested inside a Company page under staff/employees,
 * or can be their own /name/ page for agents.
 *
 * @param {object}  contactNode       The individual contact node from the JSON
 * @param {string}  fallbackId        The nm ID extracted from the URL
 * @param {string}  parentCompanyName The company this contact belongs to
 */
function mapContactProfile(contactNode, fallbackId, parentCompanyName) {
    if (!contactNode) return null;

    const id_imdb   = fallbackId || contactNode?.id || contactNode?.nameId;
    const name_full = contactNode?.nameText?.text || contactNode?.name || null;
    const { first_name, last_name } = splitName(name_full);

    // Role / Title
    const role = contactNode?.title
              || contactNode?.jobTitle
              || contactNode?.primaryProfession?.text
              || safeJoin((contactNode?.professions || []).map(p => p?.profession?.text))
              || null;

    // Contact info
    const email = contactNode?.employeeContact?.emailAddress
               || contactNode?.directContact?.emailAddresses?.[0]?.email
               || contactNode?.email
               || null;

    const phone = contactNode?.employeeContact?.phoneNumbers?.[0]?.number
               || contactNode?.directContact?.phoneNumbers?.[0]?.number
               || contactNode?.phone
               || null;

    // Image
    const image_url = contactNode?.primaryImage?.url || null;

    return {
        id_imdb,
        name_full,
        first_name,
        last_name,
        company_name: parentCompanyName || null,
        role,
        email,
        phone,
        url_imdb:   id_imdb ? `https://pro.imdb.com/name/${id_imdb}/` : null,
        image_url,
        updated_at: new Date().toISOString()
    };
}

// ─── Bulk Contact Extractor ─────────────────────────────────────────
/**
 * Given a Company pageProps, extract ALL staff/employee contacts
 * so they can be bulk-upserted into crm_contacts.
 *
 * Looks for paths like:
 *   mainColumnData.staff.edges[].node
 *   mainColumnData.employees.edges[].node
 */
function extractContactsFromCompany(pageProps) {
    const main = pageProps?.mainColumnData || pageProps;
    const companyName = pageProps?.aboveTheFold?.companyText?.text || null;

    const contacts = [];

    // Try multiple possible node paths for staff/employees
    const staffPaths = [
        main?.staff?.edges,
        main?.employees?.edges,
        main?.companyContacts?.edges,
        main?.contacts?.edges,
    ];

    for (const edges of staffPaths) {
        if (!Array.isArray(edges)) continue;
        for (const edge of edges) {
            const node = edge?.node;
            if (!node) continue;
            const mapped = mapContactProfile(node, node?.id || node?.nameId, companyName);
            if (mapped?.id_imdb) contacts.push(mapped);
        }
    }

    return contacts;
}

module.exports = {
    mapTalentProfile,
    mapCompanyProfile,
    mapContactProfile,
    extractContactsFromCompany,
    splitName,
    safeJoin
};
