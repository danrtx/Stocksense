// Busca un modelo de Gemini que responda con la clave del .env.
// Se ejecuta dentro del contenedor de la API (lo llama scripts/arreglar-gemini.ps1):
//   Get-Content -Raw scripts/probar-gemini.js | docker compose exec -T backend node -
// Imprime MODELO_OK=<nombre> con el primero que responde, o MODELO_OK=ninguno.
const KEY = process.env.GEMINI_API_KEY;
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function probar(modelo) {
  try {
    const r = await fetch(`${BASE}/models/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Responde solo: funciona' }] }] }),
      signal: AbortSignal.timeout(25000),
    });
    const d = await r.json().catch(() => ({}));
    const detalle = r.ok ? 'responde bien' : (d.error && d.error.message ? d.error.message.split('\n')[0].slice(0, 90) : 'sin detalle');
    console.log(`  ${modelo}: ${r.status} ${detalle}`);
    return r.ok;
  } catch (e) {
    console.log(`  ${modelo}: no respondio (${e.name === 'TimeoutError' ? 'mas de 25 s' : e.message})`);
    return false;
  }
}

// Primero los flash completos, luego preview y al final los lite; los mas nuevos primero.
function puntaje(nombre) {
  let p = 0;
  if (nombre.includes('lite')) p += 20;
  if (/preview|exp/.test(nombre)) p += 10;
  const v = parseFloat((nombre.match(/gemini-(\d+(\.\d+)?)/) || [])[1] || '0');
  return p - v;
}

(async () => {
  if (!KEY) {
    console.log('No hay GEMINI_API_KEY en el .env.');
    console.log('MODELO_OK=ninguno');
    return;
  }
  let lista = [];
  try {
    const r = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': KEY }, signal: AbortSignal.timeout(20000) });
    const d = await r.json();
    if (!r.ok) console.log(`Google respondio ${r.status} al pedir la lista: ${d.error && d.error.message}`);
    lista = (d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace('models/', ''));
  } catch (e) {
    console.log(`No se pudo pedir la lista de modelos: ${e.message}`);
  }
  const candidatos = lista
    .filter((n) => n.includes('flash') && !/image|tts|audio|live|thinking/.test(n))
    .sort((a, b) => puntaje(a) - puntaje(b));
  if (!candidatos.includes('gemini-flash-latest')) candidatos.push('gemini-flash-latest');
  console.log(`Modelos flash disponibles: ${candidatos.join(', ')}`);
  console.log('Probando:');
  for (const m of candidatos) {
    if (await probar(m)) {
      console.log(`MODELO_OK=${m}`);
      return;
    }
  }
  console.log('MODELO_OK=ninguno');
})();
