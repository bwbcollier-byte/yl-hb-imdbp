const fs = require('fs');

const file = '/tmp/imdb-gists/bfd50e25dd5af6121f12aef67a76b53f.txt';
const html = fs.readFileSync(file, 'utf8');

const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
if (!match) {
    console.log("No NEXT DATA");
    process.exit(1);
}

const data = JSON.parse(match[1]);
const props = data.props.pageProps;

// If it's a talent or agent page, it has aboveTheFold and mainColumnData
const isPerson = !!props.aboveTheFold;
// If it's a company page, it usually has a 'data' object with 'company'
const isCompany = !!props.data?.company;

console.log("Is person page?", isPerson);
console.log("Is company page?", isCompany);

if (isPerson) {
   const atf = props.aboveTheFold;
   const main = props.mainColumnData;
   
   console.log("ID:", atf.id);
   console.log("Name:", atf.nameText.text);
   
   // Check if they are an agent by seeing if they have a company association or "clients"
   const hasClients = main.clients && main.clients.edges && main.clients.edges.length > 0;
   console.log("Has clients?", hasClients);
   
   // Look for company affiliation
   const refEdges = main.representation?.edges || [];
   console.log("Rep edges:", refEdges.length);
}

if (isCompany) {
   const comp = props.data.company;
   console.log("ID:", comp.id);
   console.log("Name:", comp.companyText?.text);
}

