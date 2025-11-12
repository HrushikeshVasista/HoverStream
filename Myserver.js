// @ts-check
/**
 * @file        Myserver.js
 * @description Proxy controller - proxy for a proxy (Hoverfly)
 * @author      Rushi Vasista
 * @created     2025-07-03
 * @version     1.0.0
 */
const http = require('http');

const net = require('net');
//const https = require('https');
const { URL } = require('url');

// @ts-check
//const httpProxy = require('http-proxy');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');

// Create a proxy controller to a proxy (i.e. Hoverfly)
const server = http.createServer();

server.on('request', (req, res) => {
  const pathname = req.url;

  // Admin API passthrough
  if (pathname.startsWith('/admin')) {

    const options = {
      hostname: 'localhost',
      port: 8888,
      path: pathname.replace(/^\/admin/, '') || '/',
      method: req.method,
      headers: req.headers
    };

    // and simply pipe any admin response from HOverfly to the client
    const proxyReq = http.request(options, proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    // simply pipe any admin requests from client to the proxy
    req.pipe(proxyReq);
    proxyReq.on('error', err => {
      res.writeHead(502);
      res.end(`Admin proxy error: ${err.message}`);
    });
    return;
  }

  if (req.url === '/capture') {
    let body = '';

    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const targetUrl = req.headers['x-target-url'];
      if (!targetUrl) {
        res.writeHead(400);
        return res.end('Missing x-target-url header');
      }

      const parsedUrl = new URL(targetUrl);
      const { client, agent } = getProxyDetails(targetUrl);

      const options = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: req.method, // Use the original method (GET, POST, PUT, etc.)
        headers: req.headers,
        agent: agent
      };

      const proxyReq = (parsedUrl.protocol === 'https:' ? https : http).request(options, proxyRes => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', err => {
        console.error('Proxy request error:', err.message);
        res.writeHead(500);
        res.end('Proxy request failed');
      });

      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        proxyReq.write(body);
      }

      proxyReq.end();
    });
  }

  // For any endpoint
  if (pathname.match(/^(\/[\w\-\.]+){1,}/)) {

    let body = '';
    //req.on('data', chunk => (body += chunk));
    req.on('end', () => {

      // try {
      //   //proxy controller gets the intended target endpoint from client
      //   const parsedBody = JSON.parse(body); // -d {url: <target>}
      //   targetUrl = parsedBody.url;
      //   if (!targetUrl) throw new Error('Missing "url"');
      // } catch (err) {
      //   res.writeHead(400);
      //   return res.end('Invalid JSON body or missing "url" field');
      // }

      const hoverflyBaseUrl = 'http://localhost:8500';
      const parsedUrl = new URL(pathname, hoverflyBaseUrl);
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
        agent: agent
      };

      // Send the request to Hoverfly, get the response and stream it back the client
      const hoverflyReq = client.request(options);
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
        console.error('Request to Hoverfly failed: ', err.message);
        res.writeHead(502);
        res.end('Bad gateway');
      });

      req.pipe(hoverflyReq);
      
    });

    req.on('error', err => {
      res.writeHead(502);
      res.end(`Fetch error: ${err.message}`);
    });

    return;
  }

  // Fallback for unmatched routes
  res.writeHead(404);
  res.end('Not Found');
});

// Handle HTTPS tunneling
server.on('connect', (req, clientSocket, head) => {
  // Instead of parsing the original URL, forward to localhost:8500
  const targetPort = 8500;
  const targetHost = 'localhost';

  const serverSocket = net.connect(targetPort, targetHost, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', (err) => {
    console.error('Server socket error:', err);
    clientSocket.end();
  });

  clientSocket.on('error', (err) => {
    console.error('Client socket error:', err);
    serverSocket.end();
  });
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

server.listen(3000, () => {
  console.log('Proxy running at http://localhost:3000');
});