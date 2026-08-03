/**
 * BACKEND — ATS y Charla de 5 minutos → Google Drive
 * ---------------------------------------------------
 * Recibe los registros del formulario (index.html) y guarda los archivos
 * escaneados en Drive con la jerarquía:
 *   Mes › Día › Área › División › Cuadrilla N › CLIENTE - Circuito X › (ATS | Charla de 5 minutos)
 *
 * Puntos clave del enunciado que resuelve este script:
 *  - Jerarquía anidada que separa ATS y Charla de 5 min para que no se mezclen.
 *  - VARIAS cuadrillas, mismo día y misma división → carpetas compartidas SIN
 *    duplicados (getOrCreateFolder + LockService solo al crear carpetas).
 *  - Idempotencia por uploadId (CacheService): un reintento tras un error de red
 *    NO vuelve a subir los archivos → nunca se duplican en Drive.
 *  - Nombre de archivo con formato estándar de fecha (lo arma el frontend).
 *  - Registro de metadatos (cliente, circuito, área…) en una hoja de cálculo.
 *
 * INSTALACIÓN (ver README.md):
 *  1) Crea una carpeta raíz en tu Drive y copia su ID en ROOT_FOLDER_ID.
 *  2) (Opcional) Crea una hoja de cálculo y copia su ID en LOG_SHEET_ID.
 *  3) Implementar › Nueva implementación › Aplicación web
 *       - Ejecutar como: Yo
 *       - Quién tiene acceso: Cualquier usuario
 *  4) Copia la URL /exec y pégala en CONFIG.endpoint del index.html.
 */

/* ====================== CONFIGURACIÓN ====================== */
var ROOT_FOLDER_ID = '16M5ZqMyRon7Xaxm461FT0B_TTEx00RPK'; // carpeta "ATS y Charlas 2026" (SSOMA ONI)
var LOG_SHEET_ID   = '';   // (opcional) ID de una Google Sheet para el registro; vacío = sin registro
var LOG_SHEET_NAME = 'Registros';
/* ========================================================== */

function doGet() {
  return json({ ok: true, service: 'ATS/Charla uploader', time: new Date().toISOString() });
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (!data || !data.files || !data.files.length) {
      return json({ ok: false, error: 'Sin archivos en la solicitud.' });
    }
    if (!ROOT_FOLDER_ID || ROOT_FOLDER_ID.indexOf('PEGA_AQUI') === 0) {
      return json({ ok: false, error: 'ROOT_FOLDER_ID no configurado en el script.' });
    }

    var meta = data.meta || {};

    // Idempotencia: si este MISMO envío ya se procesó (un reintento tras un error
    // de red), devuelve el resultado anterior en vez de volver a subir → NO duplica.
    var cache = CacheService.getScriptCache();
    var uid = data.uploadId ? ('up_' + String(data.uploadId)) : '';
    if (uid) {
      var prev = cache.get(uid);
      if (prev) return textJson(prev);
    }

    // Crea/reutiliza la ruta de carpetas. Solo esta parte necesita el candado
    // (evita carpetas duplicadas si dos cuadrillas suben en el mismo instante).
    var dest = createFolderPath(data, meta);

    // La subida de archivos NO necesita candado (crear archivos en una carpeta ya
    // existente no genera duplicados de carpeta), así varias cuadrillas suben en paralelo.
    var saved = [];
    for (var i = 0; i < data.files.length; i++) {
      var f = data.files[i];
      var bytes = Utilities.base64Decode(f.dataB64);
      var blob = Utilities.newBlob(bytes, f.mime || 'image/jpeg', sanitize(f.name));
      var file = dest.createFile(blob);
      file.setDescription(JSON.stringify(meta)); // metadatos dentro del propio archivo
      saved.push({ name: file.getName(), id: file.getId(), url: file.getUrl() });
    }

    logToSheet(meta, dest.getUrl(), saved);

    var result = JSON.stringify({ ok: true, folder: dest.getUrl(), folderId: dest.getId(), saved: saved, count: saved.length });
    if (uid) { try { cache.put(uid, result, 21600); } catch (e3) {} } // 6 h: ventana anti-duplicado para reintentos
    return textJson(result);

  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

/**
 * Crea (o reutiliza) la jerarquía de carpetas y devuelve la carpeta DESTINO:
 *   Raíz › Mes › Día › División › Cuadrilla N › CLIENTE - Circuito X › (ATS | Charla de 5 minutos)
 * Serializa solo la creación de carpetas con LockService para no duplicarlas.
 */
function createFolderPath(data, meta) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var root = DriveApp.getFolderById(ROOT_FOLDER_ID);
    var mes  = getOrCreateFolder(root, sanitize(data.mesFolder || 'Sin-mes'));
    var dia  = getOrCreateFolder(mes,  sanitize(data.diaFolder || 'Sin-dia'));
    var area = getOrCreateFolder(dia,  sanitize(meta.area || data.area || 'Sin-area'));
    var div  = getOrCreateFolder(area, sanitize(data.division || meta.division || 'Sin-division'));
    var cuad = getOrCreateFolder(div,  sanitize('Cuadrilla ' + (meta.cuadrilla || 'S-N')));
    var cliName = (meta.cliente || 'Sin-cliente') + (meta.circuito ? ' - Circuito ' + meta.circuito : '');
    var cli  = getOrCreateFolder(cuad, sanitize(cliName));
    var tipoName = (String(meta.tipo || '').toUpperCase().indexOf('ATS') === 0) ? 'ATS' : 'Charla de 5 minutos';
    return getOrCreateFolder(cli, sanitize(tipoName));
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/** Devuelve la carpeta hija por nombre; si no existe, la crea. Evita duplicados. */
function getOrCreateFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();     // reutiliza la existente
  return parent.createFolder(name);       // o crea una nueva
}

/** Limpia nombres para Drive (sin barras ni caracteres problemáticos). */
function sanitize(s) {
  return String(s == null ? '' : s).replace(/[\\\/\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Sin-nombre';
}

/** Registro opcional en Google Sheets. */
function logToSheet(meta, folderUrl, saved) {
  if (!LOG_SHEET_ID) return;
  try {
    var ss = SpreadsheetApp.openById(LOG_SHEET_ID);
    var sh = ss.getSheetByName(LOG_SHEET_NAME) || ss.insertSheet(LOG_SHEET_NAME);
    if (sh.getLastRow() === 0) {
      sh.appendRow(['Recibido', 'Tipo', 'Cliente', 'Circuito', 'Fecha', 'Cuadrilla', 'Área', 'División', 'N° archivos', 'Carpeta', 'Archivos']);
    }
    sh.appendRow([
      new Date(), meta.tipo || '', meta.cliente || '', meta.circuito || '', meta.fecha || '',
      meta.cuadrilla || '', meta.area || '', meta.division || '',
      saved.length, folderUrl, saved.map(function (s) { return s.name; }).join(', ')
    ]);
  } catch (e) { /* el registro no debe romper la carga */ }
}

function json(obj) {
  return textJson(JSON.stringify(obj));
}
function textJson(str) {
  return ContentService.createTextOutput(str).setMimeType(ContentService.MimeType.JSON);
}
