/**
 * JPL Publications - Central Shared Node.js API Server & Storage
 * Zero-dependency Node server providing real-time data persistence
 * and binary PDF upload serving for all users and visitors globally.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'publications.json');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Initial Seed Data
const SEED_PUBLICATIONS = [
  {
    id: 'seed-1',
    title: 'Advances in Sustainable Materials for Civil Infrastructure',
    authors: 'Dr. A. Karthik, R. Menon',
    date: '2026-07-14',
    category: 'Journal',
    description: 'A peer-reviewed study examining low-carbon composite materials for long-span infrastructure, with lifecycle cost modelling across three climates.',
    link: '',
    hasPdf: false,
    pdfName: ''
  },
  {
    id: 'seed-2',
    title: 'Adaptive Signal Filtering Method for Low-Power IoT Sensors',
    authors: 'Mr. V. Santhosh Kumar',
    date: '2026-06-02',
    category: 'Patent',
    description: 'Patent publication documenting a novel adaptive filtering circuit that reduces power draw in distributed sensor networks by up to 34%.',
    link: '',
    hasPdf: false,
    pdfName: ''
  },
  {
    id: 'seed-3',
    title: 'Interdisciplinary Approaches to Public Health Policy Design',
    authors: 'Dr. Satyanand Singh',
    date: '2026-05-20',
    category: 'Ph.D. Thesis',
    description: 'A doctoral thesis synthesizing epidemiology, behavioural economics and policy science to model community health interventions.',
    link: '',
    hasPdf: false,
    pdfName: ''
  }
];

// Read / Write Database Helper
function getDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      saveDB(SEED_PUBLICATIONS);
      return SEED_PUBLICATIONS;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return SEED_PUBLICATIONS;
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Database write error:', err);
    return false;
  }
}

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=UTF-8',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // CORS Headers for global cross-domain access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

  // ------------ API ENDPOINTS ------------

  // GET /api/publications
  if (req.method === 'GET' && pathname === '/api/publications') {
    const list = getDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: list }));
    return;
  }

  // GET /api/pdfs/:id
  if (req.method === 'GET' && pathname.startsWith('/api/pdfs/')) {
    const id = pathname.replace('/api/pdfs/', '');
    const pdfPath = path.join(UPLOADS_DIR, `${id}.pdf`);
    if (fs.existsSync(pdfPath)) {
      const stat = fs.statSync(pdfPath);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': stat.size,
        'Content-Disposition': 'inline'
      });
      fs.createReadStream(pdfPath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'PDF document not found' }));
    }
    return;
  }

  // POST /api/publications (Add or Update publication with optional PDF)
  if (req.method === 'POST' && pathname === '/api/publications') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        let list = getDB();

        const id = payload.id || (`pub-${Date.now()}`);
        let hasPdf = payload.hasPdf || false;
        let pdfName = payload.pdfName || '';

        // Handle uploaded PDF DataURL if included
        if (payload.pdfDataUrl) {
          try {
            const matches = payload.pdfDataUrl.match(/^data:application\/pdf;base64,(.+)$/);
            if (matches && matches[1]) {
              const buffer = Buffer.from(matches[1], 'base64');
              const savePath = path.join(UPLOADS_DIR, `${id}.pdf`);
              fs.writeFileSync(savePath, buffer);
              hasPdf = true;
              pdfName = payload.pdfName || 'publication.pdf';
            }
          } catch (err) {
            console.error('Error saving PDF file:', err);
          }
        } else if (payload.removePdf) {
          hasPdf = false;
          pdfName = '';
          const pdfPath = path.join(UPLOADS_DIR, `${id}.pdf`);
          if (fs.existsSync(pdfPath)) {
            try { fs.unlinkSync(pdfPath); } catch (e) { }
          }
        }

        const entry = {
          id: id,
          title: payload.title || '',
          authors: payload.authors || '',
          category: payload.category || 'Journal',
          date: payload.date || new Date().toISOString().split('T')[0],
          link: payload.link || '',
          description: payload.description || '',
          hasPdf: hasPdf,
          pdfName: pdfName,
          pdfUrl: hasPdf ? `/api/pdfs/${id}` : ''
        };

        const existingIdx = list.findIndex(p => p.id === id);
        if (existingIdx > -1) {
          list[existingIdx] = entry;
        } else {
          list.unshift(entry);
        }

        saveDB(list);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, entry: entry }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Invalid publication payload' }));
      }
    });
    return;
  }

  // DELETE /api/publications/:id
  if (req.method === 'DELETE' && pathname.startsWith('/api/publications/')) {
    const id = pathname.replace('/api/publications/', '');
    let list = getDB();
    const idx = list.findIndex(p => p.id === id);
    if (idx > -1) {
      list.splice(idx, 1);
      saveDB(list);
      const pdfPath = path.join(UPLOADS_DIR, `${id}.pdf`);
      if (fs.existsSync(pdfPath)) {
        try { fs.unlinkSync(pdfPath); } catch (e) { }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Publication not found' }));
    }
    return;
  }

  // ------------ STATIC FILE SERVING ------------
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(__dirname, pathname);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
      res.end('<h1>404 Not Found</h1><p>The requested resource could not be found.</p>');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const nextPort = Number(PORT) + 1;
    console.log(`\n[Notice] Port ${PORT} is already in use. Switching to port ${nextPort}...`);
    setTimeout(() => {
      server.listen(nextPort);
    }, 500);
  } else {
    console.error('Server error:', err);
  }
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  JPL Publications Central Server Running`);
  console.log(`  Local URL: http://localhost:${PORT}`);
  console.log(`  API Endpoint: http://localhost:${PORT}/api/publications`);
  console.log(`====================================================`);
});

