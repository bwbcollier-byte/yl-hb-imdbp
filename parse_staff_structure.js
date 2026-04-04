const fs = require('fs');
const d = JSON.parse(fs.readFileSync('company_caa_staff.json'));

function findKey(obj, key, path='') {
    if (!obj || typeof obj !== 'object') return [];
    let results = [];
    if (key in obj) results.push({ path: path + '.' + key, value: typeof obj[key] });
    for (let k in obj) {
        results.push(...findKey(obj[k], key, path + '.' + k));
    }
    return results;
}

// Find keyStaff
let paths = findKey(d, 'keyStaff');
console.log('keyStaff paths:', paths);

// Get first staff node shape
function search(obj, key) {
    if(!obj || typeof obj !== 'object') return null;
    if(key in obj) return obj[key];
    for(let k in obj) {
        let res = search(obj[k], key);
        if(res) return res;
    }
    return null;
}

let ks = search(d, 'keyStaff');
if (ks && ks.edges && ks.edges.length > 0) {
    let node = ks.edges[0].node;
    console.log('\n--- First Staff Node Keys ---');
    console.log(JSON.stringify(node, null, 2).substring(0, 2000));
    console.log('\n--- Total edges ---', ks.edges.length);
    console.log('--- Has pageInfo? ---', ks.pageInfo);
}
