const fs = require('fs');
function search(obj, key) {
    if(!obj || typeof obj !== 'object') return null;
    if(key in obj) return obj[key];
    for(let k in obj) {
        let res = search(obj[k], key);
        if(res) return res;
    }
    return null;
}
let d1 = JSON.parse(fs.readFileSync('company_caa_staff.json'));
let ks = search(d1, 'keyStaff');
console.log('Staff edges length:', ks ? (ks.edges ? ks.edges.length : 'no edges') : 'not found');
console.log('Staff total:', ks ? ks.total : 'not found');

let d2;
try {
    d2 = JSON.parse(fs.readFileSync('company_caa_clients.json'));
    let clients = search(d2, 'clients');
    console.log('Clients edges length:', clients ? (clients.edges ? clients.edges.length : 'no edges') : 'not found');
    console.log('Clients total:', clients ? clients.total : 'not found');
} catch(e) {
    console.log('Client file not ready');
}
