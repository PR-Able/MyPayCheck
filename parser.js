// Reads a Tas Health "Pay Advice Slip" from the text lines of the PDF.
// textLines: array of strings, one per visual line, in reading order.

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const num = (s) => parseFloat(String(s).replace(/,/g, ''));
const longDate = (d, m, y) => `${y}-${MONTHS[m]}-${d.padStart(2, '0')}`;
const shortDate = (s) => (s ? `20${s.slice(5, 7)}-${MONTHS[s.slice(2, 5)]}-${s.slice(0, 2)}` : null);

const DATA_ROW = /^(.*?)\s*(-?[\d,]*\.?\d+)\s+(-?[\d,]*\.\d+)\s+(?:(\d{2}[A-Z][a-z]{2}\d{2})\s+(\d{2}[A-Z][a-z]{2}\d{2})\s+)?(-?[\d,]+\.\d{2})$/;

export function parsePayslipText(textLines) {
  const lines = textLines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const all = lines.join('\n');
  const out = { lines: [], deductions: [] };

  let m = all.match(/Pay Date:\s*(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})/);
  if (m) out.payDate = longDate(m[1], m[2], m[3]);
  m = all.match(/(\d{1,2}) ([A-Z][a-z]{2}) (\d{4}) to (\d{1,2}) ([A-Z][a-z]{2}) (\d{4})/);
  if (m) { out.periodStart = longDate(m[1], m[2], m[3]); out.periodEnd = longDate(m[4], m[5], m[6]); }
  m = all.match(/(MP Level \d+ \([^)]*\))/);
  if (m) out.classification = m[1];
  m = all.match(/\$([\d,]+\.\d{2})/);
  if (m) out.annualSalary = num(m[1]);
  m = all.match(/Net Pay \$\s*([\d,]+\.\d{2})/);
  if (m) out.net = num(m[1]);
  // "Summary This Pay" numbers line: Total Remuneration, Taxable Gross, PAYG
  const si = lines.findIndex((l) => /Summary This Pay/.test(l));
  if (si >= 0) {
    for (let k = si + 1; k < Math.min(si + 4, lines.length); k++) {
      const nums = lines[k].match(/-?[\d,]+\.\d{2}/g);
      if (nums && nums.length >= 3 && !/Net Pay/.test(lines[k])) {
        out.gross = num(nums[0]); out.taxable = num(nums[1]); out.tax = num(nums[2]); break;
      }
    }
  }

  // Payment Details section
  const start = lines.findIndex((l) => /^Payment Details/.test(l));
  let end = lines.findIndex((l, i) => i > start && /^(Pay Deductions|Pay Disbursement|Pay Summary)/.test(l));
  if (end < 0) end = lines.length;
  if (start >= 0) {
    const sect = lines.slice(start + 1, end).filter((l) => !/^Description\b.*Amount$/.test(l));
    const rows = sect.map((l) => {
      const d = l.match(DATA_ROW);
      return d ? { data: true, desc: d[1].trim(), hours: num(d[2]), rate: num(d[3]), from: shortDate(d[4]), to: shortDate(d[5]), amount: num(d[6]) }
        : { data: false, text: l };
    });
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.data) continue;
      let desc = r.desc;
      if (!desc) {
        const prev = rows[i - 1], next = rows[i + 1];
        const parts = [];
        if (prev && !prev.data && !prev.used) { parts.push(prev.text); prev.used = true; }
        if (next && !next.data) { parts.push(next.text); next.used = true; }
        desc = parts.join(' ');
      }
      out.lines.push({ desc, hours: r.hours, rate: r.rate, from: r.from, to: r.to, amount: r.amount });
    }
  }
  // Deductions (informational)
  const ds = lines.findIndex((l) => /^Pay Deductions/.test(l));
  if (ds >= 0) {
    for (let k = ds + 1; k < lines.length && !/^Pay (Disbursement|Summary)/.test(lines[k]); k++) {
      const d = lines[k].match(/^(.*\D)\s+(-?[\d,]+\.\d{2})$/);
      if (d && !/^Description/.test(lines[k])) out.deductions.push({ desc: d[1].trim(), amount: num(d[2]) });
    }
  }
  out.linesTotal = Math.round(out.lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  out.ok = !!(out.payDate && out.periodStart);
  return out;
}

// Turn pdf.js text content into visual lines (group by y, sort by x).
export function textContentToLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4], y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' '));
}

export async function readPayslipPdf(pdfjs, arrayBuffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    lines.push(...textContentToLines(tc.items));
  }
  return parsePayslipText(lines);
}
