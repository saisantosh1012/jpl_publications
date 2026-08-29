const { getStore } = require('@netlify/blobs');

let store;

function hostedStore() {
  if (!store) store = getStore('jpl-publications');
  return store;
}
const seedPublications = [
  {
    id: 'seed-1',
    title: 'Advances in Sustainable Materials for Civil Infrastructure',
    authors: 'Dr. A. Karthik, R. Menon',
    date: '2026-07-14',
    category: 'Journal',
    description: 'A peer-reviewed study examining low-carbon composite materials for long-span infrastructure, with lifecycle cost modelling across three climates.',
    link: '',
    hasPdf: false,
    pdfName: '',
    pdfUrl: ''
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
    pdfName: '',
    pdfUrl: ''
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
    pdfName: '',
    pdfUrl: ''
  }
];

function response(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }, extraHeaders || {}),
    body: JSON.stringify(body)
  };
}

async function readPublications() {
  const publications = await hostedStore().get('publications', { type: 'json' });
  if (Array.isArray(publications)) return publications;
  await hostedStore().setJSON('publications', seedPublications);
  return seedPublications;
}

function requestResource(event) {
  const pathname = new URL(event.rawUrl || 'https://jpl.invalid').pathname;
  const parts = pathname.split('/').filter(Boolean);
  const apiIndex = parts.indexOf('api');
  return { type: parts[apiIndex + 1] || '', id: parts[apiIndex + 2] || '' };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return response(204, {});

  try {
    const resource = requestResource(event);

    if (resource.type === 'publications' && event.httpMethod === 'GET') {
      return response(200, { success: true, data: await readPublications() });
    }

    if (resource.type === 'pdfs' && (event.httpMethod === 'GET' || event.httpMethod === 'HEAD') && resource.id) {
      const pdf = await hostedStore().get(`pdf:${resource.id}`, { type: 'arrayBuffer' });
      if (!pdf) return response(404, { success: false, message: 'PDF document not found' });
      if (event.httpMethod === 'HEAD') {
        return { statusCode: 200, headers: { 'Content-Type': 'application/pdf', 'Access-Control-Allow-Origin': '*' }, body: '' };
      }
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline',
          'Access-Control-Allow-Origin': '*'
        },
        isBase64Encoded: true,
        body: Buffer.from(pdf).toString('base64')
      };
    }

    if (resource.type === 'publications' && event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const publications = await readPublications();
      const id = payload.id || `pub-${Date.now()}`;
      let hasPdf = Boolean(payload.hasPdf);
      let pdfName = payload.pdfName || '';

      if (payload.pdfDataUrl) {
        const match = payload.pdfDataUrl.match(/^data:application\/pdf;base64,(.+)$/);
        if (!match) return response(400, { success: false, message: 'Invalid PDF data' });
        await hostedStore().set(`pdf:${id}`, Buffer.from(match[1], 'base64'), { contentType: 'application/pdf' });
        hasPdf = true;
        pdfName = payload.pdfName || 'publication.pdf';
      } else if (payload.removePdf) {
        await hostedStore().delete(`pdf:${id}`);
        hasPdf = false;
        pdfName = '';
      }

      const entry = {
        id,
        title: payload.title || '',
        authors: payload.authors || '',
        category: payload.category || 'Journal',
        date: payload.date || new Date().toISOString().split('T')[0],
        link: payload.link || '',
        description: payload.description || '',
        hasPdf,
        pdfName,
        pdfUrl: hasPdf ? `/api/pdfs/${id}` : ''
      };
      const index = publications.findIndex(publication => publication.id === id);
      if (index >= 0) publications[index] = entry;
      else publications.unshift(entry);
      await hostedStore().setJSON('publications', publications);
      return response(200, { success: true, entry });
    }

    if (resource.type === 'publications' && resource.id && event.httpMethod === 'DELETE') {
      const publications = await readPublications();
      const remaining = publications.filter(publication => publication.id !== resource.id);
      if (remaining.length === publications.length) return response(404, { success: false, message: 'Publication not found' });
      await hostedStore().setJSON('publications', remaining);
      await hostedStore().delete(`pdf:${resource.id}`);
      return response(200, { success: true });
    }

    return response(404, { success: false, message: 'API route not found' });
  } catch (error) {
    console.error(error);
    return response(500, { success: false, message: 'Hosted publication storage error' });
  }
};