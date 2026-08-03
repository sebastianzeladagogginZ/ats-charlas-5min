/**
 * BACKEND — ATS y Charla de 5 minutos → Google Drive
 * ---------------------------------------------------
 * Recibe los registros del formulario (index.html) y guarda los archivos
 * escaneados en Drive con la jerarquía:  Mes ›  Día ›  División
 *
 * Puntos clave del enunciado que resuelve este script:
 *  - Jerarquía de carpetas Mes > Día > División.
 *  - VARIAS cuadrillas, mismo día y misma división → TODO va a la MISMA
 *    carpeta, SIN carpetas duplicadas (getOrCreateFolder + LockService).
 *  - LockService serializa la creación de carpetas: si dos cuadrillas suben
 *    en el mismo segundo, no se crean dos carpetas "División X" repetidas.
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
  var lock = LockService.getScriptLock();
  try {
    // Serializa: evita carpetas duplicadas cuando varias cuadrillas suben a la vez.
    lock.waitLock(30000);

    var data = JSON.parse(e.postData.contents);
    if (!data || !data.files || !data.files.length) {
      return json({ ok: false, error: 'Sin archivos en la solicitud.' });
    }
    if (!ROOT_FOLDER_ID || ROOT_FOLDER_ID.indexOf('PEGA_AQUI') === 0) {
      return json({ ok: false, error: 'ROOT_FOLDER_ID no configurado en el script.' });
    }

    var root = DriveApp.getFolderById(ROOT_FOLDER_ID);

    // Jerarquía Mes > Día > División (reutiliza la carpeta si ya existe).
    var mes = getOrCreateFolder(root, sanitize(data.mesFolder || 'Sin-mes'));
    var dia = getOrCreateFolder(mes, sanitize(data.diaFolder || 'Sin-dia'));
    var div = getOrCreateFolder(dia, sanitize(data.division || 'Sin-division'));

    var meta = data.meta || {};
    var saved = [];
    for (var i = 0; i < data.files.length; i++) {
      var f = data.files[i];
      var bytes = Utilities.base64Decode(f.dataB64);
      var blob = Utilities.newBlob(bytes, f.mime || 'image/jpeg', sanitize(f.name));
      var file = div.createFile(blob);
      // Guarda los metadatos dentro del propio archivo (queda asociado aunque se mueva).
      file.setDescription(JSON.stringify(meta));
      saved.push({ name: file.getName(), id: file.getId(), url: file.getUrl() });
    }

    logToSheet(meta, div.getUrl(), saved);

    return json({ ok: true, folder: div.getUrl(), folderId: div.getId(), saved: saved, count: saved.length });

  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
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
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
