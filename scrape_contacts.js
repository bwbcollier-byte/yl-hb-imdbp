const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
require('dotenv').config();

// Put your target IMDb IDs here
const IMDB_IDS = [
  'nm0000123', // Example ID (George Clooney)
];

const RAW_COOKIE = process.env.IMDBPRO_COOKIE;

if (!RAW_COOKIE) {
  console.error('\n🔴 ERROR: Please add IMDBPRO_COOKIE="your_cookie_string" to your .env file in the yl-hb-imdbp folder.');
  console.log('To get your cookie:');
  console.log('1. Log into IMDbPro in your browser.');
  console.log('2. Open Developer Tools (Cmd+Option+I), go to Network tab.');
  console.log('3. Refresh the page and click the main page request (e.g. name/nm0000123).');
  console.log('4. Look under Request Headers for "cookie:" and copy the entire string.\n');
  process.exit(1);
}

async function scrapeContactDetails() {
  const results = [];

  for (const id of IMDB_IDS) {
    console.log(`\n🔍 Fetching profile: https://pro.imdb.com/name/${id} ...`);
    
    try {
      const response = await axios.get(`https://pro.imdb.com/name/${id}/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Cookie': RAW_COOKIE,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });

      const html = response.data;
      const $ = cheerio.load(html);

      // Verify we are actually logged in
      const title = $('title').text();
      const pageText = $('body').text();
      
      if (pageText.includes('Sign in with Amazon') || title.includes('Log In') || pageText.includes('Join IMDbPro')) {
        console.error('🔴 ERROR: IMDbPro returned a login page. Your cookie might be expired, invalid, or you are getting blocked.');
        break; // Stop execution
      }

      console.log('✅ Successfully authenticated!');

      // We'll save the HTML to a debug file so we can analyze the exact DOM structure IMDbPro uses for contacts
      const debugFile = `./debug_${id}.html`;
      fs.writeFileSync(debugFile, html);
      console.log(`💾 Saved full page HTML to ${debugFile} for analysis.`);

      // Basic parsing attempt (IMDbPro structure often changes, so we will update this based on the debug file)
      // Usually IMDb Pro injected JSON config for React
      let contactData = "Check debug HTML file to locate exact DOM selectors.";
      
      const nextDataNode = $('#__NEXT_DATA__').html();
      if (nextDataNode) {
          console.log('Found __NEXT_DATA__ config. We can parse JSON straight from this if contact data is present inside.');
      } else {
          console.log('No __NEXT_DATA__ found, might need to scrape standard HTML nodes.');
      }

      results.push({
          id,
          name: $('h1').first().text().trim(),
          status: "Fetched (Waiting for selector configuration)"
      });
      
    } catch (error) {
       console.error(`🔴 Request failed for ${id}:`, error.message);
       if (error.response && error.response.status === 403) {
           console.log('Got a 403 Forbidden. We may need to use Puppeteer if Axios is strictly blocked.');
       }
    }
    
    // Polite sleep between requests to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Output summary
  console.log('\n--- Summary ---');
  console.log(JSON.stringify(results, null, 2));
}

scrapeContactDetails();
