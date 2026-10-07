/**
 * ============================================================================
 * ONT Network Inventory Portal - single-file backend (Code.gs)  -  v3
 * Server-enforced roles, session tokens, catalog management, tickets, tasks,
 * requisitions with issue step, pending actions, user management.
 * Web app: Execute as "Me". HTML file name must be: improves
 * ============================================================================
 */

var SHEETS = {
  REGISTER: 'Horizontal Register',
  LEDGER: 'Transaction Ledger',
  SERIAL: 'Serialized Inventory',
  CATALOG: 'Item Catalog',
  USERS: 'User Directory',
  ISSUES: 'Customer Issues',
  REQS: 'Technician Requisitions',
  TASKS: 'Tasks',
  NOTIFICATIONS: 'Notification Log',
  SETTINGS: 'Inventory Settings',
  PROJECTS: 'Projects & Infrastructure',
  PROCURE: 'Procurement',
  DOCS: 'Delivery Notes',
  AUDIT: 'Audit Trail Log',
  CUSTOMERS: 'Customers',
  HOTSPOTS: 'Hotspots',
  SPLITTERS: 'Splitters',
  ENCLOSURES: 'Enclosures'
};

var REG = { DATE: 1, DIR: 2, ITEM: 3, MODEL: 4, QTY: 5, USER: 6, ROLE: 7, SITE: 8,
            NOTES: 9, STATUS: 10, CAT: 11, LEDGER_REF: 12 };

var SHEET_RULES = {
  'Horizontal Register':     { width: 12, keys: [2, 3] },
  'Transaction Ledger':      { width: 13, keys: [2, 3] },
  'Serialized Inventory':    { width: 14, keys: [1] },
  'Customer Issues':         { width: 16, keys: [1] },
  'Technician Requisitions': { width: 17, keys: [1] }
};

var SERIALIZED_SKU_PREFIXES = ['SKU-ONT', 'SKU-RTR', 'SKU-NET', 'SKU-FAT'];
var UNIT_STATUSES = ['In Stock', 'Issued / Out', 'Under Repair', 'Decommissioned'];
var MAX_PLACEHOLDERS = 200;
var MAX_EDIT_ROWS = 200;

/* ============================== HELPERS =================================== */

function norm_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
function normId_(v) { return norm_(v).toUpperCase(); }

function normDir_(v) {
  var s = norm_(v).toLowerCase();
  if (['stock in', 'in', 'receive', 'received', '+'].indexOf(s) > -1) return 'Stock In';
  if (['stock out', 'out', 'issue', 'issued', '-'].indexOf(s) > -1) return 'Stock Out';
  return '';
}

function tz_() { return Session.getScriptTimeZone(); }
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function stamp_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }

function fmtDate_(d) {
  if (d instanceof Date) return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
  var s = norm_(d);
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var p = new Date(s);
  return isNaN(p.getTime()) ? s : Utilities.formatDate(p, tz_(), 'yyyy-MM-dd');
}

function pad_(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function toast_(msg) {
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Inventory', 8); } catch (e) {}
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ======================= CONTIGUOUS-ROW GUARDRAILS ======================== */

function nextFreeRow_(sheet) {
  var rule = SHEET_RULES[sheet.getName()];
  var keys = rule ? rule.keys : [1];
  var maxKey = Math.max.apply(null, keys);
  var vals = sheet.getRange(1, 1, sheet.getMaxRows(), maxKey).getValues();
  for (var r = vals.length - 1; r >= 1; r--) {
    for (var k = 0; k < keys.length; k++) {
      if (norm_(vals[r][keys[k] - 1]) !== '') return r + 2;
    }
  }
  return 2;
}

function safeAppendRows_(sheet, rows) {
  if (!rows.length) return -1;
  var start = nextFreeRow_(sheet);
  var need = start + rows.length - 1;
  if (need > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), need - sheet.getMaxRows());
  sheet.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
  return start;
}

function safeAppend_(sheet, values) { return safeAppendRows_(sheet, [values]); }

function nextSeqId_(sheet, prefix, width) {
  var last = sheet.getLastRow(), max = 0;
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      var s = norm_(r[0]);
      if (s.indexOf(prefix + '-') === 0) {
        var n = parseInt(s.substring(prefix.length + 1), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
  }
  return prefix + '-' + pad_(max + 1, width);
}

/* ============================ LOOKUP CONTEXT ============================== */

function getCatalogMap_(sh) {
  var map = {};
  if (!sh) return map;
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    var id = normId_(d[i][0]);
    if (id && !map[id]) map[id] = { category: norm_(d[i][1]), manufacturer: norm_(d[i][2]), accessTech: norm_(d[i][4]), model: norm_(d[i][3]), unitCost: Number(d[i][5] || 0), reorderLevel: Number(d[i][7] || 0), tracking: norm_(d[i][8]) || (isSerializedSku_(id) ? 'Serialized' : 'Bulk'), scope: norm_(d[i][9]) || 'Shared' };
  }
  return map;
}

function getSerialMap_(sh) {
  var map = {};
  if (!sh) return map;
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    var id = normId_(d[i][0]);
    if (id && !map[id]) map[id] = { id: id, row: i + 1, status: norm_(d[i][8]), model: norm_(d[i][3]), category: norm_(d[i][1]), sku: normId_(d[i][13] || '') };
  }
  return map;
}

function buildCtx_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ctx = {
    ss: ss,
    reg: ss.getSheetByName(SHEETS.REGISTER),
    ledger: ss.getSheetByName(SHEETS.LEDGER),
    serialSheet: ss.getSheetByName(SHEETS.SERIAL)
  };
  if (!ctx.reg || !ctx.ledger || !ctx.serialSheet) {
    throw new Error('Missing sheet: need Horizontal Register, Transaction Ledger and Serialized Inventory.');
  }
  ctx.catalog = getCatalogMap_(ss.getSheetByName(SHEETS.CATALOG));
  ctx.serial = getSerialMap_(ctx.serialSheet);
  return ctx;
}

function isSerializedSku_(id) {
  id = normId_(id);
  for (var i = 0; i < SERIALIZED_SKU_PREFIXES.length; i++) {
    if (id.indexOf(SERIALIZED_SKU_PREFIXES[i]) > -1) return true;
  }
  return false;
}

/* ======================= ENHANCEMENT SCHEMA / EMAIL ======================= */

function ensureSheetWithHeaders_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, headers.length).setValues([headers]); return sh; }
  var existing = sh.getRange(1, 1, 1, Math.max(headers.length, sh.getLastColumn() || 1)).getValues()[0];
  headers.forEach(function(h, i) { if (!norm_(existing[i])) sh.getRange(1, i + 1).setValue(h); });
  return sh;
}

function ensureFeatureSchema_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var catalog = ss.getSheetByName(SHEETS.CATALOG);
  if (catalog) {
    catalog.getRange(1, 8).setValue(catalog.getRange(1, 8).getValue() || 'Reorder Level');
    var last = Math.max(catalog.getLastRow(), 2);
    var vals = catalog.getRange(2, 8, last - 1, 1).getValues();
    var changed = false;
    vals.forEach(function(r) { if (r[0] === '' || r[0] === null) { r[0] = 3; changed = true; } });
    if (changed) catalog.getRange(2, 8, vals.length, 1).setValues(vals);
  }
  var serial = ss.getSheetByName(SHEETS.SERIAL);
  if (serial) serial.getRange(1, 14).setValue(serial.getRange(1, 14).getValue() || 'Item SKU');
  var ledger = ss.getSheetByName(SHEETS.LEDGER);
  if (ledger) {
    ledger.getRange(1, 11, 1, 3).setValues([['Cost Type', 'Task ID', 'Asset ID']]);
  }
  ensureSheetWithHeaders_(ss, SHEETS.USERS, ['Email', 'Password', 'Role', 'Name', 'Magic Token', 'Token Expiry']);
  ensureSheetWithHeaders_(ss, 'Magic Tokens', ['Email', 'Token', 'Expires']);
  ensureSheetWithHeaders_(ss, SHEETS.TASKS, ['Task ID','Created At','Task Title','Task Type','Assigned Personnel','Assignee Email','Priority','Status','Required SKU','Required Qty','Customer / Site','Reference','Notes','Created By','Stock Ready At']);
  ensureSheetWithHeaders_(ss, SHEETS.NOTIFICATIONS, ['Timestamp','Type','Reference','Recipient','Subject','Status','Error']);
  ensureSheetWithHeaders_(ss, SHEETS.SETTINGS, ['Key','Value']);
  var set = ss.getSheetByName(SHEETS.SETTINGS);
  var existingKeys = {};
  if (set.getLastRow() > 1) set.getRange(2,1,set.getLastRow()-1,2).getValues().forEach(function(r){ existingKeys[norm_(r[0])] = true; });
  var defaults = [
    ['DEFAULT_REORDER_LEVEL','3'],
    ['LOW_STOCK_EMAILS',''],
    ['LOW_STOCK_ENABLED','TRUE'],
    ['TASK_ASSIGNMENT_ENABLED','TRUE'],
    ['STOCK_AVAILABLE_ENABLED','TRUE'],
    ['PURCHASING_EMAIL',''],
    ['FINANCE_EMAIL',''],
    ['DRIVE_FOLDER_ID','1-EV9L-rPvxHXs4UY6mfe14EKMTgyXQHg'],
    ['FINANCE_APPROVAL_THRESHOLD','50000'],
    ['COMPANY_NAME','ONT Network Services'],
    ['DIGEST_ENABLED','TRUE'],
    ['GENIEACS_URL',''],
    ['GENIEACS_NBI_URL',''],
    ['GENIEACS_ONLINE_MINUTES','15']
  ];
  defaults.forEach(function(r){ if (!existingKeys[r[0]]) safeAppend_(set, r); });
  return ss;
}

function getSettingsMap_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEETS.SETTINGS);
  var out = {};
  if (!sh) return out;
  var d = sh.getDataRange().getValues();
  for (var i=1;i<d.length;i++) if (norm_(d[i][0])) out[norm_(d[i][0])] = norm_(d[i][1]);
  return out;
}

function notificationRecipients_(fallbackRoles) {
  var s = getSettingsMap_();
  var explicit = norm_(s.LOW_STOCK_EMAILS);
  if (explicit) return explicit.split(/[,;\s]+/).filter(Boolean);
  var users = getUserMap_(), out=[];
  Object.keys(users).forEach(function(k){ var u=users[k]; if (u.email && fallbackRoles.indexOf(String(u.role).trim())>-1) out.push(u.email); });
  return out.filter(function(v,i,a){ return a.indexOf(v)===i; });
}

function sendEmailSafe_(to, subject, htmlBody, type, ref, attachments, cc) {
  if (!norm_(to)) return false;
  try {
    var opts = { to: to, subject: subject, htmlBody: htmlBody, body: htmlBody.replace(/<[^>]+>/g, ' ') };
    if (attachments && attachments.length) opts.attachments = attachments;
    if (cc) opts.cc = cc;
    MailApp.sendEmail(opts);
    logNotification_(type, ref, to, subject, 'SENT', '');
    return true;
  } catch (e) {
    logNotification_(type, ref, to, subject, 'FAILED', String(e));
    return false;
  }
}

function logNotification_(type, ref, recipient, subject, status, err) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.NOTIFICATIONS);
  if (!sh) return;
  safeAppend_(sh, [stamp_(), type, ref, recipient, subject, status, err || '']);
}

function catalogRecord_(ctx, sku) {
  var id=normId_(sku); return ctx.catalog[id] || null;
}

function resolveSkuForAsset_(ctx, assetId, model) {
  var ser=ctx.serial[assetId];
  if (ser && ser.sku) return ser.sku;
  var m=norm_(model).toLowerCase();
  var found=''; Object.keys(ctx.catalog).some(function(k){ var c=ctx.catalog[k]; if(norm_(c.model).toLowerCase()===m) {found=k; return true;} return false; });
  return found;
}

function currentSkuBalance_(ctx, sku) {
  var total=0, rows=ctx.ledger.getDataRange().getValues();
  var serialSku=normId_(sku);
  for (var i=1;i<rows.length;i++) {
    var id=normId_(rows[i][2]), qty=Number(rows[i][4]||0); if(!id||!qty) continue;
    var rsku = id.indexOf('INV-')===0 ? resolveSkuForAsset_(ctx,id,rows[i][3]) : id;
    if(rsku!==serialSku) continue;
    total += normDir_(rows[i][1])==='Stock In' ? qty : (normDir_(rows[i][1])==='Stock Out' ? -qty : 0);
  }
  return total;
}

/* ============ EPISODE-BASED LOW STOCK RE-ALERTING LOGIC ============ */

function getLastLowStockNotification_(sku) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.NOTIFICATIONS);
  if (!sh || sh.getLastRow() < 2) return null;
  var d = sh.getDataRange().getValues();
  var cleanSku = normId_(sku);
  for (var i = d.length - 1; i >= 1; i--) {
    if (norm_(d[i][1]) === 'LOW_STOCK' && normId_(d[i][2]) === cleanSku && norm_(d[i][5]) === 'SENT') {
      return { timestamp: fmtDate_(d[i][0]) };
    }
  }
  return null;
}

function hasReplenishmentSince_(ctx, sku, timestampStr) {
  if (!timestampStr) return true;
  var rows = ctx.ledger.getDataRange().getValues();
  var cleanSku = normId_(sku);
  for (var i = 1; i < rows.length; i++) {
    var id = normId_(rows[i][2]);
    if (!id) continue;
    var rsku = id.indexOf('INV-') === 0 ? resolveSkuForAsset_(ctx, id, rows[i][3]) : id;
    if (rsku === cleanSku && normDir_(rows[i][1]) === 'Stock In') {
      var dateStr = fmtDate_(rows[i][0]);
      if (dateStr >= timestampStr.substring(0, 10)) return true;
    }
  }
  return false;
}

function lowStockAlerts_(ctx, sku) {
  var settings = getSettingsMap_();
  if (String(settings.LOW_STOCK_ENABLED).toUpperCase() === 'FALSE') return;
  var c = catalogRecord_(ctx, sku);
  if (!c) return;
  var level = Number(c.reorderLevel || settings.DEFAULT_REORDER_LEVEL || 3);
  var bal = currentSkuBalance_(ctx, sku);
  if (level < 0 || bal > level) return;

  var lastNotif = getLastLowStockNotification_(sku);
  if (lastNotif && !hasReplenishmentSince_(ctx, sku, lastNotif.timestamp)) return;

  var recipients = lowStockRecipients_();
  if (!recipients.length) return;

  recipients.forEach(function (to) {
    var subject = 'Low stock alert: ' + sku;
    var body = '<p><strong>Low stock alert</strong></p><p><b>SKU:</b> ' + sku +
               '<br><b>Item:</b> ' + norm_(c.model) +
               '<br><b>Available:</b> ' + bal +
               '<br><b>Reorder level:</b> ' + level +
               '<br><b>Unit cost:</b> KES ' + Number(c.unitCost || 0).toLocaleString() +
               '<br><b>Stock value:</b> KES ' + (bal * Math.max(Number(c.unitCost || 0), 0)).toLocaleString() + '</p>';
    sendEmailSafe_(to, subject, body, 'LOW_STOCK', sku);
  });
}

function runLowStockScan() {
  return withLock_(function () {
    var ctx = buildCtx_();
    var count = 0;
    Object.keys(ctx.catalog).forEach(function (sku) {
      var bal = currentSkuBalance_(ctx, sku);
      var level = Number(ctx.catalog[sku].reorderLevel || 3);
      if (bal <= level) {
        lowStockAlerts_(ctx, sku);
        count++;
      }
    });
    var msg = 'Low-stock scan completed. Checked ' + Object.keys(ctx.catalog).length + ' SKUs (' + count + ' low).';
    toast_(msg);
    return msg;
  });
}

function taskAssignmentEmail_(task) {
  var settings=getSettingsMap_(); if(String(settings.TASK_ASSIGNMENT_ENABLED).toUpperCase()==='FALSE') return;
  if(!task.assigneeEmail) return;
  var subject='Task assigned: '+task.id+' - '+task.title;
  var body='<p>A task has been assigned to you.</p><p><b>Task:</b> '+task.id+'<br><b>Title:</b> '+task.title+'<br><b>Priority:</b> '+task.priority+'<br><b>Status:</b> '+task.status+'<br><b>Required stock:</b> '+(task.sku ? task.sku+' × '+task.qty : 'None')+'<br><b>Site:</b> '+(task.site||'—')+'<br><b>Reference:</b> '+(task.reference||'—')+'<br><b>Notes:</b> '+(task.notes||'—')+'</p>';
  sendEmailSafe_(task.assigneeEmail,subject,body,'TASK_ASSIGNED',task.id);
}

function notifyAwaitingStockTasks_(ctx, sku) {
  var settings=getSettingsMap_(); if(String(settings.STOCK_AVAILABLE_ENABLED).toUpperCase()==='FALSE') return;
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var available=currentSkuBalance_(ctx,sku);
  var sh=ss.getSheetByName(SHEETS.TASKS);
  if(sh){
    var data=sh.getDataRange().getValues();
    for(var i=1;i<data.length;i++){
      var taskId=norm_(data[i][0]), status=norm_(data[i][7]), reqSku=normId_(data[i][8]), qty=Number(data[i][9]||0), email=norm_(data[i][5]);
      if(!taskId || status!=='Awaiting Stock' || reqSku!==normId_(sku) || !qty || available<qty) continue;
      available-=qty; sh.getRange(i+1,8).setValue('Ready'); sh.getRange(i+1,15).setValue(stamp_());
      if(email){
        var subject='Stock available for task '+taskId;
        var body='<p>Required stock is now available for your task.</p><p><b>Task:</b> '+taskId+'<br><b>SKU:</b> '+reqSku+'<br><b>Required Qty:</b> '+qty+'<br><b>Stock available after this task:</b> '+available+'<br><b>Status:</b> Ready</p>';
        sendEmailSafe_(email,subject,body,'STOCK_AVAILABLE',taskId);
      }
    }
  }
  notifyAwaitingRequisitions_(ctx,sku,available);
}

function notifyAwaitingRequisitions_(ctx, sku, available) {
  var sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REQS); if(!sh) return;
  var data=sh.getDataRange().getValues(); var users=getUserMap_();
  for(var i=1;i<data.length;i++){
    var reqId=norm_(data[i][0]), status=norm_(data[i][6]), reqSku=normId_(data[i][3]), qty=Number(data[i][4]||0), tech=norm_(data[i][2]);
    if(!reqId || status!=='Awaiting Stock' || reqSku!==normId_(sku) || !qty || available<qty) continue;
    available-=qty; sh.getRange(i+1,7).setValue('Approved - Ready'); sh.getRange(i+1,9).setValue(stamp_());
    var u=users[tech.toLowerCase()]; if(u && u.email){
      var subject='Stock available for requisition '+reqId;
      var body='<p>Stock required for your approved requisition is now available.</p><p><b>Requisition:</b> '+reqId+'<br><b>SKU:</b> '+reqSku+'<br><b>Required Qty:</b> '+qty+'<br><b>Status:</b> Approved - Ready</p>';
      sendEmailSafe_(u.email,subject,body,'STOCK_AVAILABLE_REQ',reqId);
    }
  }
}

function sendIssueAssignmentEmail_(ticketId, form) {
  var users=getUserMap_(), u=users[norm_(form.assignedTech).toLowerCase()]; if(!u || !u.email) return;
  var subject='Support task assigned: '+ticketId;
  var body='<p>A customer support task has been assigned to you.</p><p><b>Ticket:</b> '+ticketId+'<br><b>Customer:</b> '+norm_(form.customerName)+'<br><b>Issue:</b> '+norm_(form.issueCategory)+'<br><b>Old device:</b> '+norm_(form.oldDeviceSN||'N/A')+'<br><b>New device:</b> '+norm_(form.newDeviceSN||'N/A')+'<br><b>Notes:</b> '+norm_(form.notes||'')+'</p>';
  sendEmailSafe_(u.email,subject,body,'TICKET_ASSIGNED',ticketId);
}

function backfillSerializedSkuLinks_() {
  var ss=SpreadsheetApp.getActiveSpreadsheet(), sh=ss.getSheetByName(SHEETS.SERIAL), cat=ss.getSheetByName(SHEETS.CATALOG);
  if(!sh || !cat || sh.getLastRow()<2 || cat.getLastRow()<2) return 0;
  var serialRows=sh.getRange(2,1,sh.getLastRow()-1,14).getValues(), cats=cat.getRange(2,1,cat.getLastRow()-1,8).getValues(), changed=0;
  for(var i=0;i<serialRows.length;i++){
    if(norm_(serialRows[i][13])) continue;
    var model=norm_(serialRows[i][3]).toLowerCase(), asset=norm_(serialRows[i][1]).toLowerCase(), matches=[];
    if(model) cats.forEach(function(c){ var cm=norm_(c[3]).toLowerCase(), ca=norm_(c[1]).toLowerCase(); if(cm && cm===model) matches.push(normId_(c[0])); });
    if(matches.length===1){ serialRows[i][13]=matches[0]; changed++; }
    else if(model){
      matches=[];
      cats.forEach(function(c){ var cm=norm_(c[3]).toLowerCase(), ca=norm_(c[1]).toLowerCase(); if(cm===model && asset && ca && asset.indexOf(ca)>-1) matches.push(normId_(c[0])); });
      var uniq=matches.filter(function(v,k,a){return v&&a.indexOf(v)===k;}); if(uniq.length===1){ serialRows[i][13]=uniq[0]; changed++; }
    }
  }
  if(changed) sh.getRange(2,1,serialRows.length,14).setValues(serialRows);
  return changed;
}

/* ================= HARDENED GOOGLE SHEETS DATA PROTECTION ================= */

function applySheetProtections() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ownerEmail = ss.getOwner() ? ss.getOwner().getEmail() : Session.getEffectiveUser().getEmail();

  var sensitiveSheets = [SHEETS.LEDGER, SHEETS.CATALOG, SHEETS.SETTINGS, SHEETS.NOTIFICATIONS];
  sensitiveSheets.forEach(function(sName) {
    var sheet = ss.getSheetByName(sName);
    if (!sheet) return;
    var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    var protection = protections.length > 0 ? protections[0] : sheet.protect().setDescription('Admin Only Edit Protection');
    protection.removeEditors(protection.getEditors());
    protection.addEditor(ownerEmail);
    if (protection.canDomainEdit()) protection.setDomainEdit(false);
  });
  toast_('Sheet protections updated: Admin/Owner edit access only.');
}

function installInventoryEnhancements() {
  return withLock_(function(){
    ensureFeatureSchema_();
    ensurePortalSchema_();
    applyLedgerFormulas_(true);
    var n = backfillSerializedSkuLinks_();
    applySheetProtections();

    ScriptApp.getProjectTriggers().forEach(function (t) {
      var h = t.getHandlerFunction();
      if (h === 'runLowStockScan' || h === 'sendDailyDigest') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('sendDailyDigest').timeBased().everyDays(1).atHour(8).create();

    toast_('Inventory enhancements installed. Serialized SKU links backfilled: ' + n + '.');
    return 'Enhancements installed. Serialized SKU links backfilled: ' + n + '.';
  });
}

/* =================== CORE: REGISTER ROW -> LEDGER + UNITS ================= */

function processRegisterRow_(ctx, row) {
  var reg = ctx.reg;
  var v = reg.getRange(row, 1, 1, REG.LEDGER_REF).getValues()[0];
  var status = norm_(v[REG.STATUS - 1]);
  var ledgerRef = norm_(v[REG.LEDGER_REF - 1]);
  var idRaw = norm_(v[REG.ITEM - 1]);
  var dirRaw = norm_(v[REG.DIR - 1]);
  var qtyRaw = norm_(v[REG.QTY - 1]);

  if (!idRaw && !dirRaw && !qtyRaw) return { state: 'blank' };

  if (ledgerRef || status === 'PROCESSED' || status.indexOf('EDITED') === 0) {
    if (ledgerRef && !status) reg.getRange(row, REG.STATUS).setValue('PROCESSED');
    return { state: 'posted' };
  }

  if (!idRaw || !dirRaw || !qtyRaw) {
    return { state: 'incomplete', message: 'Direction, Item ID and Quantity are all required.' };
  }

  var fail = function (msg) {
    reg.getRange(row, REG.STATUS).setValue('ERROR: ' + msg);
    return { state: 'error', message: msg };
  };

  var dir = normDir_(dirRaw);
  if (!dir) return fail('Direction must be "Stock In" or "Stock Out"');

  var qty = Number(qtyRaw);
  if (!isFinite(qty) || qty <= 0 || Math.floor(qty) !== qty) return fail('Quantity must be a whole number above 0');

  var id = normId_(idRaw);
  var cat = ctx.catalog[id];
  var ser = ctx.serial[id];
  if (!cat && !ser) return fail('Unknown Item ID ' + id + ' (not in Item Catalog or Serialized Inventory)');

  var notes = norm_(v[REG.NOTES - 1]);

  if (ser) {
    if (qty !== 1) return fail('Serialized unit ' + id + ' must have quantity 1');
    if (dir === 'Stock Out' && ser.status !== 'In Stock') return fail(id + ' is "' + ser.status + '", not In Stock');
    if (dir === 'Stock In' && ser.status === 'In Stock') return fail(id + ' is already In Stock');
  }

  var makePlaceholders = !ser && dir === 'Stock In' && isSerializedSku_(id) && !/backfill/i.test(notes);
  if (makePlaceholders && qty > MAX_PLACEHOLDERS) {
    return fail('Quantity ' + qty + ' is too large for auto-creating units (max ' + MAX_PLACEHOLDERS + ')');
  }

  var dateStr = fmtDate_(v[REG.DATE - 1]) || today_();
  var model = norm_(v[REG.MODEL - 1]) || (ser ? ser.model : (cat ? cat.model : ''));
  var user = norm_(v[REG.USER - 1]);
  var role = norm_(v[REG.ROLE - 1]);
  var site = norm_(v[REG.SITE - 1]);
  var category = (cat && cat.category) || (ser && ser.category) || (id.indexOf('RTR') > -1 ? 'Wireless Router' : 'XPON/ONT');
  var ledgerItemId = ser ? (ser.sku || resolveSkuForAsset_(ctx, id, model) || id) : id;
  var assetId = ser ? id : '';
  var unitCost = ser ? Number((ctx.catalog[ledgerItemId] || {}).unitCost || 0) : Number((cat || {}).unitCost || 0);
  var costType = norm_(v[REG.NOTES - 1]).toLowerCase().indexOf('replacement') > -1 ? 'Replacement' : (dir === 'Stock In' ? 'Procurement / Stock In' : 'Other');
  var taskId = site;
  var notesLower = norm_(v[REG.NOTES - 1]);
  var taskMatch = notesLower.match(/(?:TASK|TKT|JOB)[-_#]?\w+/i); if(taskMatch) taskId = taskMatch[0];

  var createdIds = [];
  var ledgerRow = appendLedger_(ctx.ledger, [dateStr, dir, ledgerItemId, model, qty, user, role, site], [costType, taskId, assetId]);

  if (ser) {
    updateSerialUnit_(ctx, ser, dir, user, site, dateStr);
  } else if (makePlaceholders) {
    createdIds = createPlaceholders_(ctx, id, model, qty, dateStr, user, site);
  }

  if (!norm_(v[REG.DATE - 1])) reg.getRange(row, REG.DATE).setValue(dateStr);
  if (!norm_(v[REG.MODEL - 1]) && model) reg.getRange(row, REG.MODEL).setValue(model);

  reg.getRange(row, REG.STATUS, 1, 3).clearDataValidations();
  reg.getRange(row, REG.STATUS, 1, 3).setValues([['PROCESSED', category, ledgerRow]]);

  lowStockAlerts_(ctx, ledgerItemId);
  if (dir === 'Stock In') notifyAwaitingStockTasks_(ctx, ledgerItemId);

  return { state: 'ok', category: category, ledgerRow: ledgerRow, unitCost: unitCost, totalCost: qty * unitCost, assetId: assetId, createdIds: createdIds };
}

function updateSerialUnit_(ctx, ser, dir, user, site, dateStr) {
  var sh = ctx.serialSheet, prevStatus = ser.status;
  var newStatus = (dir === 'Stock Out') ? 'Issued / Out' : 'In Stock';
  sh.getRange(ser.row, 9).setValue(newStatus);
  if (dir === 'Stock Out') {
    if (user) sh.getRange(ser.row, 12).setValue(user);
    if (site) sh.getRange(ser.row, 11).setValue(site);
  } else {
    sh.getRange(ser.row, 12).setValue('');
    sh.getRange(ser.row, 11).setValue(site || 'Main Store');
  }
  var noteCell = sh.getRange(ser.row, 13);
  var cur = noteCell.getValue();
  var log = '[' + dateStr + '] ' + dir + ' -> ' + (user || 'Staff') + ' (Site: ' + (site || 'Main Store') + ')';
  noteCell.setValue(cur ? cur + ' | ' + log : log);
  ser.status = newStatus;
  audit_('Serialized Asset', ser.id, dir, { status: prevStatus }, { status: newStatus, custodian: dir === 'Stock Out' ? user : '', location: dir === 'Stock Out' ? site : (site || 'Main Store') }, 'Ledger movement');
}

function createPlaceholders_(ctx, id, model, qty, dateStr, user, site) {
  var m = String(model || '').toUpperCase();
  var prefix = 'INV-ONT-', assetType = 'XPON/ONT', tech = 'XPON';

  if (id.indexOf('RTR') > -1 || m.indexOf('ROUTER') > -1 || m.indexOf('WR842N') > -1) {
    prefix = 'INV-RTR-'; assetType = 'Wireless Router'; tech = 'Ethernet / Wi-Fi';
  } else if (id.indexOf('NET') > -1 || m.indexOf('AR611') > -1) {
    prefix = 'INV-NET-'; assetType = 'Enterprise Router'; tech = 'Ethernet WAN';
  } else if (id.indexOf('FAT') > -1 || m.indexOf('FAT') > -1) {
    prefix = 'INV-FAT-'; assetType = 'FAT Box'; tech = 'Optical PLC';
  }

  var maxSeq = 0;
  Object.keys(ctx.serial).forEach(function (k) {
    if (k.indexOf(prefix) === 0) {
      var n = parseInt(k.substring(prefix.length), 10);
      if (!isNaN(n) && n > maxSeq) maxSeq = n;
    }
  });

  var rows = [], ids = [];
  for (var i = 0; i < qty; i++) {
    maxSeq++;
    var newId = prefix + pad_(maxSeq, 4);
    ids.push(newId);
    rows.push([
      newId, assetType, (ctx.catalog[id] && ctx.catalog[id].manufacturer) || 'Huawei / Generic', model, tech,
      '', '', '',
      'In Stock', 'New', site || 'Main Store', '',
      'Received: ' + dateStr + ' | Ref: ' + (site || 'Main Store') + ' | Logged By: ' + (user || 'Admin') + ' | Awaiting S/N & MAC', id
    ]);
  }
  var start = safeAppendRows_(ctx.serialSheet, rows);
  ids.forEach(function (nid, i) {
    ctx.serial[nid] = { id: nid, row: start + i, status: 'In Stock', model: model, category: assetType, sku: id };
    audit_('Serialized Asset', nid, 'Created (Stock In)', null, { sku: id, model: model, status: 'In Stock', location: site || 'Main Store' }, 'Received ' + dateStr + (user ? ' by ' + user : ''));
  });
  return ids;
}

function postMovement_(m) {
  var ctx = buildCtx_();
  var startRow = nextFreeRow_(ctx.reg);

  ctx.reg.getRange(startRow, REG.ITEM).clearDataValidations();

  var row = safeAppend_(ctx.reg, [m.date || '', m.dir || '', m.id || '', m.model || '', m.qty || '',
                                  m.user || '', m.role || '', m.site || '', m.notes || '', '', '', '']);
  var out = processRegisterRow_(ctx, row);
  if (out.state !== 'ok') {
    ctx.reg.deleteRow(row);
    return { state: 'error', message: out.message || 'Could not record movement.' };
  }
  return out;
}

/* ===================== MANUAL-EDIT SYNC (TRIGGER) ========================= */

function onRegisterEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== SHEETS.REGISTER) return;

    var first = Math.max(e.range.getRow(), 2);
    var last = e.range.getLastRow();
    if (last < first) return;
    if (last - first + 1 > MAX_EDIT_ROWS) {
      toast_('Large paste detected - run Inventory Tools > Sync unprocessed rows.');
      return;
    }
    var touchedData = e.range.getColumn() <= REG.SITE;

    withLock_(function () {
      var ctx = buildCtx_();
      for (var r = first; r <= last; r++) {
        if (touchedData) {
          var st = sh.getRange(r, REG.STATUS, 1, 3).getValues()[0];
          var posted = norm_(st[2]) !== '' || norm_(st[0]) === 'PROCESSED';
          if (posted) {
            sh.getRange(r, REG.STATUS).setValue('EDITED - REVIEW LEDGER');
            continue;
          }
        }
        processRegisterRow_(ctx, r);
      }
    });
  } catch (err) {
    console.error('onRegisterEdit: ' + err);
  }
}

function processRows_(start, end) {
  return withLock_(function () {
    var ctx = buildCtx_();
    var res = { ok: 0, error: 0, incomplete: 0, skipped: 0 };
    for (var r = Math.max(start, 2); r <= end; r++) {
      var o = processRegisterRow_(ctx, r);
      if (o.state === 'ok') res.ok++;
      else if (o.state === 'error') res.error++;
      else if (o.state === 'incomplete') res.incomplete++;
      else res.skipped++;
    }
    return res;
  });
}

function syncAllUnprocessedRecords() {
  var reg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REGISTER);
  if (!reg) return 'Horizontal Register missing';
  var res = processRows_(2, nextFreeRow_(reg) - 1);
  var msg = 'Posted ' + res.ok + ' row(s). Errors: ' + res.error + '. Incomplete: ' + res.incomplete +
            '. Already posted: ' + res.skipped + '. (See Sync Status column for ERROR details.)';
  toast_(msg);
  return msg;
}

/* ============================ ONE-TIME SETUP ============================== */

function setupGuardrails() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'onRegisterEdit' || h === 'onEdit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onRegisterEdit').forSpreadsheet(ss).onEdit().create();

  var reg = ss.getSheetByName(SHEETS.REGISTER);
  if (!norm_(reg.getRange(1, REG.LEDGER_REF).getValue())) reg.getRange(1, REG.LEDGER_REF).setValue('Ledger Ref');

  var n = Math.max(reg.getMaxRows() - 1, 1);
  reg.getRange(2, REG.DIR, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Stock In', 'Stock Out'], true).setAllowInvalid(false).build());
  reg.getRange(2, REG.QTY, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(1).setAllowInvalid(false).build());

  applySheetProtections();
  toast_('Guardrails installed: edit trigger + Direction/Quantity validation + Sheet protections.');
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Inventory Tools')
      .addItem('Sync unprocessed rows', 'syncAllUnprocessedRecords')
      .addItem('Run low-stock alert scan', 'runLowStockScan')
      .addItem('Repair row gaps (with backup)', 'repairAllGaps')
      .addItem('Fix duplicate unit IDs', 'fixDuplicateSerialIds')
      .addItem('Install guardrails & protections', 'setupGuardrails')
      .addItem('Install notifications + costing', 'installInventoryEnhancements')
      .addItem('Send daily digest now', 'sendDailyDigest')
      .addItem('Verify audit trail', 'verifyAuditMenu')
      .addItem('Set GenieACS credentials', 'setGenieAcsCredentials')
      .addItem('Convert ledger costs to formulas', 'convertLedgerCostsToFormulas')
      .addToUi();
  } catch (e) {}
}

function repairAllGaps() {
  withLock_(function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tag = Utilities.formatDate(new Date(), tz_(), 'yyMMdd-HHmm');
    Object.keys(SHEET_RULES).forEach(function (name) {
      var sheet = ss.getSheetByName(name);
      if (!sheet || sheet.getLastRow() < 2) return;
      var rule = SHEET_RULES[name];
      sheet.copyTo(ss).setName((name + ' BAK ' + tag).substring(0, 99));
      var range = sheet.getRange(2, 1, sheet.getLastRow() - 1, rule.width);
      var keep = range.getValues().filter(function (row) {
        return rule.keys.some(function (k) { return norm_(row[k - 1]) !== ''; });
      });
      range.clearContent();
      if (keep.length) sheet.getRange(2, 1, keep.length, rule.width).setValues(keep);
      console.log(name + ': kept ' + keep.length + ' rows');
    });
    applyLedgerFormulas_(true);
    toast_('Gaps repaired. Backups are the "BAK" tabs - delete them once you have checked.');
  });
}

function fixDuplicateSerialIds() {
  withLock_(function () {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SERIAL);
    if (!sh || sh.getLastRow() < 2) return;
    var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    var maxBy = {}, seen = {}, changes = [];

    ids.forEach(function (r) {
      var m = normId_(r[0]).match(/^(.*?)(\d+)$/);
      if (m) { var n = parseInt(m[2], 10); if (!(m[1] in maxBy) || n > maxBy[m[1]]) maxBy[m[1]] = n; }
    });
    ids.forEach(function (r, i) {
      var id = normId_(r[0]);
      if (!id) return;
      if (seen[id]) {
        var m = id.match(/^(.*?)(\d+)$/);
        if (m) {
          maxBy[m[1]]++;
          var nid = m[1] + pad_(maxBy[m[1]], 4);
          changes.push('Row ' + (i + 2) + ': ' + id + ' -> ' + nid);
          r[0] = nid;
        }
      } else {
        seen[id] = true;
      }
    });
    sh.getRange(2, 1, ids.length, 1).setValues(ids);
    console.log(changes.length ? changes.join('\n') : 'No duplicates found.');
    toast_(changes.length ? 'Renamed ' + changes.length + ' duplicate ID(s). See Executions log.' : 'No duplicate unit IDs.');
  });
}

/* ================== DATA HELPERS USED BY THE WEB APP ====================== */

function getCleanSheetData(sheet) {
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  var out = values.map(function (row) {
    return row.map(function (cell) {
      if (cell instanceof Date) return Utilities.formatDate(cell, tz_(), 'yyyy-MM-dd HH:mm');
      return (cell === null || cell === undefined) ? '' : cell.toString();
    });
  });
  while (out.length > 1 && out[out.length - 1].every(function (c) { return c === '' || c === '0'; })) out.pop();
  return out;
}

/** Movement logic (called by the permission-checked submitTransaction wrapper). Now project-aware. */
function submitTransaction_(form) {
  return withLock_(function () {
    ensureFeatureSchema_();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var id = normId_(form.itemID), type = norm_(form.itemType) || 'bulk', dir = normDir_(form.direction);
    var ser = getSerialMap_(ss.getSheetByName(SHEETS.SERIAL))[id], projectId = normId_(form.projectId);
    if (type === 'serialized' && !ser) return { success: false, message: 'Select a valid serialized unit / asset.' };
    if (type === 'bulk' && ser) return { success: false, message: 'Serialized unit IDs are only valid when Item Type is Serialized unit.' };
    if (type === 'bulk' && dir === 'Stock Out' && isSerializedSku_(id)) return { success: false, message: 'This is a serialized SKU. Select Item Type = Serialized unit and choose the exact asset.' };
    if (type === 'bulk' && dir === 'Stock In' && isSerializedSku_(id)) return { success: false, message: 'Serialized items need their S/N and MAC. Use Stock In (Serialized) and enter the unit details.' };
    if (projectId && !projectExists_(projectId)) return { success: false, message: 'Unknown project ' + projectId + '.' };
    if (dir === 'Stock Out') {
      var se = scopeError_(ser ? ser.sku : id, projectId);
      if (se) return { success: false, message: se };
    }
    var notes = norm_(form.notes), costType = norm_(form.costType) || (dir === 'Stock In' ? 'Procurement / Stock In' : 'Other');
    if (form.taskId) notes = notes ? notes + ' | Task: ' + form.taskId : 'Task: ' + form.taskId;
    if (costType) notes = notes ? notes + ' | Cost Type: ' + costType : 'Cost Type: ' + costType;
    var out = postMovement_({ date: form.date, dir: dir, id: id, model: form.model, qty: Number(form.quantity), user: form.user, role: form.role, site: form.site || projectId || '', notes: notes });
    if (out.state !== 'ok') return { success: false, message: out.message };

    var ledger = ss.getSheetByName(SHEETS.LEDGER);
    if (out.ledgerRow) {
      ledger.getRange(out.ledgerRow, 11, 1, 3).setValues([[costType, norm_(form.taskId) || norm_(form.site) || '', out.assetId || '']]);
      if (projectId) setLedgerProject_(out.ledgerRow, projectId);
    }
    return { success: true, message: 'Movement recorded (' + out.category + ')' + (projectId ? ' against ' + projectId : '') + '.' };
  });
}

/** Original device-update logic (called by the permission-checked updateSerializedDevice wrapper). */
function updateSerializedDevice_(form) {
  return withLock_(function () {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SERIAL);
    if (!sh) return { success: false, message: 'Serialized Inventory sheet missing.' };

    var id = normId_(form.itemID);
    var ser = getSerialMap_(sh)[id];
    if (!ser) return { success: false, message: 'Device ID not found.' };
    var ctx = buildCtx_();
    var sku = ser.sku || resolveSkuForAsset_(ctx, id, ser.model);
    if (sku) sh.getRange(ser.row, 14).setValue(sku);
    var cur0 = sh.getRange(ser.row, 1, 1, 14).getValues()[0];
    var before = { status: norm_(cur0[8]), condition: norm_(cur0[9]), location: norm_(cur0[10]), custodian: norm_(cur0[11]), sn: norm_(cur0[7]), mac: norm_(cur0[6]) };

    var newStatus = norm_(form.status);
    if (newStatus && UNIT_STATUSES.indexOf(newStatus) === -1) {
      return { success: false, message: 'Invalid status: ' + newStatus };
    }
    var newSn = null, newMac = null, idn = serialIdentifiers_();
    if (norm_(form.sn) && normSn_(form.sn) !== normSn_(before.sn)) {
      newSn = normSn_(form.sn);
      if (idn.sn[newSn] && idn.sn[newSn] !== id) return { success: false, message: 'S/N ' + newSn + ' already belongs to ' + idn.sn[newSn] + '.' };
    }
    if (norm_(form.mac)) {
      var pm = parseMac_(form.mac);
      if (pm !== norm_(before.mac).replace(/[:.\-\s]/g, '').toUpperCase()) {
        newMac = pm;
        if (idn.mac[newMac] && idn.mac[newMac] !== id) return { success: false, message: 'MAC ' + newMac + ' already belongs to ' + idn.mac[newMac] + '.' };
      }
    }

    var moved = false;
    var flips = (newStatus === 'In Stock' || newStatus === 'Issued / Out') &&
                (ser.status === 'In Stock' || ser.status === 'Issued / Out') && newStatus !== ser.status;
    if (flips) {
      var out = postMovement_({
        dir: newStatus === 'Issued / Out' ? 'Stock Out' : 'Stock In',
        id: id, qty: 1,
        user: norm_(form.custodian), site: norm_(form.location),
        notes: 'Via Serialized Units form'
      });
      if (out.state !== 'ok') return { success: false, message: out.message };
      moved = true;
    } else if (newStatus && newStatus !== ser.status) {
      sh.getRange(ser.row, 9).setValue(newStatus);
    }

    if (norm_(form.condition)) sh.getRange(ser.row, 10).setValue(form.condition);
    if (!moved) {
      if (norm_(form.location)) sh.getRange(ser.row, 11).setValue(form.location);
      if (norm_(form.custodian)) sh.getRange(ser.row, 12).setValue(form.custodian);
    }
    if (norm_(form.notes)) {
      var noteCell = sh.getRange(ser.row, 13);
      var cur = noteCell.getValue();
      var log = '[' + stamp_() + '] Note: ' + form.notes;
      noteCell.setValue(cur ? cur + ' | ' + log : log);
    }
    var pidNew = norm_(form.productId), pidOld = norm_(cur0[5]);
    if (pidNew && pidNew !== pidOld) { var pcell = sh.getRange(ser.row, 6); pcell.setNumberFormat('@'); pcell.setValue(pidNew); }
    if (newSn !== null || newMac !== null) {
      var idr = sh.getRange(ser.row, 7, 1, 2); idr.setNumberFormat('@');
      if (newMac !== null) sh.getRange(ser.row, 7).setValue(newMac);
      if (newSn !== null) sh.getRange(ser.row, 8).setValue(newSn);
    }
    var after = { status: moved ? 'In Stock/Issued (via movement)' : (newStatus || before.status), condition: norm_(form.condition) || before.condition, location: moved ? '' : (norm_(form.location) || before.location), custodian: moved ? '' : (norm_(form.custodian) || before.custodian), sn: newSn !== null ? newSn : before.sn, mac: newMac !== null ? newMac : before.mac };
    var pv = {}, nx = {};
    ['condition', 'location', 'custodian', 'sn', 'mac'].forEach(function (k) { if (String(after[k]) !== String(before[k]) && !(moved && (k === 'location' || k === 'custodian'))) { pv[k] = before[k]; nx[k] = after[k]; } });
    if (!moved && String(after.status) !== String(before.status)) { pv.status = before.status; nx.status = after.status; }
    if (pidNew && pidNew !== pidOld) { pv.productId = pidOld; nx.productId = pidNew; }
    if (Object.keys(nx).length || norm_(form.notes)) audit_('Serialized Asset', id, 'Updated', pv, nx, norm_(form.notes));
    return { success: true, message: 'Device ' + id + ' updated successfully!' };
  });
}

function getStockSummary_(includeCost) {
  var ctx=buildCtx_(), map={};
  Object.keys(ctx.catalog).forEach(function(sku){ var c=ctx.catalog[sku]; map[sku]={sku:sku,model:c.model,totalIn:0,totalOut:0,net:0,unitCost:includeCost ? (c.unitCost||0) : 0,reorderLevel:c.reorderLevel||0}; });
  var rows=ctx.ledger.getDataRange().getValues();
  for(var i=1;i<rows.length;i++){
    var id=normId_(rows[i][2]), model=norm_(rows[i][3]), qty=Number(rows[i][4]||0); if(!id||!qty) continue;
    var sku=id.indexOf('INV-')===0?resolveSkuForAsset_(ctx,id,model):id; if(!sku) continue;
    if(!map[sku]) { map[sku]={sku:sku,model:model,totalIn:0,totalOut:0,net:0,unitCost:includeCost ? Number((ctx.catalog[sku]||{}).unitCost||0) : 0,reorderLevel:Number((ctx.catalog[sku]||{}).reorderLevel||0)}; }
    if(normDir_(rows[i][1])==='Stock In') map[sku].totalIn+=qty; else if(normDir_(rows[i][1])==='Stock Out') map[sku].totalOut+=qty;
  }
  var out=[['Item ID (SKU)','Item Name / Model','Total In','Total Out','Net Remaining Qty','Current Status','Unit Cost','Stock Value','Reorder Level']];
  Object.keys(map).sort().forEach(function(sku){
    var x=map[sku]; x.net=x.totalIn-x.totalOut;
    var status=x.net<=0?'Out of Stock':(x.reorderLevel>0&&x.net<=x.reorderLevel?'Low Stock':'In Stock');
    out.push([x.sku,x.model,x.totalIn,x.totalOut,x.net,status,x.unitCost,includeCost ? x.net*Math.max(x.unitCost,0) : 0,x.reorderLevel]);
  });
  return out;
}

function getCostAnalysis_() {
  var ctx=buildCtx_(), summary=getStockSummary_(true), items={}, tasks={}, byType={};
  for(var i=1;i<summary.length;i++){ var r=summary[i], sku=normId_(r[0]); items[sku]={sku:sku,model:r[1],qty:Number(r[4]||0),unitCost:Number(r[6]||0),stockValue:Number(r[7]||0),issuedCost:0}; }
  var stockInSpend=0, stockOutCost=0, replacementCost=0;
  var rows=ctx.ledger.getDataRange().getValues();
  for(var j=1;j<rows.length;j++){
    var id=normId_(rows[j][2]), dir=normDir_(rows[j][1]), qty=Number(rows[j][4]||0), unit=Number(rows[j][8]||0), total=Number(rows[j][9]||qty*unit), type=norm_(rows[j][10]), task=norm_(rows[j][11])||norm_(rows[j][7]), date=fmtDate_(rows[j][0]); if(!id) continue;
    var sku=id.indexOf('INV-')===0?resolveSkuForAsset_(ctx,id,rows[j][3]):id;
    if(sku && !items[sku]) items[sku]={sku:sku,model:(ctx.catalog[sku]||{}).model||rows[j][3],qty:0,unitCost:Number((ctx.catalog[sku]||{}).unitCost||unit),stockValue:0,issuedCost:0};
    if(dir==='Stock In') stockInSpend+=total;
    if(dir==='Stock Out'){
      stockOutCost+=total; if(items[sku]) items[sku].issuedCost+=total;
      var typeKey=type || 'Other'; if(!byType[typeKey]) byType[typeKey]={type:typeKey,qty:0,cost:0}; byType[typeKey].qty+=qty; byType[typeKey].cost+=total;
      if(String(type).toLowerCase().indexOf('replacement')>-1) replacementCost+=total;
    }
    if(task && dir==='Stock Out') { if(!tasks[task]) tasks[task]={ref:task,qty:0,cost:0,replacementCost:0,lastUse:date}; tasks[task].qty+=qty; tasks[task].cost+=total; if(String(type).toLowerCase().indexOf('replacement')>-1) tasks[task].replacementCost+=total; if(date>tasks[task].lastUse) tasks[task].lastUse=date; }
  }
  return {stockValue:summary.slice(1).reduce(function(a,r){return a+Number(r[7]||0);},0),stockInSpend:stockInSpend,stockOutCost:stockOutCost,replacementCost:replacementCost,byCostType:Object.keys(byType).map(function(k){return byType[k];}).sort(function(a,b){return b.cost-a.cost;}),items:Object.keys(items).map(function(k){return items[k];}).sort(function(a,b){return b.stockValue-a.stockValue;}),tasks:Object.keys(tasks).map(function(k){return tasks[k];}).sort(function(a,b){return b.cost-a.cost;})};
}

/* ======================================================================= */
/* ======================= PORTAL v2 (auth, roles, UI API) ================ */
/* ======================================================================= */

var SESSION_TTL_ = 21600; // 6h (CacheService maximum)
var ROLES_ = ['Admin', 'Store Manager', 'Finance', 'Project Manager', 'Support', 'Technician'];
var TICKET_STATUSES_ = ['Open', 'Assigned', 'In Progress', 'Resolved', 'Closed'];
var TASK_STATUSES_ = ['Assigned', 'Awaiting Stock', 'Ready', 'In Progress', 'Completed', 'Cancelled'];
var PROJECT_STATUSES_ = ['Planning', 'Active', 'On Hold', 'Completed', 'Cancelled'];
var PROJECT_TYPES_ = ['Deployment', 'Upgrade', 'Maintenance', 'Expansion', 'Other'];

/* ---- WHO CAN DO WHAT (enforced on the server, not just hidden in the UI) ---- */
var CAN_ = {
  viewCosts:          ['Admin', 'Finance'],
  viewLedger:         ['Admin', 'Finance'],
  manageUsers:        ['Admin'],
  viewStock:          ['Admin', 'Store Manager', 'Finance', 'Project Manager'],
  manageCatalog:      ['Admin', 'Store Manager'],
  moveStock:          ['Admin', 'Store Manager'],
  manageDevices:      ['Admin', 'Store Manager'],
  approveReq:         ['Admin', 'Store Manager'],                 // stage 1 (operations) + issue stock
  approveFinance:     ['Admin', 'Finance'],                       // stage 2 (budget / cost clearance)
  viewAllReqs:        ['Admin', 'Store Manager', 'Finance'],
  createTicket:       ['Admin', 'Store Manager', 'Support'],
  viewAllTickets:     ['Admin', 'Store Manager', 'Support'],
  createTask:         ['Admin', 'Store Manager', 'Support', 'Project Manager'],
  viewAllTasks:       ['Admin', 'Store Manager', 'Support', 'Project Manager', 'Finance'],
  requestMaterial:    ['Admin', 'Store Manager', 'Technician', 'Project Manager'],
  manageProjects:     ['Admin', 'Project Manager'],
  viewProcurement:    ['Admin', 'Store Manager', 'Finance', 'Project Manager'],
  requestProcurement: ['Admin', 'Store Manager', 'Project Manager'],
  approveProcurement: ['Admin', 'Finance'],
  receiveProcurement: ['Admin', 'Store Manager'],
  generatePDF:        ['Admin', 'Store Manager', 'Finance', 'Project Manager'],
  viewDocs:           ['Admin', 'Store Manager', 'Finance', 'Project Manager'],
  managePayments:     ['Admin', 'Finance'],
  viewAudit:          ['Admin', 'Finance', 'Store Manager'],   // history of one unit / record
  viewAuditAll:       ['Admin', 'Finance'],                    // the full audit trail page
  viewNetwork:        ['Admin', 'Store Manager', 'Support', 'Technician', 'Project Manager'],
  manageCustomers:    ['Admin', 'Store Manager', 'Support'],
  manageNetwork:      ['Admin', 'Store Manager', 'Technician'],
  replaceDevice:      ['Admin', 'Store Manager', 'Technician']
};

/* Column maps -> JSON objects for the client */
var KEYS_ = {
  catalog: ['sku', 'assetType', 'manufacturer', 'model', 'accessTech', 'unitCost', 'description', 'reorder', 'tracking', 'scope'],
  serial:  ['id', 'assetType', 'manufacturer', 'model', 'accessTech', 'productId', 'mac', 'sn', 'status', 'condition', 'location', 'custodian', 'notes', 'sku', 'customer', 'account', 'ticketId'],
  ticket:  ['id', 'date', 'customer', 'category', 'tech', 'oldSN', 'newSN', 'status', 'loggedBy', 'notes', 'task', 'priority', 'closedAt', 'customerId', 'hotspotId', 'deviceId'],
  req:     ['id', 'date', 'tech', 'sku', 'qty', 'reason', 'status', 'approvedBy', 'actionDate', 'issuedBy', 'note', 'projectId', 'finStatus', 'estValue', 'units', 'finBy', 'procRef'],
  task:    ['id', 'created', 'title', 'type', 'assignee', 'assigneeEmail', 'priority', 'status', 'sku', 'qty', 'site', 'ref', 'notes', 'createdBy', 'readyAt', 'ticket', 'projectId'],
  ledger:  ['date', 'dir', 'sku', 'model', 'qty', 'user', 'role', 'site', 'unitCost', 'totalCost', 'costType', 'taskId', 'assetId', 'composite', 'projectId'],
  project: ['id', 'name', 'type', 'linkedReqs', 'status', 'start', 'end', 'location', 'manager', 'budget', 'notes', 'createdBy'],
  proc:    ['id', 'date', 'by', 'sku', 'qty', 'estUnit', 'estTotal', 'projectId', 'reqId', 'status', 'finBy', 'finDate', 'supplier', 'po', 'ordered', 'received', 'notes'],
  audit:   ['id', 'timestamp', 'entityType', 'entityId', 'action', 'user', 'role', 'prev', 'next', 'details', 'hash'],
  customer: ['id', 'name', 'subscription', 'account', 'contact', 'phone', 'email', 'plot', 'location', 'hotspotId', 'pppoeUser', 'package', 'status', 'onu', 'splitterId', 'port', 'genieId', 'installDate', 'notes', 'createdBy'],
  hotspot:  ['id', 'name', 'plot', 'location', 'contact', 'phone', 'status', 'onu', 'aps', 'splitterId', 'port', 'genieId', 'ssid', 'installDate', 'notes', 'createdBy'],
  splitter: ['id', 'name', 'ratio', 'level', 'parent', 'parentPort', 'olt', 'enclosureId', 'status', 'notes', 'createdBy'],
  enclosure: ['id', 'name', 'type', 'location', 'plot', 'coords', 'capacity', 'notes', 'createdBy'],
  doc:     ['no', 'type', 'ref', 'projectId', 'recipient', 'file', 'url', 'by', 'at', 'emailedTo', 'value', 'payStatus', 'paidDate', 'paidRef']
};

/* Item types in the catalog form. Serialized types are tracked per unit (S/N + MAC). */
var ITEM_TYPES_ = {
  ONT:    { prefix: 'SKU-ONT-', assetType: 'XPON/ONT',          tracking: 'Serialized' },
  RTR:    { prefix: 'SKU-RTR-', assetType: 'Wireless Router',   tracking: 'Serialized' },
  NET:    { prefix: 'SKU-NET-', assetType: 'Enterprise Router', tracking: 'Serialized' },
  FAT:    { prefix: 'SKU-FAT-', assetType: 'FAT Box',           tracking: 'Serialized' },
  BULK:   { prefix: 'SKU-',     assetType: '',                  tracking: 'Bulk' },
  NONSER: { prefix: 'SKU-',     assetType: '',                  tracking: 'Non-Serialized' }
};

/* ============================ SESSIONS & AUTH ============================= */

function roleKey_(r) { r = norm_(r); return r === 'Store Supervisor' ? 'Store Manager' : r; }
function can_(u, perm) { return (CAN_[perm] || []).indexOf(u.role) > -1; }
function sameUser_(val, u) { var v = norm_(val).toLowerCase(); return !!v && (v === u.name.toLowerCase() || v === u.email); }

function newSession_(u) {
  var t = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('sess_' + t, JSON.stringify(u), SESSION_TTL_);
  return t;
}
function getSession_(t) {
  if (!t) return null;
  var s = CacheService.getScriptCache().get('sess_' + t);
  return s ? JSON.parse(s) : null;
}

/** Every endpoint goes through this: checks session + permission, catches errors. */
function api_(token, perm, fn) {
  var u = getSession_(token);
  if (!u) return { success: false, authExpired: true, message: 'Session expired. Please log in again.' };
  if (perm && !can_(u, perm)) return { success: false, message: 'You do not have permission for this action.' };
  CURRENT_ACTOR_ = u;
  try { return fn(u); } catch (err) { return { success: false, message: String(err.message || err) }; }
}

function directory_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.USERS), out = [];
  if (!sh) return out;
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (!norm_(d[i][0])) continue;
    out.push({ row: i + 1, email: norm_(d[i][0]).toLowerCase(), pass: norm_(d[i][1]), role: roleKey_(d[i][2]),
               name: norm_(d[i][3]) || norm_(d[i][0]), uid: norm_(d[i][6]), status: norm_(d[i][7]),
               site: norm_(d[i][8]), contact: norm_(d[i][9]) });
  }
  return out;
}
function isActive_(u) { return ['inactive', 'disabled', 'suspended'].indexOf(u.status.toLowerCase()) < 0; }
function publicUser_(u) { return { name: u.name, email: u.email, role: u.role }; }

/** FIXED: old version read email from the Name column and name from the Magic Token column. */
function getUserMap_() {
  var out = {};
  directory_().forEach(function (u) {
    var rec = { username: u.email, name: u.name, email: u.email, role: u.role };
    out[u.name.toLowerCase()] = rec; out[u.email] = rec;
  });
  return out;
}

function hashPw_(pw, salt) {
  salt = salt || Utilities.getUuid().slice(0, 8);
  var hex = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  return 'sha256$' + salt + '$' + hex;
}
function checkPw_(stored, pw) {
  if (stored.indexOf('sha256$') === 0) return hashPw_(pw, stored.split('$')[1]) === stored;
  return stored === pw; // legacy plain text - upgraded to a hash on next successful login
}

function authenticateUser(email, password) {
  try {
    ensureOnce_();
    var cache = CacheService.getScriptCache(), e = norm_(email).toLowerCase(), key = 'fail_' + e, pw = norm_(password);
    if (Number(cache.get(key) || 0) >= 5) return { success: false, message: 'Too many attempts. Try again in 10 minutes.' };
    var u = directory_().filter(function (x) { return x.email === e; })[0];
    if (!u || !isActive_(u) || !u.pass || !checkPw_(u.pass, pw)) {
      cache.put(key, String(Number(cache.get(key) || 0) + 1), 600);
      return { success: false, message: 'Invalid email address or password.' };
    }
    cache.remove(key);
    if (u.pass.indexOf('sha256$') !== 0) {
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.USERS).getRange(u.row, 2).setValue(hashPw_(pw));
    }
    return { success: true, token: newSession_(publicUser_(u)), user: publicUser_(u) };
  } catch (err) { return { success: false, message: 'Authentication error: ' + err }; }
}

function logout(token) { if (token) CacheService.getScriptCache().remove('sess_' + token); return { success: true }; }

function changePassword(token, oldPw, newPw) {
  return api_(token, null, function (u) {
    newPw = norm_(newPw);
    if (newPw.length < 6) throw new Error('New password must be at least 6 characters.');
    var rec = directory_().filter(function (x) { return x.email === u.email; })[0];
    if (!rec || !checkPw_(rec.pass, norm_(oldPw))) throw new Error('Current password is incorrect.');
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.USERS).getRange(rec.row, 2).setValue(hashPw_(newPw));
    audit_('User', u.email, 'Password changed', null, null, '');
    return { success: true, message: 'Password changed.' };
  });
}

function sendMagicLink(email) {
  var generic = { success: true, message: 'If that email is registered, a login link has been sent.' };
  try {
    ensureOnce_();
    var e = norm_(email).toLowerCase(), cache = CacheService.getScriptCache();
    if (cache.get('ml_' + e)) return generic; // 1 link per minute per address
    var u = directory_().filter(function (x) { return x.email === e && isActive_(x); })[0];
    if (!u) return generic;
    cache.put('ml_' + e, '1', 60);
    var token = Utilities.getUuid(), expiry = new Date(Date.now() + 15 * 60 * 1000);
    safeAppend_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Magic Tokens'), [e, token, expiry]);
    var url = ScriptApp.getService().getUrl() + '?token=' + token;
    sendEmailSafe_(e, 'Your ONT Portal login link',
      '<p>Hello <b>' + u.name + '</b>,</p><p><a href="' + url + '" style="background:#4f46e5;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;">Open the portal</a></p><p><small>Expires in 15 minutes. Single use.</small></p>',
      'MAGIC_LINK', e);
  } catch (err) { console.error('sendMagicLink: ' + err); }
  return generic;
}

function consumeMagicToken_(tk) {
  return withLock_(function () {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Magic Tokens');
    if (!sh || sh.getLastRow() < 2) return null;
    var d = sh.getDataRange().getValues();
    for (var i = d.length - 1; i >= 1; i--) {
      var exp = new Date(d[i][2]), match = norm_(d[i][1]) === tk;
      if (match || exp < new Date()) sh.deleteRow(i + 1); // also sweeps expired tokens
      if (match) {
        if (exp < new Date()) return null;
        var u = directory_().filter(function (x) { return x.email === norm_(d[i][0]).toLowerCase() && isActive_(x); })[0];
        return u ? publicUser_(u) : null;
      }
    }
    return null;
  });
}

/** Magic link now REALLY logs in: token -> session handed to the page as BOOT. */
function doGet(e) {
  var boot = {}, tk = e && e.parameter && e.parameter.token;
  if (tk) {
    var u = consumeMagicToken_(tk);
    boot = u ? { session: newSession_(u) } : { error: 'That login link is invalid or has expired.' };
  }
  var t = HtmlService.createTemplateFromFile('improves');
  t.boot = JSON.stringify(boot).replace(/</g, '\\u003c');
  return t.evaluate().setTitle('ONT Network Inventory Portal')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Run ONCE from the editor (Run > authorizeServices) then redeploy as a NEW VERSION.
 *  Fixes the "no permission to call MailApp.sendEmail" failures in your Notification Log. */
function authorizeServices() {
  MailApp.getRemainingDailyQuota();
  CacheService.getScriptCache().put('auth_ok', '1', 10);
  DriveApp.getRootFolder(); // authorises Drive for delivery-note PDFs
  return 'Authorized (Mail + Drive). Now Deploy > Manage deployments > Edit > New version.';
}

/* ============================ SCHEMA / DATA =============================== */

function ensurePortalSchema_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetWithHeaders_(ss, SHEETS.CATALOG, ['Item ID', 'Asset Type', 'Manufacturer', 'Model', 'Access Tech', 'Unit Cost (KES)', 'Description/Notes', 'Reorder Level', 'Tracking', 'Project Scope']);
  ensureSheetWithHeaders_(ss, SHEETS.ISSUES, ['Ticket ID', 'Date Logged', 'Customer Name / Acc', 'Issue Category', 'Assigned Tech', 'Old Device S/N', 'New Device S/N', 'Status', 'Logged By', 'Resolution Notes', 'Linked Task', 'Priority', 'Closed At', 'Customer ID', 'Hotspot ID', 'Device Asset ID']);
  ensureSheetWithHeaders_(ss, SHEETS.REQS, ['Requisition ID', 'Date Requested', 'Technician Name', 'Item Requested', 'Quantity', 'Reason / Job', 'Status', 'Approved By', 'Decision / Issue Date', 'Issued By', 'Decision Note', 'Project ID', 'Finance Status', 'Est. Value (KES)', 'Issued Units', 'Finance By', 'Procurement Ref']);
  ensureSheetWithHeaders_(ss, SHEETS.TASKS, ['Task ID', 'Created At', 'Task Title', 'Task Type', 'Assigned Personnel', 'Assignee Email', 'Priority', 'Status', 'Required SKU', 'Required Qty', 'Customer / Site', 'Reference', 'Notes', 'Created By', 'Stock Ready At', 'Linked Ticket', 'Project ID']);
  ensureSheetWithHeaders_(ss, SHEETS.PROJECTS, ['Project ID', 'Project Name', 'Type', 'Linked Material Request', 'Status', 'Start Date', 'End Date', 'Location / FAT', 'Project Manager', 'Budget (KES)', 'Notes', 'Created By']);
  ensureSheetWithHeaders_(ss, SHEETS.PROCURE, ['Procurement ID', 'Date', 'Requested By', 'Item SKU', 'Quantity', 'Est. Unit Cost', 'Est. Total', 'Project ID', 'Linked Requisition', 'Status', 'Finance By', 'Finance Date', 'Supplier', 'PO Ref', 'Ordered Date', 'Received Date', 'Notes']);
  ensureSheetWithHeaders_(ss, SHEETS.DOCS, ['Doc No', 'Type', 'Reference', 'Project ID', 'Recipient', 'File Name', 'Drive URL', 'Created By', 'Created At', 'Emailed To', 'Value (KES)', 'Payment Status', 'Paid Date', 'Payment Ref']);
  ensureSheetWithHeaders_(ss, SHEETS.CUSTOMERS, ['Customer ID', 'Name', 'Subscription', 'Account No', 'Contact Person', 'Phone', 'Email', 'Plot No', 'Location', 'Hotspot ID', 'PPPoE Username', 'Package', 'Status', 'ONU Asset ID', 'Splitter ID', 'Splitter Port', 'GenieACS Device ID', 'Install Date', 'Notes', 'Created By']);
  ensureSheetWithHeaders_(ss, SHEETS.HOTSPOTS, ['Hotspot ID', 'Name', 'Plot No(s)', 'Location', 'Contact Person', 'Phone', 'Status', 'ONU Asset ID', 'AP Asset IDs', 'Splitter ID', 'Splitter Port', 'GenieACS Device ID', 'SSID', 'Install Date', 'Notes', 'Created By']);
  ensureSheetWithHeaders_(ss, SHEETS.SPLITTERS, ['Splitter ID', 'Name', 'Ratio', 'Level', 'Parent Splitter', 'Parent Port', 'OLT / PON Port', 'Enclosure ID', 'Status', 'Notes', 'Created By']);
  ensureSheetWithHeaders_(ss, SHEETS.ENCLOSURES, ['Enclosure ID', 'Name', 'Type', 'Location', 'Plot / Area', 'Coordinates', 'Capacity', 'Notes', 'Created By']);
  ensureNetFormats_();
  ensureAuditSchema_();
  var led = ss.getSheetByName(SHEETS.LEDGER);
  if (led && !norm_(led.getRange(1, 15).getValue())) led.getRange(1, 15).setValue('Project ID');
}
function ensureOnce_() {
  var c = CacheService.getScriptCache();
  if (c.get('schema_ok2')) return;
  ensureFeatureSchema_(); ensurePortalSchema_(); applyLedgerFormulas_(false);
  c.put('schema_ok2', '1', 3600);
}

function objs_(sheetName, keys) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  return getCleanSheetData(sh).slice(1).map(function (r) {
    var o = {}; keys.forEach(function (k, i) { o[k] = r[i] === undefined ? '' : r[i]; }); return o;
  }).filter(function (o) { return Object.keys(o).some(function (k) { return o[k] !== ''; }); });
}
function findRow_(sh, id, col) {
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) if (norm_(d[i][col || 0]) === norm_(id)) return { row: i + 1, vals: d[i] };
  return null;
}
function appendLog_(cell, text) { var cur = norm_(cell.getValue()); cell.setValue((cur ? cur + ' | ' : '') + '[' + stamp_() + '] ' + text); }

function getInitialData(token) {
  return api_(token, null, function (u) {
    ensureOnce_();
    var perms = {}; Object.keys(CAN_).forEach(function (k) { perms[k] = can_(u, k); });
    var isPM = u.role === 'Project Manager', costs = perms.viewCosts;

    var projects = objs_(SHEETS.PROJECTS, KEYS_.project), mine = {};
    projects.forEach(function (p) { if (sameUser_(p.manager, u)) mine[p.id] = true; });
    var stats = projectStats_();
    projects = projects.map(function (p) {
      var own = !!mine[p.id], money = costs || own, st = stats[p.id] || { spent: 0, items: [] };
      return { id: p.id, name: p.name, type: p.type, status: p.status || 'Planning', start: p.start, end: p.end,
        location: p.location, manager: p.manager, notes: p.notes, linkedReqs: p.linkedReqs, own: own,
        budget: money ? p.budget : '', spent: money ? st.spent : '',
        items: (perms.viewStock || own) ? st.items.map(function (i) { return { sku: i.sku, model: i.model, qty: i.qty, cost: money ? i.cost : '' }; }) : [] };
    });

    var catalog = objs_(SHEETS.CATALOG, KEYS_.catalog).map(function (c) {
      if (!costs) c.unitCost = 0;
      c.tracking = c.tracking || (isSerializedSku_(c.sku) ? 'Serialized' : 'Bulk');
      c.scope = c.scope || 'Shared';
      return c;
    });

    var tickets = objs_(SHEETS.ISSUES, KEYS_.ticket), tasks = objs_(SHEETS.TASKS, KEYS_.task), reqs = objs_(SHEETS.REQS, KEYS_.req);
    if (!perms.viewAllTickets) tickets = tickets.filter(function (t) { return sameUser_(t.tech, u); });
    if (!perms.viewAllTasks) tasks = tasks.filter(function (t) { return sameUser_(t.assignee, u); });
    if (!perms.viewAllReqs) reqs = reqs.filter(function (r) { return sameUser_(r.tech, u) || (isPM && mine[r.projectId]); });
    if (!costs) reqs.forEach(function (r) { r.estValue = ''; });

    var procs = perms.viewProcurement ? objs_(SHEETS.PROCURE, KEYS_.proc) : [];
    if (isPM) procs = procs.filter(function (p) { return sameUser_(p.by, u) || mine[p.projectId]; });
    if (!costs) procs.forEach(function (p) { p.estUnit = ''; p.estTotal = ''; });
    var docs = perms.viewDocs ? objs_(SHEETS.DOCS, KEYS_.doc) : [];
    if (isPM) docs = docs.filter(function (d) { return mine[d.projectId]; });
    if (!costs) docs.forEach(function (d) { d.value = ''; });

    var summary = perms.viewStock ? getStockSummary_(costs).slice(1).map(function (r) {
      return { sku: r[0], model: r[1], totalIn: r[2], totalOut: r[3], net: r[4], status: r[5], unitCost: r[6], value: r[7], reorder: r[8] };
    }) : [];
    var dir = directory_(), st = getSettingsMap_(), canNet = perms.viewNetwork;
    var serialized = (perms.moveStock || perms.manageDevices || perms.manageNetwork || perms.manageCustomers) ? objs_(SHEETS.SERIAL, KEYS_.serial) : [];
    return {
      success: true, user: u, can: perms, summary: summary, catalog: catalog, projects: projects,
      serialized: serialized,
      customers: canNet ? objs_(SHEETS.CUSTOMERS, KEYS_.customer) : [], hotspots: canNet ? objs_(SHEETS.HOTSPOTS, KEYS_.hotspot) : [],
      splitters: canNet ? objs_(SHEETS.SPLITTERS, KEYS_.splitter) : [], enclosures: canNet ? objs_(SHEETS.ENCLOSURES, KEYS_.enclosure) : [],
      genie: { url: norm_(st.GENIEACS_URL), nbi: !!norm_(st.GENIEACS_NBI_URL) },
      people: dir.filter(isActive_).map(publicUser_),
      users: perms.manageUsers ? dir.map(function (x) { return { email: x.email, name: x.name, role: x.role, status: x.status || 'Active', site: x.site, contact: x.contact }; }) : [],
      tickets: tickets, tasks: tasks, reqs: reqs, procs: procs, docs: docs,
      ledger: perms.viewLedger ? objs_(SHEETS.LEDGER, KEYS_.ledger) : [],
      costs: costs ? getCostAnalysis_() : null,
      pending: pending_(u, perms, { serialized: serialized, summary: summary, tickets: tickets, tasks: tasks, reqs: reqs, procs: procs, docs: docs, mine: mine })
    };
  });
}

/** "What is waiting on ME" - drives the Pending Actions card. */
function pending_(u, perms, d) {
  var out = [];
  function add(type, ref, text, tab) { out.push({ type: type, ref: ref, text: text, tab: tab }); }
  if (perms.manageDevices) {
    var miss = (d.serialized || []).filter(function (x) { return !norm_(x.sn) || !norm_(x.mac); }).length;
    if (miss) add('details', 'Units', miss + ' serialized unit(s) have no S/N or MAC recorded - add the details', 'units');
  }
  d.reqs.forEach(function (r) {
    var own = sameUser_(r.tech, u);
    if (r.status === 'Pending Approval' && !own && (perms.approveReq || (u.role === 'Project Manager' && d.mine[r.projectId]))) add('approve', r.id, r.tech + ' requests ' + r.qty + ' x ' + r.sku + (r.projectId ? ' for ' + r.projectId : ''), 'reqs');
    if (r.status === 'Pending Finance' && perms.approveFinance) add('finance', r.id, 'Clear ' + r.qty + ' x ' + r.sku + (r.projectId ? ' (' + r.projectId + ')' : '') + (r.estValue ? ' - KES ' + r.estValue : ''), 'reqs');
    if (perms.approveReq && r.status === 'Approved - Ready') add('issue', r.id, 'Issue ' + r.qty + ' x ' + r.sku + ' to ' + r.tech, 'reqs');
    if (perms.approveReq && r.status === 'Awaiting Stock') add('waiting', r.id, 'Approved, short of ' + r.sku + (r.procRef ? ' (purchase ' + r.procRef + ')' : ' - raise a purchase request'), 'reqs');
    if (!perms.approveReq && own && r.status === 'Approved - Ready') add('collect', r.id, 'Approved - collect ' + r.qty + ' x ' + r.sku + ' from the store', 'reqs');
  });
  d.procs.forEach(function (p) {
    if (p.status === 'Pending Finance' && perms.approveProcurement) add('finance', p.id, 'Approve purchase of ' + p.qty + ' x ' + p.sku + (p.estTotal ? ' (KES ' + p.estTotal + ')' : ''), 'procure');
    if (p.status === 'Approved' && perms.receiveProcurement) add('order', p.id, 'Place order: ' + p.qty + ' x ' + p.sku, 'procure');
    if (p.status === 'Ordered' && perms.receiveProcurement) add('receive', p.id, 'Awaiting delivery: ' + p.qty + ' x ' + p.sku + (p.supplier ? ' from ' + p.supplier : ''), 'procure');
  });
  if (perms.managePayments) d.docs.forEach(function (x) { if (x.payStatus === 'Pending') add('pay', x.no, x.type + ' for ' + x.ref + ' - payment pending', 'docs'); });
  if (perms.approveReq) d.summary.forEach(function (s) {
    if (Number(s.reorder) > 0 && Number(s.net) <= Number(s.reorder)) add('low', s.sku, s.model + ': ' + s.net + ' left (reorder at ' + s.reorder + ')', 'dashboard');
  });
  if (perms.viewAllTickets) {
    d.tickets.forEach(function (t) {
      if (t.status === 'Open' && (!t.tech || t.tech === 'Unassigned')) add('assign', t.id, t.customer + ' - ' + t.category + ' needs a technician', 'tickets');
      else if (t.status === 'Resolved') add('close', t.id, t.customer + ' resolved - confirm and close', 'tickets');
    });
    d.tasks.forEach(function (t) { if (t.status === 'Awaiting Stock') add('waiting', t.id, t.title + ' waiting for ' + t.sku, 'tasks'); });
  }
  d.tasks.forEach(function (t) {
    if (sameUser_(t.assignee, u) && ['Assigned', 'Ready', 'In Progress'].indexOf(t.status) > -1) add('task', t.id, t.title + ' (' + t.status + ')', 'tasks');
  });
  d.tickets.forEach(function (t) {
    if (sameUser_(t.tech, u) && ['Open', 'Assigned', 'In Progress'].indexOf(t.status) > -1) add('ticket', t.id, t.customer + ' - ' + t.category, 'tickets');
  });
  return out;
}

/* ============================== CATALOG =================================== */

function validScope_(scope) {
  scope = norm_(scope);
  if (!scope || scope.toLowerCase() === 'shared') return 'Shared';
  if (!projectInfo_(normId_(scope))) throw new Error('Unknown project ' + scope + '.');
  return normId_(scope);
}

function saveCatalogItem(token, form) {
  return api_(token, 'manageCatalog', function (u) {
    return withLock_(function () {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CATALOG);
      if (!sh) throw new Error('Item Catalog sheet is missing.');
      var model = norm_(form.model);
      if (!model) throw new Error('Item name / model is required.');
      var cost = Number(form.unitCost || 0), reorder = form.reorder === '' || form.reorder == null ? 3 : Number(form.reorder);
      if (!isFinite(cost) || cost < 0 || !isFinite(reorder) || reorder < 0) throw new Error('Cost and reorder level must be 0 or more.');
      var scope = validScope_(form.scope);
      var vals = [norm_(form.assetType), norm_(form.manufacturer), model, norm_(form.accessTech)];

      if (norm_(form.mode) === 'edit') {
        var esku = normId_(form.sku), f = findRow_(sh, esku);
        if (!f) throw new Error('Item not found.');
        sh.getRange(f.row, 2, 1, 4).setValues([vals]);
        if (can_(u, 'viewCosts')) sh.getRange(f.row, 6).setValue(cost); // only Admin / Finance change prices
        sh.getRange(f.row, 7, 1, 2).setValues([[norm_(form.description), reorder]]);
        var trk = isSerializedSku_(esku) ? 'Serialized' : (norm_(form.itemType) === 'NONSER' ? 'Non-Serialized' : (norm_(form.itemType) === 'BULK' ? 'Bulk' : (norm_(f.vals[8]) || 'Bulk')));
        sh.getRange(f.row, 9, 1, 2).setValues([[trk, scope]]);
        audit_('Catalog Item', esku, 'Edited', { model: f.vals[3], unitCost: f.vals[5], reorder: f.vals[7], tracking: f.vals[8], scope: f.vals[9] }, { model: model, unitCost: can_(u, 'viewCosts') ? cost : f.vals[5], reorder: reorder, tracking: trk, scope: scope }, '');
        return { success: true, message: 'Item ' + esku + ' updated.' };
      }

      var key = ITEM_TYPES_[norm_(form.itemType)] ? norm_(form.itemType) : 'BULK', t = ITEM_TYPES_[key];
      var serialized = t.tracking === 'Serialized';
      var sku = normId_(form.sku) || (t.prefix + model.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
      if (serialized && sku.indexOf(t.prefix) !== 0) sku = t.prefix + sku.replace(/^SKU-/, '');
      if (!serialized && isSerializedSku_(sku)) throw new Error('That SKU would be treated as a serialized unit. Pick the matching serialized type instead.');
      if (!/^[A-Z0-9][A-Z0-9-]{2,49}$/.test(sku)) throw new Error('SKU may only use A-Z, 0-9 and dashes (3-50 characters).');
      if (getCatalogMap_(sh)[sku]) throw new Error('SKU ' + sku + ' already exists.');
      if (!vals[0]) vals[0] = t.assetType || 'General Material';
      safeAppend_(sh, [sku, vals[0], vals[1], vals[2], vals[3], can_(u, 'viewCosts') ? cost : 0, norm_(form.description), reorder, t.tracking, scope]);
      audit_('Catalog Item', sku, 'Created', null, { model: model, tracking: t.tracking, scope: scope, unitCost: can_(u, 'viewCosts') ? cost : 0 }, '');
      return { success: true, message: 'Item ' + sku + ' added (' + t.tracking + (scope === 'Shared' ? ', shared' : ', only for ' + scope) + ')' + (serialized ? ' - record a Stock In to create unit records.' : '.') };
    });
  });
}

/* ================ STOCK MOVEMENTS & DEVICES (permission wrappers) ========= */

function submitTransaction(token, form) {
  return api_(token, 'moveStock', function (u) {
    form.user = form.user || u.name; form.role = form.role || u.role;
    return submitTransaction_(form);
  });
}
function updateSerializedDevice(token, form) {
  return api_(token, 'manageDevices', function () { return updateSerializedDevice_(form); });
}

/* ================================ TASKS =================================== */

function createTaskInternal_(u, f) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.TASKS);
  var p = getUserMap_()[norm_(f.assignee).toLowerCase()];
  if (!p) throw new Error('Assigned personnel was not found in the User Directory.');
  var title = norm_(f.title); if (!title) throw new Error('Task title is required.');
  var tpid = normId_(f.projectId); if (tpid && !projectExists_(tpid)) throw new Error('Unknown project ' + tpid + '.');
  var sku = normId_(f.requiredSku), qty = Number(f.requiredQty || 0), status = 'Assigned';
  if (sku && qty > 0) {
    var ctx = buildCtx_();
    if (!catalogRecord_(ctx, sku)) throw new Error('Unknown stock SKU ' + sku + '.');
    if (currentSkuBalance_(ctx, sku) < qty) status = 'Awaiting Stock';
  }
  var id = nextSeqId_(sh, 'TASK', 4), pr = norm_(f.priority) || 'Normal';
  safeAppend_(sh, [id, stamp_(), title, 'Field / Operations', p.name, p.email, pr, status, sku, qty || 0,
                   norm_(f.site), norm_(f.reference), norm_(f.notes), u.name, '', norm_(f.ticketId), tpid]);
  taskAssignmentEmail_({ id: id, title: title, priority: pr, status: status, sku: sku, qty: qty, site: norm_(f.site), reference: norm_(f.reference), notes: norm_(f.notes), assigneeEmail: p.email });
  return { id: id, status: status, assignee: p.name };
}

function createTask(token, form) {
  return api_(token, 'createTask', function (u) {
    return withLock_(function () {
      ensureOnce_();
      var r = createTaskInternal_(u, form);
      audit_('Task', r.id, 'Created', null, { assignee: r.assignee, status: r.status }, norm_(form.title));
      return { success: true, message: 'Task ' + r.id + ' assigned to ' + r.assignee + (r.status === 'Awaiting Stock' ? ' (awaiting stock).' : '.') };
    });
  });
}

function setTicketStatus_(ticketId, status, note, u) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ISSUES), f = findRow_(sh, ticketId);
  if (!f || norm_(f.vals[7]) === 'Closed') return;
  sh.getRange(f.row, 8).setValue(status);
  if (status === 'Closed') sh.getRange(f.row, 13).setValue(stamp_());
  appendLog_(sh.getRange(f.row, 10), status + ' by ' + u.name + (note ? ': ' + note : ''));
}

function updateTaskStatus(token, taskId, status, note) {
  return api_(token, null, function (u) {
    return withLock_(function () {
      if (TASK_STATUSES_.indexOf(status) < 0) throw new Error('Invalid task status.');
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.TASKS), f = findRow_(sh, taskId);
      if (!f) throw new Error('Task not found.');
      var cur = norm_(f.vals[7]), mine = sameUser_(f.vals[4], u), priv = can_(u, 'createTask');
      if (!mine && !priv) throw new Error('You can only update tasks assigned to you.');
      if (!priv && ['In Progress', 'Completed'].indexOf(status) < 0) throw new Error('You can start or complete your own tasks only.');
      if (cur === 'Completed' || cur === 'Cancelled') throw new Error('Task is already ' + cur + '.');
      if (status === 'In Progress' && cur === 'Awaiting Stock') throw new Error('Stock is not available yet for this task.');
      if (status === 'Completed' && cur !== 'In Progress') throw new Error('Start the task before completing it.');
      sh.getRange(f.row, 8).setValue(status);
      appendLog_(sh.getRange(f.row, 13), status + ' by ' + u.name + (note ? ': ' + note : ''));
      var tk = norm_(f.vals[15]);
      if (tk && status === 'In Progress') setTicketStatus_(tk, 'In Progress', 'task ' + taskId + ' started', u);
      if (tk && status === 'Completed') setTicketStatus_(tk, 'Resolved', 'task ' + taskId + ' completed' + (note ? ' - ' + note : ''), u);
      audit_('Task', taskId, 'Status changed', { status: cur }, { status: status }, note);
      return { success: true, message: 'Task ' + taskId + ' is now ' + status + '.' };
    });
  });
}

/* ================================ TICKETS ================================= */

function logCustomerIssue(token, form) {
  return api_(token, 'createTicket', function (u) {
    return withLock_(function () {
      ensureOnce_();
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ISSUES);
      var cid = normId_(form.customerId), hid = normId_(form.hotspotId), did = normId_(form.deviceId);
      if (cid) { var crec = findRow_(netSheet_(SHEETS.CUSTOMERS), cid); if (!crec) throw new Error('Unknown customer ' + cid + '.'); if (!norm_(form.customerName)) form.customerName = norm_(crec.vals[1]) + ' / ' + (norm_(crec.vals[3]) || cid); hid = hid || normId_(crec.vals[9]); }
      if (hid) { var hrec = findRow_(netSheet_(SHEETS.HOTSPOTS), hid); if (!hrec) throw new Error('Unknown hotspot ' + hid + '.'); if (!norm_(form.customerName)) form.customerName = 'Hotspot: ' + norm_(hrec.vals[1]); }
      if (did && !getSerialMap_(netSheet_(SHEETS.SERIAL))[did]) throw new Error('Unknown device ' + did + '.');
      if (!norm_(form.customerName)) throw new Error('Customer name / account is required.');
      var tech = norm_(form.assignedTech), pr = norm_(form.priority) || 'Normal';
      if (tech) { var p = getUserMap_()[tech.toLowerCase()]; if (!p) throw new Error('Technician not found.'); tech = p.name; }
      var id = nextSeqId_(sh, 'TKT', 4), taskId = '';
      if (tech && form.createTask) {
        taskId = createTaskInternal_(u, { title: 'Ticket ' + id + ': ' + norm_(form.issueCategory), assignee: tech, priority: pr,
          site: norm_(form.customerName), reference: id, notes: norm_(form.notes), ticketId: id }).id;
      }
      safeAppend_(sh, [id, stamp_(), norm_(form.customerName), norm_(form.issueCategory), tech || 'Unassigned',
        norm_(form.oldDeviceSN) || 'N/A', norm_(form.newDeviceSN) || 'N/A', tech ? 'Assigned' : 'Open', u.name, norm_(form.notes), taskId, pr, '', cid, hid, did]);
      if (did) setUnitTicket_(did, id);
      if (tech && !taskId) sendIssueAssignmentEmail_(id, { assignedTech: tech, customerName: form.customerName, issueCategory: form.issueCategory, oldDeviceSN: form.oldDeviceSN, newDeviceSN: form.newDeviceSN, notes: form.notes });
      audit_('Ticket', id, 'Created', null, { customer: norm_(form.customerName), tech: tech || 'Unassigned', priority: pr }, '');
      return { success: true, message: 'Ticket ' + id + ' created' + (taskId ? ' with task ' + taskId : '') + '.' };
    });
  });
}

function updateTicket(token, f) {
  return api_(token, null, function (u) {
    return withLock_(function () {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ISSUES), t = findRow_(sh, f.ticketId);
      if (!t) throw new Error('Ticket not found.');
      var priv = can_(u, 'viewAllTickets');
      if (!priv && !sameUser_(t.vals[4], u)) throw new Error('You can only update tickets assigned to you.');
      if (norm_(t.vals[7]) === 'Closed') throw new Error('Ticket is closed.');
      var status = norm_(f.status);
      if (status && TICKET_STATUSES_.indexOf(status) < 0) throw new Error('Invalid status.');
      if (!priv && ['In Progress', 'Resolved'].indexOf(status) < 0 && status) throw new Error('Technicians can set In Progress or Resolved.');
      var note = norm_(f.notes), tech = norm_(f.assignedTech);
      if (status === 'Resolved' && !note) throw new Error('Add a resolution note before resolving.');
      if (tech && priv && !sameUser_(t.vals[4], { name: tech, email: '' })) {
        var p = getUserMap_()[tech.toLowerCase()]; if (!p) throw new Error('Technician not found.');
        sh.getRange(t.row, 5).setValue(p.name);
        if (!status && norm_(t.vals[7]) === 'Open') status = 'Assigned';
        if (!norm_(t.vals[10]) && f.createTask) {
          var tk = createTaskInternal_(u, { title: 'Ticket ' + f.ticketId + ': ' + norm_(t.vals[3]), assignee: p.name, priority: norm_(t.vals[11]) || 'Normal', site: norm_(t.vals[2]), reference: f.ticketId, ticketId: f.ticketId });
          sh.getRange(t.row, 11).setValue(tk.id);
        } else sendIssueAssignmentEmail_(f.ticketId, { assignedTech: p.name, customerName: t.vals[2], issueCategory: t.vals[3], oldDeviceSN: t.vals[5], newDeviceSN: t.vals[6], notes: note });
      }
      if (norm_(f.oldDeviceSN)) sh.getRange(t.row, 6).setValue(norm_(f.oldDeviceSN));
      if (norm_(f.newDeviceSN)) sh.getRange(t.row, 7).setValue(norm_(f.newDeviceSN));
      if (status) setTicketStatus_(f.ticketId, status, note, u);
      else if (note) appendLog_(sh.getRange(t.row, 10), 'Note by ' + u.name + ': ' + note);
      audit_('Ticket', f.ticketId, 'Updated', { status: norm_(t.vals[7]), tech: norm_(t.vals[4]) }, { status: status || norm_(t.vals[7]), tech: tech || norm_(t.vals[4]) }, note);
      return { success: true, message: 'Ticket ' + f.ticketId + ' updated.' };
    });
  });
}

/* ============================ SHARED HELPERS (v3) ========================= */

function unique_(arr) { return (arr || []).filter(function (v, i, a) { return v && a.indexOf(v) === i; }); }
function htmlEsc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function catSheet_() { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CATALOG); }

function emailsForRoles_(roles, settingKey) {
  var out = directory_().filter(function (x) { return isActive_(x) && x.email && roles.indexOf(x.role) > -1; }).map(function (x) { return x.email; });
  var extra = settingKey ? norm_(getSettingsMap_()[settingKey]) : '';
  if (extra) out = out.concat(extra.split(/[,;\s]+/).filter(Boolean));
  return unique_(out);
}
function notifyMany_(emails, subject, html, type, ref) { unique_(emails).forEach(function (to) { sendEmailSafe_(to, subject, html, type, ref); }); }
function emailOf_(name) { var p = getUserMap_()[norm_(name).toLowerCase()]; return p ? p.email : ''; }

function projectInfo_(id) {
  id = normId_(id); if (!id) return null;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.PROJECTS); if (!sh) return null;
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (normId_(d[i][0]) === id) return { row: i + 1, id: id, name: norm_(d[i][1]), status: norm_(d[i][4]) || 'Planning', manager: norm_(d[i][8]), budget: Number(d[i][9] || 0), linked: norm_(d[i][3]) };
  }
  return null;
}
function projectExists_(id) { return !!projectInfo_(id); }
function projectOpen_(p) { return ['Planning', 'Active'].indexOf(p.status) > -1; }
function linkReqToProject_(p, reqId) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.PROJECTS);
  var list = (p.linked ? p.linked + ', ' : '') + reqId;
  if (list.length > 450) list = list.slice(list.length - 450);
  sh.getRange(p.row, 4).setValue(list);
}

/** Items dedicated to one project can only be requested / issued against that project. */
function scopeError_(sku, projectId) {
  var c = getCatalogMap_(catSheet_())[normId_(sku)];
  if (!c || !c.scope || c.scope === 'Shared') return '';
  if (normId_(projectId) !== normId_(c.scope)) return 'Item ' + normId_(sku) + ' is dedicated to project ' + c.scope + '. Select that project.';
  return '';
}
function estValue_(sku, qty) { var c = getCatalogMap_(catSheet_())[normId_(sku)]; return c ? Number(c.unitCost || 0) * qty : 0; }

/** Spend per project from the ledger (Stock Out rows tagged with a Project ID in column O). */
function projectStats_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.LEDGER), out = {};
  if (!sh) return out;
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    var pid = normId_(d[i][14]);
    if (!pid || normDir_(d[i][1]) !== 'Stock Out') continue;
    var sku = normId_(d[i][2]), qty = Number(d[i][4] || 0), cost = Number(d[i][9] || 0);
    var p = out[pid] || (out[pid] = { spent: 0, items: {} });
    p.spent += cost;
    var it = p.items[sku] || (p.items[sku] = { sku: sku, model: norm_(d[i][3]), qty: 0, cost: 0 });
    it.qty += qty; it.cost += cost;
  }
  Object.keys(out).forEach(function (k) { out[k].items = Object.keys(out[k].items).map(function (s) { return out[k].items[s]; }); });
  return out;
}

function financeNeeded_(est, proj) {
  var th = Number(getSettingsMap_().FINANCE_APPROVAL_THRESHOLD || 50000);
  if (est > 0 && est >= th) return 'value KES ' + est + ' is at or above the KES ' + th + ' approval threshold';
  if (proj && proj.budget > 0) {
    var spent = (projectStats_()[proj.id] || { spent: 0 }).spent;
    if (spent + est > proj.budget) return 'it would take ' + proj.id + ' over its budget';
  }
  return '';
}

/* ============================== REQUISITIONS ============================== */

function approverEmails_() {
  return directory_().filter(function (x) { return isActive_(x) && can_(x, 'approveReq') && x.email; }).map(function (x) { return x.email; });
}
function reservedQty_(sku, exceptId) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REQS), n = 0;
  getCleanSheetData(sh).slice(1).forEach(function (r) {
    if (norm_(r[0]) !== exceptId && normId_(r[3]) === sku && norm_(r[6]) === 'Approved - Ready') n += Number(r[4] || 0);
  });
  return n;
}

function submitTechnicianRequisition(token, form) {
  return api_(token, 'requestMaterial', function (u) {
    return withLock_(function () {
      ensureOnce_();
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REQS), sku = normId_(form.itemID), qty = Number(form.quantity), pid = normId_(form.projectId);
      if (!isFinite(qty) || qty <= 0 || Math.floor(qty) !== qty) throw new Error('Quantity must be a whole number above 0.');
      if (!getCatalogMap_(catSheet_())[sku]) throw new Error('Unknown item SKU.');
      var proj = null;
      if (pid) {
        proj = projectInfo_(pid);
        if (!proj) throw new Error('Unknown project ' + pid + '.');
        if (!projectOpen_(proj)) throw new Error('Project ' + pid + ' is ' + proj.status + '. Requests are accepted for Planning or Active projects only.');
        if (u.role === 'Project Manager' && !sameUser_(proj.manager, u)) throw new Error('You can only request material for projects you manage.');
      }
      var se = scopeError_(sku, pid); if (se) throw new Error(se);
      var id = nextSeqId_(sh, 'REQ', 3), est = estValue_(sku, qty);
      safeAppend_(sh, [id, stamp_(), u.name, sku, qty, norm_(form.reason), 'Pending Approval', '', '', '', '', pid, 'N/A', est, '', '', '']);
      if (proj) linkReqToProject_(proj, id);
      var to = approverEmails_(); if (proj) to.push(emailOf_(proj.manager));
      to = to.filter(function (e) { return e && e !== u.email; });
      notifyMany_(to, 'Requisition awaiting approval: ' + id,
        '<p><b>' + id + '</b>: ' + htmlEsc_(u.name) + ' requests ' + qty + ' x ' + sku + (pid ? '<br>Project: ' + pid + ' - ' + htmlEsc_(proj.name) : '') + '<br>Reason: ' + htmlEsc_(norm_(form.reason) || '-') + '</p>', 'REQUISITION_PENDING', id);
      audit_('Requisition', id, 'Submitted', null, { sku: sku, qty: qty, project: pid, estValue: est }, norm_(form.reason));
      return { success: true, message: 'Requisition ' + id + ' submitted' + (pid ? ' for ' + pid : '') + ' for approval.' };
    });
  });
}

/** Stage 1 (Pending Approval): Store Manager / Admin / the project's manager.
 *  Stage 2 (Pending Finance): Finance / Admin - needed when value >= threshold or the project would exceed budget. */
function decideRequisition(token, reqId, action, note) {
  return api_(token, null, function (u) {
    return withLock_(function () {
      if (['Approved', 'Rejected'].indexOf(action) < 0) throw new Error('Invalid action.');
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REQS), f = findRow_(sh, reqId);
      if (!f) throw new Error('Requisition not found.');
      var status = norm_(f.vals[6]), tech = norm_(f.vals[2]), sku = normId_(f.vals[3]), qty = Number(f.vals[4] || 0), pid = norm_(f.vals[11]);
      var proj = pid ? projectInfo_(pid) : null, reqEmail = emailOf_(tech);
      var stage1 = status === 'Pending Approval', stage2 = status === 'Pending Finance';
      if (!stage1 && !stage2) throw new Error(reqId + ' is already ' + status + '.');
      if (sameUser_(tech, u) && u.role !== 'Admin') throw new Error('You cannot approve your own requisition.');
      if (stage1 && !(can_(u, 'approveReq') || (u.role === 'Project Manager' && proj && sameUser_(proj.manager, u)))) throw new Error('You cannot approve at this stage.');
      if (stage2 && !can_(u, 'approveFinance')) throw new Error('Only Finance can clear this requisition.');
      note = norm_(note);
      if (action === 'Rejected' && !note) throw new Error('Give a reason for rejecting.');

      if (action === 'Rejected') {
        sh.getRange(f.row, 7, 1, 3).setValues([['Rejected', stage1 ? u.name : norm_(f.vals[7]), stamp_()]]);
        sh.getRange(f.row, 11).setValue(note);
        if (stage2) { sh.getRange(f.row, 13).setValue('Rejected'); sh.getRange(f.row, 16).setValue(u.name); }
        sendEmailSafe_(reqEmail, 'Requisition ' + reqId + ': Rejected', '<p><b>' + reqId + '</b> - ' + qty + ' x ' + sku + ' was rejected by ' + htmlEsc_(u.name) + '.<br>Reason: ' + htmlEsc_(note) + '</p>', 'REQUISITION_STATUS', reqId);
        audit_('Requisition', reqId, stage1 ? 'Rejected (operations)' : 'Rejected (finance)', { status: status }, { status: 'Rejected' }, note);
        return { success: true, message: reqId + ' rejected.' };
      }

      if (stage1) {
        var est = Number(f.vals[13]) || estValue_(sku, qty), why = financeNeeded_(est, proj);
        sh.getRange(f.row, 8, 1, 2).setValues([[u.name, stamp_()]]);
        sh.getRange(f.row, 14).setValue(est);
        if (note) sh.getRange(f.row, 11).setValue(note);
        if (why) {
          sh.getRange(f.row, 7).setValue('Pending Finance'); sh.getRange(f.row, 13).setValue('Pending');
          notifyMany_(emailsForRoles_(['Finance'], 'FINANCE_EMAIL'), 'Finance approval needed: ' + reqId,
            '<p><b>' + reqId + '</b> - ' + qty + ' x ' + sku + (pid ? ' for ' + pid : '') + '<br>Estimated value: KES ' + est + '<br>Why Finance: ' + why + '.<br>Operations approved by ' + htmlEsc_(u.name) + '.</p>', 'REQUISITION_FINANCE', reqId);
          sendEmailSafe_(reqEmail, 'Requisition ' + reqId + ': with Finance', '<p>Operations approved <b>' + reqId + '</b>. It now needs Finance clearance (' + why + ').</p>', 'REQUISITION_STATUS', reqId);
          audit_('Requisition', reqId, 'Approved by operations, sent to Finance', { status: status }, { status: 'Pending Finance', estValue: est }, why);
          return { success: true, message: reqId + ' approved by operations and sent to Finance (' + why + ').' };
        }
      } else {
        sh.getRange(f.row, 13).setValue('Approved'); sh.getRange(f.row, 16).setValue(u.name);
        if (note) sh.getRange(f.row, 11).setValue(note);
      }
      var avail = currentSkuBalance_(buildCtx_(), sku) - reservedQty_(sku, reqId);
      var ready = avail >= qty ? 'Approved - Ready' : 'Awaiting Stock';
      sh.getRange(f.row, 7).setValue(ready);
      sendEmailSafe_(reqEmail, 'Requisition ' + reqId + ': ' + ready, '<p><b>' + reqId + '</b> - ' + qty + ' x ' + sku + '<br>Status: <b>' + ready + '</b>' + (ready === 'Awaiting Stock' ? '<br>Stock is being arranged.' : '<br>Collect it from the store.') + '</p>', 'REQUISITION_STATUS', reqId);
      if (ready === 'Awaiting Stock') notifyMany_(approverEmails_(), 'Short of stock for ' + reqId, '<p><b>' + reqId + '</b> is approved but only ' + Math.max(avail, 0) + ' x ' + sku + ' is available (needs ' + qty + '). Raise a purchase request in the portal.</p>', 'REQUISITION_SHORT', reqId);
      audit_('Requisition', reqId, stage2 ? 'Cleared by Finance' : 'Approved', { status: status }, { status: ready }, note);
      return { success: true, message: reqId + ' ' + ready + '.' };
    });
  });
}

function cancelRequisition(token, reqId) {
  return api_(token, null, function (u) {
    return withLock_(function () {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REQS), f = findRow_(sh, reqId);
      if (!f) throw new Error('Requisition not found.');
      if (!sameUser_(f.vals[2], u)) throw new Error('Only the requester can cancel.');
      if (['Pending Approval', 'Pending Finance'].indexOf(norm_(f.vals[6])) < 0) throw new Error('Only pending requisitions can be cancelled.');
      sh.getRange(f.row, 7).setValue('Cancelled');
      audit_('Requisition', reqId, 'Withdrawn', { status: norm_(f.vals[6]) }, { status: 'Cancelled' }, '');
      return { success: true, message: reqId + ' cancelled.' };
    });
  });
}

/** Store manager hands over the stock: posts the Stock Out(s) so ledger, project cost and serial status all update. */
function issueRequisition(token, reqId, assetIds) {
  return api_(token, 'approveReq', function (u) {
    return withLock_(function () {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REQS), f = findRow_(sh, reqId);
      if (!f) throw new Error('Requisition not found.');
      if (norm_(f.vals[6]) !== 'Approved - Ready') throw new Error(reqId + ' is not ready to issue (status: ' + norm_(f.vals[6]) + ').');
      var tech = norm_(f.vals[2]), sku = normId_(f.vals[3]), qty = Number(f.vals[4] || 0), reason = norm_(f.vals[5]), pid = norm_(f.vals[11]);
      var se = scopeError_(sku, pid); if (se) throw new Error(se);
      var ctx = buildCtx_(), ref = (reason.match(/(?:TASK|TKT|JOB)[-_#]?\w+/i) || [reqId])[0];
      var costType = /replac/i.test(reason) ? 'Replacement' : 'Installation';
      var jobs = [];
      if (isSerializedSku_(sku)) {
        assetIds = (assetIds || []).map(normId_).filter(Boolean);
        if (assetIds.length !== qty) throw new Error('Select exactly ' + qty + ' unit(s) to issue.');
        assetIds.forEach(function (a) {
          var s = ctx.serial[a];
          if (!s || s.status !== 'In Stock') throw new Error(a + ' is not In Stock.');
          if ((s.sku || resolveSkuForAsset_(ctx, a, s.model)) !== sku) throw new Error(a + ' is not a ' + sku + ' unit.');
          jobs.push({ id: a, qty: 1 });
        });
      } else {
        if (currentSkuBalance_(ctx, sku) < qty) throw new Error('Not enough ' + sku + ' in stock.');
        jobs.push({ id: sku, qty: qty });
      }
      var ledger = ctx.ledger, done = [];
      jobs.forEach(function (j) {
        var out = postMovement_({ date: today_(), dir: 'Stock Out', id: j.id, qty: j.qty, user: tech, role: 'Technician', site: pid || ref,
                                  notes: 'Requisition ' + reqId + ' | ' + costType });
        if (out.state !== 'ok') throw new Error((done.length ? 'Issued ' + done.join(', ') + ' before failing: ' : '') + out.message);
        ledger.getRange(out.ledgerRow, 11, 1, 3).setValues([[costType, ref === reqId ? reqId : ref, out.assetId || '']]);
        if (pid) setLedgerProject_(out.ledgerRow, pid);
        done.push(j.id);
      });
      sh.getRange(f.row, 7).setValue('Issued');
      sh.getRange(f.row, 9).setValue(stamp_());
      sh.getRange(f.row, 10).setValue(u.name);
      if (isSerializedSku_(sku)) sh.getRange(f.row, 15).setValue(done.join(', '));
      sendEmailSafe_(emailOf_(tech), 'Stock issued: ' + reqId, '<p>' + qty + ' x ' + sku + ' issued to you by ' + htmlEsc_(u.name) + (pid ? ' for ' + pid : '') + (isSerializedSku_(sku) ? '<br>Units: ' + done.join(', ') : '') + '</p>', 'REQUISITION_ISSUED', reqId);
      audit_('Requisition', reqId, 'Stock issued', { status: 'Approved - Ready' }, { status: 'Issued', units: done.join(', ') || (qty + ' x ' + sku), project: pid }, 'to ' + tech);
      return { success: true, message: reqId + ' issued to ' + tech + '. You can now generate the delivery note.' };
    });
  });
}

/* ================================ PROJECTS ================================ */

function saveProject(token, f) {
  return api_(token, 'manageProjects', function (u) {
    return withLock_(function () {
      ensureOnce_();
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.PROJECTS), name = norm_(f.name);
      if (!name) throw new Error('Project name is required.');
      var type = PROJECT_TYPES_.indexOf(norm_(f.type)) > -1 ? norm_(f.type) : 'Deployment';
      var status = PROJECT_STATUSES_.indexOf(norm_(f.status)) > -1 ? norm_(f.status) : 'Planning';
      var budget = Number(f.budget || 0); if (!isFinite(budget) || budget < 0) throw new Error('Budget must be 0 or more.');
      var start = norm_(f.start), end = norm_(f.end);
      if ((start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) || (end && !/^\d{4}-\d{2}-\d{2}$/.test(end))) throw new Error('Dates must be valid.');
      if (start && end && end < start) throw new Error('End date is before the start date.');
      var mgr = norm_(f.manager);
      if (u.role === 'Project Manager') mgr = u.name;
      var mp = getUserMap_()[mgr.toLowerCase()];
      if (!mp || ['Project Manager', 'Admin'].indexOf(mp.role) < 0) throw new Error('Pick a Project Manager (or Admin) as the project manager.');

      if (norm_(f.mode) === 'edit') {
        var p = projectInfo_(f.id); if (!p) throw new Error('Project not found.');
        if (u.role !== 'Admin' && !sameUser_(p.manager, u)) throw new Error('You can only edit projects you manage.');
        sh.getRange(p.row, 2, 1, 3).setValues([[name, type, sh.getRange(p.row, 4).getValue()]]);
        sh.getRange(p.row, 5, 1, 3).setValues([[status, start, end]]);
        sh.getRange(p.row, 8, 1, 4).setValues([[norm_(f.location), u.role === 'Admin' ? mp.name : p.manager, budget, norm_(f.notes)]]);
        audit_('Project', p.id, 'Edited', { status: p.status, budget: p.budget, manager: p.manager }, { name: name, status: status, budget: budget, manager: u.role === 'Admin' ? mp.name : p.manager }, '');
        return { success: true, message: 'Project ' + p.id + ' updated.' };
      }
      var id = nextSeqId_(sh, 'PRJ', 3);
      safeAppend_(sh, [id, name, type, '', status, start, end, norm_(f.location), mp.name, budget, norm_(f.notes), u.name]);
      if (mp.email && mp.name !== u.name) sendEmailSafe_(mp.email, 'You manage project ' + id, '<p>You have been made project manager of <b>' + id + ' - ' + htmlEsc_(name) + '</b> by ' + htmlEsc_(u.name) + '.</p>', 'PROJECT_ASSIGNED', id);
      audit_('Project', id, 'Created', null, { name: name, status: status, budget: budget, manager: mp.name }, '');
      return { success: true, message: 'Project ' + id + ' (' + name + ') created.' };
    });
  });
}

/* ============================== PROCUREMENT ============================== */

function procWhy_(u, sku, qty, pid) {
  var proj = null;
  if (!getCatalogMap_(catSheet_())[sku]) throw new Error('Unknown item SKU.');
  if (!isFinite(qty) || qty <= 0 || Math.floor(qty) !== qty) throw new Error('Quantity must be a whole number above 0.');
  if (pid) {
    proj = projectInfo_(pid); if (!proj) throw new Error('Unknown project ' + pid + '.');
    if (u.role === 'Project Manager' && !sameUser_(proj.manager, u)) throw new Error('You can only raise purchases for projects you manage.');
  }
  var se = scopeError_(sku, pid); if (se) throw new Error(se);
  return proj;
}
function createProcurement_(u, sku, qty, pid, supplier, notes, reqId) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.PROCURE);
  var cat = getCatalogMap_(catSheet_())[sku], unit = Number(cat.unitCost || 0), id = nextSeqId_(sh, 'PRC', 3);
  safeAppend_(sh, [id, stamp_(), u.name, sku, qty, unit, unit * qty, pid, reqId || '', 'Pending Finance', '', '', supplier, '', '', '', notes]);
  notifyMany_(emailsForRoles_(['Finance'], 'FINANCE_EMAIL'), 'Purchase approval needed: ' + id,
    '<p><b>' + id + '</b>: ' + htmlEsc_(u.name) + ' wants to buy ' + qty + ' x ' + sku + ' (' + htmlEsc_(cat.model) + ')' + (pid ? ' for ' + pid : '') + (reqId ? ' - to fulfil ' + reqId : '') + '.<br>Estimated: KES ' + (unit * qty) + '</p>', 'PROCUREMENT_PENDING', id);
  return id;
}

function submitProcurement(token, form) {
  return api_(token, 'requestProcurement', function (u) {
    return withLock_(function () {
      ensureOnce_();
      var sku = normId_(form.itemID), qty = Number(form.quantity), pid = normId_(form.projectId);
      procWhy_(u, sku, qty, pid);
      var id = createProcurement_(u, sku, qty, pid, norm_(form.supplier), norm_(form.notes), '');
      audit_('Procurement', id, 'Requested', null, { sku: sku, qty: qty, project: pid }, norm_(form.notes));
      return { success: true, message: 'Purchase request ' + id + ' sent to Finance.' };
    });
  });
}

function raiseProcurementFromReq(token, reqId) {
  return api_(token, 'requestProcurement', function (u) {
    return withLock_(function () {
      var rs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REQS), f = findRow_(rs, reqId);
      if (!f) throw new Error('Requisition not found.');
      if (norm_(f.vals[6]) !== 'Awaiting Stock') throw new Error('Only requisitions awaiting stock need a purchase.');
      if (norm_(f.vals[16])) throw new Error('A purchase (' + norm_(f.vals[16]) + ') is already linked.');
      var sku = normId_(f.vals[3]), qty = Number(f.vals[4] || 0), pid = norm_(f.vals[11]);
      var short = Math.max(qty - Math.max(currentSkuBalance_(buildCtx_(), sku) - reservedQty_(sku, reqId), 0), 1);
      procWhy_(u, sku, short, pid);
      var id = createProcurement_(u, sku, short, pid, '', 'Shortfall for ' + reqId, reqId);
      rs.getRange(f.row, 17).setValue(id);
      audit_('Procurement', id, 'Raised from requisition', null, { sku: sku, qty: short, requisition: reqId }, '');
      return { success: true, message: 'Purchase request ' + id + ' raised for ' + short + ' x ' + sku + '.' };
    });
  });
}

function decideProcurement(token, id, action, note) {
  return api_(token, 'approveProcurement', function (u) {
    return withLock_(function () {
      if (['Approved', 'Rejected'].indexOf(action) < 0) throw new Error('Invalid action.');
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.PROCURE), f = findRow_(sh, id);
      if (!f) throw new Error('Purchase request not found.');
      if (norm_(f.vals[9]) !== 'Pending Finance') throw new Error(id + ' is already ' + norm_(f.vals[9]) + '.');
      if (sameUser_(f.vals[2], u) && u.role !== 'Admin') throw new Error('You cannot approve your own purchase request.');
      note = norm_(note); if (action === 'Rejected' && !note) throw new Error('Give a reason for rejecting.');
      sh.getRange(f.row, 10, 1, 3).setValues([[action, u.name, stamp_()]]);
      if (note) sh.getRange(f.row, 17).setValue((norm_(f.vals[16]) ? norm_(f.vals[16]) + ' | ' : '') + note);
      var body = '<p><b>' + id + '</b> (' + f.vals[4] + ' x ' + norm_(f.vals[3]) + ') was <b>' + action + '</b> by ' + htmlEsc_(u.name) + '.' + (note ? '<br>Note: ' + htmlEsc_(note) : '') + '</p>';
      sendEmailSafe_(emailOf_(f.vals[2]), 'Purchase ' + id + ': ' + action, body, 'PROCUREMENT_STATUS', id);
      if (action === 'Approved') notifyMany_(emailsForRoles_(['Admin', 'Store Manager'], 'PURCHASING_EMAIL'), 'Place order: ' + id, body + '<p>Please order from a supplier and record it in the portal.</p>', 'PROCUREMENT_APPROVED', id);
      audit_('Procurement', id, action + ' by Finance', { status: 'Pending Finance' }, { status: action }, note);
      return { success: true, message: id + ' ' + action + '.' };
    });
  });
}

function orderProcurement(token, id, form) {
  return api_(token, 'receiveProcurement', function (u) {
    return withLock_(function () {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.PROCURE), f = findRow_(sh, id);
      if (!f) throw new Error('Purchase request not found.');
      if (norm_(f.vals[9]) !== 'Approved') throw new Error(id + ' must be Approved by Finance before ordering.');
      var supplier = norm_(form.supplier), po = norm_(form.po);
      if (!supplier) throw new Error('Supplier is required.');
      sh.getRange(f.row, 10).setValue('Ordered');
      sh.getRange(f.row, 13, 1, 3).setValues([[supplier, po, today_()]]);
      var body = '<p><b>' + id + '</b> ordered from ' + htmlEsc_(supplier) + (po ? ' (PO ' + htmlEsc_(po) + ')' : '') + ' by ' + htmlEsc_(u.name) + '.</p>';
      notifyMany_([emailOf_(f.vals[2])].concat(emailsForRoles_(['Finance'], 'FINANCE_EMAIL')), 'Order placed: ' + id, body, 'PROCUREMENT_ORDERED', id);
      audit_('Procurement', id, 'Ordered', { status: 'Approved' }, { status: 'Ordered', supplier: supplier, po: po }, '');
      return { success: true, message: id + ' marked as ordered from ' + supplier + '.' };
    });
  });
}

/** Receiving posts a Stock In, which also releases requisitions / tasks that were Awaiting Stock. */
function receiveProcurement(token, id) {
  return api_(token, 'receiveProcurement', function (u) {
    return withLock_(function () {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.PROCURE), f = findRow_(sh, id);
      if (!f) throw new Error('Purchase request not found.');
      if (norm_(f.vals[9]) !== 'Ordered') throw new Error(id + ' has not been ordered yet.');
      var sku = normId_(f.vals[3]), qty = Number(f.vals[4] || 0), pid = norm_(f.vals[7]), po = norm_(f.vals[13]);
      var cat = getCatalogMap_(catSheet_())[sku] || {};
      var out = postMovement_({ date: today_(), dir: 'Stock In', id: sku, model: cat.model || '', qty: qty, user: u.name, role: u.role, site: 'Procurement ' + id, notes: 'Procurement ' + id + (po ? ' | PO ' + po : '') });
      if (out.state !== 'ok') throw new Error(out.message);
      var ledger = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.LEDGER);
      ledger.getRange(out.ledgerRow, 11, 1, 3).setValues([['Procurement / Stock In', id, '']]);
      if (pid) setLedgerProject_(out.ledgerRow, pid);
      sh.getRange(f.row, 10).setValue('Received'); sh.getRange(f.row, 16).setValue(today_());
      notifyMany_([emailOf_(f.vals[2])].concat(emailsForRoles_(['Finance'], 'FINANCE_EMAIL')), 'Stock received: ' + id,
        '<p><b>' + id + '</b>: ' + qty + ' x ' + sku + ' received into the store by ' + htmlEsc_(u.name) + '. A receipt note can now be generated for payment tracking.</p>', 'PROCUREMENT_RECEIVED', id);
      audit_('Procurement', id, 'Received', { status: 'Ordered' }, { status: 'Received', qty: qty }, 'Stock In posted');
      return { success: true, message: id + ' received - ' + qty + ' x ' + sku + ' added to stock.' };
    });
  });
}

function cancelProcurement(token, id) {
  return api_(token, null, function (u) {
    return withLock_(function () {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.PROCURE), f = findRow_(sh, id);
      if (!f) throw new Error('Purchase request not found.');
      if (!sameUser_(f.vals[2], u) && u.role !== 'Admin') throw new Error('Only the requester can cancel.');
      if (norm_(f.vals[9]) !== 'Pending Finance') throw new Error('Only requests still pending Finance can be cancelled.');
      sh.getRange(f.row, 10).setValue('Cancelled');
      audit_('Procurement', id, 'Cancelled', { status: 'Pending Finance' }, { status: 'Cancelled' }, '');
      return { success: true, message: id + ' cancelled.' };
    });
  });
}

/* ===================== DELIVERY / RECEIPT NOTES (PDF) ==================== */

function serialLookup_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SERIAL), out = {};
  if (!sh) return out;
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) { var id = normId_(d[i][0]); if (id) out[id] = { model: norm_(d[i][3]), mac: norm_(d[i][6]), sn: norm_(d[i][7]) }; }
  return out;
}

function noteHtml_(d) {
  var th = ' style="text-align:left;border-bottom:2px solid #334155;padding:6px;font-size:11px;"', td = ' style="border-bottom:1px solid #e2e8f0;padding:6px;font-size:11px;"';
  var rows = d.rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td' + td + '>' + htmlEsc_(c) + '</td>'; }).join('') + '</tr>'; }).join('');
  return '<html><body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:24px;">' +
    '<table style="width:100%;"><tr><td><div style="font-size:20px;font-weight:bold;">' + htmlEsc_(d.company) + '</div><div style="font-size:11px;color:#64748b;">' + htmlEsc_(d.title) + '</div></td>' +
    '<td style="text-align:right;font-size:12px;"><b>' + htmlEsc_(d.no) + '</b><br>' + htmlEsc_(d.date) + '</td></tr></table><hr>' +
    '<table style="width:100%;font-size:12px;margin-bottom:12px;"><tr><td><b>' + htmlEsc_(d.toLabel) + ':</b> ' + htmlEsc_(d.to) + '<br><b>Reference:</b> ' + htmlEsc_(d.ref) + '<br><b>Project:</b> ' + htmlEsc_(d.project || '-') + '</td>' +
    '<td style="text-align:right;">' + htmlEsc_(d.extra) + '</td></tr></table>' +
    '<table style="width:100%;border-collapse:collapse;"><tr>' + d.heads.map(function (h) { return '<th' + th + '>' + htmlEsc_(h) + '</th>'; }).join('') + '</tr>' + rows + '</table>' +
    (d.showValue ? '<p style="text-align:right;font-size:13px;margin-top:12px;"><b>Total value: KES ' + Number(d.total || 0).toLocaleString() + '</b></p>' : '') +
    '<p style="font-size:11px;margin-top:28px;">Goods received in good order and condition.</p>' +
    '<table style="width:100%;font-size:11px;margin-top:28px;"><tr><td style="width:50%;border-top:1px solid #334155;padding-top:4px;">' + htmlEsc_(d.signLeft) + '</td><td style="width:50%;border-top:1px solid #334155;padding-top:4px;">' + htmlEsc_(d.signRight) + ' (name / signature / date)</td></tr></table>' +
    '</body></html>';
}

function generateNote(token, ref, opts) {
  return api_(token, 'generatePDF', function (u) {
    ref = normId_(ref); opts = opts || {};
    var ss = SpreadsheetApp.getActiveSpreadsheet(), settings = getSettingsMap_(), folderId = norm_(settings.DRIVE_FOLDER_ID);
    if (!folderId) throw new Error('Set DRIVE_FOLDER_ID in Inventory Settings first.');
    var folder; try { folder = DriveApp.getFolderById(folderId); } catch (e) { throw new Error('Cannot open the Drive folder. Check DRIVE_FOLDER_ID and that the script owner can edit that folder.'); }
    var cat = getCatalogMap_(catSheet_()), showValue = can_(u, 'viewCosts'), d = { company: settings.COMPANY_NAME || 'ONT Network Services', date: stamp_(), ref: ref, showValue: showValue };
    var kind, prefix, recipient, recipientEmail, pid = '', total = 0;

    if (ref.indexOf('REQ-') === 0) {
      var f = findRow_(ss.getSheetByName(SHEETS.REQS), ref);
      if (!f) throw new Error('Requisition not found.');
      if (norm_(f.vals[6]) !== 'Issued') throw new Error('A delivery note can only be made after the stock has been issued.');
      kind = 'Delivery Note'; prefix = 'DN'; recipient = norm_(f.vals[2]); pid = norm_(f.vals[11]);
      var sku = normId_(f.vals[3]), qty = Number(f.vals[4] || 0), c = cat[sku] || {}, units = norm_(f.vals[14]) ? norm_(f.vals[14]).split(/\s*,\s*/) : [], ser = serialLookup_();
      d.heads = ['SKU', 'Item', 'Unit ID', 'Serial No.', 'MAC', 'Qty']; d.rows = [];
      if (units.length) units.forEach(function (a) { var s = ser[normId_(a)] || {}; d.rows.push([sku, c.model || '', a, s.sn || '', s.mac || '', 1]); });
      else d.rows.push([sku, c.model || '', '', '', '', qty]);
      total = Number(c.unitCost || 0) * qty;
      d.toLabel = 'Delivered to'; d.signLeft = 'Issued by: ' + norm_(f.vals[9]); d.signRight = 'Received by ' + recipient;
      d.extra = 'Approved by: ' + norm_(f.vals[7]) + (norm_(f.vals[15]) ? ' | Finance: ' + norm_(f.vals[15]) : '');
      recipientEmail = emailOf_(recipient);
    } else if (ref.indexOf('PRC-') === 0) {
      var p = findRow_(ss.getSheetByName(SHEETS.PROCURE), ref);
      if (!p) throw new Error('Purchase request not found.');
      if (norm_(p.vals[9]) !== 'Received') throw new Error('A receipt note can only be made after the goods are received.');
      kind = 'Receipt Note'; prefix = 'RN'; recipient = 'Main Store'; pid = norm_(p.vals[7]);
      var psku = normId_(p.vals[3]), pc = cat[psku] || {};
      d.heads = ['SKU', 'Item', 'Supplier', 'PO Ref', 'Qty']; d.rows = [[psku, pc.model || '', norm_(p.vals[12]), norm_(p.vals[13]), Number(p.vals[4] || 0)]];
      total = Number(pc.unitCost || 0) * Number(p.vals[4] || 0);
      d.toLabel = 'Received into'; d.signLeft = 'Received by: ' + u.name; d.signRight = 'Supplier representative';
      d.extra = 'Requested by: ' + norm_(p.vals[2]) + (norm_(p.vals[10]) ? ' | Finance: ' + norm_(p.vals[10]) : '');
      recipientEmail = emailOf_(norm_(p.vals[2]));
    } else throw new Error('Notes can be generated for REQ- or PRC- references only.');

    if (u.role === 'Project Manager') { var pj = pid ? projectInfo_(pid) : null; if (!pj || !sameUser_(pj.manager, u)) throw new Error('You can only generate notes for projects you manage.'); }
    var docs = ss.getSheetByName(SHEETS.DOCS), no = nextSeqId_(docs, prefix, 4);
    d.no = no; d.title = kind.toUpperCase(); d.to = recipient; d.project = pid; d.total = total;
    var name = no + '_' + ref, blob = Utilities.newBlob(noteHtml_(d), 'text/html', name + '.html').getAs('application/pdf').setName(name + '.pdf');
    var file = folder.createFile(blob);
    var sent = [];
    if (opts.email) {
      var to = unique_([recipientEmail, norm_(opts.extra)]);
      var cc = norm_(settings.FINANCE_EMAIL);
      to.forEach(function (addr, i) { if (sendEmailSafe_(addr, kind + ' ' + no + ' - ' + ref, '<p>Please find the ' + kind.toLowerCase() + ' <b>' + no + '</b> for <b>' + ref + '</b> attached.</p><p>' + htmlEsc_(settings.COMPANY_NAME || 'Operations Team') + '</p>', 'DOCUMENT', no, [blob], i === 0 ? cc : '')) sent.push(addr); });
    }
    safeAppend_(docs, [no, kind, ref, pid, recipient, name + '.pdf', file.getUrl(), u.name, stamp_(), sent.join(', '), total, kind === 'Receipt Note' ? 'Pending' : 'Tracking only', '', '']);
    audit_('Document', no, kind + ' generated', null, { ref: ref, file: name + '.pdf', emailedTo: sent.join(', ') }, '');
    return { success: true, message: kind + ' ' + no + ' saved to Drive' + (sent.length ? ' and emailed to ' + sent.join(', ') : '') + '.', url: file.getUrl(), docNo: no };
  });
}

function setPaymentStatus(token, docNo, status, ref) {
  return api_(token, 'managePayments', function (u) {
    return withLock_(function () {
      if (['Tracking only', 'Pending', 'Paid'].indexOf(status) < 0) throw new Error('Invalid payment status.');
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.DOCS), f = findRow_(sh, docNo);
      if (!f) throw new Error('Document not found.');
      sh.getRange(f.row, 12, 1, 3).setValues([[status, status === 'Paid' ? today_() : '', norm_(ref) || (status === 'Paid' ? 'by ' + u.name : '')]]);
      audit_('Document', docNo, 'Payment ' + status, { payStatus: norm_(f.vals[11]) }, { payStatus: status, ref: norm_(ref) }, '');
      return { success: true, message: docNo + ' marked ' + status + '.' };
    });
  });
}

/* ============================ BARCODE / QR LOOKUP ========================= */

function lookupCode(token, code) {
  return api_(token, null, function (u) {
    var raw = norm_(code); if (!raw) throw new Error('Empty code.');
    var key = raw.toUpperCase().replace(/[^A-Z0-9]/g, ''), ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEETS.SERIAL), d = sh ? sh.getDataRange().getValues() : [];
    var seeCustomer = can_(u, 'moveStock') || can_(u, 'createTicket');
    for (var i = 1; i < d.length; i++) {
      var ks = [d[i][0], d[i][5], d[i][6], d[i][7]].map(function (x) { return normId_(x).replace(/[^A-Z0-9]/g, ''); });
      if (key && ks.indexOf(key) > -1) {
        return { success: true, kind: 'unit', id: norm_(d[i][0]), sku: norm_(d[i][13]), model: norm_(d[i][3]), status: norm_(d[i][8]), condition: norm_(d[i][9]),
          location: norm_(d[i][10]), custodian: norm_(d[i][11]), mac: norm_(d[i][6]), sn: norm_(d[i][7]),
          customer: seeCustomer ? norm_(d[i][14]) : '', account: seeCustomer ? norm_(d[i][15]) : '', ticket: seeCustomer ? norm_(d[i][16]) : '' };
      }
    }
    var cm = getCatalogMap_(catSheet_()), sku = normId_(raw), hit = cm[sku];
    if (!hit) Object.keys(cm).some(function (k) { if (norm_(cm[k].model).toUpperCase().replace(/[^A-Z0-9]/g, '') === key) { sku = k; hit = cm[k]; return true; } return false; });
    if (hit) return { success: true, kind: 'sku', sku: sku, model: hit.model, tracking: hit.tracking, scope: hit.scope, net: can_(u, 'viewStock') ? currentSkuBalance_(buildCtx_(), sku) : null };
    return { success: false, message: 'No unit or item matches "' + raw + '".' };
  });
}

/* ===================== DAILY DIGEST (time-driven trigger) ================ */

function digestSection_(title, items) {
  if (!items.length) return '';
  return '<h3 style="margin:16px 0 4px;font-size:14px;">' + title + ' (' + items.length + ')</h3><ul style="margin:0;padding-left:18px;font-size:13px;">' + items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul>';
}

/** One consolidated email per audience: operations/purchasing (low stock + approvals to action) and Finance. */
function sendDailyDigest() {
  var s = getSettingsMap_();
  if (String(s.DIGEST_ENABLED).toUpperCase() === 'FALSE') return 'Digest disabled.';
  ensureOnce_();
  var low = getStockSummary_(false).slice(1).filter(function (r) { return Number(r[8]) > 0 && Number(r[4]) <= Number(r[8]); })
    .map(function (r) { return '<b>' + htmlEsc_(r[0]) + '</b> ' + htmlEsc_(r[1]) + ': ' + r[4] + ' left (reorder at ' + r[8] + ')'; });
  var reqs = objs_(SHEETS.REQS, KEYS_.req), procs = objs_(SHEETS.PROCURE, KEYS_.proc), docs = objs_(SHEETS.DOCS, KEYS_.doc);
  function rq(st) { return reqs.filter(function (r) { return r.status === st; }).map(function (r) { return '<b>' + r.id + '</b> ' + htmlEsc_(r.tech) + ': ' + r.qty + ' x ' + htmlEsc_(r.sku) + (r.projectId ? ' (' + r.projectId + ')' : ''); }); }
  function pc(st) { return procs.filter(function (p) { return p.status === st; }).map(function (p) { return '<b>' + p.id + '</b> ' + p.qty + ' x ' + htmlEsc_(p.sku) + (p.supplier ? ' from ' + htmlEsc_(p.supplier) : ''); }); }
  var sent = 0;
  var ops = digestSection_('Low stock', low) + digestSection_('Requisitions to approve', rq('Pending Approval')) + digestSection_('Approved - ready to issue', rq('Approved - Ready')) +
            digestSection_('Awaiting stock (needs a purchase)', rq('Awaiting Stock')) + digestSection_('Purchases to order', pc('Approved')) + digestSection_('Orders awaiting delivery', pc('Ordered'));
  var fin = digestSection_('Requisitions awaiting Finance', rq('Pending Finance')) + digestSection_('Purchases awaiting Finance', pc('Pending Finance')) +
            digestSection_('Receipt notes awaiting payment', docs.filter(function (x) { return x.payStatus === 'Pending'; }).map(function (x) { return '<b>' + x.no + '</b> for ' + htmlEsc_(x.ref); }));
  if (ops) emailsForRoles_(['Admin', 'Store Manager'], 'PURCHASING_EMAIL').concat(lowStockRecipients_()).filter(function (v, i, a) { return v && a.indexOf(v) === i; })
    .forEach(function (to) { if (sendEmailSafe_(to, 'Daily inventory digest - ' + today_(), '<h2 style="font-size:16px;">Inventory & approvals digest</h2>' + ops, 'DIGEST_OPS', today_())) sent++; });
  if (fin) emailsForRoles_(['Finance'], 'FINANCE_EMAIL')
    .forEach(function (to) { if (sendEmailSafe_(to, 'Daily finance digest - ' + today_(), '<h2 style="font-size:16px;">Finance approvals digest</h2>' + fin, 'DIGEST_FIN', today_())) sent++; });
  toast_('Daily digest sent to ' + sent + ' recipient(s).');
  return 'Daily digest sent to ' + sent + ' recipient(s).';
}

/* ================================= USERS ================================== */

function saveUser(token, f) {
  return api_(token, 'manageUsers', function (u) {
    return withLock_(function () {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.USERS), email = norm_(f.email).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
      if (ROLES_.indexOf(norm_(f.role)) < 0) throw new Error('Pick a valid role.');
      var pw = norm_(f.password), cur = directory_().filter(function (x) { return x.email === email; })[0];
      if (cur) {
        if (email === u.email && norm_(f.status) === 'Inactive') throw new Error('You cannot deactivate your own account.');
        sh.getRange(cur.row, 3).setValue(norm_(f.role));
        sh.getRange(cur.row, 4).setValue(norm_(f.name) || cur.name);
        sh.getRange(cur.row, 8).setValue(norm_(f.status) || 'Active');
        if (pw) { if (pw.length < 6) throw new Error('Password must be at least 6 characters.'); sh.getRange(cur.row, 2).setValue(hashPw_(pw)); }
        audit_('User', email, 'Updated', { role: cur.role, status: cur.status }, { role: norm_(f.role), status: norm_(f.status) || 'Active', passwordReset: !!pw }, '');
        return { success: true, message: 'User ' + email + ' updated. Role/status changes apply at their next login.' };
      }
      if (!norm_(f.name)) throw new Error('Name is required.');
      if (pw.length < 6) throw new Error('Set an initial password of at least 6 characters.');
      var uid = 'USR-' + pad_(directory_().length + 1, 3);
      safeAppend_(sh, [email, hashPw_(pw), norm_(f.role), norm_(f.name), '', '', uid, 'Active', norm_(f.site), norm_(f.contact)]);
      audit_('User', email, 'Created', null, { role: norm_(f.role) }, '');
      return { success: true, message: 'User ' + email + ' created.' };
    });
  });
}

/* ===================== LEDGER (formula-driven costs) ===================== */

function ledgerFormulaPair_(r) {
  var q = "'Item Catalog'!$A:$F";
  return ['=IF($C' + r + '="","",IFERROR(VLOOKUP($C' + r + ',' + q + ',6,FALSE),0))', '=IF($C' + r + '="","",$E' + r + '*$I' + r + ')'];
}

/** Appends a ledger row. Unit/Total cost are FORMULAS that look up the Item Catalog,
 *  so a price change by Admin/Finance re-values every past and future ledger line. */
function appendLedger_(sh, head, tail) {
  var r = nextFreeRow_(sh);
  if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), r - sh.getMaxRows());
  sh.getRange(r, 1, 1, 8).setValues([head]);
  sh.getRange(r, 9, 1, 2).setFormulas([ledgerFormulaPair_(r)]);
  sh.getRange(r, 11, 1, 3).setValues([tail]);
  if (norm_(sh.getRange(1, 14).getValue()) === 'Composite Key' && !sh.getRange(r, 14).getFormula()) {
    sh.getRange(r, 14).setFormula('=IF(C' + r + '<>"",C' + r + '&"|"&D' + r + ',"")');
  }
  return r;
}

/** One-off conversion: the old whole-column array formulas (I2:I782) would be broken by new rows. */
function applyLedgerFormulas_(force) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.LEDGER);
  if (!sh) return 0;
  if (!force && sh.getRange('I2').getFormula().indexOf('C2:C') < 0) return 0;
  var last = Math.max(nextFreeRow_(sh) - 1, 2), f = [];
  sh.getRange(2, 9, Math.max(sh.getMaxRows() - 1, 1), 2).clearContent();
  for (var r = 2; r <= last; r++) f.push(ledgerFormulaPair_(r));
  sh.getRange(2, 9, f.length, 2).setFormulas(f);
  return f.length;
}
function convertLedgerCostsToFormulas() {
  var n = withLock_(function () { return applyLedgerFormulas_(true); });
  toast_('Ledger costs now follow the Item Catalog prices (' + n + ' rows).');
  return n;
}

function setLedgerProject_(row, projectId) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.LEDGER).getRange(row, 15).setValue(normId_(projectId));
}

function lowStockRecipients_() {
  var s = getSettingsMap_(), out = notificationRecipients_(['Admin', 'Store Manager']);
  var p = norm_(s.PURCHASING_EMAIL);
  if (p) out = out.concat(p.split(/[,;\s]+/).filter(Boolean));
  return out.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
}

/* ====================== AUDIT TRAIL (tamper-evident) ===================== */
/* Every important action appends one row to 'Audit Trail Log'. Each row carries a SHA-256 hash that
 * includes the previous row's hash, so edited or deleted rows are detected by verifyAuditChain_(). */

var CURRENT_ACTOR_ = null;
var AUDIT_HEADERS_ = ['Audit ID', 'Timestamp', 'Entity Type', 'Entity ID', 'Action', 'User', 'Role', 'Previous State', 'New State', 'Details', 'Hash'];

function ensureAuditSchema_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureSheetWithHeaders_(ss, SHEETS.AUDIT, AUDIT_HEADERS_);
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('audit_fmt')) return sh;
  sh.getRange(1, 1, sh.getMaxRows(), 11).setNumberFormat('@'); // keep text exactly as written (hash stays verifiable)
  try {
    var owner = ss.getOwner() ? ss.getOwner().getEmail() : Session.getEffectiveUser().getEmail();
    var prot = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0] || sh.protect().setDescription('Audit trail - script only');
    prot.removeEditors(prot.getEditors()); prot.addEditor(owner);
    if (prot.canDomainEdit()) prot.setDomainEdit(false);
  } catch (e) { console.error('audit protection: ' + e); }
  props.setProperty('audit_fmt', '1');
  return sh;
}

function auditStr_(v, max) {
  var s = (v === null || v === undefined || v === '') ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  return s.length > (max || 2000) ? s.slice(0, max || 2000) : s;
}
function auditHash_(prevHash, fields) {
  var raw = [prevHash].concat(fields).join('\u241F');
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function logAuditEntry_(entityType, entityId, action, user, role, previousState, newState, details) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEETS.AUDIT) || ensureAuditSchema_();
  var r = nextFreeRow_(sh);
  if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), r - sh.getMaxRows());
  var prevHash = r > 2 ? norm_(sh.getRange(r - 1, 11).getValue()) : '';
  var f = [ 'AUD-' + pad_(r - 1, 6), stamp_(), auditStr_(entityType, 100), auditStr_(entityId, 100), auditStr_(action, 200), auditStr_(user || 'System', 100), auditStr_(role || 'System', 50),
            auditStr_(previousState), auditStr_(newState), auditStr_(details) ];
  var h = auditHash_(prevHash, f);
  sh.getRange(r, 1, 1, 11).setValues([f.concat([h])]);
  PropertiesService.getScriptProperties().setProperty('audit_head', JSON.stringify({ id: f[0], hash: h }));
  return f[0];
}

/** Never blocks the real action: an audit failure is logged to the Apps Script console. */
function audit_(entityType, entityId, action, prev, next, details) {
  try {
    logAuditEntry_(entityType, entityId, action, CURRENT_ACTOR_ ? CURRENT_ACTOR_.name : 'Sheet / system', CURRENT_ACTOR_ ? CURRENT_ACTOR_.role : 'System', prev, next, details);
  } catch (e) { console.error('audit_ failed: ' + e); }
}

function verifyAuditChain_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.AUDIT);
  if (!sh || sh.getLastRow() < 2) return { intact: true, count: 0 };
  var d = sh.getRange(2, 1, sh.getLastRow() - 1, 11).getValues(), prev = '', n = 0;
  for (var i = 0; i < d.length; i++) {
    if (!norm_(d[i][0])) continue;
    var f = d[i].slice(0, 10).map(function (c) { return c instanceof Date ? Utilities.formatDate(c, tz_(), 'yyyy-MM-dd HH:mm') : String(c === null || c === undefined ? '' : c); });
    var h = norm_(d[i][10]);
    if (!h) { prev = ''; continue; } // legacy row written before hashing existed
    if (auditHash_(prev, f) !== h) return { intact: false, count: n, brokenAt: norm_(d[i][0]), row: i + 2 };
    prev = h; n++;
  }
  var head = null; try { head = JSON.parse(PropertiesService.getScriptProperties().getProperty('audit_head') || 'null'); } catch (e) {}
  if (head && head.hash && head.hash !== prev) return { intact: false, count: n, brokenAt: 'the newest records (rows were removed from the end)', row: sh.getLastRow() };
  return { intact: true, count: n };
}
function verifyAuditMenu() {
  var r = verifyAuditChain_();
  toast_(r.intact ? 'Audit trail intact - ' + r.count + ' chained records verified.' : 'TAMPERING DETECTED at ' + r.brokenAt + ' (row ' + r.row + ').');
  return r;
}

function getAuditLogs(token, entityType, entityId, limit) {
  return api_(token, 'viewAudit', function (u) {
    if (!entityId && !can_(u, 'viewAuditAll')) throw new Error('Only Admin or Finance can open the full audit trail.');
    ensureAuditSchema_();
    var logs = objs_(SHEETS.AUDIT, KEYS_.audit);
    if (norm_(entityType)) logs = logs.filter(function (l) { return norm_(l.entityType).toLowerCase() === norm_(entityType).toLowerCase(); });
    if (norm_(entityId)) logs = logs.filter(function (l) { return normId_(l.entityId) === normId_(entityId); });
    var lim = Number(limit) || 0; if (lim > 0 && logs.length > lim) logs = logs.slice(logs.length - lim);
    var out = { success: true, logs: logs };
    if (normId_(entityId) && norm_(entityType) === 'Serialized Asset') {
      var s = getSerialMap_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SERIAL))[normId_(entityId)];
      if (s) out.legacy = norm_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SERIAL).getRange(s.row, 13).getValue());
    }
    return out;
  });
}
function verifyAuditTrail(token) {
  return api_(token, 'viewAuditAll', function () { var r = verifyAuditChain_(); r.success = true; return r; });
}

/* ================= SERIALIZED STOCK IN BY MODEL (S/N + MAC) ================ */

function normSn_(v) { return norm_(v).toUpperCase().replace(/\s+/g, ''); }
/** MACs are stored as 12 upper-case hex characters with no separators (same as your existing units). */
function parseMac_(v) {
  var raw = norm_(v).replace(/[:.\-\s]/g, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(raw)) throw new Error('"' + norm_(v) + '" is not a valid MAC (needs 12 hex characters).');
  return raw;
}
function serialIdentifiers_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SERIAL), out = { sn: {}, mac: {} };
  if (!sh) return out;
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    var id = normId_(d[i][0]); if (!id) continue;
    var m = norm_(d[i][6]).replace(/[:.\-\s]/g, '').toUpperCase(), s = normSn_(d[i][7]);
    if (m) out.mac[m] = id; if (s) out.sn[s] = id;
  }
  return out;
}

/** Pick a serialized model, enter/scan many S/N + MAC pairs: creates one unit record per pair, posts ONE ledger
 *  Stock In, and releases anything waiting for that model. */
function recordSerializedStockIn(token, form) {
  return api_(token, 'moveStock', function (u) {
    return withLock_(function () {
      ensureOnce_();
      var sku = normId_(form.sku), site = norm_(form.site) || 'Main Store', ref = norm_(form.notes), units = form.units || [];
      if (!isSerializedSku_(sku)) throw new Error('Pick a serialized model (ONT, router, enterprise router or FAT box).');
      var ctx = buildCtx_(), cat = ctx.catalog[sku];
      if (!cat) throw new Error('Unknown SKU ' + sku + '.');
      if (!units.length) throw new Error('Add at least one unit.');
      if (units.length > MAX_PLACEHOLDERS) throw new Error('Receive at most ' + MAX_PLACEHOLDERS + ' units at a time.');
      var ids = serialIdentifiers_(), seenSn = {}, seenMac = {}, clean = [];
      units.forEach(function (x, i) {
        var n = i + 1, sn = normSn_(x.sn), mac = '';
        if (norm_(x.mac)) { try { mac = parseMac_(x.mac); } catch (e) { throw new Error('Row ' + n + ': ' + e.message); } }
        if (!sn && !mac) throw new Error('Row ' + n + ': enter a serial number or a MAC.');
        if (sn) {
          if (seenSn[sn]) throw new Error('Row ' + n + ': S/N ' + sn + ' appears twice in this list.');
          if (ids.sn[sn]) throw new Error('Row ' + n + ': S/N ' + sn + ' already exists as ' + ids.sn[sn] + '.');
          seenSn[sn] = 1;
        }
        if (mac) {
          if (seenMac[mac]) throw new Error('Row ' + n + ': MAC ' + mac + ' appears twice in this list.');
          if (ids.mac[mac]) throw new Error('Row ' + n + ': MAC ' + mac + ' already exists as ' + ids.mac[mac] + '.');
          seenMac[mac] = 1;
        }
        clean.push({ sn: sn, mac: mac, productId: norm_(x.productId), condition: norm_(x.condition), remarks: norm_(x.remarks) });
      });
      var out = postMovement_({ date: today_(), dir: 'Stock In', id: sku, model: cat.model, qty: clean.length, user: u.name, role: u.role, site: site, notes: 'Serialized batch' + (ref ? ' | ' + ref : '') });
      if (out.state !== 'ok') throw new Error(out.message);
      var created = out.createdIds || [];
      if (created.length !== clean.length) throw new Error('Unit records were not created as expected - check the Serialized Inventory sheet.');
      var sh = ctx.serialSheet, map = getSerialMap_(sh);
      created.forEach(function (id, i) {
        var row = map[id].row, rng = sh.getRange(row, 7, 1, 2);
        rng.setNumberFormat('@'); rng.setValues([[clean[i].mac, clean[i].sn]]);
        var pr = sh.getRange(row, 6); pr.setNumberFormat('@'); pr.setValue(clean[i].productId || '');
        if (['New', 'Good', 'Faulty', 'Not Recorded'].indexOf(clean[i].condition) > -1) sh.getRange(row, 10).setValue(clean[i].condition);
        var nc = sh.getRange(row, 13); nc.setValue(norm_(nc.getValue()).replace('Awaiting S/N & MAC', 'S/N & MAC recorded') + (clean[i].remarks ? ' | ' + clean[i].remarks : ''));
        audit_('Serialized Asset', id, 'Details recorded', null, { sn: clean[i].sn, mac: clean[i].mac, productId: clean[i].productId, condition: clean[i].condition || 'New' }, clean[i].remarks || ref);
      });
      return { success: true, message: 'Received ' + clean.length + ' x ' + cat.model + ' (' + sku + ') into ' + site + ': ' + created[0] + (created.length > 1 ? ' to ' + created[created.length - 1] : '') + '.', createdIds: created };
    });
  });
}

/* ============ CUSTOMERS, HOTSPOTS & NETWORK MAP (splitters / enclosures) ============ */

var SUBSCRIPTIONS_ = ['PPPoE', 'Hotspot User'];
var CUSTOMER_STATUSES_ = ['Active', 'Suspended', 'Disconnected', 'Pending Install'];
var SPLITTER_RATIOS_ = ['1:2', '1:4', '1:8', '1:16', '1:32', '1:64'];
var ENCLOSURE_TYPES_ = ['FAT Box', 'Joint Closure', 'Pole Box', 'Cabinet', 'Other'];

function ratioPorts_(r) { var n = parseInt(String(r).split(':')[1], 10); return isFinite(n) ? n : 0; }
function netSheet_(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }
function splitIds_(v) { return unique_(norm_(v).split(/[,;\s]+/).map(normId_).filter(Boolean)); }

function ensureNetFormats_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('net_fmt')) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [[SHEETS.CUSTOMERS, [4, 6, 8, 18]], [SHEETS.HOTSPOTS, [3, 6, 9, 15]], [SHEETS.ENCLOSURES, [5, 6]]].forEach(function (x) {
    var sh = ss.getSheetByName(x[0]); if (!sh) return;
    x[1].forEach(function (c) { sh.getRange(2, c, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@'); });
  });
  props.setProperty('net_fmt', '1');
}

/** Serial-unit columns O/P/Q = customer name, account, linked ticket. */
function setUnitLink_(assetId, name, account, ticketId) {
  var sh = netSheet_(SHEETS.SERIAL), m = getSerialMap_(sh)[normId_(assetId)];
  if (!m) return;
  var tk = ticketId === undefined ? norm_(sh.getRange(m.row, 17).getValue()) : ticketId;
  sh.getRange(m.row, 15, 1, 3).setValues([[name || '', account || '', tk || '']]);
}
function setUnitTicket_(assetId, ticketId) {
  var sh = netSheet_(SHEETS.SERIAL), m = getSerialMap_(sh)[normId_(assetId)];
  if (m) sh.getRange(m.row, 17).setValue(ticketId);
}

/** A unit can be installed only if it exists, has left the store, and is not linked to another record. */
function checkUnitFree_(assetId, selfId) {
  var id = normId_(assetId), sh = netSheet_(SHEETS.SERIAL), m = getSerialMap_(sh)[id];
  if (!m) throw new Error('Unit ' + id + ' does not exist in Serialized Inventory.');
  if (['Issued / Out', 'Dispatched'].indexOf(m.status) < 0) throw new Error(id + ' is "' + m.status + '". Issue it first (requisition or Record Movement) before linking it to a customer or hotspot.');
  var clash = '';
  objs_(SHEETS.CUSTOMERS, KEYS_.customer).forEach(function (c) { if (c.id !== selfId && normId_(c.onu) === id) clash = c.id + ' ' + c.name; });
  objs_(SHEETS.HOTSPOTS, KEYS_.hotspot).forEach(function (h) { if (h.id !== selfId && (normId_(h.onu) === id || splitIds_(h.aps).indexOf(id) > -1)) clash = h.id + ' ' + h.name; });
  if (clash) throw new Error(id + ' is already installed at ' + clash + '.');
}
function checkPort_(splitterId, port, selfId) {
  port = norm_(port);
  if (!splitterId) { if (port) throw new Error('Choose a splitter for that port.'); return; }
  var sp = findRow_(netSheet_(SHEETS.SPLITTERS), splitterId);
  if (!sp) throw new Error('Unknown splitter ' + splitterId + '.');
  if (!port) return;
  var cap = ratioPorts_(sp.vals[2]), p = Number(port);
  if (!isFinite(p) || Math.floor(p) !== p || p < 1 || (cap && p > cap)) throw new Error('Port must be a whole number from 1 to ' + cap + ' on ' + splitterId + ' (' + sp.vals[2] + ').');
  var who = '';
  objs_(SHEETS.CUSTOMERS, KEYS_.customer).forEach(function (c) { if (c.id !== selfId && normId_(c.splitterId) === splitterId && Number(c.port) === p) who = c.id + ' ' + c.name; });
  objs_(SHEETS.HOTSPOTS, KEYS_.hotspot).forEach(function (h) { if (h.id !== selfId && normId_(h.splitterId) === splitterId && Number(h.port) === p) who = h.id + ' ' + h.name; });
  objs_(SHEETS.SPLITTERS, KEYS_.splitter).forEach(function (s) { if (s.id !== selfId && normId_(s.parent) === splitterId && Number(s.parentPort) === p) who = s.id + ' ' + s.name; });
  if (who) throw new Error('Port ' + p + ' on ' + splitterId + ' is already used by ' + who + '.');
}
function phoneOk_(p) { if (p && !/^[+\d][\d\s\-()]{6,}$/.test(p)) throw new Error('The phone number looks wrong.'); }

function saveCustomer(token, f) {
  return api_(token, 'manageCustomers', function (u) {
    return withLock_(function () {
      ensureOnce_();
      var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(SHEETS.CUSTOMERS), name = norm_(f.name);
      if (!name) throw new Error('Customer name is required.');
      var sub = SUBSCRIPTIONS_.indexOf(norm_(f.subscription)) > -1 ? norm_(f.subscription) : 'PPPoE';
      var status = CUSTOMER_STATUSES_.indexOf(norm_(f.status)) > -1 ? norm_(f.status) : 'Active';
      var phone = norm_(f.phone), email = norm_(f.email).toLowerCase();
      phoneOk_(phone); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('The email address looks wrong.');
      var hid = normId_(f.hotspotId);
      if (sub === 'Hotspot User') {
        if (!hid) throw new Error('Pick the hotspot this user belongs to.');
        if (!findRow_(ss.getSheetByName(SHEETS.HOTSPOTS), hid)) throw new Error('Unknown hotspot ' + hid + '.');
      } else hid = '';
      var onu = sub === 'PPPoE' ? normId_(f.onu) : '', spl = sub === 'PPPoE' ? normId_(f.splitterId) : '', port = sub === 'PPPoE' ? norm_(f.port) : '';
      var edit = norm_(f.mode) === 'edit', cur = edit ? findRow_(sh, normId_(f.id)) : null;
      if (edit && !cur) throw new Error('Customer not found.');
      var id = edit ? norm_(cur.vals[0]) : nextSeqId_(sh, 'CUS', 4), account = norm_(f.account) || id, pppoe = norm_(f.pppoeUser);
      objs_(SHEETS.CUSTOMERS, KEYS_.customer).forEach(function (c) {
        if (c.id === id) return;
        if (norm_(c.account).toLowerCase() === account.toLowerCase()) throw new Error('Account ' + account + ' already belongs to ' + c.id + '.');
        if (pppoe && norm_(c.pppoeUser).toLowerCase() === pppoe.toLowerCase()) throw new Error('PPPoE user ' + pppoe + ' is already used by ' + c.id + '.');
      });
      if (onu) checkUnitFree_(onu, id);
      checkPort_(spl, port, id);
      var row = [id, name, sub, account, norm_(f.contact), phone, email, norm_(f.plot), norm_(f.location), hid, pppoe, norm_(f.package), status, onu, spl, port, norm_(f.genieId), norm_(f.installDate), norm_(f.notes), edit ? norm_(cur.vals[19]) : u.name];
      if (edit) sh.getRange(cur.row, 1, 1, 20).setValues([row]); else safeAppend_(sh, row);
      var prevOnu = edit ? normId_(cur.vals[13]) : '';
      if (prevOnu && prevOnu !== onu) setUnitLink_(prevOnu, '', '');
      if (onu) setUnitLink_(onu, name, account);
      audit_('Customer', id, edit ? 'Edited' : 'Created', edit ? { status: norm_(cur.vals[12]), onu: prevOnu, splitter: norm_(cur.vals[14]), port: norm_(cur.vals[15]) } : null, { name: name, subscription: sub, status: status, onu: onu, splitter: spl, port: port, hotspot: hid }, '');
      return { success: true, message: 'Customer ' + id + (edit ? ' updated.' : ' added.') };
    });
  });
}

function saveHotspot(token, f) {
  return api_(token, 'manageCustomers', function (u) {
    return withLock_(function () {
      ensureOnce_();
      var sh = netSheet_(SHEETS.HOTSPOTS), name = norm_(f.name);
      if (!name) throw new Error('Hotspot name is required.');
      var status = ['Active', 'Planned', 'Suspended', 'Decommissioned'].indexOf(norm_(f.status)) > -1 ? norm_(f.status) : 'Active';
      var phone = norm_(f.phone); phoneOk_(phone);
      var edit = norm_(f.mode) === 'edit', cur = edit ? findRow_(sh, normId_(f.id)) : null;
      if (edit && !cur) throw new Error('Hotspot not found.');
      var id = edit ? norm_(cur.vals[0]) : nextSeqId_(sh, 'HSP', 3);
      var onu = normId_(f.onu), aps = splitIds_(f.aps), spl = normId_(f.splitterId), port = norm_(f.port);
      if (onu) checkUnitFree_(onu, id);
      aps.forEach(function (a) { if (a === onu) throw new Error(a + ' cannot be both the ONU and an AP.'); checkUnitFree_(a, id); });
      checkPort_(spl, port, id);
      var row = [id, name, norm_(f.plot), norm_(f.location), norm_(f.contact), phone, status, onu, aps.join(', '), spl, port, norm_(f.genieId), norm_(f.ssid), norm_(f.installDate), norm_(f.notes), edit ? norm_(cur.vals[15]) : u.name];
      if (edit) sh.getRange(cur.row, 1, 1, 16).setValues([row]); else safeAppend_(sh, row);
      var prev = edit ? [normId_(cur.vals[7])].concat(splitIds_(cur.vals[8])).filter(Boolean) : [], now = [onu].concat(aps).filter(Boolean);
      prev.forEach(function (a) { if (now.indexOf(a) < 0) setUnitLink_(a, '', ''); });
      now.forEach(function (a) { setUnitLink_(a, 'Hotspot: ' + name, id); });
      audit_('Hotspot', id, edit ? 'Edited' : 'Created', edit ? { status: norm_(cur.vals[6]), onu: norm_(cur.vals[7]), aps: norm_(cur.vals[8]), splitter: norm_(cur.vals[9]), port: norm_(cur.vals[10]) } : null, { name: name, status: status, onu: onu, aps: aps.join(', '), splitter: spl, port: port }, '');
      return { success: true, message: 'Hotspot ' + id + (edit ? ' updated.' : ' added.') };
    });
  });
}

/** Technicians (and others who map the network) update only the install details of a customer / hotspot. */
function updateInstall(token, f) {
  return api_(token, 'manageNetwork', function (u) {
    return withLock_(function () {
      var hs = norm_(f.kind) === 'hotspot', sh = netSheet_(hs ? SHEETS.HOTSPOTS : SHEETS.CUSTOMERS), rec = findRow_(sh, normId_(f.id));
      if (!rec) throw new Error('Record not found.');
      var id = norm_(rec.vals[0]), name = norm_(rec.vals[1]), onu = normId_(f.onu), spl = normId_(f.splitterId), port = norm_(f.port), genie = norm_(f.genieId);
      var aps = hs ? splitIds_(f.aps) : [];
      if (!hs && norm_(rec.vals[2]) !== 'PPPoE') throw new Error('Hotspot users have no ONU of their own - edit the hotspot instead.');
      if (onu) checkUnitFree_(onu, id);
      aps.forEach(function (a) { if (a === onu) throw new Error(a + ' cannot be both the ONU and an AP.'); checkUnitFree_(a, id); });
      checkPort_(spl, port, id);
      var prev = hs ? [normId_(rec.vals[7])].concat(splitIds_(rec.vals[8])).filter(Boolean) : [normId_(rec.vals[13])].filter(Boolean);
      if (hs) sh.getRange(rec.row, 8, 1, 5).setValues([[onu, aps.join(', '), spl, port, genie]]);
      else sh.getRange(rec.row, 14, 1, 4).setValues([[onu, spl, port, genie]]);
      var now = [onu].concat(aps).filter(Boolean), acct = hs ? id : (norm_(rec.vals[3]) || id);
      prev.forEach(function (a) { if (now.indexOf(a) < 0) setUnitLink_(a, '', ''); });
      now.forEach(function (a) { setUnitLink_(a, hs ? 'Hotspot: ' + name : name, acct); });
      audit_(hs ? 'Hotspot' : 'Customer', id, 'Install details updated', { devices: prev.join(', '), splitter: hs ? norm_(rec.vals[9]) : norm_(rec.vals[14]), port: hs ? norm_(rec.vals[10]) : norm_(rec.vals[15]) }, { devices: now.join(', '), splitter: spl, port: port, genieId: genie }, '');
      return { success: true, message: id + ' install details saved.' };
    });
  });
}

function saveEnclosure(token, f) {
  return api_(token, 'manageNetwork', function (u) {
    return withLock_(function () {
      ensureOnce_();
      var sh = netSheet_(SHEETS.ENCLOSURES), name = norm_(f.name);
      if (!name) throw new Error('Enclosure name is required.');
      var type = ENCLOSURE_TYPES_.indexOf(norm_(f.type)) > -1 ? norm_(f.type) : 'FAT Box', coords = norm_(f.coords), cap = norm_(f.capacity);
      if (coords && !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(coords)) throw new Error('Coordinates must look like -1.2921, 36.8219.');
      if (cap && (!isFinite(Number(cap)) || Number(cap) < 0)) throw new Error('Capacity must be a number.');
      var edit = norm_(f.mode) === 'edit', cur = edit ? findRow_(sh, normId_(f.id)) : null;
      if (edit && !cur) throw new Error('Enclosure not found.');
      var id = edit ? norm_(cur.vals[0]) : nextSeqId_(sh, 'ENC', 3);
      var row = [id, name, type, norm_(f.location), norm_(f.plot), coords, cap, norm_(f.notes), edit ? norm_(cur.vals[8]) : u.name];
      if (edit) sh.getRange(cur.row, 1, 1, 9).setValues([row]); else safeAppend_(sh, row);
      audit_('Enclosure', id, edit ? 'Edited' : 'Created', edit ? { name: norm_(cur.vals[1]), location: norm_(cur.vals[3]) } : null, { name: name, type: type, location: norm_(f.location), plot: norm_(f.plot) }, '');
      return { success: true, message: 'Enclosure ' + id + (edit ? ' updated.' : ' added.') };
    });
  });
}

function saveSplitter(token, f) {
  return api_(token, 'manageNetwork', function (u) {
    return withLock_(function () {
      ensureOnce_();
      var sh = netSheet_(SHEETS.SPLITTERS), name = norm_(f.name), ratio = norm_(f.ratio);
      if (!name) throw new Error('Splitter name is required.');
      if (SPLITTER_RATIOS_.indexOf(ratio) < 0) throw new Error('Pick a split ratio.');
      var edit = norm_(f.mode) === 'edit', cur = edit ? findRow_(sh, normId_(f.id)) : null;
      if (edit && !cur) throw new Error('Splitter not found.');
      var id = edit ? norm_(cur.vals[0]) : nextSeqId_(sh, 'SPL', 3);
      var parent = normId_(f.parent), pport = norm_(f.parentPort), enc = normId_(f.enclosureId);
      var status = ['Active', 'Planned', 'Decommissioned'].indexOf(norm_(f.status)) > -1 ? norm_(f.status) : 'Active';
      if (parent) {
        if (parent === id) throw new Error('A splitter cannot feed itself.');
        var all = objs_(SHEETS.SPLITTERS, KEYS_.splitter), cursor = parent, guard = 0;
        while (cursor && guard++ < 12) { if (cursor === id) throw new Error('That parent would create a loop.'); var nx = all.filter(function (s) { return s.id === cursor; })[0]; cursor = nx ? normId_(nx.parent) : ''; }
        checkPort_(parent, pport, id);
        if (!pport) throw new Error('Say which port of ' + parent + ' feeds this splitter.');
      } else pport = '';
      if (enc && !findRow_(netSheet_(SHEETS.ENCLOSURES), enc)) throw new Error('Unknown enclosure ' + enc + '.');
      var level = parent ? 'Secondary' : 'Primary';
      var row = [id, name, ratio, level, parent, pport, norm_(f.olt), enc, status, norm_(f.notes), edit ? norm_(cur.vals[10]) : u.name];
      if (edit) sh.getRange(cur.row, 1, 1, 11).setValues([row]); else safeAppend_(sh, row);
      audit_('Splitter', id, edit ? 'Edited' : 'Created', edit ? { ratio: norm_(cur.vals[2]), parent: norm_(cur.vals[4]), port: norm_(cur.vals[5]), enclosure: norm_(cur.vals[7]) } : null, { name: name, ratio: ratio, parent: parent, parentPort: pport, olt: norm_(f.olt), enclosure: enc }, '');
      return { success: true, message: 'Splitter ' + id + (edit ? ' updated.' : ' added.') };
    });
  });
}

/** Swap a faulty ONU / AP at a customer or hotspot: retires the old unit, installs the new one, links the ticket. */
function replaceDevice(token, f) {
  return api_(token, 'replaceDevice', function (u) {
    return withLock_(function () {
      var hs = norm_(f.kind) === 'hotspot', sh = netSheet_(hs ? SHEETS.HOTSPOTS : SHEETS.CUSTOMERS), rec = findRow_(sh, normId_(f.entityId));
      if (!rec) throw new Error('Customer / hotspot not found.');
      var id = norm_(rec.vals[0]), name = norm_(rec.vals[1]), role = norm_(f.role) === 'AP' ? 'AP' : 'ONU';
      var oldA = normId_(f.oldAsset), newA = normId_(f.newAsset), ticket = normId_(f.ticketId), reason = norm_(f.reason) || 'faulty';
      if (!oldA || !newA || oldA === newA) throw new Error('Pick the faulty unit and a different replacement.');
      var onuCol = hs ? 8 : 14, onu = normId_(rec.vals[onuCol - 1]), aps = hs ? splitIds_(rec.vals[8]) : [];
      if (role === 'ONU' ? onu !== oldA : aps.indexOf(oldA) < 0) throw new Error(oldA + ' is not installed at ' + id + ' as its ' + role + '.');
      var ssh = netSheet_(SHEETS.SERIAL), smap = getSerialMap_(ssh), ou = smap[oldA], nu = smap[newA];
      if (!ou || !nu) throw new Error('Unit not found in Serialized Inventory.');
      var nv = ssh.getRange(nu.row, 1, 1, 17).getValues()[0], nStatus = norm_(nv[8]);
      if (norm_(nv[14])) throw new Error(newA + ' is already installed at ' + norm_(nv[14]) + '.');
      var tkSh = netSheet_(SHEETS.ISSUES), tk = ticket ? findRow_(tkSh, ticket) : null;
      if (ticket && !tk) throw new Error('Ticket ' + ticket + ' not found.');
      var loc = norm_(rec.vals[hs ? 3 : 8]) || name, acct = hs ? id : (norm_(rec.vals[3]) || id);
      if (nStatus === 'In Stock') {
        if (!can_(u, 'moveStock')) throw new Error(newA + ' is still In Stock. Ask the store to issue it to you first, or have the store do the replacement.');
        var out = postMovement_({ date: today_(), dir: 'Stock Out', id: newA, qty: 1, user: norm_(f.tech) || u.name, role: 'Technician', site: loc, notes: 'Replacement | ' + (ticket || id) });
        if (out.state !== 'ok') throw new Error(out.message);
        netSheet_(SHEETS.LEDGER).getRange(out.ledgerRow, 11, 1, 3).setValues([['Replacement', ticket || id, newA]]);
      } else if (['Issued / Out', 'Dispatched'].indexOf(nStatus) > -1) {
        if (!can_(u, 'moveStock') && !sameUser_(nv[11], u)) throw new Error(newA + ' is issued to ' + (norm_(nv[11]) || 'someone else') + ', not to you.');
      } else throw new Error(newA + ' is "' + nStatus + '" and cannot be installed.');
      ssh.getRange(ou.row, 9, 1, 4).setValues([['Under Repair', 'Faulty', 'Returned from ' + name, u.name]]);
      appendLog_(ssh.getRange(ou.row, 13), 'Replaced by ' + newA + ' at ' + name + (ticket ? ' (' + ticket + ')' : '') + ' - ' + reason);
      ssh.getRange(ou.row, 15, 1, 3).setValues([['', '', ticket || norm_(ssh.getRange(ou.row, 17).getValue())]]);
      ssh.getRange(nu.row, 15, 1, 3).setValues([[hs ? 'Hotspot: ' + name : name, acct, ticket]]);
      ssh.getRange(nu.row, 11).setValue(loc);
      appendLog_(ssh.getRange(nu.row, 13), 'Installed at ' + name + ', replacing ' + oldA + (ticket ? ' (' + ticket + ')' : ''));
      if (role === 'ONU') sh.getRange(rec.row, onuCol).setValue(newA);
      else { aps[aps.indexOf(oldA)] = newA; sh.getRange(rec.row, 9).setValue(aps.join(', ')); }
      if (tk) { tkSh.getRange(tk.row, 6, 1, 2).setValues([[oldA, newA]]); appendLog_(tkSh.getRange(tk.row, 10), 'Device replaced ' + oldA + ' -> ' + newA + ' by ' + u.name); }
      audit_(hs ? 'Hotspot' : 'Customer', id, role + ' replaced', { device: oldA }, { device: newA }, (ticket ? ticket + ' - ' : '') + reason);
      audit_('Serialized Asset', oldA, 'Retired - replaced at ' + name, { status: norm_(ou.status) }, { status: 'Under Repair', condition: 'Faulty', replacedBy: newA }, reason);
      audit_('Serialized Asset', newA, 'Installed at ' + name, { status: nStatus }, { location: loc, replaces: oldA, ticket: ticket }, '');
      return { success: true, message: role + ' at ' + name + ' replaced: ' + oldA + ' -> ' + newA + '. The faulty unit is now Under Repair.' };
    });
  });
}

/* ---- GenieACS (optional): link out from the UI, plus a read-only online / last-inform check ---- */
function setGenieAcsCredentials() {
  var ui = SpreadsheetApp.getUi(), a = ui.prompt('GenieACS API user (leave empty to clear)'), b = ui.prompt('GenieACS API password');
  var p = PropertiesService.getScriptProperties();
  p.setProperty('GENIEACS_USER', a.getResponseText()); p.setProperty('GENIEACS_PASS', b.getResponseText());
  toast_('GenieACS credentials saved (stored in Script Properties, not in the sheet).');
}
function genieacsStatus(token, kind, id) {
  return api_(token, 'viewNetwork', function () {
    var s = getSettingsMap_(), nbi = norm_(s.GENIEACS_NBI_URL);
    if (!nbi) throw new Error('GenieACS API is not configured. Set GENIEACS_NBI_URL in Inventory Settings.');
    var hs = kind === 'hotspot', rec = findRow_(netSheet_(hs ? SHEETS.HOTSPOTS : SHEETS.CUSTOMERS), normId_(id));
    if (!rec) throw new Error('Record not found.');
    var gid = norm_(rec.vals[hs ? 11 : 16]), onu = normId_(rec.vals[hs ? 7 : 13]), sn = '';
    if (onu) { var m = getSerialMap_(netSheet_(SHEETS.SERIAL))[onu]; if (m) sn = norm_(netSheet_(SHEETS.SERIAL).getRange(m.row, 8).getValue()); }
    if (!gid && !sn) throw new Error('Add the GenieACS device ID or link an ONU that has an S/N first.');
    var q = gid ? { _id: gid } : { '_deviceId._SerialNumber': sn };
    var props = PropertiesService.getScriptProperties(), headers = {}, usr = props.getProperty('GENIEACS_USER');
    if (usr) headers.Authorization = 'Basic ' + Utilities.base64Encode(usr + ':' + (props.getProperty('GENIEACS_PASS') || ''));
    var res = UrlFetchApp.fetch(nbi.replace(/\/$/, '') + '/devices/?projection=' + encodeURIComponent('_id,_lastInform,_tags') + '&query=' + encodeURIComponent(JSON.stringify(q)), { muteHttpExceptions: true, headers: headers });
    if (res.getResponseCode() !== 200) throw new Error('GenieACS answered HTTP ' + res.getResponseCode() + '.');
    var arr = JSON.parse(res.getContentText());
    if (!arr.length) return { success: true, found: false, message: 'Not found in GenieACS (' + (gid || sn) + ').' };
    var d = arr[0], last = d._lastInform ? new Date(d._lastInform) : null, mins = last ? Math.round((Date.now() - last.getTime()) / 60000) : null;
    var online = mins !== null && mins <= Number(s.GENIEACS_ONLINE_MINUTES || 15);
    return { success: true, found: true, id: d._id, online: online, minutesAgo: mins, lastInform: last ? Utilities.formatDate(last, tz_(), 'yyyy-MM-dd HH:mm') : '', tags: d._tags || [],
             message: (online ? 'ONLINE' : 'OFFLINE') + ' - last inform ' + (mins === null ? 'never' : mins + ' min ago') };
  });
}
