// @ts-check
/**
 * @file        Myserver.js
 * @description Proxy controller - proxy for a proxy (Hoverfly)
 * @author      Hrushikesh Vasista
 * @created     2025-07-03
 * @version     1.0.0
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');
require('dotenv').config();
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

const HOVERFLY_BASE_URL = process.env.HOVERFLY_BASE_URL || 'http://localhost:8500';
const TARGET_BASE_URL = process.env.TARGET_BASE_URL;
const SNIFFER_PORT = Number(process.env.SNIFFER_PORT) || 3001;
const HOVERSTREAM_PORT = Number(process.env.HOVERSTREAM_PORT) || 3000;

// ---------------------------------------------
// SNIFFER
//----------------------------------------------
// Create a traffic sniffer to display traffic on port SNIFFER_PORT
const sniffer = http.createServer();

sniffer.on('request', (clientReq, clientRes) => {

  console.log('=== REQUEST HEADER ===')
  console.log(JSON.stringify(clientReq.headers, null, 2));

  let clientReqBody = '';

  clientReq.on('data', chunk => (clientReqBody += chunk));

  clientReq.on('end', () => {

    console.log('=== REQUEST BODY ===');
    console.log(clientReqBody);

    const targetUrl = new URL(TARGET_BASE_URL);

    const { agent, client: targetClient } = createProxyConfig(TARGET_BASE_URL);

    // Options for proxied request
    const options = {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      path: clientReq.url,
      method: clientReq.method,
      headers: {
        ...clientReq.headers,
        host: targetUrl.hostname
      },
      //agent
    };

    const targetReq = targetClient.request(options, targetRes => {
      console.log('=== RESPONSE HEADER ===');
      console.log(JSON.stringify(targetRes.headers, null, 2));

      console.log('=== RESPONSE BODY ===');
      
      targetRes.pipe(clientRes);

      targetRes.on('data', chunk => {
        console.log('=== CHUNK ===');
        console.log(chunk.toString());
      });

      targetRes.on('end', () => {
        console.log('=== END OF RESPONSE ===');
      });
    });
    
    targetReq.write(clientReqBody);
    targetReq.end();

    targetReq.on('error', err => {
      clientRes.writeHead(500, { 'Content-Type': 'text/plain' });
      clientRes.end(`Error connecting to ${TARGET_BASE_URL}:\n${err.message}`);
    });
  });

});


sniffer.listen(SNIFFER_PORT, () => {
  console.log(`
===========================================
 🚨  SNIFFER ACTIVE – Debugging Traffic 🚨
===========================================
Listenting on http://localhost:${SNIFFER_PORT}
`);
});

// ---------------------------------------------
// HOVERSTREAM
//----------------------------------------------
// Create a reverse proxy to Hoverfly on port HOVERSTREAM_PORT
const hoverStream = http.createServer();

hoverStream.on('request', (clientReq, clientRes) => {

  const hoverflyUrl = new URL(clientReq.url, HOVERFLY_BASE_URL);

  // For any valid endpoint
  //if (Boolean(hoverflyUrl.pathname.match(/^(\/[\w\-\.]+){1,}/))) {

    let clientReqBody = '';
    clientReq.on('data', chunk => (clientReqBody += chunk));

    clientReq.on('end', () => {

      const { client: hoverflyClient } = createProxyConfig(HOVERFLY_BASE_URL);

      const options = {
        protocol: hoverflyUrl.protocol,
        hostname: hoverflyUrl.hostname,
        port: hoverflyUrl.port,
        path: hoverflyUrl.pathname + hoverflyUrl.search,
        method: clientReq.method,
        headers: {
          ...clientReq.headers,
          host: hoverflyUrl.hostname
        }
      };

      // Send the request to Hoverfly, get the response and 
      // stream it back the client
      const hoverflyReq = hoverflyClient.request(options);
      clientReq.pipe(hoverflyReq);

      hoverflyReq.on('response', (hoverflyRes) => {

        let mockedResBody = '';
        hoverflyRes.on('data', chunk => (mockedResBody += chunk));

        hoverflyRes.on('end', () => {
          streamResponseBack2Client(clientRes, mockedResBody);
        });

        hoverflyRes.on('error', (err) => {
          console.error(`Error receiving response from Hoverfly: ${err.message}`);
        });
      });

      hoverflyReq.on('error', (err) => {
        clientRes.writeHead(502);
        clientRes.end(`Bad gateway. Request to Hoverfly failed:  ${err.message || 'Unknown error'}`);
      });

    });

    clientReq.on('error', err => {
      clientRes.writeHead(502);
      clientRes.end(`Fetch error: ${err.message}`);
    });

  //  return; // early return
  //}

  // Fallback A
  //clientRes.writeHead(404);
  //clientRes.end(`The requested endpoint ${hoverflyUrl.pathname} does not exist or is not available.`);
});

hoverStream.listen(HOVERSTREAM_PORT, () => {
  console.log(`
==============================================
 🚨  HOVERSTREAM ACTIVE – Mocked responses 🚨
==============================================
Listenting on http://localhost:${HOVERSTREAM_PORT}
`);
});

/**
 * Creates an HTTP(S) client and proxy agent configuration for a given target URL.
 *
 * Chooses the appropriate Node.js client (`http` or `https`) based on the target URL's protocol,
 * and returns a proxy agent configured to forward requests through Hoverfly.
 *
 * @param {string} targetUrl - The target URL whose protocol determines the client type.
 * @returns {{
 *   agent: HttpProxyAgent | HttpsProxyAgent,
 *   client: typeof import('http') | typeof import('https')
 * }} Proxy configuration including the correct client and agent.
 */
function createProxyConfig(targetUrl) {
  const urlObj = new URL(targetUrl);
  const protocol = urlObj.protocol;
  const isHttps = protocol.includes('https');
  const client = isHttps ? https : http;
  const agent = isHttps ? new HttpsProxyAgent(HOVERFLY_BASE_URL) : new HttpProxyAgent(HOVERFLY_BASE_URL);
  return { agent, client };
}


/**
 * Streams a string response to the client in timed chunks.
 *
 * @param {http.ServerResponse} res - The HTTP response object to write to.
 * @param {string} data - The full string content to stream.
 * @param {number} chunkSize - Number of characters per chunk (default: 4).
 * @param {number} intervalMs - Delay between chunks in milliseconds (default: 100ms).
 * @returns void
 * @description Splits the input string into fixed-size chunks and writes each chunk to the response at regular intervals, simulating a streaming effect.
 */
function streamResponseBack2Client(res, data, chunkSize = 4, intervalMs = 100) {
  const chunks = data.match(new RegExp(`.{1,${chunkSize}}`, 'g')) || [];

  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache'
  });

  let i = 0;
  const interval = setInterval(() => {
    if (i < chunks.length) {
      res.write(chunks[i]);
      i++;
    } else {
      clearInterval(interval);
      res.end();
    }
  }, intervalMs);
}