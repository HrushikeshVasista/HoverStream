// @ts-check
/**
 * @file        Myserver.js
 * @description Proxy controller - proxy for a proxy (Hoverfly)
 * @author      Hrushikesh Vasista
 * @created     2025-07-03
 * @version     1.0.0
 */
const http = require('http');

const net = require('net');
//const https = require('https');
const { URL } = require('url');
require('dotenv').config();

//const httpProxy = require('http-proxy');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');

// Create a proxy controller to a proxy (i.e. Hoverfly)
const server = http.createServer();

server.on('request', (req, res) => {
  const hoverflyBaseUrl = 'http://hoverfly:8500';
  const parsedUrl = new URL(req.url, hoverflyBaseUrl);

  // For any endpoint
  if (Boolean(parsedUrl.pathname.match(/^(\/[\w\-\.]+){1,}/))) {

    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {

      const protocol = parsedUrl.protocol;
      const isHttps = protocol.includes('https');

      //const parsedUrl = new URL(targetUrl);
      const { agent, client } = getProxyDetails(hoverflyBaseUrl);

      const options = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: req.method, // Use the original method (GET, POST, PUT, etc.)
        headers: req.headers,
        agent: new HttpProxyAgent(hoverflyBaseUrl)
      };

      // Send the request to Hoverfly, get the response and stream it back the client
      const hoverflyReq = require('http').request(options);
      req.pipe(hoverflyReq);
      hoverflyReq.on('response', (proxyRes) => {
        let simulatedResponse = '';
        proxyRes.on('data', chunk => {
          simulatedResponse += chunk;
        });
        proxyRes.on('end', () => {
          streamResponseBack2Client(res, simulatedResponse);
        });
        proxyRes.on('error', () => {
          console.error('Error receiving response from Hoverfly');
        });
      });

      hoverflyReq.on('error', (err) => {
        res.writeHead(502);
        res.end(`Bad gateway. Request to Hoverfly failed:  ${err.message || 'Unknown error'}`);
      });

    });

    req.on('error', err => {
      res.writeHead(502);
      res.end(`Fetch error: ${err.message}`);
    });

    return;
  }

  // Fallback A
  res.writeHead(404);
  res.end(`The requested endpoint ${parsedUrl.pathname} does not exist or is not available.`);
});

server.listen(3000, () => {
  console.log('Proxy running at http://localhost:3000');
});

/**
 * Returns proxy configuration details based on the target URL protocol.
 *
 * @param {any} targetUrl - The URL to determine proxy settings for.
 * @returns {{ agent: HttpProxyAgent | HttpsProxyAgent, client: typeof import('http') | typeof import('https') }}
 */
function getProxyDetails(targetUrl) {
  const urlObj = new URL(targetUrl);
  const protocol = urlObj.protocol;
  const isHttps = protocol.includes('https');

  const proxy = 'http://hoverfly:8500'; // for debugging: localhost:8500        
  return isHttps
    ? { agent: new HttpsProxyAgent(proxy), client: require('https') }
    : { agent: new HttpProxyAgent(proxy), client: require('http') };
}


/**
 * 
 * @param {http.ServerResponse} res 
 * @param {string} data 
 * @param {number} chunkSize 
 * @param {number} intervalMs 
 * @returns void
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