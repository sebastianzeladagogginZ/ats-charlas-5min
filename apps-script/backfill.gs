/**
 * RESCATE (backfill) — reconstruye filas en la hoja "Registros" a partir de los
 * documentos que YA están en Google Drive (subidos ANTES de configurar LOG_SHEET_ID,
 * por lo que nunca se registraron en la hoja y no aparecían en el Panel SSOMA).
 *
 * Recorre la jerarquía de ROOT_FOLDER_ID, detecta cada carpeta hoja "ATS" /
 * "Charla de 5 minutos" que contenga archivos, y deduce cliente / circuito /
 * cuadrilla / área / división / fecha subiendo por las carpetas padre. Es
 * IDEMPOTENTE: no duplica (dedupe por la URL de la carpeta, columna 10). Se puede
 * volver a ejecutar sin miedo — solo agregará carpetas nuevas que aún no estén.
 *
 * Uso (desde el editor de Apps Script, "Ejecutar"):
 *   backfillDryRun()   → NO escribe; reporta en el Registro de ejecución qué encontró.
 *   backfillEjecutar() → agrega a la hoja las filas nuevas.
 *
 * Depende de las globales ROOT_FOLDER_ID, LOG_SHEET_ID, LOG_SHEET_NAME de Codigo.gs.
 * NOTA: este archivo es una utilidad de mantenimiento; no lo llama doGet/doPost.
 * Las subidas normales (con LOG_SHEET_ID ya configurado) se registran solas vía logToSheet().
 */
function backfillDryRun(){ return _backfill(true); }
function backfillEjecutar(){ return _backfill(false); }

function _esFecha(s){ return s.length === 10 && s.charAt(4) === '-' && s.charAt(7) === '-' && /^[0-9-]+$/.test(s); }

function _backfill(dryRun){
  var root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  var ss = SpreadsheetApp.openById(LOG_SHEET_ID);
  var sh = ss.getSheetByName(LOG_SHEET_NAME) || ss.insertSheet(LOG_SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Recibido', 'Tipo', 'Cliente', 'Circuito', 'Fecha', 'Cuadrilla', 'Área', 'División', 'N° archivos', 'Carpeta', 'Archivos']);
  }
  // URLs de carpeta ya registradas (col 10) para no duplicar.
  var existing = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 10, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { if (r[0]) existing[String(r[0])] = 1; });
  }
  var rows = [], scanned = 0, vacias = 0, dup = 0, sample = [];
  var stack = [root];
  while (stack.length) {
    var f = stack.pop();
    var subs = f.getFolders();
    while (subs.hasNext()) stack.push(subs.next());   // DFS por todo el árbol
    var nm = String(f.getName()).trim();
    var isATS = /^ats$/i.test(nm);
    var isCharla = /charla/i.test(nm);
    if (!isATS && !isCharla) continue;                // solo carpetas hoja de tipo
    scanned++;
    var it = f.getFiles(), names = [], firstDate = null;
    while (it.hasNext()) { var fl = it.next(); names.push(fl.getName()); var dc = fl.getDateCreated(); if (!firstDate || dc < firstDate) firstDate = dc; }
    if (!names.length) { vacias++; continue; }         // carpeta de tipo vacía → nada que registrar
    var url = f.getUrl();
    if (existing[url]) { dup++; continue; }            // ya está en la hoja
    // Subir por los padres armando la cadena de nombres (chain[0] = "CLIENTE - Circuito X").
    var chain = [], p = f;
    for (var i = 0; i < 12; i++) {
      var par = p.getParents(); if (!par.hasNext()) break; p = par.next();
      if (p.getId() === ROOT_FOLDER_ID) break;
      chain.push(String(p.getName()).trim());
    }
    var cliente = '', circuito = '';
    if (chain[0]) { var parts = chain[0].split(' - Circuito '); cliente = (parts[0] || '').trim(); circuito = (parts.length > 1 ? parts[1] : '').trim(); }
    var fecha = '', diaIdx = -1;
    for (var j = 0; j < chain.length; j++) { if (_esFecha(chain[j])) { fecha = chain[j]; diaIdx = j; break; } }
    var cuadrilla = '', cuadIdx = -1;
    for (var k = 0; k < chain.length; k++) { if (/cuadrilla/i.test(chain[k])) { var ix = chain[k].toLowerCase().indexOf('cuadrilla'); cuadrilla = chain[k].slice(ix + 9).trim(); cuadIdx = k; break; } }
    // Área/División = niveles entre "Cuadrilla" y el "Día" (fecha). Robusto a la jerarquía
    // vieja (solo División) y a la nueva (Área ▸ División).
    var area = '', division = '';
    if (cuadIdx >= 0) {
      var top = (diaIdx < 0 ? chain.length : diaIdx), mid = [];
      for (var z = cuadIdx + 1; z < top; z++) mid.push(chain[z]);
      if (mid.length === 1) { division = mid[0]; }
      else if (mid.length >= 2) { division = mid[0]; area = mid[1]; }
    }
    var tipo = isATS ? 'ATS' : 'Charla de 5 minutos';
    rows.push([firstDate || new Date(), tipo, cliente, circuito, fecha, cuadrilla, area, division, names.length, url, names.join(', ')]);
    if (sample.length < 12) sample.push(fecha + ' | ' + tipo + ' | ' + cliente + ' | Circ ' + circuito + ' | Cuad ' + cuadrilla + ' | ' + area + ' > ' + division + ' | ' + names.length + ' arch');
  }
  if (!dryRun && rows.length) { sh.getRange(sh.getLastRow() + 1, 1, rows.length, 11).setValues(rows); }
  var msg = (dryRun ? '[DRY RUN] ' : '[EJECUTADO] ') + 'carpetas ATS/Charla: ' + scanned + ' | nuevas: ' + rows.length + ' | vacías: ' + vacias + ' | ya en hoja: ' + dup;
  Logger.log(msg);
  sample.forEach(function (s) { Logger.log('  · ' + s); });
  return msg;
}

/**
 * Reinicia el estado de revisión de TODAS las filas a 'Pendiente' (limpia RevisadoPor,
 * RevisadoEn y MensajeTecnico). Útil para dejar la hoja lista para que los jefes revisen
 * desde cero (p. ej. tras una prueba). NO borra ni mueve archivos de Drive.
 */
function resetEstados() {
  var ss = SpreadsheetApp.openById(LOG_SHEET_ID);
  var sh = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) { Logger.log('Sin filas.'); return 'Sin filas.'; }
  ensureReviewHeader(sh);
  var n = sh.getLastRow() - 1;
  var estados = [], resto = [];
  for (var i = 0; i < n; i++) { estados.push(['Pendiente']); resto.push(['', '', '']); }
  sh.getRange(2, 12, n, 1).setValues(estados);   // Estado = Pendiente
  sh.getRange(2, 13, n, 3).setValues(resto);     // RevisadoPor / RevisadoEn / MensajeTecnico vacíos
  var msg = 'Reseteadas ' + n + ' filas a Pendiente.';
  Logger.log(msg);
  return msg;
}
