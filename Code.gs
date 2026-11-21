// Engagement Photos - Google Apps Script
const IN_ID = '1u2dxynChyCrAMDN0M1c7z-hJ2qP6TTMM';   // Engagement Photos (originals)
const OUT_ID = '1bnDQnP9SiLF_4PeYhwAGpIklUC3SFNac';  // Engagement Photos 1 (enhanced)
const ADMIN_KEY = 'Rohi@#8520';                       // admin page par yahi key daalni hai

function doGet(e) {
  const page = e && e.parameter && e.parameter.page === 'admin' ? 'admin' : 'guest';
  return HtmlService.createHtmlOutputFromFile(page)
    .setTitle('Engagement Photos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function check_(k) { if (k !== ADMIN_KEY) throw new Error('Galat admin key'); }

function auth_() { return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }; }

// TEZ listing: Drive API se ek hi call me (DriveApp ka file-by-file loop slow tha)
function images_(folderId, withLink) {
  try {
    const out = [], q = "'" + folderId + "' in parents and mimeType contains 'image/' and trashed=false";
    let token = '';
    do {
      const url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) +
        '&fields=nextPageToken,files(id,name' + (withLink ? ',thumbnailLink' : '') + ')&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true' +
        (token ? '&pageToken=' + token : '');
      const r = JSON.parse(UrlFetchApp.fetch(url, { headers: auth_() }).getContentText());
      (r.files || []).forEach(function (f) { out.push(withLink ? { id: f.id, name: f.name, link: f.thumbnailLink || '' } : { id: f.id, name: f.name }); });
      token = r.nextPageToken || '';
    } while (token);
    return out;
  } catch (err) { return imagesSlow_(folderId); }   // koi dikkat aaye to purana tarika
}
function imagesSlow_(folderId) {
  const out = [], it = DriveApp.getFolderById(folderId).getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if ((f.getMimeType() || '').indexOf('image/') === 0) out.push({ id: f.getId(), name: f.getName() });
  }
  return out;
}

// Output ki list 30 sec cache (saveEnhanced hote hi saaf). Admin aur guests dono isse tez + quota bachta hai.
function outList_() {
  const c = CacheService.getScriptCache(), hit = c.get('lst');
  if (hit) return JSON.parse(hit);
  const files = images_(OUT_ID);
  try { c.put('lst', JSON.stringify(files), 30); } catch (e) {}
  return files;
}
function nameOf_(n) { return n.replace(/\.[^.]+$/, '') + '.jpg'; }

// ---- sirf admin ----
// EK call me sirf nayi photos (jo abhi enhance nahi hui), thumbnail link ke saath
function pending(k) {
  check_(k);
  const done = {}; outList_().forEach(function (f) { done[f.name] = 1; });
  return images_(IN_ID, true).filter(function (f) { return !done[nameOf_(f.name)]; });
}
function listInput(k) { check_(k); return images_(IN_ID); }
function getInputBase64(k, id) { check_(k); return Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes()); }

// FAST: chhota (2048px) version, original se ~10x chhota download. Link mila to ek hi fetch.
function getInputFastBase64(k, id, px, link) {
  check_(k);
  px = px || 2048;
  const tries = [];
  if (link) tries.push(link.replace(/=s\d+$/, '=s' + px));
  tries.push('https://drive.google.com/thumbnail?id=' + id + '&sz=w' + px);
  for (let i = 0; i < tries.length; i++) {
    try {
      const r = UrlFetchApp.fetch(tries[i], { headers: auth_(), muteHttpExceptions: true });
      if (r.getResponseCode() === 200) return Utilities.base64Encode(r.getBlob().getBytes());
    } catch (e) {}
  }
  const meta = JSON.parse(UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + id + '?fields=thumbnailLink&supportsAllDrives=true', { headers: auth_() }).getContentText());
  if (!meta.thumbnailLink) throw new Error('thumbnail abhi ready nahi');
  const r2 = UrlFetchApp.fetch(meta.thumbnailLink.replace(/=s\d+$/, '=s' + px), { headers: auth_(), muteHttpExceptions: true });
  if (r2.getResponseCode() !== 200) throw new Error('thumbnail ' + r2.getResponseCode());
  return Utilities.base64Encode(r2.getBlob().getBytes());
}

// TEZ upload: Drive API multipart (DriveApp.createFile se tez). Fail ho to purana tarika.
function upload_(name, bytes) {
  const b = 'eng' + Date.now(), meta = JSON.stringify({ name: name, parents: [OUT_ID] });
  const head = Utilities.newBlob('--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + b + '\r\nContent-Type: image/jpeg\r\n\r\n').getBytes();
  const tail = Utilities.newBlob('\r\n--' + b + '--').getBytes();
  const r = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
    method: 'post', contentType: 'multipart/related; boundary=' + b, payload: head.concat(bytes, tail), headers: auth_() });
  return JSON.parse(r.getContentText()).id;
}
function saveEnhanced(k, name, b64) {
  check_(k);
  const bytes = Utilities.base64Decode(b64);
  let id;
  try { id = upload_(name, bytes); }
  catch (e) { id = DriveApp.getFolderById(OUT_ID).createFile(Utilities.newBlob(bytes, 'image/jpeg', name)).getId(); }
  CacheService.getScriptCache().remove('lst');   // guests ko nayi photo agli poll me hi dikhe
  return id;
}
// chehre ka data PRIVATE rakha hai (My Drive root me), public folder me nahi
function faceFile_() {
  const it = DriveApp.getRootFolder().getFilesByName('engagement_faces.json');
  return it.hasNext() ? it.next() : null;
}
function saveFaces(k, json) {
  check_(k);
  const f = faceFile_();
  if (f) f.setContent(json); else DriveApp.getRootFolder().createFile('engagement_faces.json', json, 'application/json');
  CacheService.getScriptCache().put('fv', String(Date.now()), 21600);   // chehra-data badla: guests dobara le lenge
}
function getFacesAdmin(k) { check_(k); const f = faceFile_(); return f ? f.getBlob().getDataAsString() : '{}'; }

// ---- guests ----
function listOutput() { return images_(OUT_ID); }
function getFaces() { const f = faceFile_(); return f ? f.getBlob().getDataAsString() : '{}'; }

// Guest page har 2 sec me ye bulata hai. Cache se jawab aata hai, isliye bahut guests hone par bhi quota/slow nahi hota.
function liveState() {
  return { files: outList_(), fv: CacheService.getScriptCache().get('fv') || '0' };
}
