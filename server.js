const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ==========================================
// CONFIGURACION - Solo cambia esto
const GEMINI_API_KEY = 'AIzaSyAhx5N-4pxfzAxTqxcUfR3MAi_3w_tM_Zo';
const PORT = process.env.PORT || 3000;
// ==========================================

const PROMPT = `Eres un nutricionista experto analizando imágenes para contar calorías.

Determina si hay comida en la imagen:
- SÍ es comida: platos, frutas, verduras, snacks, bebidas, ingredientes, un solo alimento (aguacate, manzana, huevo, etc.)
- NO es comida: personas, animales, objetos, paisajes, habitaciones, ropa, vehículos.

Si NO hay alimento responde SOLO este JSON exacto:
{"error":"No se detectó comida. Fotografía tu plato o alimento."}

Si SÍ hay comida responde SOLO este JSON sin texto extra ni backticks:
{"totalKcal":número,"items":[{"name":"nombre en español","portion":"cantidad estimada","kcal":número,"prot":número,"carb":número,"fat":número}],"prot":número,"carb":número,"fat":número,"confidence":"alta","note":"consejo nutricional breve en español"}

Solo usa comillas dobles. Sé preciso con calorías según la porción visible.`;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.ico':  'image/x-icon'
};

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // ---- API ENDPOINT ----
  if (req.method === 'POST' && req.url === '/api/analyze') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 20e6) req.destroy(); });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { return sendJSON(res, 400, { error: 'JSON inválido' }); }

      const { image, mimeType = 'image/jpeg' } = parsed;
      if (!image) return sendJSON(res, 400, { error: 'No se recibió imagen' });

      const payload = JSON.stringify({
        contents: [{ parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mimeType, data: image } }
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 800 }
      });

      const options = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      };

      const apiReq = https.request(options, apiRes => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
          console.log(`[Gemini] Status: ${apiRes.statusCode}`);
          try {
            const gemini = JSON.parse(data);
            if (gemini.error) {
              console.error('[Gemini] Error:', gemini.error.message);
              return sendJSON(res, 500, { error: 'Error de IA: ' + gemini.error.message });
            }
            const text = gemini.candidates?.[0]?.content?.parts?.[0]?.text || '';
            console.log('[Gemini] Respuesta:', text.substring(0, 150));
            const clean = text.replace(/```json|```/g, '').trim();
            const result = JSON.parse(clean);
            sendJSON(res, 200, result);
          } catch (e) {
            console.error('[Gemini] Parse error:', e.message);
            sendJSON(res, 500, { error: 'No se pudo procesar la respuesta de IA' });
          }
        });
      });

      apiReq.on('error', err => { console.error('[Red]', err.message); sendJSON(res, 500, { error: 'Sin conexión a internet' }); });
      apiReq.write(payload);
      apiReq.end();
    });
    return;
  }

  // ---- ARCHIVOS ESTÁTICOS ----
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, 'www', filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIP = 'localhost';
  for (const iface of Object.values(nets).flat()) {
    if (iface.family === 'IPv4' && !iface.internal) { localIP = iface.address; break; }
  }
  console.log('\n✅ NutriLens servidor corriendo!');
  console.log(`   PC:     http://localhost:${PORT}`);
  console.log(`   Celular (misma WiFi): http://${localIP}:${PORT}`);
  console.log('\nDeja esta ventana abierta mientras usas la app.\n');
});
