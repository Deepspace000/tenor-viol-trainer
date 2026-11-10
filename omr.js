/* Tenor Viol Clef Trainer: reading printed music from a PDF or picture.
   Staff, notehead and key-signature detection come from Violin Colour Score (same author);
   rhythm, rests, bar lines and accidentals are added below. */
function estimateSkew(imgData){
  const W = imgData.width, H = imgData.height, d = imgData.data;
  const f = Math.max(1, Math.round(W / 600));
  const w = Math.floor(W / f), h = Math.floor(H / f);
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y * f) * W + x * f) * 4; dark[y * w + x] = (d[i] * 77 + d[i+1] * 151 + d[i+2] * 28) >> 8 < 150 ? 1 : 0; }
  const cx = w / 2;
  const proj = new Float64Array(h + 2 * w);
  const score = (th) => {
    proj.fill(0); const tn = Math.tan(th);
    for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) if (dark[o + x]) proj[Math.round(y - (x - cx) * tn) + w]++; }
    let s = 0; for (let k = 0; k < proj.length; k++) s += proj[k] * proj[k]; return s;
  };
  let best = 0, bestS = -1;
  for (let deg = -4; deg <= 4; deg += 0.25) { const s = score(deg * Math.PI / 180); if (s > bestS) { bestS = s; best = deg; } }
  let fine = best;
  for (let deg = best - 0.25; deg <= best + 0.25; deg += 0.05) { const s = score(deg * Math.PI / 180); if (s > bestS) { bestS = s; fine = deg; } }
  return fine * Math.PI / 180;
}

function analyzeBitmap(imgData, opts){
  const W = imgData.width, H = imgData.height, d = imgData.data, N = W * H;
  const strict = opts.strict || 'normal';
  const MIN_CORE_W = strict === 'loose' ? 0.55 : strict === 'strict' ? 0.75 : 0.65;

  // 1. grey + adaptive threshold (works for clean PDFs and phone photos)
  const gray = new Uint8Array(N);
  for (let i = 0; i < N; i++) gray[i] = (d[i*4]*77 + d[i*4+1]*151 + d[i*4+2]*28) >> 8;
  const W1 = W + 1;
  const S = new Uint32Array(W1 * (H + 1));
  for (let y = 1; y <= H; y++) { let row = 0; const yo = y*W1, yp = (y-1)*W1, go = (y-1)*W; for (let x = 1; x <= W; x++) { row += gray[go + x - 1]; S[yo + x] = S[yp + x] + row; } }
  const r = Math.max(8, Math.round(W / 60));
  const bin = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
    const a = y0 * W1, b = (y1 + 1) * W1, rows = y1 - y0 + 1;
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
      const sum = S[b + x1 + 1] - S[a + x1 + 1] - S[b + x0] + S[a + x0];
      const mean = sum / (rows * (x1 - x0 + 1));
      const g = gray[y*W + x];
      bin[y*W + x] = (g < mean * 0.80 && g < 215) ? 1 : 0;
    }
  }

  // 2. staff line thickness from vertical black runs
  const bh = new Uint32Array(64);
  for (let x = 0; x < W; x += 2) { let run = 0; for (let y = 0; y < H; y++) { if (bin[y*W + x]) run++; else { if (run > 0 && run < 64) bh[run]++; run = 0; } } }
  let LT = 1, best = 0; for (let k = 1; k < 64; k++) if (bh[k] > best) { best = bh[k]; LT = k; }

  // 3. staff lines by row projection
  const rowSum = new Uint32Array(H); let maxRow = 0;
  for (let y = 0; y < H; y++) { let s = 0; const o = y*W; for (let x = 0; x < W; x++) s += bin[o + x]; rowSum[y] = s; if (s > maxRow) maxRow = s; }
  const thr = Math.max(W * 0.3, maxRow * 0.5);
  const lines = []; let start = -1;
  const flush = (y0, y1) => { let wsum = 0, ws = 0; for (let y = y0; y <= y1; y++) { wsum += y * rowSum[y]; ws += rowSum[y]; } const t = y1 - y0 + 1; if (t <= Math.max(3 * LT + 2, 6)) lines.push({ y: wsum / ws, t }); };
  for (let y = 0; y < H; y++) { if (rowSum[y] >= thr) { if (start < 0) start = y; } else if (start >= 0) { flush(start, y - 1); start = -1; } }
  if (start >= 0) flush(start, H - 1);

  const staves = [];
  let i = 0;
  while (i + 4 < lines.length) {
    const g = lines.slice(i, i + 5);
    const ds = [1,2,3,4].map(k => g[k].y - g[k-1].y);
    const m = median(ds);
    if (m >= 4 && m <= 150 && ds.every(dd => Math.abs(dd - m) <= 0.22 * m)) { staves.push({ lines: g.map(l => l.y), lt: g.map(l => l.t), p: m, top: g[0].y, bot: g[4].y }); i += 5; }
    else i++;
  }
  if (!staves.length) return { W, H, LT, U: 0, staves: [], notes: [] };
  const U = median(staves.map(s => s.p));

  // staff left/right extents
  for (const st of staves) {
    const Ls = [], Rs = [];
    for (const ly of st.lines) {
      const y = Math.round(ly), o = y * W;
      let bestL = 0, bestR = -1, cs = -1, gap = 0, curL = 0;
      for (let x = 0; x < W; x++) {
        if (bin[o + x]) { if (cs < 0) { cs = x; } gap = 0; curL = x; }
        else { if (cs >= 0) { gap++; if (gap > 2 * LT + 2) { if (curL - cs > bestR - bestL) { bestL = cs; bestR = curL; } cs = -1; } } }
      }
      if (cs >= 0 && curL - cs > bestR - bestL) { bestL = cs; bestR = curL; }
      Ls.push(bestL); Rs.push(bestR);
    }
    st.left = median(Ls); st.right = median(Rs);
  }

  // 4. remove staff lines, but keep anything thicker than a line (noteheads, stems, beams)
  const clean = new Uint8Array(bin);
  // Erase only runs that are just the line itself. A hollow notehead touching a line from
  // above or below makes the run about twice as long, and must survive so its ring stays closed.
  // Lines drawn from a PDF can come out a pixel thicker than the usual line, depending on where they
  // fall on the pixel grid, so each line is erased up to its own measured thickness.
  for (const st of staves) {
    const x0 = Math.max(0, Math.round(st.left - U)), x1 = Math.min(W - 1, Math.round(st.right + U));
    for (let li = 0; li < st.lines.length; li++) {
      const ly = st.lines[li], maxRun = Math.max(LT, Math.min(2 * LT, st.lt[li] || LT)), t = Math.ceil(maxRun / 2) + 1;
      const yc = Math.round(ly);
      for (let x = x0; x <= x1; x++) {
        for (let y = yc - t; y <= yc + t; y++) {
          if (y < 0 || y >= H || !clean[y*W + x]) continue;
          let ya = y, yb = y;
          while (ya > 0 && bin[(ya-1)*W + x]) ya--;
          while (yb < H - 1 && bin[(yb+1)*W + x]) yb++;
          if (yb - ya + 1 <= maxRun) { for (let k = ya; k <= yb; k++) clean[k*W + x] = 0; }
          y = yb;
        }
      }
    }
  }
  // 4a. Ledger lines too: one running through a hollow note splits its hole in two and the note is missed.
  //     A ledger line is a short thin line on a line position above or below the staff, with a note on it or touching it.
  const ledgerYs = [];
  for (const st of staves) {
    const p = st.p, x0 = Math.max(0, Math.round(st.left + 2 * p)), x1 = Math.min(W - 1, Math.round(st.right + p));
    const ledT = Math.max(LT + 1, Math.min(2 * LT + 2, Math.round(0.24 * p)));   // (ledger lines are often drawn thicker than staff lines)
    for (const side of [-1, 1]) for (let k = 1; k <= 5; k++) {
      const yc = Math.round(side < 0 ? st.top - k * p : st.bot + k * p);
      if (yc < LT + 3 || yc >= H - LT - 3) continue;
      let any = false;
      for (let y = yc - LT - 1; y <= yc + LT + 1; y++) {
        let s = -1;
        for (let x = x0; x <= x1 + 1; x++) {
          const v = x <= x1 && clean[y*W + x];
          if (v && s < 0) s = x;
          else if (!v && s >= 0) {
            const e = x - 1, len = e - s + 1;
            s0: if (len >= 1.2 * p && len <= 4 * p) {
              let head = false;
              for (let xx = s; xx <= e && !head; xx++) { let ya = y, yb = y; while (ya > 0 && bin[(ya-1)*W + xx]) ya--; while (yb < H - 1 && bin[(yb+1)*W + xx]) yb++; if (yb - ya + 1 >= 0.6 * p) head = true; }
              if (!head) break s0;
              any = true;
              // a thick ledger line is straight and the same thickness all along (a tie is a curve, thin at its ends)
              let lim = LT + 1;
              { const th = [], tops = []; let hs = -1, he = -1;
                const tall = xx => { let ya = y, yb = y; while (ya > 0 && bin[(ya-1)*W + xx]) ya--; while (yb < H - 1 && bin[(yb+1)*W + xx]) yb++; return [ya, yb - ya + 1]; };
                for (let xx = s; xx <= e; xx++) if (tall(xx)[1] >= 0.5 * p) { if (hs < 0) hs = xx; he = xx; }
                // (the line sticks out on both sides of the note; a tie starts at the note)
                if (hs - s >= 0.2 * p && e - he >= 0.2 * p) for (let xx = Math.max(s, Math.round(hs - 0.6 * p)); xx <= Math.min(e, Math.round(he + 0.6 * p)); xx++) { if (xx >= hs && xx <= he) continue; const t = tall(xx); if (t[1] < 0.5 * p) { th.push(t[1]); tops.push(t[0]); } }
                if (opts.thickLedger && th.length >= 4) { const mt = median(th), my = median(tops); let same = 0; for (let q = 0; q < th.length; q++) if (Math.abs(th[q] - mt) <= 1 && Math.abs(tops[q] - my) <= 1) same++; if (mt > LT + 1 && mt <= ledT && same >= 0.75 * th.length) lim = Math.min(ledT, mt + 1); } }
              for (let xx = s; xx <= e; xx++) { let ya = y, yb = y; while (ya > 0 && bin[(ya-1)*W + xx]) ya--; while (yb < H - 1 && bin[(yb+1)*W + xx]) yb++; if (yb - ya + 1 <= lim) for (let q = ya; q <= yb; q++) clean[q*W + xx] = 0; }
            }
            s = -1;
          }
        }
      }
      if (any) ledgerYs.push(yc);
    }
  }

  // 4b. read the key signature of each staff: accidentals between the clef and the time signature
  const visitedK = new Uint8Array(N);
  const stackK = new Int32Array(N);
  // work on a copy with every thin horizontal sliver removed, so leftover bits of staff line
  // cannot glue the clef, the accidentals and the time signature into one shape
  const kimg = new Uint8Array(N);
  for (const st of staves) {
    const p = st.p;
    const ya = Math.max(0, Math.round(st.top - 1.6 * p)), yb = Math.min(H - 1, Math.round(st.bot + 1.6 * p));
    const xa = Math.max(0, Math.round(st.left - 0.5 * p)), xb = Math.min(W - 1, Math.round(st.left + 14 * p));
    for (let x = xa; x <= xb; x++) { let s = -1; for (let y = ya; y <= yb + 1; y++) { const v = y <= yb && clean[y*W + x]; if (v && s < 0) s = y; else if (!v && s >= 0) { if (y - s > LT + 1) for (let k = s; k < y; k++) kimg[k*W + x] = 1; s = -1; } } }
    const comps = [];
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const idx = y*W + x;
      if (!kimg[idx] || visitedK[idx]) continue;
      let sp = 0; stackK[sp++] = idx; visitedK[idx] = 1;
      let minx = x, maxx = x, miny = y, maxy = y, area = 0; const pix = [];
      while (sp > 0) {
        const q = stackK[--sp]; const px = q % W, py = (q - px) / W; area++; if (area < 20000) pix.push(q);
        if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
        if (px > xa) { const z = q - 1; if (kimg[z] && !visitedK[z]) { visitedK[z] = 1; stackK[sp++] = z; } }
        if (px < xb) { const z = q + 1; if (kimg[z] && !visitedK[z]) { visitedK[z] = 1; stackK[sp++] = z; } }
        if (py > ya) { const z = q - W; if (kimg[z] && !visitedK[z]) { visitedK[z] = 1; stackK[sp++] = z; } }
        if (py < yb) { const z = q + W; if (kimg[z] && !visitedK[z]) { visitedK[z] = 1; stackK[sp++] = z; } }
      }
      comps.push({ minx, maxx, miny, maxy, w: maxx - minx + 1, h: maxy - miny + 1, area, pix });
    }
    // Which clef? A treble clef reaches well above and below the staff. A C clef is a thick bar the height of the
    // staff (plus a thin bar and two curls) and its middle marks the C line: the middle line for the alto clef, the
    // line above for the tenor clef. A bass clef is a broad shape hanging from the top line, with two dots.
    // (The bracket or line that joins the staves of a full score is thin or much taller, and is ignored.)
    const near = comps.filter(c => c.minx < st.left + 3.5 * p && c.minx >= st.left + 0.25 * p && c.w >= 0.25 * p);   // (a bracket and its hooks start right at the staff's edge)
    const gClef = near.find(c => c.h >= 5.2 * p && c.w >= 1.0 * p && c.w <= 3.6 * p);
    const cBar = near.find(c => c.h >= 3.6 * p && c.h <= 5.0 * p && c.w <= 0.9 * p);
    const fClef = near.find(c => c.h >= 2.0 * p && c.h < 3.95 * p && c.w >= 1.0 * p && c.miny - st.top < 0.6 * p && !cBar);
    let clef = gClef || cBar || fClef || null;
    if (gClef) st.clefType = 'treble';
    else if (cBar) { const line = Math.round(((cBar.miny + cBar.maxy) / 2 - st.top) / p); st.clefType = ['baritoneC', 'tenor', 'alto', 'mezzo', 'soprano'][line] || null; }
    else if (fClef) st.clefType = 'bass';
    else st.clefType = null;
    if (!clef) clef = comps.filter(c => c.h > 4 * p && c.h < 8 * p && c.w >= 0.25 * p).sort((a, b) => a.minx - b.minx)[0];
    // a C clef is a tall bar plus two curls that come out as separate shapes; they belong to the clef too
    // (otherwise the two curls look like the stacked numbers of a time signature)
    let clefRight = clef ? clef.maxx : 0;
    if (clef) for (const c of comps) if (c.minx < clef.minx + 2.7 * p && c.maxx < clef.minx + 3.2 * p && c.maxx > clefRight) clefRight = c.maxx;
    const zone = clef ? clefRight + 0.15 * p : st.left + 2.8 * p;
    st.clefRight = clef ? clefRight : null;
    // In some editions a flat comes apart into its stem and its round part (thin joins are dropped above):
    // put pieces that sit side by side and overlap in height back together into one sign.
    const signs = [];
    for (const c of comps.filter(c => c.minx >= zone - 0.2 * p).sort((a, b) => a.minx - b.minx)) {
      const g = signs.find(s => Math.min(s.maxx, c.maxx) - Math.max(s.minx, c.minx) >= -0.25 * p && Math.min(s.maxy, c.maxy) - Math.max(s.miny, c.miny) >= -0.1 * p &&
        Math.max(s.maxx, c.maxx) - Math.min(s.minx, c.minx) <= 1.05 * p && Math.max(s.maxy, c.maxy) - Math.min(s.miny, c.miny) <= 3.4 * p);
      if (g) { g.minx = Math.min(g.minx, c.minx); g.maxx = Math.max(g.maxx, c.maxx); g.miny = Math.min(g.miny, c.miny); g.maxy = Math.max(g.maxy, c.maxy); g.pix = g.pix.concat(c.pix); g.area += c.area; g.w = g.maxx - g.minx + 1; g.h = g.maxy - g.miny + 1; }
      else signs.push({ ...c, pix: c.pix.slice() });
    }
    const cands = signs.filter(c => c.minx >= zone && c.h >= 2.15 * p && c.h <= 3.4 * p && c.w >= 0.35 * p && c.w <= (opts.thickLedger ? 1.3 : 1.05) * p).sort((a, b) => a.minx - b.minx);
    let lastX = -1; const keyAccs = [];
    for (const c of cands) {
      if (lastX >= 0 && c.minx - lastX > 1.4 * p) break;                       // past the key signature
      const paired = comps.some(o => o !== c && Math.min(o.maxx, c.maxx) - Math.max(o.minx, c.minx) > 0.5 * c.w && (o.miny > c.maxy || o.maxy < c.miny) && Math.abs((o.miny > c.maxy ? o.miny - c.maxy : c.miny - o.maxy)) < 0.6 * p);
      if (paired) break;                                                        // time-signature digits
      // sharp: a stroke runs nearly the full height in the right third of the glyph. Flat: only the loop is there.
      const colH = new Uint16Array(c.w); for (const q of c.pix) colH[(q % W) - c.minx]++;
      let mx = 0; for (let k = Math.round(c.w * 0.65); k < c.w; k++) if (colH[k] > mx) mx = colH[k];
      // a sharp has an unbroken upright stroke on its right and a flat on its left; a rest at the start of the music has neither
      { const colS = new Map(); for (const q of c.pix) { const cx = (q % W) - c.minx; if (!colS.has(cx)) colS.set(cx, []); colS.get(cx).push((q - (q % W)) / W); }
        const longest = cx => { const ys = (colS.get(cx) || []).sort((a, b) => a - b); let best = 0, run = 0; for (let i = 0; i < ys.length; i++) { run = i && ys[i] === ys[i - 1] + 1 ? run + 1 : 1; if (run > best) best = run; } return best; };
        let rl = 0, rr = 0; for (let k = 0; k < c.w; k++) { const v = longest(k); if (k <= c.w * 0.4 && v > rl) rl = v; if (k >= c.w * 0.6 && v > rr) rr = v; }
        // (the top of a flat is its stem alone, at the left; the top of a rest is broad and further right)
        let topAll = 0, topLeft = 0; for (const q of c.pix) { const cx = (q % W) - c.minx, cy = (q - (q % W)) / W - c.miny; if (cy <= 0.3 * c.h) { topAll++; if (cx <= 0.42 * c.w) topLeft++; } }
        if (keyAccs.length >= 1 && (mx >= 0.72 * c.h ? 1 : -1) !== keyAccs[0].type && keyAccs.every(a => a.type === keyAccs[0].type) && rl < 0.8 * c.h) break;   // (sharps and flats are not mixed: a rest after the sharps)
        if (opts.thickLedger) {
          // A note with its stem can look like a sharp or a flat. A sharp has two long strokes, a note one. A flat's
          // round part is at its foot, a note with its stem down has its head at the top. And the signs of a key
          // signature stand close together, the first note stands apart.
          if (lastX >= 0 && c.minx - lastX > 0.8 * p) break;
          if (mx >= 0.72 * c.h) { if (rl < 0.5 * c.h || rr < 0.5 * c.h) break; }
          else { const rowW = new Map(); for (const q of c.pix) { const cy = (q - (q % W)) / W - c.miny; rowW.set(cy, (rowW.get(cy) || 0) + 1); }
            let up = 0, dn = 0; for (const [cy, n] of rowW) { if (cy < 0.45 * c.h) up += n; else if (cy > 0.55 * c.h) dn += n; }
            if (up > dn) break; }
        } }   // (sharps and flats are not mixed)
      keyAccs.push({ minx: c.minx, maxx: c.maxx, miny: c.miny, maxy: c.maxy, type: mx >= 0.72 * c.h ? 1 : -1 });
      lastX = c.maxx;
    }
    st.keyAccs = keyAccs;     // checked again once the notes are known: the first note's own sharp can sit here too
    const sharps = keyAccs.filter(a => a.type > 0).length, flats = keyAccs.length - sharps;
    st.key = sharps >= flats ? { type: 'sharp', n: sharps } : { type: 'flat', n: flats };
    {
      const afterKey = lastX >= 0 ? lastX : zone; let ms = afterKey;
      const cs = comps.filter(c => c.minx >= afterKey - 0.3 * p && c.minx < afterKey + 4.5 * p && c.h <= 2.8 * p && c.h >= 0.8 * p);
      let tsx = null;
      for (const a of cs) for (const b of cs) if (a !== b && a.miny < b.miny && Math.min(a.maxx, b.maxx) - Math.max(a.minx, b.minx) > 0.4 * Math.min(a.w, b.w) && b.miny - a.maxy < 0.8 * p) { ms = Math.max(ms, a.maxx, b.maxx); tsx = [Math.min(tsx ? tsx[0] : 1e9, a.minx, b.minx), Math.max(tsx ? tsx[1] : 0, a.maxx, b.maxx)]; }
      // in some fonts the two numbers touch and come out as one shape, exactly as tall as the staff
      if (!tsx && opts.thickLedger) { const one = comps.find(c => c.minx >= afterKey - 0.3 * p && c.minx < afterKey + 4.5 * p && c.h >= 3.5 * p && c.h <= 4.7 * p && c.w >= 1.3 * p && c.w <= 3.1 * p && Math.abs(c.miny - st.top) <= 0.45 * p && Math.abs(c.maxy - st.bot) <= 0.45 * p);
        if (one) { tsx = [one.minx, one.maxx]; ms = Math.max(ms, one.maxx); } }
      // ...or as a few overlapping pieces that together are exactly as tall as the staff
      if (!tsx && opts.thickLedger) {   // (only on a page with a piano part or chords)
        const near2 = comps.filter(c => c.minx >= afterKey - 0.3 * p && c.minx < afterKey + 4.5 * p && c.h >= 1.2 * p && c.h <= 4.4 * p && c.w >= 0.5 * p && c.miny >= st.top - 0.45 * p && c.maxy <= st.bot + 0.45 * p).sort((a, b) => a.minx - b.minx);
        if (near2.length >= 2) {
          const g = near2.filter(c => c.minx - near2[0].minx <= 2.5 * p);
          const x0 = Math.min(...g.map(c => c.minx)), x1 = Math.max(...g.map(c => c.maxx)), y0 = Math.min(...g.map(c => c.miny)), y1 = Math.max(...g.map(c => c.maxy));
          if (g.length >= 2 && g.length <= 6 && x1 - x0 + 1 >= 1.3 * p && x1 - x0 + 1 <= 3.5 * p && Math.abs(y0 - st.top) <= 0.45 * p && Math.abs(y1 - st.bot) <= 0.45 * p) { tsx = [x0, x1]; ms = Math.max(ms, x1); }
        }
      }
      st.tsBox = tsx;            // where the time signature's two numbers are, if there is one
      st.tsSym = null;
      if (!tsx) {
        // common time (C) or cut time (C with a stroke through it): one round sign on the middle line, open on its right
        const c1 = comps.find(c => c.minx >= afterKey - 0.3 * p && c.minx < afterKey + 4.5 * p && c.h >= 1.5 * p && c.h <= 3.4 * p &&
          c.w >= 0.8 * p && c.w <= 1.9 * p && Math.abs((c.miny + c.maxy) / 2 - (st.top + 2 * p)) <= 0.5 * p);
        if (c1) {
          // longest unbroken upright run in the left, middle and right of the sign: a C has a tall curved back on the
          // left and is open on the right; a cut C also has a stroke through the middle; a rest's zigzag has neither
          const g = new Uint8Array(c1.w * c1.h);
          for (const q of c1.pix) { const gx = q % W - c1.minx, gy = Math.floor(q / W) - c1.miny; if (gx >= 0 && gx < c1.w && gy >= 0 && gy < c1.h) g[gy * c1.w + gx] = 1; }
          const run = (a, b) => { let best = 0; for (let gx = Math.floor(a * c1.w); gx < Math.min(c1.w, Math.ceil(b * c1.w)); gx++) { let r = 0; for (let gy = 0; gy < c1.h; gy++) { if (g[gy * c1.w + gx]) { r++; if (r > best) best = r; } else r = 0; } } return best / c1.h; };
          const L = run(0, 0.3), R = run(0.75, 1);
          // a C is the same upside down (a rest's zigzag is not)
          let both = 0, either = 0;
          for (let gy = 0; gy < c1.h; gy++) for (let gx = 0; gx < c1.w; gx++) { const a = g[gy * c1.w + gx], b = g[(c1.h - 1 - gy) * c1.w + gx]; if (a && b) both++; if (a || b) either++; }
          const mirror = either ? both / either : 0;
          // (C and cut C give the same length of bar; it only counts as cut time when its stroke sticks out well past the C)
          if (L >= 0.6 && R <= 0.5 && mirror >= 0.55) { st.tsSym = c1.h >= 2.6 * p ? [2, 2] : [4, 4]; ms = Math.max(ms, c1.maxx); }
        }
      }
      if (!tsx && !st.tsSym && opts.thickLedger) {
        // a C in pieces (its thin ends are lost): together the pieces are a round sign on the middle line, the same
        // upside down, with a tall back on the left and open on the right
        const g = comps.filter(c => c.minx >= afterKey - 0.3 * p && c.minx < afterKey + 2.6 * p && c.miny >= st.top + 0.4 * p && c.maxy <= st.bot - 0.4 * p && c.h >= 0.5 * p).sort((a, b) => a.minx - b.minx);
        const g1 = g.length ? g.filter(c => c.minx - g[0].minx <= 1.6 * p) : [];
        if (g1.length >= 1 && g1.length <= 3 && g1[0].h >= 1.5 * p && g1[0].w <= 1.1 * p) {
          const x0 = g1[0].minx, x1 = Math.max(...g1.map(c => c.maxx)), y0 = Math.min(...g1.map(c => c.miny)), y1 = Math.max(...g1.map(c => c.maxy)), uw = x1 - x0 + 1, uh = y1 - y0 + 1;
          if (uw >= 0.8 * p && uw <= 1.9 * p && uh >= 1.6 * p && uh <= 2.7 * p && Math.abs((y0 + y1) / 2 - (st.top + 2 * p)) <= 0.45 * p) {
            const grid = new Uint8Array(uw * uh);
            for (const c of g1) for (const q of c.pix) { const gx = q % W - x0, gy = Math.floor(q / W) - y0; if (gx >= 0 && gx < uw && gy >= 0 && gy < uh) grid[gy * uw + gx] = 1; }
            let both = 0, either = 0, mid = 0, midN = 0;
            for (let gy = 0; gy < uh; gy++) for (let gx = 0; gx < uw; gx++) { const a = grid[gy * uw + gx], b = grid[(uh - 1 - gy) * uw + gx]; if (a && b) both++; if (a || b) either++; if (gx >= 0.6 * uw && gy >= 0.42 * uh && gy <= 0.58 * uh) { midN++; if (a) mid++; } }
            if (either && both / either >= 0.4 && midN && mid / midN <= 0.2) { st.tsSym = [4, 4]; ms = Math.max(ms, x1); }
          }
        }
      }
      st.musicStart = ms + 0.4 * p;
    }
    if (opts.debug) st.keyDebug = { all: comps.filter(c => c.minx < st.left + 9 * p && c.h > 0.8 * p).map(c => ({ x: c.minx - Math.round(st.left), y: +((c.miny - st.top) / p).toFixed(2), w: +(c.w / p).toFixed(2), h: +(c.h / p).toFixed(2) })), zone: Math.round(zone), clef: clef && { minx: clef.minx, maxx: clef.maxx, h: clef.h }, comps: comps.filter(c => c.minx >= zone - p && c.minx < zone + 8 * p).map(c => ({ x: c.minx, y: c.miny, w: +(c.w / p).toFixed(2), h: +(c.h / p).toFixed(2) })) };
  }

  // 5. search bands around each staff (merged when they overlap)
  const UPB = opts.thickLedger ? 5.2 : 3.2, DNB = opts.thickLedger ? 5.4 : 3.6, STEP_LO = opts.thickLedger ? -10 : -6, STEP_HI = opts.thickLedger ? 18 : 13;   // (piano music goes further above and below the staff)
  const bands = staves.map(st => [Math.max(0, Math.round(st.top - UPB * U)), Math.min(H - 1, Math.round(st.bot + DNB * U))]).sort((a, b) => a[0] - b[0]);
  const ranges = [];
  for (const b of bands) { if (ranges.length && b[0] <= ranges[ranges.length-1][1]) ranges[ranges.length-1][1] = Math.max(ranges[ranges.length-1][1], b[1]); else ranges.push([b[0], b[1]]); }

  // 6. fill small enclosed holes so hollow noteheads (minims, semibreves) become solid.
  //    The ring of a hollow note often has a tiny gap where it meets the stem, so the hole
  //    search runs on a slightly dilated copy that closes gaps of a pixel or two.
  const rad = Math.max(1, Math.round(LT / 2));
  const dil = new Uint8Array(N);
  for (const [ya, yb] of ranges) {
    for (let y = ya; y <= yb; y++) { const o = y*W; for (let x = 0; x < W; x++) { if (!clean[o + x]) continue;
      for (let dy = -rad; dy <= rad; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; const oo = yy*W; for (let dx = -rad; dx <= rad; dx++) { const xx = x + dx; if (xx >= 0 && xx < W) dil[oo + xx] = 1; } } } }
  }
  const filled = new Uint8Array(clean);
  const holes = new Uint8Array(N);
  const visited = new Uint8Array(N);
  const holeMaxArea = 1.2 * U * U, holeMaxH = 1.3 * U, holeMaxW = 2.2 * U;
  const stack = new Int32Array(N);
  for (const [ya, yb] of ranges) {
    for (let y = ya; y <= yb; y++) for (let x = 0; x < W; x++) {
      const idx = y*W + x;
      if (dil[idx] || visited[idx]) continue;
      let sp = 0; stack[sp++] = idx; visited[idx] = 1;
      let area = 0, edge = false, minx = x, maxx = x, miny = y, maxy = y;
      const pix = [];
      while (sp > 0) {
        const p = stack[--sp]; const px = p % W, py = (p - px) / W;
        area++;
        if (area <= holeMaxArea) pix.push(p);
        if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
        if (px === 0 || px === W - 1 || py === ya || py === yb) edge = true;
        if (px > 0) { const q = p - 1; if (!dil[q] && !visited[q]) { visited[q] = 1; stack[sp++] = q; } }
        if (px < W - 1) { const q = p + 1; if (!dil[q] && !visited[q]) { visited[q] = 1; stack[sp++] = q; } }
        if (py > ya) { const q = p - W; if (!dil[q] && !visited[q]) { visited[q] = 1; stack[sp++] = q; } }
        if (py < yb) { const q = p + W; if (!dil[q] && !visited[q]) { visited[q] = 1; stack[sp++] = q; } }
      }
      if (!edge && area <= holeMaxArea && (maxy - miny + 1) <= holeMaxH && (maxx - minx + 1) <= holeMaxW) for (const p of pix) holes[p] = 1;
    }
  }
  // paint the holes (grown back by the dilation radius) into the working image
  for (const [ya, yb] of ranges) {
    for (let y = ya; y <= yb; y++) { const o = y*W; for (let x = 0; x < W; x++) { if (!holes[o + x]) continue;
      for (let dy = -rad; dy <= rad; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; const oo = yy*W; for (let dx = -rad; dx <= rad; dx++) { const xx = x + dx; if (xx >= 0 && xx < W) filled[oo + xx] = 1; } } } }
  }

  // 6b. A hollow note that fills a whole space touches the lines above and below it, and erasing the lines
  //     can break its thin top and bottom so the hole leaks out. Look for holes again with the lines left in,
  //     and keep only round ones next to a line (the gap between two stems is square, not round).
  const lineNear = new Uint8Array(H);
  for (const st of staves) for (let li = 0; li < st.lines.length; li++) { const yc = Math.round(st.lines[li]), r2 = Math.ceil((st.lt[li] || LT) / 2) + 2; for (let y = yc - r2; y <= yc + r2; y++) if (y >= 0 && y < H) lineNear[y] = 1; }
  for (const ly of ledgerYs) for (let y = ly - LT - 2; y <= ly + LT + 2; y++) if (y >= 0 && y < H) lineNear[y] = 1;
  const visited2 = new Uint8Array(N);
  const wall = q => bin[q] || filled[q];
  for (const [ya, yb] of ranges) {
    for (let y = ya; y <= yb; y++) for (let x = 0; x < W; x++) {
      const idx = y*W + x;
      if (wall(idx) || visited2[idx]) continue;
      let sp = 0; stack[sp++] = idx; visited2[idx] = 1;
      let area = 0, edge = false, minx = x, maxx = x, miny = y, maxy = y;
      const pix = [], lim = 0.7 * U * U;
      while (sp > 0) {
        const p = stack[--sp]; const px = p % W, py = (p - px) / W;
        area++; if (area <= lim) pix.push(p);
        if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
        if (px === 0 || px === W - 1 || py === ya || py === yb) edge = true;
        if (px > 0) { const q = p - 1; if (!wall(q) && !visited2[q]) { visited2[q] = 1; stack[sp++] = q; } }
        if (px < W - 1) { const q = p + 1; if (!wall(q) && !visited2[q]) { visited2[q] = 1; stack[sp++] = q; } }
        if (py > ya) { const q = p - W; if (!wall(q) && !visited2[q]) { visited2[q] = 1; stack[sp++] = q; } }
        if (py < yb) { const q = p + W; if (!wall(q) && !visited2[q]) { visited2[q] = 1; stack[sp++] = q; } }
      }
      const w = maxx - minx + 1, h = maxy - miny + 1;
      if (edge || area > lim || w > (opts.thickLedger ? 1.4 : 1.1) * U || h > 1.05 * U || w < 0.25 * U || h < 0.3 * U) { if (opts.debug) (analyzeBitmap.d6 = analyzeBitmap.d6 || []).push([minx, miny, maxx - minx + 1, maxy - miny + 1, area, 'size']); continue; }
      if (!(miny > 0 && lineNear[miny - 1]) && !(maxy < H - 1 && lineNear[maxy + 1])) { if (opts.debug) (analyzeBitmap.d6 = analyzeBitmap.d6 || []).push([minx, miny, maxx - minx + 1, maxy - miny + 1, area, 'noline']); continue; }
      // round on BOTH sides: the gap between a sharp and its note is round only on the note's side
      const lx = new Int32Array(h).fill(1e9), rx = new Int32Array(h).fill(-1);
      for (const q of pix) { const k = Math.floor(q / W) - miny, qx = q % W; if (qx < lx[k]) lx[k] = qx; if (qx > rx[k]) rx[k] = qx; }
      let mk = 0; for (let k = 0; k < h; k++) if (rx[k] - lx[k] > rx[mk] - lx[mk]) mk = k;
      const k1 = Math.round(h * 0.15), k2 = Math.min(h - 1, Math.round(h * 0.85)), need = Math.max(1, 0.05 * U);
      // (a slanted oval curves in more at one end on each side, so add top and bottom together)
      const L1 = lx[k1] - lx[mk], L2 = lx[k2] - lx[mk], R1 = rx[mk] - rx[k1], R2 = rx[mk] - rx[k2];
      // (many fonts draw the hollow of a minim as a slanted slot: both its sides lean the same way, and it is narrower at its ends)
      const wMid = rx[mk] - lx[mk] + 1, slot = lx[k1] - lx[k2] >= 2 * need && rx[k1] - rx[k2] >= 2 * need && rx[k1] - lx[k1] + 1 <= 0.8 * wMid && rx[k2] - lx[k2] + 1 <= 0.8 * wMid;
      if (!slot && !(L1 + L2 >= 2 * need && R1 + R2 >= 2 * need)) { if (opts.debug) (analyzeBitmap.d6 = analyzeBitmap.d6 || []).push([minx, miny, maxx - minx + 1, maxy - miny + 1, area, 'round']); continue; }
      // and a notehead's hollow curves in about as much on one side as on the other (the gap beside a sharp has one straight side)
      if (!slot && Math.abs((L1 + L2) - (R1 + R2)) > Math.max(3, 0.35 * (L1 + L2 + R1 + R2))) { if (opts.debug) (analyzeBitmap.d6 = analyzeBitmap.d6 || []).push([minx, miny, maxx - minx + 1, maxy - miny + 1, area, 'even']); continue; }
      // and it narrows at its top and bottom, where the gap beside a sharp is cut off flat by the staff lines
      const wMax = rx[mk] - lx[mk] + 1;
      if (rx[0] - lx[0] + 1 > 0.6 * wMax || rx[h - 1] - lx[h - 1] + 1 > 0.6 * wMax) { if (opts.debug) (analyzeBitmap.d6 = analyzeBitmap.d6 || []).push([minx, miny, maxx - minx + 1, maxy - miny + 1, area, 'flat']); continue; }
      for (const q of pix) { holes[q] = 1; filled[q] = 1; }
    }
  }

  // 7. run lengths -> "core" pixels that are thick both ways (only noteheads are)
  const hRun = new Uint16Array(N), vRun = new Uint16Array(N);
  for (const [ya, yb] of ranges) {
    for (let y = ya; y <= yb; y++) { const o = y*W; let s = -1; for (let x = 0; x <= W; x++) { const v = x < W && filled[o + x]; if (v && s < 0) s = x; else if (!v && s >= 0) { const len = x - s; for (let k = s; k < x; k++) hRun[o + k] = len; s = -1; } } }
    for (let x = 0; x < W; x++) { let s = -1; for (let y = ya; y <= yb + 1; y++) { const v = y <= yb && filled[y*W + x]; if (v && s < 0) s = y; else if (!v && s >= 0) { const len = y - s; for (let k = s; k < y; k++) vRun[k*W + x] = len; s = -1; } } }
  }
  const minH = 0.5 * U, minV = 0.62 * U;
  const core = new Uint8Array(N);
  for (const [ya, yb] of ranges) for (let y = ya; y <= yb; y++) { const o = y*W; for (let x = 0; x < W; x++) { const k = o + x; if (filled[k] && hRun[k] >= minH && vRun[k] >= minV) core[k] = 1; } }

  // 8. connected components of the core
  const seen = new Uint8Array(N);
  const blobs = [];
  for (const [ya, yb] of ranges) {
    for (let y = ya; y <= yb; y++) for (let x = 0; x < W; x++) {
      const idx = y*W + x;
      if (!core[idx] || seen[idx]) continue;
      let sp = 0; stack[sp++] = idx; seen[idx] = 1;
      let area = 0, sx = 0, sy = 0, minx = x, maxx = x, miny = y, maxy = y;
      while (sp > 0) {
        const p = stack[--sp]; const px = p % W, py = (p - px) / W;
        area++; sx += px; sy += py;
        if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
        if (px > 0) { const q = p - 1; if (core[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; } }
        if (px < W - 1) { const q = p + 1; if (core[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; } }
        if (py > ya) { const q = p - W; if (core[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; } }
        if (py < yb) { const q = p + W; if (core[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; } }
      }
      blobs.push({ area, cx: sx / area, cy: sy / area, minx, maxx, miny, maxy });
    }
  }

  // helpers for validation
  const blackRatio = (y, xa, xb) => { if (y < 0 || y >= H) return 0; xa = Math.max(0, Math.round(xa)); xb = Math.min(W - 1, Math.round(xb)); if (xb < xa) return 0; let c = 0; const o = y*W; for (let x = xa; x <= xb; x++) c += bin[o + x]; return c / (xb - xa + 1); };
  // A ledger line is one continuous horizontal stroke, at least 1.5 spaces long and (even when
  // neighbouring ledgers merge) no longer than 8. Text, chord symbols and volta brackets fail this.
  const ledgerOk = (cx, ly, p) => {
    const tol = LT + 2, cxi = Math.round(cx);
    for (let y = Math.round(ly - tol); y <= Math.round(ly + tol); y++) {
      if (y < LT + 2 || y >= H - LT - 2) continue;
      const o = y*W;
      let l = cxi, gap = 0; while (l > 0) { if (bin[o + l - 1]) { gap = 0; l--; } else if (++gap <= 1) l--; else break; }
      let r = cxi; gap = 0; while (r < W - 1) { if (bin[o + r + 1]) { gap = 0; r++; } else if (++gap <= 1) r++; else break; }
      const len = r - l;
      if (!(len >= 1.5 * p && len <= 8 * p && l <= cx - 0.5 * p && r >= cx + 0.5 * p)) continue;
      // the ends of a ledger line are thin: nothing directly above or below them (letters have serifs and legs there)
      const e = Math.max(2, Math.round(0.25 * p)), d = LT + 1;
      const endsThin = (yy) => blackRatio(yy, l, l + e) < 0.35 && blackRatio(yy, r - e, r) < 0.35;
      if (endsThin(y - d) && endsThin(y + d)) return true;
      const rightThin = yy => blackRatio(yy, r - e, r) < 0.35;
      if (rightThin(y - d) && rightThin(y + d) && l >= cx - 2.2 * p && blackRatio(y - d, l, l + e) + blackRatio(y + d, l, l + e) >= 0.7) return true;   // (a flat or sharp stands on its left end)
    }
    return false;
  };
  // Fraction of a blob's columns that carry a vertical stroke just above (dir -1) or below (dir +1) it.
  // Ledger lines and neighbouring noteheads (rows that are black nearly all the way across) are ignored.
  const strokeCov = (b, dir, p) => {
    const x0 = b.minx, x1 = b.maxx, cols = x1 - x0 + 1;
    const ya = Math.round(dir < 0 ? b.miny - 0.9 * p : b.maxy + 0.25 * p), yb = Math.round(dir < 0 ? b.miny - 0.25 * p : b.maxy + 0.9 * p);
    const wa = Math.max(0, Math.round(x0 - 0.5 * p)), wb = Math.min(W - 1, Math.round(x1 + 0.5 * p));
    const hits = new Uint16Array(cols); let rows = 0;
    for (let y = ya; y <= yb; y++) {
      if (y < 0 || y >= H) continue;
      const o = y*W; let wide = 0; for (let x = wa; x <= wb; x++) wide += filled[o + x];
      if (wide > 0.8 * (wb - wa + 1)) continue;
      rows++; for (let x = x0; x <= x1; x++) if (filled[o + x]) hits[x - x0]++;
    }
    if (!rows) return 0;
    let c = 0; for (let k = 0; k < cols; k++) if (hits[k] >= 0.4 * rows) c++;
    return c / cols;
  };
  // A head in the middle of a chord has its stem running past it, above and below: one thin stroke at one edge of the
  // head, in the same place above as below. (A sharp has two strokes; a natural's go up on the left and down on the right.)
  const stemThrough = (b, p) => {
    const x0 = b.minx, x1 = b.maxx, cols = x1 - x0 + 1, sides = [];
    for (const dir of [-1, 1]) {
      const ya = Math.round(dir < 0 ? b.miny - 0.9 * p : b.maxy + 0.25 * p), yb = Math.round(dir < 0 ? b.miny - 0.25 * p : b.maxy + 0.9 * p);
      const wa = Math.max(0, Math.round(x0 - 0.5 * p)), wb = Math.min(W - 1, Math.round(x1 + 0.5 * p));
      const hits = new Uint16Array(cols); let rows = 0;
      for (let y = ya; y <= yb; y++) {
        if (y < 0 || y >= H) continue;
        const o = y*W; let wide = 0; for (let x = wa; x <= wb; x++) wide += filled[o + x];
        if (wide > 0.8 * (wb - wa + 1)) continue;
        rows++; for (let x = x0; x <= x1; x++) if (filled[o + x]) hits[x - x0]++;
      }
      // what stands on this side: the stem (one thin stroke at an edge of the head), or the next head of the chord
      // (one broad shape, with or without the stem beside it)
      const runs = []; let cur = null;
      for (let k = 0; k < cols; k++) { if (rows && hits[k] >= 0.4 * rows) { if (cur) cur.hi = k; else runs.push(cur = { lo: k, hi: k }); } else cur = null; }
      const thin = r => r.hi - r.lo + 1 <= Math.max(3, 0.26 * cols) && (r.hi <= 0.32 * cols || r.lo >= 0.68 * cols);
      const broad = runs.filter(r => r.hi - r.lo + 1 >= 0.4 * cols), rest = runs.filter(r => r.hi - r.lo + 1 < 0.4 * cols);
      // (a staccato dot stands alone under or over the middle of the head)
      const dot = runs.length === 1 && runs[0].hi - runs[0].lo + 1 <= 0.5 * cols && runs[0].lo >= 0.2 * cols && runs[0].hi <= 0.8 * cols;
      sides.push({ lo: runs.length ? runs[0].lo : -1, hi: runs.length ? runs[0].hi : -1, stem: runs.length === 1 && thin(runs[0]), head: broad.length === 1 && rest.length <= 1 && rest.every(thin), dot });
    }
    const [a, c] = sides;
    if (a.dot || c.dot) return (a.dot || a.head || a.stem) && (c.dot || c.head || c.stem);
    if (a.head || c.head) return (a.head || a.stem) && (c.head || c.stem);
    if (a.stem && c.stem && a.lo >= 0.68 * cols && c.hi <= 0.32 * cols) return true;       // two voices: stem up on the right, stem down on the left
    return a.stem && c.stem && Math.abs(a.lo - c.lo) <= 2 && Math.abs(a.hi - c.hi) <= 2;   // the same stroke above and below
  };
  // How much of a notehead-sized ellipse around (cx, cy) is black. Real noteheads fill it; rests,
  // accidentals, numbers and letters leave gaps.
  const ellipseFill = (cx, cy, p) => {
    const rx = 0.55 * p, ry = 0.42 * p; let n = 0, c = 0;
    for (let y = Math.round(cy - ry); y <= Math.round(cy + ry); y++) { if (y < 0 || y >= H) continue; const dy = (y - cy) / ry; const half = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
      for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) { if (x < 0 || x >= W) continue; n++; c += filled[y*W + x]; } }
    return n ? c / n : 0;
  };
  const darkFrac = (xa, xb, ya, yb) => { xa = Math.max(0, Math.round(xa)); xb = Math.min(W - 1, Math.round(xb)); ya = Math.max(0, Math.round(ya)); yb = Math.min(H - 1, Math.round(yb)); let c = 0, n = 0; for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { n++; c += filled[y*W + x]; } return n ? c / n : 0; };

  // 9. validate every blob as a notehead
  const notes = [];
  const rej = [];
  const R = (b, why, extra) => { if (opts.debug) rej.push({ why, x: Math.round(b.cx), y: Math.round(b.cy), w: b.maxx - b.minx + 1, h: b.maxy - b.miny + 1, area: b.area, ...extra }); };
  for (const b0 of blobs) {
    let b = b0, w = b.maxx - b.minx + 1, h = b.maxy - b.miny + 1;
    // which staff?
    let st = null, bd = 1e9;
    for (const s of staves) { if (b.cy < s.top - UPB * U || b.cy > s.bot + DNB * U) continue; const dd = Math.abs(b.cy - (s.top + s.bot) / 2); if (dd < bd) { bd = dd; st = s; } }
    if (!st) { R(b, 'nostaff'); continue; }
    const p = st.p;
    if (b.cx < st.left + 3.2 * p || b.cx > st.right + 0.5 * p) { R(b, 'clefzone'); continue; }
    // a breve: two thick bars between side strokes (or an oval between double bars), about two spaces wide and hollow inside
    // (its hole is wide and in the middle; a sharp or natural stuck to a note has a small hole off to the left)
    if (w > 1.5 * p && w <= 2.9 * p && h >= 1.0 * p && h <= 2.4 * p) {
      let hc = 0, hx = 0, hmin = 1e9, hmax = -1, cl = 0, cr = 0; const mx = (b.minx + b.maxx) / 2;
      for (let y = b.miny; y <= b.maxy; y++) for (let x = b.minx; x <= b.maxx; x++) { const q = y*W + x; if (holes[q]) { hc++; hx += x; if (x < hmin) hmin = x; if (x > hmax) hmax = x; } if (core[q]) { if (x < mx) cl++; else cr++; } }
      const raw = ((b.miny + b.maxy) / 2 - st.top) / (p / 2), step = Math.round(raw);
      const even = cl > 0 && cr > 0 && cl / cr >= 0.7 && cl / cr <= 1.43;          // a breve is the same on both sides
      let holeParts = 0;                                                           // ...and has one hollow middle
      { const seenH = new Set(); for (let y = b.miny; y <= b.maxy; y++) for (let x = b.minx; x <= b.maxx; x++) { const q0 = y*W + x; if (!holes[q0] || seenH.has(q0)) continue; holeParts++; const stk = [q0]; seenH.add(q0);
          while (stk.length) { const q = stk.pop(), qx = q % W, qy = (q - qx) / W; for (const n of [q - 1, q + 1, q - W, q + W]) { const nx = n % W, ny = (n - nx) / W; if (nx >= b.minx && nx <= b.maxx && ny >= b.miny && ny <= b.maxy && holes[n] && !seenH.has(n)) { seenH.add(n); stk.push(n); } } } } }
      // square breves are tall; round ones have upright strokes at both sides (a tied semibreve has neither)
      const yc0 = (b.miny + b.maxy) / 2;
      const side = (xa, xb) => { let rows = 0, n = 0; for (let y = Math.round(yc0 - 0.8 * p); y <= Math.round(yc0 + 0.8 * p); y++) { n++; for (let x = Math.max(0, xa); x <= Math.min(W - 1, xb); x++) if (filled[y*W + x]) { rows++; break; } } return n ? rows / n : 0; };
      const sw = Math.max(2, Math.round(0.15 * w));
      const shaped = h >= 1.3 * p || (side(b.minx - 3, b.minx + sw) >= 0.9 && side(b.maxx - sw, b.maxx + 3) >= 0.9);
      if (even && shaped && holeParts === 1 && hc >= 0.06 * w * h && hmax - hmin + 1 >= 0.45 * w && Math.abs(hx / hc - mx) <= 0.15 * w && Math.abs(raw - step) <= 0.8 && step >= -6 && step <= 13) {
        notes.push({ x: (b.minx + b.maxx) / 2, y: st.top + step * p / 2, step, p, stemUp: null, staff: staves.indexOf(st), area: b.area, w, breve: true });
        continue;
      }
    }
    // Two notes a step apart in a chord sit side by side, the lower one on the left and the upper one on the right,
    // and join into one wide shape: two heads, half a space apart in height.
    if (opts.thickLedger && w >= 1.7 * p && w <= 2.7 * p && h >= 1.15 * p && h <= 2.0 * p) {
      const xm = (b.minx + b.maxx) / 2; let nl = 0, nr = 0, lx = 0, ly = 0, rx = 0, ry = 0;
      for (let y = b.miny; y <= b.maxy; y++) for (let x = b.minx; x <= b.maxx; x++) if (core[y*W + x]) { if (x < xm) { nl++; lx += x; ly += y; } else { nr++; rx += x; ry += y; } }
      if (nl > 0.25 * p * p && nr > 0.25 * p * p && nl / nr > 0.6 && nl / nr < 1.7) {
        lx /= nl; ly /= nl; rx /= nr; ry /= nr;
        const sL = Math.round((ly - st.top) / (p / 2)), sR = Math.round((ry - st.top) / (p / 2));
        if (ly - ry >= 0.3 * p && ly - ry <= 0.75 * p && sL - sR === 1 && sR >= STEP_LO && sL <= STEP_HI && ellipseFill(lx, st.top + sL * p / 2, p) >= 0.75 && ellipseFill(rx, st.top + sR * p / 2, p) >= 0.75) {
          for (const [hx, stp, ar] of [[lx, sL, nl], [rx, sR, nr]]) notes.push({ x: hx, y: st.top + stp * p / 2, step: stp, p, stemUp: null, staff: staves.indexOf(st), area: ar, w: w / 2, pair: b.minx + ':' + b.miny });
          continue;
        }
      }
    }
    // an accidental printed hard against its note joins it into one blob: the note is the right-hand part
    if (w > 1.35 * p && w <= 2.9 * p && (w > 1.7 * p || (strokeCov(b, -1, p) >= 0.12 && strokeCov(b, 1, p) >= 0.12))) {
      const x0 = Math.round(b.maxx - 1.15 * p); let n = 0, sx = 0, sy = 0, miny = 1e9, maxy = -1;
      for (let y = b.miny; y <= b.maxy; y++) for (let x = x0; x <= b.maxx; x++) if (core[y*W + x]) { n++; sx += x; sy += y; if (y < miny) miny = y; if (y > maxy) maxy = y; }
      if (n > 0.2 * p * p) { b = { area: n, cx: sx / n, cy: sy / n, minx: x0, maxx: b.maxx, miny, maxy }; w = b.maxx - b.minx + 1; h = b.maxy - b.miny + 1; }
    }
    if (w < MIN_CORE_W * p || w > 2.1 * p) { R(b, 'width', { wU: +(w / p).toFixed(2) }); continue; }
    // sharps and naturals: vertical strokes continue both above and below the filled centre
    // (on a piano page a full-sized solid head stays even with marks above and below it: its stem on one side, a slur,
    //  an accent or a fingering number on the other. The filled middle of a sharp or natural is much narrower.)
    if (strokeCov(b, -1, p) >= 0.12 && strokeCov(b, 1, p) >= 0.12 && !stemThrough(b, p) && !(opts.thickLedger && w >= 1.0 * p && w <= 1.5 * p && h >= 0.75 * p && h <= 1.25 * p && ellipseFill(b.cx, b.cy, p) >= 0.9)) { R(b, 'strokes'); continue; }
    let heads = [];
    if (h >= 0.5 * p && h <= 1.5 * p) { if (b.area < 0.28 * p * p) { R(b, 'area'); continue; } heads.push({ x: b.cx, y: b.cy, tol: 0.3 }); }
    else if (h > 1.5 * p && h <= 3.5 * p && w <= 1.7 * p) { const n = Math.max(2, Math.round(h / p)); for (let k = 0; k < n; k++) heads.push({ x: b.cx, y: b.miny + (k + 0.5) * h / n, tol: 0.4 }); }
    else { R(b, 'height', { hU: +(h / p).toFixed(2) }); continue; }
    for (const hd of heads) {
      const raw = (hd.y - st.top) / (p / 2);
      const step = Math.round(raw);
      if (Math.abs(raw - step) > hd.tol * 2) { R(b, 'offgrid', { raw: +raw.toFixed(2) }); continue; }     // not sitting on a line or space
      if (step < STEP_LO || step > STEP_HI) { R(b, 'range', { step }); continue; }
      const sy = st.top + step * p / 2;
      // a beam is thick too, but it runs on sideways well past where a notehead would end
      const hrun = yy => { yy = Math.round(yy); const x0 = Math.round(hd.x); if (yy < 0 || yy >= H || !filled[yy*W + x0]) return 0; let l = x0, r = x0; while (l > 0 && filled[yy*W + l - 1]) l--; while (r < W - 1 && filled[yy*W + r + 1]) r++; return r - l + 1; };
      if (Math.max(hrun(hd.y - 0.3 * p), hrun(hd.y + 0.3 * p)) > 2.0 * p) {
        let thin = false;
        if (opts.thickLedger) {   // (how thick is whatever runs on sideways, a little way from the head?)
          const tk = xx => { xx = Math.round(xx); let best = 0; for (const yy of [Math.round(hd.y - 0.3 * p), Math.round(hd.y + 0.3 * p)]) { if (xx < 0 || xx >= W || !filled[yy * W + xx]) continue; let a2 = yy, b2 = yy; while (a2 > 0 && filled[(a2 - 1) * W + xx]) a2--; while (b2 < H - 1 && filled[(b2 + 1) * W + xx]) b2++; best = Math.max(best, b2 - a2 + 1); } return best; };
          const l = tk(hd.x - 1.25 * p), r2 = tk(hd.x + 1.25 * p); thin = Math.max(l, r2) > 0 && Math.max(l, r2) < 0.3 * p;
        }
        if (!thin) { R(b, 'beam'); continue; }
      }
      // ...and a short beam is thinner, top to bottom, than a notehead
      const vx = Math.round(hd.x); let va = Math.round(hd.y), vb = va;
      if (filled[va*W + vx]) { while (va > 0 && filled[(va - 1)*W + vx]) va--; while (vb < H - 1 && filled[(vb + 1)*W + vx]) vb++; }
      if (vb - va + 1 < 0.66 * p) { R(b, 'thin'); continue; }
      { const bx0 = b.minx + 1, bx1 = b.maxx - 1, by0 = b.miny + 1, by1 = b.maxy - 1;
        const corners = [[bx0, by0], [bx1, by0], [bx0, by1], [bx1, by1]].filter(([cx, cy]) => filled[cy * W + cx]).length;
        let hollowIn = 0; if (opts.thickLedger && corners >= 3) for (let yy = b.miny; yy <= b.maxy; yy++) for (let xx = b.minx; xx <= b.maxx; xx++) if (holes[yy * W + xx]) hollowIn++;
        if (corners >= 3 && b.maxy - b.miny + 1 <= 0.8 * p && hollowIn < 0.04 * w * h) { R(b, 'block'); continue; } }
      const ef = ellipseFill(hd.x, hd.y, p);
      if (ef < 0.82) { R(b, 'fill', { ef: +ef.toFixed(2), step }); continue; }      // not a solid oval: rest, accidental, text
      if (opts.ledger && (step <= -2 || step >= 10)) {
        const ls = step >= 10 ? (step % 2 === 0 ? step : step - 1) : (step % 2 === 0 ? step : step + 1);
        if (!ledgerOk(hd.x, st.top + ls * p / 2, p)) { R(b, 'ledger', { step }); continue; }
        if (opts.thickLedger && (ls >= 12 || ls <= -4)) {
          let all = true; for (let q = ls >= 12 ? 10 : -2; ls >= 12 ? q < ls : q > ls; q += ls >= 12 ? 2 : -2) if (!ledgerOk(hd.x, st.top + q * p / 2, p)) all = false;
          if (!all) { R(b, 'ledger', { step }); continue; }
        }
      }
      // stem direction: right side going up, or left side going down
      const up = darkFrac(hd.x + 0.35 * p, hd.x + 0.7 * p, sy - 2.2 * p, sy - 0.8 * p);
      const down = darkFrac(hd.x - 0.7 * p, hd.x - 0.35 * p, sy + 0.8 * p, sy + 2.2 * p);
      let stemUp = null; if (up > 0.3 && up >= down) stemUp = true; else if (down > 0.3) stemUp = false;
      notes.push({ x: hd.x, y: sy, step, p, stemUp, staff: staves.indexOf(st), area: b.area, w });
    }
  }
  // an accidental sits just left of its note, on the same step, and is narrower than the notehead
  // (a flat's round bowl can sit a step off its note, but then it has the flat's upright stroke rising on its left)
  const flatStroke = n => { const p = n.p; for (let x = Math.round(n.x - 0.75 * p); x <= Math.round(n.x - 0.15 * p); x++) { let run = 0, best = 0; for (let y = Math.round(n.y - 2.2 * p); y <= Math.round(n.y - 0.3 * p); y++) { if (x >= 0 && x < W && y >= 0 && y < H && filled[y*W + x]) { run++; if (run > best) best = run; } else run = 0; } if (best >= 1.0 * p) return true; } return false; };
  const accidental = n => notes.some(m => m !== n && m.staff === n.staff && m.x - n.x >= 0.55 * n.p && n.w < 0.9 * m.w &&
    ((m.step === n.step && m.x - n.x <= 1.8 * n.p) || (Math.abs(m.step - n.step) <= 1 && m.x - n.x <= 4.2 * n.p && flatStroke(n))));
  let real = notes.filter(n => !accidental(n));
  // the end of a short beam is thick enough to pass as a notehead, but it is much smaller than the real ones on the page
  const heads0 = real.filter(n => !n.breve);
  if (heads0.length >= 8) {
    const medW = median(heads0.map(n => n.w)), medA = median(heads0.map(n => n.area));
    real = real.filter(n => n.breve || !(n.w < 0.72 * medW && n.area < 0.5 * medA));
  }
  // dedupe
  real.sort((a, b) => b.area - a.area);
  const kept = [];
  for (const n of real) { if (!kept.some(k => Math.hypot(k.x - n.x, k.y - n.y) < 0.5 * n.p)) kept.push(n); }
  kept.sort((a, b) => a.staff - b.staff || a.x - b.x);
  const out = { W, H, LT, U, staves, notes: kept, bin, clean, filled, holes };
  if (opts.debug) Object.assign(out, { core, blobs, rej, accidentals: notes.filter(n => accidental(n)) });
  return out;
}
function median(a){ const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2; }

/* ================================================================
   Rhythm, rests, bar lines and accidentals, built on analyzeBitmap
   ================================================================ */
const OMR_TOPDIA = { alto: 32, tenor: 30, treble: 38, treble8: 31, bass: 26, soprano: 36, mezzo: 34, baritoneC: 28 };   // diatonic index of the top staff line
const OMR_LET = 'CDEFGAB', OMR_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const OMR_SHARPS = 'FCGDAEB', OMR_FLATS = 'BEADGCF';

function omrReadPage(imgData, again) {
  // (a page with a piano part or chords is read a second time, allowing for ledger lines thicker than the staff lines)
  const res = analyzeBitmap(imgData, { strict: 'normal', ledger: true, thickLedger: !!again });
  const { W, H, LT, U, staves, clean, filled, holes, bin } = res;
  const out = { W, H, U, staves: [] };
  if (!staves.length) return out;
  const dark = (x, y) => x >= 0 && x < W && y >= 0 && y < H && filled[y * W + x] === 1;
  const discFill = (cx, cy, r) => { let n = 0, c = 0; for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) { const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= r * r) { n++; if (dark(x, y)) c++; } } return n ? c / n : 0; };
  const ringFill = (cx, cy, r1, r2) => { let n = 0, c = 0; for (let y = Math.floor(cy - r2); y <= Math.ceil(cy + r2); y++) for (let x = Math.floor(cx - r2); x <= Math.ceil(cx + r2); x++) { const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy; if (d2 >= r1 * r1 && d2 <= r2 * r2) { n++; if (dark(x, y)) c++; } } return n ? c / n : 0; };
  // a dot is small and round: nothing dark straight above, below or beside it (a short upright mark fails)
  const hasDot = (x, y, p) => { for (let dx = 0.8; dx <= 1.75; dx += 0.1) { const cx = x + dx * p, r = 0.34 * p; if (discFill(cx, y, 0.16 * p) >= 0.8 && ringFill(cx, y, 0.3 * p, 0.46 * p) <= 0.22 && !dark(Math.round(cx), Math.round(y - r)) && !dark(Math.round(cx), Math.round(y + r)) && !dark(Math.round(cx - r), Math.round(y)) && !dark(Math.round(cx + r), Math.round(y))) return true; } return false; };
  const runLen = (x, y0, dir, max) => { let len = 0, last = 0, gap = 0, y = y0; while (len < max) { y += dir; len++; if (y < 0 || y >= H) break; if (filled[y * W + x]) { last = len; gap = 0; } else if (++gap > Math.max(2, LT)) break; } return last; };
  const runsBack = (x0, y0, sx, tipY, p) => { let y = y0; const tx = Math.round(sx), dx = tx > x0 ? 1 : -1;
    for (let xx = x0; xx !== tx; xx += dx) { if (clean[y * W + xx]) continue; let moved = false; for (const d of [-1, 1, -2, 2]) if (clean[(y + d) * W + xx]) { y += d; moved = true; break; } if (!moved) return false; }
    return Math.abs(y - tipY) <= 0.6 * p; };
  const bandCount = (x, ya, yb, p, sx, thickOnly, tipY) => { const a = Math.round(Math.min(ya, yb)), b = Math.round(Math.max(ya, yb)), xi = Math.round(x); let runs = 0, run = 0; const lo = thickOnly ? 0.3 * p : Math.max(2, 0.16 * p), hi = 0.9 * p;
    // (sx: the stem's place. Then a band only counts if it runs unbroken from there to x.)
    const joined = ym => { if (sx == null) return true; let gap = 0; for (let xx = Math.min(xi, Math.round(sx)); xx <= Math.max(xi, Math.round(sx)); xx++) { if (xx >= 0 && xx < W && clean[ym * W + xx]) gap = 0; else if (++gap > 2) return false; } return true; };
    const anyJoined = (y0, y1) => { for (let y = y0; y <= y1; y += 2) if (joined(y)) return true; return joined(y1); };   // (a flag leaves the stem as it curls down)
    for (let y = a; y <= b + 1; y++) { if (y <= b && xi >= 0 && xi < W && y >= 0 && y < H && clean[y * W + xi]) run++; else { if (run >= lo && run <= hi && anyJoined(y - run, y - 1)) {
        // past the stem's end only a thick beam that runs back to the stem's end counts (not words, not another voice's beam)
        const ym = Math.round(y - 1 - run / 2), beyond = tipY != null && (ym - tipY) * (ya - tipY) > 0;
        if (!beyond || (run >= 0.3 * p && runsBack(xi, ym, sx, tipY, p))) runs++;
      } run = 0; } } return runs; };   // (past the stem's end only a thick beam counts, not words)
  const med3 = a => a.sort((x, y) => x - y)[1];

  // ---------- accidentals (sharp, flat, natural) as separate shapes left of noteheads ----------
  const stackA = new Int32Array(W * H > 0 ? Math.min(W * H, 4000000) : 1);
  const accidentalsFor = (st, si, notes) => {
    const p = st.p;
    const ya = Math.max(0, Math.round(st.top - 2.8 * p)), yb = Math.min(H - 1, Math.round(st.bot + 2.8 * p));
    const xa = Math.max(0, Math.round(st.musicStart)), xb = Math.min(W - 1, Math.round(st.right));
    const bw = xb - xa + 1, bh = yb - ya + 1; if (bw <= 0 || bh <= 0) return [];
    const k = new Uint8Array(bw * bh);
    for (let x = xa; x <= xb; x++) { let s = -1; for (let y = ya; y <= yb + 1; y++) { const v = y <= yb && filled[y * W + x]; if (v && s < 0) s = y; else if (!v && s >= 0) { if (y - s > LT + 1) for (let q = s; q < y; q++) k[(q - ya) * bw + (x - xa)] = 1; s = -1; } } }
    const seen = new Uint8Array(bw * bh), comps = [];
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i0 = y * bw + x; if (!k[i0] || seen[i0]) continue;
      let sp = 0; stackA[sp++] = i0; seen[i0] = 1; let minx = x, maxx = x, miny = y, maxy = y, area = 0; const pix = [];
      while (sp > 0) { const q = stackA[--sp]; const px = q % bw, py = (q - px) / bw; area++; if (area < 6000) pix.push(q);
        if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
        if (px > 0 && k[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stackA[sp++] = q - 1; }
        if (px < bw - 1 && k[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stackA[sp++] = q + 1; }
        if (py > 0 && k[q - bw] && !seen[q - bw]) { seen[q - bw] = 1; stackA[sp++] = q - bw; }
        if (py < bh - 1 && k[q + bw] && !seen[q + bw]) { seen[q + bw] = 1; stackA[sp++] = q + bw; } }
      comps.push({ minx: minx + xa, maxx: maxx + xa, miny: miny + ya, maxy: maxy + ya, w: maxx - minx + 1, h: maxy - miny + 1, area, pix, bw, ya, xa });
    }
    const found = [];
    for (const c of comps) {
      if (c.h < 1.9 * p || c.h > 3.7 * p || c.w < 0.3 * p || c.w > 1.35 * p) continue;
      if (notes.some(n => n.x >= c.minx - 0.25 * p && n.x <= c.maxx + 0.25 * p && n.y >= c.miny - 0.25 * p && n.y <= c.maxy + 0.25 * p)) continue;
      // the longest unbroken upright run in each column: accidentals are made of straight upright strokes,
      // while a crotchet rest's zigzag only crosses a column in short pieces
      const grid = new Uint8Array(c.w * c.h);
      for (const q of c.pix) { const gx = (q % c.bw) + c.xa - c.minx, gy = Math.floor(q / c.bw) + c.ya - c.miny; if (gx >= 0 && gx < c.w && gy >= 0 && gy < c.h) grid[gy * c.w + gx] = 1; }
      const col = new Uint16Array(c.w);
      for (let gx = 0; gx < c.w; gx++) { let run = 0, best = 0; for (let gy = 0; gy < c.h; gy++) { if (grid[gy * c.w + gx]) { run++; if (run > best) best = run; } else run = 0; } col[gx] = best; }
      const third = Math.max(1, Math.round(c.w * 0.38));
      let lm = 0, rm = 0; for (let a = 0; a < third; a++) lm = Math.max(lm, col[a]); for (let a = c.w - third; a < c.w; a++) rm = Math.max(rm, col[a]);
      const lr = lm / c.h, rr = rm / c.h;
      let type = null;
      if (lr >= 0.78 && rr < 0.64) type = -1;                          // flat: tall stem on the left, small loop on the right
      else if (lr >= 0.8 && rr >= 0.8) type = 1;                       // sharp: two tall strokes
      else if (lr >= 0.5 && rr >= 0.5 && c.w >= 0.45 * p) type = 0;    // natural
      if (type === null) continue;
      found.push({ minx: c.minx, maxx: c.maxx, miny: c.miny, maxy: c.maxy, type, staff: si });
    }
    return found;
  };

  // An accidental touching its note is not a shape of its own, so read the strokes in a window just left of the head.
  // Sharp: two tall strokes side by side. Natural: two strokes, the right one lower. Flat: one stroke with a bowl at its foot.
  const accLeft = (n, p) => {
    const xr = Math.round(n.x - Math.max(0.55 * p, (n.w || p) / 2) - 1), xl = Math.round(n.x - 2.1 * p);
    const ya = Math.round(n.y - 2.6 * p), yb = Math.round(n.y + 2.2 * p);
    const strokes = []; let cur = null;
    for (let x = xl; x <= xr; x++) {
      let best = 0, bs = 0, run = 0, rs = 0;
      for (let y = ya; y <= yb + 1; y++) { const v = y <= yb && x >= 0 && x < W && y >= 0 && y < H && clean[y * W + x]; if (v) { if (!run) rs = y; run++; } else { if (run > best) { best = run; bs = rs; } run = 0; } }
      if (best >= 1.3 * p) {
        const top = bs, bot = bs + best - 1;
        if (cur && x - cur.x1 <= 1 && Math.abs(top - cur.top) < 0.3 * p) { cur.x1 = x; cur.top = Math.min(cur.top, top); cur.bot = Math.max(cur.bot, bot); }
        else { cur = { x0: x, x1: x, top, bot }; strokes.push(cur); }
      } else cur = null;
    }
    const ok = strokes.filter(s => s.bot - s.top <= 3.1 * p && s.top > ya && s.bot < yb && s.x1 - s.x0 <= 0.3 * p);
    if (!ok.length) return null;
    const r = ok[ok.length - 1];
    if (r.x1 < n.x - 1.7 * p) return null;
    const l = ok.length > 1 ? ok[ok.length - 2] : null;
    const box = t => ({ type: t, minx: (l && t !== -1 ? l.x0 : r.x0), maxx: r.x1 + 2, miny: Math.min(r.top, l ? l.top : r.top), maxy: Math.max(r.bot, l ? l.bot : r.bot) });
    if (l && r.x0 - l.x1 <= 0.8 * p && r.x0 - l.x1 >= 0.12 * p) {
      const dTop = r.top - l.top, dBot = r.bot - l.bot, mid = (l.top + r.bot) / 2;
      if (Math.abs(mid - n.y) > 0.9 * p) return null;
      if (dTop >= 0.35 * p && dBot >= 0.35 * p) return box(0);
      if (Math.abs(dTop) <= 0.5 * p && Math.abs(dBot) <= 0.5 * p) return box(1);
    }
    // flat: the stroke ends near the note, with a bowl to its right at the bottom
    if (r.bot >= n.y - 0.3 * p && r.bot <= n.y + 0.9 * p && r.top <= n.y - 1.2 * p) {
      let c = 0, t = 0;
      for (let y = Math.round(r.bot - 0.9 * p); y <= r.bot; y++) for (let x = r.x1 + 2; x <= Math.round(r.x1 + 0.7 * p) && x < xr; x++) { t++; if (clean[y * W + x]) c++; }
      if (t && c / t >= 0.18) return box(-1);
    }
    return null;
  };

  // ---------- systems: staves joined at the left by a bracket or line are the parts of one score, played together ----------
  const SV = res.staves, sysOf = SV.map((_, i) => i);
  {
    const joined = (a, b) => {
      const ya = Math.round(a.bot) + 2, yb = Math.round(b.top) - 2, p = a.p;
      if (yb <= ya) return false;
      for (let x = Math.max(0, Math.round(Math.min(a.left, b.left) - 1.5 * p)); x <= Math.min(W - 1, Math.round(Math.max(a.left, b.left) + 0.3 * p)); x++) {
        let n = 0; for (let y = ya; y <= yb; y++) if (bin[y * W + x]) n++;
        if (n >= 0.95 * (yb - ya + 1)) return true;
      }
      return false;
    };
    let sys = 0; sysOf[0] = 0;
    for (let i = 1; i < SV.length; i++) { if (!joined(SV[i - 1], SV[i])) sys++; sysOf[i] = sys; }
    // nothing joins them, but the clefs come round in a repeating pattern (treble, alto, bass, treble, ...): group by it
    const cl = SV.map(s => s.clefType || '?');
    if (sys === SV.length - 1 && SV.length >= 4 && new Set(cl).size > 1) {
      for (let k = 2; k <= 6; k++) if (SV.length % k === 0 && SV.length >= 2 * k && !cl.slice(0, k).every(c => c === cl[0]) && cl.every((c, i) => c === cl[i % k])) { SV.forEach((_, i) => sysOf[i] = Math.floor(i / k)); break; }
    }
  }
  const posOf = SV.map((_, i) => { let k = 0; for (let j = i - 1; j >= 0 && sysOf[j] === sysOf[i]; j--) k++; return k; });
  const sizeOf = SV.map((_, i) => sysOf.filter(s => s === sysOf[i]).length);

  // ---------- per staff ----------
  res.staves.forEach((st, si) => {
    const p = st.p, nextS0 = si + 1 < SV.length ? SV[si + 1] : null;
    if (st.musicStart == null) st.musicStart = st.left + 4 * p;
    // A sharp or flat right up against a note is that note's own accidental, not part of the key signature
    // (it happens when a line starts with an altered note and there is no key signature).
    const accs = (st.keyAccs || []).slice(); let dropped = null;
    const onStaff = res.notes.filter(n => n.staff === si && n.x > st.musicStart - 0.2 * p);
    while (accs.length) {
      const c = accs[accs.length - 1];
      const own = onStaff.some(n => { const gap = n.x - (n.w || p) / 2 - c.maxx; return gap >= -0.3 * p && gap <= 0.9 * p && n.y >= c.miny - 0.3 * p && n.y <= c.maxy + 0.3 * p; });
      if (!own) break;
      dropped = accs.pop();
    }
    if (dropped) st.musicStart = Math.min(st.musicStart, dropped.minx - 0.2 * p);
    const nSharp = accs.filter(a => a.type > 0).length;
    const fifths = accs.length ? (nSharp >= accs.length - nSharp ? 1 : -1) * accs.length : 0;
    // nothing before the music starts: the flats of a key signature have round bowls like little notes
    const mine = res.notes.filter(n => n.staff === si && n.x > st.musicStart - 0.2 * p);
    // a square breve on a ledger line: the line splits its middle, so look for its two thick bars directly
    {
      const ya = Math.max(0, Math.round(st.top - 4 * p)), yb = Math.min(H - 1, Math.round(st.bot + 4 * p));
      let run = null; const found = [];
      const flush = () => { if (run && run.x1 - run.x0 + 1 >= 0.9 * p && run.x1 - run.x0 + 1 <= 1.9 * p) found.push(run); run = null; };
      for (let x = Math.round(st.musicStart); x <= Math.min(W - 1, Math.round(st.right)); x++) {
        const runs = []; let s = -1;
        for (let y = ya; y <= yb + 1; y++) { const v = y <= yb && clean[y * W + x]; if (v && s < 0) s = y; else if (!v && s >= 0) { runs.push([s, y - 1]); s = -1; } }
        let hit = null;
        for (let i = 0; i < runs.length && !hit; i++) {
          const a = runs[i], ta = a[1] - a[0] + 1; if (ta < 0.3 * p || ta > 0.7 * p) continue;
          for (let j = i + 1; j < runs.length; j++) {
            const b = runs[j], tb = b[1] - b[0] + 1, gap = ((b[0] + b[1]) - (a[0] + a[1])) / 2;
            if (gap > 1.5 * p) break;
            if (tb < 0.3 * p || tb > 0.7 * p) { if (tb > LT + 2) break; continue; }      // only a thin ledger line may sit between the bars
            if (gap >= 0.85 * p) hit = [a[0], b[1]];
            break;
          }
        }
        if (hit && run && Math.abs(hit[0] - run.top) <= 2 && Math.abs(hit[1] - run.bot) <= 2) run.x1 = x;
        else { flush(); if (hit) run = { x0: x, x1: x, top: hit[0], bot: hit[1] }; }
      }
      flush();
      for (const r of found) {
        const cx = (r.x0 + r.x1) / 2, raw = ((r.top + r.bot) / 2 - st.top) / (p / 2), step = Math.round(raw);
        if (Math.abs(raw - step) > 0.6 || mine.some(n => Math.abs(n.x - cx) < 1.0 * p)) continue;
        mine.push({ x: cx, y: st.top + step * p / 2, step, p, stemUp: null, staff: si, w: r.x1 - r.x0 + 1, breve: true });
      }
    }
    mine.sort((a, b) => a.x - b.x);
    const acc = accidentalsFor(st, si, mine);
    // chords: keep the top note of each stack
    const heads = [];
    for (const n of mine) { const last = heads[heads.length - 1]; if (last && Math.abs(last.x - n.x) < 0.65 * p) { if (n.step < last.step) heads[heads.length - 1] = n; } else heads.push(n); }
    const elems = [];
    for (const n of heads) {
      // hollow or solid
      const rx = 0.55 * p, ry = 0.4 * p; let hc = 0;
      for (let y = Math.round(n.y - ry); y <= Math.round(n.y + ry); y++) for (let x = Math.round(n.x - rx); x <= Math.round(n.x + rx); x++) { const dx = (x - n.x) / rx, dy = (y - n.y) / ry; if (dx * dx + dy * dy <= 1 && x >= 0 && x < W && y >= 0 && y < H && holes[y * W + x]) hc++; }
      const hollow = hc >= 0.05 * Math.PI * rx * ry;
      // stem: tallest vertical run beside the head
      let best = { len: 0, x: n.x, dir: -1 };
      for (const dir of [-1, 1]) {
        const xs = dir < 0 ? [n.x + 0.28 * p, n.x + 0.82 * p] : [n.x - 0.82 * p, n.x - 0.28 * p];
        for (let x = Math.round(xs[0]); x <= Math.round(xs[1]); x++) { const len = runLen(x, Math.round(n.y), dir, 6 * p); if (len > best.len) best = { len, x, dir }; }
      }
      const stemLen = best.len - 0.4 * p, hasStem = !n.breve && stemLen >= 1.6 * p;
      let bands = 0;
      if (hasStem && !hollow) {
        const tip = n.y + best.dir * best.len, to = tip - best.dir * 1.7 * p;
        // beams reach out on either side of the stem; a flag hangs just to the right of it
        // (near the stem as well: a short double beam between two close notes ends before 0.9 spaces out)
        const beam = [1, -1].map(sg => Math.max(med3([0.35, 0.55, 0.75].map(dx => bandCount(best.x + sg * dx * p, tip, to, p))), med3([0.9, 1.25, 1.6].map(dx => bandCount(best.x + sg * dx * p, tip, to, p)))));
        const flag = med3([0.4, 0.6, 0.8].map(dx => bandCount(best.x + dx * p, tip, to, p)));
        bands = Math.max(beam[0], beam[1], flag);
      }
      let d = n.breve ? 128 : !hasStem ? (hollow ? 64 : 16) : hollow ? 32 : bands >= 2 ? 4 : bands === 1 ? 8 : 16;
      const half = n.breve ? n.w / 2 - 0.4 * p : 0;          // a breve is wider, so its dot sits further right
      const sy = n.y, dotY = (n.step % 2 === 0) ? sy - p / 2 : sy;
      const dotted = hasDot(n.x + half, dotY, p);
      if (dotted) d = d * 3 / 2;
      // accidental sitting just left
      let a = null, bd = 1e9;
      for (const c of acc) { if (c.maxx < n.x - 0.3 * p && n.x - c.maxx < 1.7 * p && n.y >= c.miny - 0.3 * p && n.y <= c.maxy + 0.3 * p) { const dd = n.x - c.maxx; if (dd < bd) { bd = dd; a = c; } } }
      if (!a && !n.breve) a = accLeft(n, p);
      elems.push({ kind: 'note', x: n.x, y: n.y, step: n.step, d, hollow, dotted, bands, hasStem, half: n.breve ? n.w / 2 : 0.6 * p, accOff: a ? a.type : null, accBox: a });
    }

    // ---------- every head, for music in chords and in two voices (piano staves, choir staves) ----------
    // The notes above keep one head per place, which is right for a single line of music. Here every head is kept:
    // heads on one stem make a chord, and a place with a stem going up and another going down holds two voices.
    const pe = [];
    {
      const hollowOf = n => { const rx = 0.55 * p, ry = 0.4 * p; let hc = 0;
        for (let y = Math.round(n.y - ry); y <= Math.round(n.y + ry); y++) for (let x = Math.round(n.x - rx); x <= Math.round(n.x + rx); x++) { const dx = (x - n.x) / rx, dy = (y - n.y) / ry; if (dx * dx + dy * dy <= 1 && x >= 0 && x < W && y >= 0 && y < H && holes[y * W + x]) hc++; }
        return hc >= 0.05 * Math.PI * rx * ry; };
      const info = mine.map(n => ({ n, hollow: hollowOf(n), dot: hasDot(n.x + (n.breve ? n.w / 2 - 0.4 * p : 0), (n.step % 2 === 0) ? n.y - p / 2 : n.y, p), acc: null }));
      // each sharp, flat or natural belongs to the nearest head to its right at its own height (in a chord they stand in a column)
      for (const c of acc) {
        const ty = c.type === -1 ? c.maxy - 0.5 * p : (c.miny + c.maxy) / 2; let bestH = null;
        for (const h of info) { if (h.n.x <= c.maxx || h.n.x - c.maxx > 4 * p || Math.abs(h.n.y - ty) > 0.42 * p) continue; if (!bestH || h.n.x < bestH.n.x) bestH = h; }
        if (bestH && !bestH.acc) bestH.acc = c;
      }
      const cols = [];
      for (const h of info) {
        const c = cols[cols.length - 1];
        // (two notes a step apart on ONE stem: the upper one right of the lower one, no stem on the outer side of either)
        const sideStem = (n, side) => { for (let x = Math.round(n.x + side * 0.45 * p); x !== Math.round(n.x + side * 0.85 * p); x += side) if (runLen(x, Math.round(n.y), -1, 4 * p) >= 2 * p || runLen(x, Math.round(n.y), 1, 4 * p) >= 2 * p) return true; return false; };
        if (c && c.some(m => Math.abs(h.n.x - m.n.x) < 0.7 * p || (Math.abs(h.n.x - m.n.x) < 1.4 * p && Math.abs(h.n.step - m.n.step) === 1) || (h.n.pair && m.n.pair === h.n.pair) ||
          (again && h.n.x - m.n.x < 1.75 * p && h.n.x > m.n.x && h.n.step === m.n.step - 1 && !sideStem(m.n, -1) && !sideStem(h.n, 1)))) c.push(h); else cols.push([h]);
      }
      // (a note set to one side of its chord can come before the chord's other notes: join neighbouring groups that
      //  hold two notes a step apart, close enough to share a stem)
      for (let i = cols.length - 1; i > 0; i--) {
        const A = cols[i - 1], B = cols[i];
        if (A.some(m => B.some(h => Math.abs(h.n.x - m.n.x) < 1.4 * p && Math.abs(h.n.step - m.n.step) === 1)) && Math.max(...B.map(h => h.n.x)) - Math.min(...A.map(h => h.n.x)) < 1.5 * p) { cols[i - 1] = A.concat(B); cols.splice(i, 1); }
      }
      // (the curl of a flag is thick enough to pass for a small head on the stem: in a group, a shape much smaller than
      //  the group's real head, further along the stem, is dropped)
      if (false) for (let i = 0; i < cols.length; i++) {
        const c = cols[i]; if (c.length < 2) continue;
        // (a flag's curl encloses a little space and so looks like a hollow head: a group never mixes solid and hollow
        //  heads on one stem, so the kind of its biggest head decides)
        if (c.every(h => h.hollow) || c.every(h => !h.hollow)) continue;
        const big = c.reduce((a, h) => (h.n.area || 0) > (a.n.area || 0) ? h : a, c[0]);
        if (big.hollow) continue;   // (only a hollow shape smaller than the group's solid head is a flag's curl; a minim beside a crotchet stays)
        const keep = c.filter(h => !h.hollow || h.n.pair || (h.n.area || 0) >= 0.8 * (big.n.area || 1));
        if (keep.length && keep.length < c.length) cols[i] = keep;
      }
      const stemFrom = (hs, dir) => {
        const o = dir < 0 ? hs[0] : hs[hs.length - 1]; let best = { len: 0, x: Math.round(o.n.x), dir };
        const xa = Math.round(Math.min(...hs.map(h => h.n.x)) - 0.85 * p), xb = Math.round(Math.max(...hs.map(h => h.n.x)) + 0.85 * p);
        // (a stem touches its head: a sharp, flat or natural beside the head has upright strokes too, but stands apart)
        const yo = Math.round(o.n.y), touches = x => { let gap = 0; const x2 = Math.round(o.n.x); for (let xx = Math.min(x, x2); xx <= Math.max(x, x2); xx++) { if (filled[yo * W + xx] || filled[(yo - 2) * W + xx] || filled[(yo + 2) * W + xx]) gap = 0; else if (++gap > 2) return false; } return true; };
        for (let x = xa; x <= xb; x++) { const len = runLen(x, yo, dir, (again ? 9 : 7) * p); if (len > best.len && (!again || touches(x))) best = { len, x, dir }; }   // (stems to a far beam are long in piano music)
        best.has = best.len - 0.4 * p >= 1.6 * p; return best;
      };
      const make = (hs, s) => {
        const has = !!(s && s.has), breve = hs.some(h => h.n.breve), hollow = hs.filter(h => h.hollow).length * 2 > hs.length;
        let bands = 0;
        if (has && !hollow && !breve) {
          const o = s.dir < 0 ? hs[0] : hs[hs.length - 1], tip = o.n.y + s.dir * s.len, to = tip - s.dir * Math.min(2.5 * p, Math.max(1.7 * p, s.len - 1.0 * p));
          // (a slanted beam lies a little past the stem's end on one side of the stem)
          const tipX = again ? tip + s.dir * 0.9 * p : tip;
          const beam = [1, -1].map(sg => Math.max(med3([0.35, 0.55, 0.75].map(dx => bandCount(s.x + sg * dx * p, tipX, to, p, s.x, sg < 0, tip))), med3([0.9, 1.25, 1.6].map(dx => bandCount(s.x + sg * dx * p, tipX, to, p, s.x, true, tip)))));
          const flag = med3([0.4, 0.6, 0.8].map(dx => bandCount(s.x + dx * p, tip, to, p, s.x)));
          bands = Math.max(beam[0], beam[1], flag);
        }
        let d = breve ? 128 : !has ? (hollow ? 64 : 16) : hollow ? 32 : bands >= 3 ? 2 : bands === 2 ? 4 : bands === 1 ? 8 : 16;
        const dotted = hs.some(h => h.dot); if (dotted) d = d * 3 / 2;
        // single heads touching their sharp or flat: read it from the strokes beside the head
        hs.forEach(h => { if (!h.acc && !h.n.breve && hs.length === 1) h.acc = accLeft(h.n, p); });
        const xs = hs.map(h => h.n.x);
        pe.push({ kind: 'note', x: has && s.dir > 0 ? Math.max(...xs) : Math.min(...xs), y: hs[0].n.y, d, dotted, up: has ? s.dir < 0 : null, hollow, bands,
          notes: hs.map(h => ({ x: h.n.x, y: h.n.y, step: h.n.step, half: h.n.breve ? h.n.w / 2 : 0.6 * p, accOff: h.acc ? h.acc.type : null, accBox: h.acc })) });
      };
      for (let hs of cols) {
        hs.sort((a, b) => a.n.y - b.n.y);
        let su = stemFrom(hs, -1), sd = stemFrom(hs, 1);
        // (a flag's curl encloses a little space and looks like a hollow head hanging on the note's own stem: with one
        //  stem only, hollow shapes beside a solid head are dropped. Two voices in one place have two stems.)
        if (again && hs.length > 1 && !(su.has && sd.has) && hs.some(h => h.hollow) && hs.some(h => !h.hollow)) { const solid = hs.filter(h => !h.hollow || h.n.pair); if (solid.length) { hs = solid; su = stemFrom(hs, -1); sd = stemFrom(hs, 1); } }
        if (su.has && sd.has && hs.length > 1) {
          // two voices in one place: the upper heads hang on the stem going up, the lower ones on the stem going down
          const top = hs[0].n.y, bot = hs[hs.length - 1].n.y;
          const upTo = top + runLen(su.x, Math.round(top), 1, 8 * p) + 0.35 * p, dnFrom = bot - runLen(sd.x, Math.round(bot), -1, 8 * p) - 0.35 * p;
          let k = hs.filter(h => h.n.y <= upTo).length; const k2 = hs.filter(h => h.n.y < dnFrom).length;
          if (k !== k2 || k < 1 || k >= hs.length) {   // not clear from the stems: split at the widest gap
            k = 1; let g = -1; for (let i = 1; i < hs.length; i++) { const gap = hs[i].n.y - hs[i - 1].n.y; if (gap > g + 0.2 * p) { g = gap; k = i; } }
          }
          make(hs.slice(0, k), su); make(hs.slice(k), sd);
        } else make(hs, su.has && (!sd.has || su.len >= sd.len) ? su : sd.has ? sd : null);
      }
      // ---- articulation signs: a dot (staccato), a dash (tenuto) or a wedge (accent) on the side of the head away from
      //      the stem, and a pause sign (an arc with a dot in it) over the note
      const shapesIn = (xa, ya, xb, yb) => {
        xa = Math.max(0, Math.round(xa)); xb = Math.min(W - 1, Math.round(xb)); ya = Math.max(0, Math.round(ya)); yb = Math.min(H - 1, Math.round(yb));
        const bw = xb - xa + 1, bh = yb - ya + 1, out = []; if (bw < 2 || bh < 2 || bw * bh > 400000) return out;
        const seen = new Uint8Array(bw * bh), stk = [];
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
          if (seen[y * bw + x] || !clean[(y + ya) * W + x + xa]) continue;
          let minx = x, maxx = x, miny = y, maxy = y, area = 0; stk.length = 0; stk.push(y * bw + x); seen[y * bw + x] = 1; const pix = [];
          while (stk.length) { const q = stk.pop(), px = q % bw, py = (q - px) / bw; area++; if (area < 3000) pix.push(q);
            if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue; const j = ny * bw + nx; if (!seen[j] && clean[(ny + ya) * W + nx + xa]) { seen[j] = 1; stk.push(j); } } }
          out.push({ minx: minx + xa, maxx: maxx + xa, miny: miny + ya, maxy: maxy + ya, w: maxx - minx + 1, h: maxy - miny + 1, area, pix, bw, xa, ya, touch: minx === 0 || miny === 0 || maxx === bw - 1 || maxy === bh - 1 });
        }
        return out;
      };
      for (const e of pe) {
        if (e.kind !== 'note') continue;
        e.art = [];
        const ys = e.notes.map(h => h.y), topY = Math.min(...ys), botY = Math.max(...ys), cx = e.x;
        for (const sg of e.up === true ? [1] : e.up === false ? [-1] : [1, -1]) {
          const ya = sg > 0 ? botY + 0.6 * p : topY - 2.4 * p, yb = sg > 0 ? botY + 2.4 * p : topY - 0.6 * p;
          const found = shapesIn(cx - 1.3 * p, ya, cx + 1.3 * p, yb);
          // (an accent that crosses a staff line comes out in two or three pieces: put them together)
          { const bits = found.filter(c => !c.touch && c.w <= 1.9 * p && c.h <= 1.25 * p && !(c.w <= 0.6 * p && c.h <= 0.6 * p && c.area / (c.w * c.h) >= 0.6) && Math.abs((c.minx + c.maxx) / 2 - cx) <= 0.9 * p);
            if (bits.length >= 2 && bits.length <= 4) {
              const u = { minx: Math.min(...bits.map(c => c.minx)), maxx: Math.max(...bits.map(c => c.maxx)), miny: Math.min(...bits.map(c => c.miny)), maxy: Math.max(...bits.map(c => c.maxy)), area: bits.reduce((a, c) => a + c.area, 0), pix: [].concat(...bits.map(c => c.pix)), bw: bits[0].bw, xa: bits[0].xa, ya: bits[0].ya, touch: false };
              u.w = u.maxx - u.minx + 1; u.h = u.maxy - u.miny + 1;
              if (u.w >= 0.9 * p && u.w <= 1.9 * p && u.h >= 0.45 * p && u.h <= 1.25 * p) { for (const c of bits) c.touch = true; found.push(u); }
            } }
          for (const c of found) {
            if (c.touch) continue;
            const mx = (c.minx + c.maxx) / 2, my = (c.miny + c.maxy) / 2, fill = c.area / (c.w * c.h);
            if (Math.abs(mx - cx) > 0.5 * p) continue;
            // (a ledger line lies between the note and the staff, on a line's place; a dash is shorter)
            const onLine = Math.abs((my - st.top) / p - Math.round((my - st.top) / p)) < 0.2 && (my < st.top || my > st.bot);
            if (c.w >= 0.22 * p && c.w <= 0.6 * p && c.h >= 0.22 * p && c.h <= 0.6 * p && Math.abs(c.w - c.h) <= 0.18 * p && c.w <= 1.5 * c.h && fill >= 0.6 && Math.abs(my - (sg > 0 ? botY : topY)) <= 2.0 * p && Math.abs(mx - cx) <= 0.42 * p) { if (!e.art.includes('st')) e.art.push('st'); }
            else if (c.w >= 0.7 * p && c.w <= 1.5 * p && c.h <= 0.34 * p && fill >= 0.7 && !onLine) { if (!e.art.includes('te')) e.art.push('te'); }
            else if (c.w >= 0.9 * p && c.w <= 1.9 * p && c.h >= 0.45 * p && c.h <= 1.25 * p && fill <= 0.6) {
              // a wedge open to the left: its left end is as tall as the sign, its right end a point in the middle
              let l0 = 1e9, l1 = -1, r0 = 1e9, r1 = -1;
              for (const q of c.pix) { const px = q % c.bw + c.xa, py = (q - q % c.bw) / c.bw + c.ya; if (px <= c.minx + 0.2 * c.w) { if (py < l0) l0 = py; if (py > l1) l1 = py; } if (px >= c.maxx - 0.15 * c.w) { if (py < r0) r0 = py; if (py > r1) r1 = py; } }
              if (l1 - l0 >= 0.7 * c.h && r1 - r0 <= 0.45 * c.h && Math.abs((r0 + r1) / 2 - my) <= 0.25 * c.h) { if (!e.art.includes('ac')) e.art.push('ac'); }
            }
          }
        }
        const up0 = Math.min(topY - 0.6 * p, st.top + 0.3 * p);
        const over = shapesIn(cx - 1.9 * p, up0 - 3.8 * p, cx + 1.9 * p, up0).filter(c => !c.touch);
        const arcS = over.find(c => c.w >= 1.4 * p && c.w <= 2.9 * p && c.h >= 0.6 * p && c.h <= 1.7 * p && c.area / (c.w * c.h) <= 0.72 && Math.abs((c.minx + c.maxx) / 2 - cx) <= 0.6 * p);
        if (arcS && over.some(c => c !== arcS && c.w <= 0.6 * p && c.h <= 0.6 * p && c.w >= 0.15 * p && Math.abs((c.minx + c.maxx) / 2 - (arcS.minx + arcS.maxx) / 2) <= 0.4 * p && c.miny >= arcS.miny)) {
          e.art = e.art.filter(a => a !== 'st'); e.art.push('fe');
        }
      }
      // ---- loud and soft: the heavy slanted letters p, m, f, s, z under the staff, as music fonts draw them
      if (omrDynTemplates() && pe.length) {
        const nextTop = nextS0 ? nextS0.top : st.bot + 6 * p, prevBot = si > 0 ? SV[si - 1].bot : st.top - 6 * p;
        // (under the staff for instruments; over the staff for a voice, whose words are under it. Which one counts is
        //  settled when the piano's staves are known.)
        for (const [key, ya, yb] of [['dynB', st.bot + 0.9 * p, Math.min(st.bot + 5.5 * p, nextTop - 0.9 * p)], ['dynA', Math.max(st.top - 5.5 * p, prevBot + 0.9 * p), st.top - 0.9 * p]]) {
        const sh = yb - ya > 1.2 * p ? shapesIn(st.musicStart - 2 * p, ya, st.right, yb).filter(c => !c.touch && c.h >= 0.5 * p && c.h <= 3.2 * p && c.w <= 3 * p).sort((a, b) => a.minx - b.minx) : [];
        const groups = [];
        for (const c of sh) { const g = groups[groups.length - 1]; if (g && c.minx - g.maxx <= 0.5 * p && Math.min(g.maxy, c.maxy) - Math.max(g.miny, c.miny) > 0) { g.maxx = Math.max(g.maxx, c.maxx); g.miny = Math.min(g.miny, c.miny); g.maxy = Math.max(g.maxy, c.maxy); g.n++; } else groups.push({ minx: c.minx, maxx: c.maxx, miny: c.miny, maxy: c.maxy, n: 1 }); }
        for (const g of groups) {
          const w = g.maxx - g.minx + 1, h = g.maxy - g.miny + 1;
          if (h < 1.1 * p || h > 3.2 * p || w < 0.7 * p || w > 5 * p || g.n > 5) continue;
          const v = omrMatchDyn(clean, W, g.minx, g.maxx, g.miny, g.maxy); if (!v) continue;
          let best = null, bd = 3.5 * p; const gx = g.minx + 0.4 * p;
          for (const e of pe) { const dd = Math.abs(e.x - gx); if (dd < bd) { bd = dd; best = e; } }
          if (best) best[key] = v;
        }
        }
      }
    }

    // ---------- bar lines ----------
    const spanTop = Math.round(st.top), spanBot = Math.round(st.bot);
    // in a full score a bar line may run on through the gap to the next staff of the same system
    const prevS = si > 0 && sysOf[si - 1] === sysOf[si] ? SV[si - 1] : null, nextS = si + 1 < SV.length && sysOf[si + 1] === sysOf[si] ? SV[si + 1] : null;
    const upGap = prevS ? spanTop - Math.round(prevS.bot) - 2 : 0, dnGap = nextS ? Math.round(nextS.top) - spanBot - 2 : 0;
    const cols = [];
    // (start after the clef: a C clef's thick bars span the staff like a bar line)
    for (let x = Math.round(Math.max(st.left + 2.5 * p, (st.clefRight || 0) + 0.3 * p)); x <= Math.min(W - 1, Math.round(st.right + 3)); x++) {
      let ok = true; for (let y = spanTop; y <= spanBot; y++) if (!bin[y * W + x]) { ok = false; break; }
      if (!ok) continue;
      let up = 0; while (up < Math.max(1.2 * p, upGap + 1) && spanTop - 1 - up >= 0 && bin[(spanTop - 1 - up) * W + x]) up++;
      let dn = 0; while (dn < Math.max(1.2 * p, dnGap + 1) && spanBot + 1 + dn < H && bin[(spanBot + 1 + dn) * W + x]) dn++;
      const upOk = up <= 0.55 * p || (prevS && up >= upGap), dnOk = dn <= 0.55 * p || (nextS && dn >= dnGap);
      if (upOk && dnOk && !mine.some(n => Math.abs(n.x - x) <= 0.85 * p)) cols.push(x);   // a stem right beside a notehead is not a bar line
    }
    const bars = [];
    for (const x of cols) { const last = bars[bars.length - 1]; if (last && x - last.x1 <= 2 * LT + 2) last.x1 = x; else bars.push({ x0: x, x1: x }); }
    // how many of the bar lines run on down into the next staff (they do between the two staves of a piano part)
    let linkDn = 0;
    if (nextS && dnGap > 0) { let n = 0; for (const b of bars) { const x = Math.round((b.x0 + b.x1) / 2); let c = 0; for (let y = spanBot + 1; y <= spanBot + dnGap; y++) if (bin[y * W + x] || bin[y * W + x - 1] || bin[y * W + x + 1]) c++; if (c >= 0.97 * dnGap) n++; } linkDn = bars.length ? n / bars.length : 0; }
    // repeat signs: two dots in the middle spaces, before the bar line (end of a repeat) or after it (start of one)
    const repDot = (cx, cy) => discFill(cx, cy, 0.16 * p) >= 0.75 && !dark(Math.round(cx), Math.round(cy - 0.38 * p)) && !dark(Math.round(cx), Math.round(cy + 0.38 * p));
    const dots = x => repDot(x, st.top + 1.5 * p) && repDot(x, st.top + 2.5 * p);
    for (const b of bars) {
      for (let dx = 0.25; dx <= 1.0 && !b.end; dx += 0.06) if (dots(b.x0 - dx * p)) b.end = true;
      for (let dx = 0.25; dx <= 1.0 && !b.start; dx += 0.06) if (dots(b.x1 + dx * p)) b.start = true;
    }
    const barX = [], barRep = [];
    for (const b of bars) { const x = (b.x0 + b.x1) / 2, k = barX.length - 1;
      if (!barX.length || x - barX[k] > 0.9 * p) { barX.push(x); barRep.push({ start: !!b.start, end: !!b.end }); }
      else { barRep[k].start = barRep[k].start || !!b.start; barRep[k].end = barRep[k].end || !!b.end; } }
    // a thick bar line at the very end of the line closes a piece (unless it only ends a repeat)
    const lastBar = bars[bars.length - 1];
    const endsFinal = !!lastBar && lastBar.x1 - lastBar.x0 + 1 >= 0.3 * p && lastBar.x1 >= st.right - 0.8 * p && !(barRep.length && barRep[barRep.length - 1].end);

    // ---------- rests ----------
    const y0 = Math.max(0, Math.round(st.top - 0.35 * p)), y1 = Math.min(H - 1, Math.round(st.bot + 0.35 * p));
    const x0 = Math.max(0, Math.round(st.musicStart)), x1 = Math.min(W - 1, Math.round(st.right));
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw > 0 && bh > 0) {
      const seen = new Uint8Array(bw * bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const i0 = y * bw + x; if (seen[i0] || !filled[(y + y0) * W + x + x0]) continue;
        let sp = 0; stackA[sp++] = i0; seen[i0] = 1; let minx = x, maxx = x, miny = y, maxy = y, area = 0;
        while (sp > 0) { const q = stackA[--sp]; const px = q % bw, py = (q - px) / bw; area++;
          if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
          const t = (xx, yy) => { if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) return; const j = yy * bw + xx; if (!seen[j] && filled[(yy + y0) * W + xx + x0]) { seen[j] = 1; stackA[sp++] = j; } };
          t(px - 1, py); t(px + 1, py); t(px, py - 1); t(px, py + 1); }
        const w = maxx - minx + 1, h = maxy - miny + 1, fill = area / (w * h);
        if (miny === 0 || maxy === bh - 1) continue;
        const cx = minx + x0 + w / 2, cy = miny + y0 + h / 2, top = miny + y0, bot = maxy + y0;
        if (heads.some(n => n.x >= minx + x0 - 0.3 * p && n.x <= maxx + x0 + 0.3 * p && n.y >= top - 0.3 * p && n.y <= bot + 0.3 * p)) continue;
        if (acc.some(c => c.minx <= maxx + x0 && c.maxx >= minx + x0 && c.miny <= bot && c.maxy >= top)) continue;
        let d = null;
        const l2 = st.top + p, l3 = st.top + 2 * p;
        const onLine = y => { const r = (y - st.top) / p; return Math.abs(r - Math.round(r)) <= 0.3; };
        // several bars' rest: a thick bar across the middle line with the number of bars printed above
        if (w >= 2.0 * p && h >= 0.35 * p && h <= 2.5 * p && Math.abs(cy - l3) <= 0.6 * p && fill >= 0.3) {
          const N = omrReadNumber(bin, W, H, minx + x0, maxx + x0, Math.round(st.top - 3.2 * p), Math.round(st.top - 0.3 * p));
          elems.push({ kind: 'rest', x: cx, y: cy, d: 0, multi: N || 1, box: [minx + x0, top, w, h] });
          continue;
        }
        if (h >= 0.75 * p && h <= 1.3 * p && w >= 0.25 * p && w <= 0.8 * p && fill >= 0.8 && onLine(top) && onLine(bot)) d = 128;   // breve rest: a block filling one space
        else if (h >= 0.25 * p && h <= 0.8 * p && w >= 0.65 * p && w <= 1.7 * p && fill >= 0.75) {
          if (Math.abs(top - l2) <= 0.3 * p) d = 64; else if (Math.abs(bot - l3) <= 0.3 * p) d = 32;
          else if (Math.abs(top - l3) <= 0.3 * p) d = 64;        // (some programs hang the semibreve rest from the middle line)
        } else if (h >= 2.2 * p && h <= 3.5 * p && w >= 0.45 * p && w <= 1.4 * p && fill < 0.75) d = 16;
        else if (h >= 1.2 * p && h < 2.2 * p && w >= 0.5 * p && w <= 1.3 * p && fill < 0.75 && cy > st.top + 0.6 * p && cy < st.bot - 0.4 * p) d = 8;
        if (d == null) continue;
        let dotted = false; for (const dy of [0, -0.5, 0.5]) if (hasDot(minx + x0 + w * 0.6, cy + dy * p, p)) dotted = true;
        if (dotted) d = d * 3 / 2;
        elems.push({ kind: 'rest', x: cx, y: cy, d, box: [minx + x0, top, w, h], dotted });
      }
    }
    elems.sort((a, b) => a.x - b.x);
    // ties: a thin curve just above or below the head, running on to the next note of the same height (or to the end of the line)
    const arc = (xa, xb, y, need) => {
      if (xb - xa < 0.5 * p) return false;
      for (const sg of [-1, 1]) {
        let hit = 0, n = 0;
        for (let x = Math.round(xa); x <= Math.round(xb); x++) { n++; for (let dy = Math.round(0.3 * p); dy <= Math.round(1.5 * p); dy++) if (dark(x, Math.round(y + sg * dy))) { hit++; break; } }
        if (n && hit / n >= (need || 0.85)) return true;
      }
      return false;
    };
    elems.forEach((e, i) => {
      if (e.kind !== 'note') return;
      const nx = elems[i + 1];
      if (nx && nx.kind === 'note' && nx.step === e.step) e.tie = arc(e.x + e.half + 0.1 * p, nx.x - nx.half - 0.1 * p, e.y);
      else if (!nx) e.tie = arc(e.x + e.half + 0.1 * p, Math.min(st.right - 0.3 * p, e.x + e.half + 2.5 * p), e.y);
    });
    // the same for the reading with chords: its rests, and a tie from each head to the next head at the same height
    for (const e of elems) if (e.kind === 'rest' && !mine.some(n => n.x >= e.box[0] - 0.3 * p && n.x <= e.box[0] + e.box[2] + 0.3 * p && n.y >= e.box[1] - 0.3 * p && n.y <= e.box[1] + e.box[3] + 0.3 * p)) pe.push({ kind: 'rest', x: e.x, y: e.y, d: e.d, dotted: e.dotted, multi: e.multi, box: e.box });
    pe.sort((a, b) => a.x - b.x);
    pe.forEach((e, i) => {
      if (e.kind !== 'note') return;
      for (const h of e.notes) {
        let nx = null;
        for (let j = i + 1; j < pe.length && !nx; j++) if (pe[j].kind === 'note') nx = pe[j].notes.find(g => g.step === h.step) || null;
        if (nx) h.tie = nx.x - h.x < 14 * p && arc(h.x + h.half + 0.25 * p, nx.x - nx.half - 0.25 * p, h.y, 0.8);
        else h.tie = h.x > st.right - 9 * p && arc(h.x + h.half + 0.25 * p, Math.min(st.right - 0.3 * p, h.x + h.half + 2.5 * p), h.y, 0.8);
      }
    });
    // bar index and totals
    elems.forEach(e => { let b = 0; while (b < barX.length && barX[b] < e.x) b++; e.bar = b; });
    const totals = {}; elems.forEach(e => { totals[e.bar] = (totals[e.bar] || 0) + e.d; });
    elems.forEach(e => { if (e.multi) totals[e.bar] = null; });     // a several-bar rest fills its bar whatever the time
    let ts = null;
    if (st.tsBox) {
      const a = omrReadNumber(clean, W, H, st.tsBox[0] - 2, st.tsBox[1] + 2, Math.round(st.top - 0.2 * p), Math.round(st.top + 1.85 * p), [1, 2, 3, 4, 5, 6, 7, 8, 9, 12]);
      const b = omrReadNumber(clean, W, H, st.tsBox[0] - 2, st.tsBox[1] + 2, Math.round(st.top + 2.15 * p), Math.round(st.bot + 0.2 * p), [1, 2, 4, 8, 16]);
      if (a && a <= 16 && [1, 2, 4, 8, 16].includes(b)) ts = [a, b];
    }
    let tsC = null;
    if (!ts && st.tsSym) { ts = st.tsSym; tsC = st.tsSym[0] === 2 ? 'C|' : 'C'; }   // C or cut C (shown as printed)
    // First and second endings: a thin line above the top staff of a system, with a hook down at its start and a
    // number under it. (A beam is thick, and a slur has no straight hook.)
    const voltas = [];
    if (posOf[si] === 0) {
      const ya = Math.max(0, Math.round(st.top - 4.5 * p)), yb = Math.round(st.top - 0.9 * p), found = [];
      for (let y = ya; y <= yb; y++) {
        let s = -1;
        for (let x = Math.max(0, Math.round(st.left)); x <= Math.min(W - 1, Math.round(st.right)) + 1; x++) {
          const v = x <= st.right && bin[y * W + x];
          if (v && s < 0) { s = x; continue; }
          if (v || s < 0) continue;
          const x0 = s, x1 = x - 1; s = -1;
          if (x1 - x0 < 2 * p || found.some(f => Math.abs(f.x0 - x0) < 0.6 * p && Math.abs(f.y - y) < 0.5 * p)) continue;
          let thick = false;
          for (const f of [0.25, 0.5, 0.75]) { const xm = Math.round(x0 + f * (x1 - x0)); let th = 0; for (let yy = y - 4; yy < y + p; yy++) if (yy >= 0 && bin[yy * W + xm]) th++; if (th > LT + 3) thick = true; }
          if (thick || x1 - x0 < 2.5 * p) continue;                    // a beam is thick; an ending's bracket is a thin line
          let hook = 0; for (let yy = y + 1; yy < y + 1.6 * p; yy++) { let any = false; for (let xx = x0; xx <= x0 + 3; xx++) if (bin[yy * W + xx]) { any = true; break; } if (any) hook++; else break; }
          if (hook < 0.6 * p) continue;
          found.push({ x0, x1, y });
        }
      }
      found.sort((a, b) => a.x0 - b.x0).forEach(f => {
        // (the number can sit a few spaces in from the hook)
        const n = omrReadNumber(bin, W, H, Math.round(f.x0 + 0.3 * p), Math.round(Math.min(f.x1 - 0.2 * p, f.x0 + 5 * p)), Math.round(f.y + 0.2 * p), Math.round(Math.min(f.y + 2.2 * p, st.top - 0.5 * p)));
        if (n && n <= 4) voltas.push({ n, x0: f.x0, x1: f.x1, y: f.y });            // no number, no ending
      });
    }
    out.staves.push({ p, left: st.left, right: st.right, top: st.top, bot: st.bot, fifths, keyBox: accs.length ? [accs[0].minx, accs[accs.length - 1].maxx] : null, droppedAcc: !!dropped, musicStart: st.musicStart, barX, barRep, elems, totals, acc, ts, tsC, endsFinal,
      clefType: st.clefType || null, sys: sysOf[si], pos: posOf[si], sysSize: sizeOf[si], voltas, pe, linkDn, kb: null, poly: false });
  });
  // the staves of one system share the endings drawn over its top staff, and its time signature
  const bySys = {};
  out.staves.forEach(s => (bySys[s.sys] = bySys[s.sys] || []).push(s));
  // ---- slurs: a long thin arc that starts at one note and ends at another. (An arc between two notes of the same
  //      height is a tie.) Found as shapes that are one thin stroke in nearly every column and bend up or down.
  for (const k in bySys) {
    const grp = bySys[k], p = grp[0].p; if (!grp.some(s => s.pe && s.pe.length)) continue;
    const ya = Math.max(0, Math.round(grp[0].top - 4.5 * p)), yb = Math.min(H - 1, Math.round(grp[grp.length - 1].bot + 4.5 * p));
    const xa = Math.max(0, Math.round(Math.min(...grp.map(s => s.musicStart)) - p)), xb = Math.min(W - 1, Math.round(Math.max(...grp.map(s => s.right))));
    const bw = xb - xa + 1, bh = yb - ya + 1; if (bw < 10 || bh < 10) continue;
    const seen = new Uint8Array(bw * bh), stk = [], cap = Math.round(60 * p * 0.6 * p);
    const heads = []; grp.forEach(s => s.pe.forEach(e => { if (e.kind === 'note') e.notes.forEach(h => heads.push({ e, h, s })); }));
    const nearHead = (x, y) => { let best = null, bd = 1e9; for (const q of heads) { const dx = Math.abs(q.h.x - x), dy = Math.abs(q.h.y - y); if (dx > 1.4 * p || dy > 5 * p) continue; const d = dx + 0.3 * dy; if (d < bd) { bd = d; best = q; } } return best; };
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      if (seen[y * bw + x] || !clean[(y + ya) * W + x + xa]) continue;
      let minx = x, maxx = x, miny = y, maxy = y, area = 0; const pix = []; stk.length = 0; stk.push(y * bw + x); seen[y * bw + x] = 1;
      while (stk.length) { const q = stk.pop(), px = q % bw, py = (q - px) / bw; area++; if (area <= cap) pix.push(q);
        if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue; const j = ny * bw + nx; if (!seen[j] && clean[(ny + ya) * W + nx + xa]) { seen[j] = 1; stk.push(j); } } }
      const w = maxx - minx + 1, h = maxy - miny + 1;
      if (area > cap || w < 2.2 * p || h < 0.3 * p || h > 0.5 * w + p || area > w * 0.55 * p) continue;
      const lo = new Int32Array(w).fill(1e9), hi = new Int32Array(w).fill(-1), cnt = new Uint16Array(w);
      for (const q of pix) { const px = q % bw - minx, py = (q - q % bw) / bw; cnt[px]++; if (py < lo[px]) lo[px] = py; if (py > hi[px]) hi[px] = py; }
      let single = 0, thick = 0; for (let c = 0; c < w; c++) { if (cnt[c] && hi[c] - lo[c] + 1 <= cnt[c] + 1) single++; if (cnt[c] > thick) thick = cnt[c]; }
      if (single < 0.9 * w || thick > 0.55 * p) continue;
      const mid = c => (lo[c] + hi[c]) / 2, cL = Math.min(w - 1, 2), cR = Math.max(0, w - 3), cM = w >> 1;
      const bend = mid(cM) - (mid(cL) + mid(cR)) / 2;
      if (Math.abs(bend) < 0.25 * p) continue;                                  // (a straight line is not a slur)
      const a = nearHead(minx + xa, mid(cL) + ya), b = nearHead(maxx + xa, mid(cR) + ya);
      if (!a || !b || a.e === b.e || b.h.x <= a.h.x) continue;
      if (a.s === b.s && a.h.step === b.h.step) { a.h.tie = true; continue; }    // the same note twice: a tie
      a.e.ss = 1; b.e.se = 1;
    }
  }
  // A piano part: two staves held by a brace, or the only two staves of a larger system whose bar lines run from one
  // into the other. A system with a piano part, or with chords or two voices on a staff, is read with every head.
  {
    // a brace is a tall curly shape left of the two staves; a bracket or the system's own line is straight
    const brace = (a, b) => {
      const p = a.p, ya = Math.round(a.top), yb = Math.round(b.bot), xa = Math.max(0, Math.round(Math.min(a.left, b.left) - 2.6 * p)), xb = Math.round(Math.min(a.left, b.left) - 0.3 * p);
      if (xb <= xa) return false;
      let rows = 0, lo = 1e9, hi = -1; const colN = new Uint32Array(xb - xa + 1);
      for (let y = ya; y <= yb; y++) { let any = false, first = -1; for (let x = xa; x <= xb; x++) if (bin[y * W + x]) { any = true; colN[x - xa]++; if (first < 0) first = x; } if (any) { rows++; if (first < lo) lo = first; if (first > hi) hi = first; } }
      const n = yb - ya + 1; let straight = 0; for (const c of colN) if (c >= 0.9 * n) straight++;
      return rows >= 0.9 * n && straight === 0 && hi - lo >= 0.25 * p;
    };
    for (const k in bySys) {
      const grp = bySys[k];
      for (let i = 0; i + 1 < grp.length; i++) {
        if (grp[i].kb) continue;
        const a = SV[out.staves.indexOf(grp[i])], b = SV[out.staves.indexOf(grp[i + 1])];
        const lone = grp[i].linkDn >= 0.6 && grp.length > 2 && (i === 0 || grp[i - 1].linkDn < 0.3) && (i + 2 >= grp.length || grp[i + 1].linkDn < 0.3);
        if (brace(a, b) || lone) { grp[i].kb = 'U'; grp[i + 1].kb = 'L'; i++; }
      }
      let poly = grp.some(s => s.kb);
      for (const s of grp) {
        const notes = s.pe.filter(e => e.kind === 'note'); let multi = 0;
        notes.forEach((e, i) => { if (e.notes.length > 1 || (i && e.x - notes[i - 1].x < 0.75 * s.p)) multi++; });
        if (multi >= 3 && multi >= 0.1 * notes.length) poly = true;
      }
      if (poly) { grp.forEach(s => s.poly = true); out.poly = true; }
      const hasKb = grp.some(s => s.kb);
      grp.forEach(s => s.pe.forEach(e => { const v = hasKb && !s.kb ? e.dynA : s.kb === 'L' ? null : e.dynB; if (v) e.dyn = v; }));
    }
  }
  for (const k in bySys) {
    const grp = bySys[k], top = grp.find(s => s.pos === 0);
    if (top && top.voltas.length) grp.forEach(s => { if (s !== top) s.voltas = top.voltas; });
    if (grp.length > 1) {
      const withTs = grp.filter(s => s.ts);
      if (withTs.length * 2 > grp.length || (again && withTs.length * 2 >= grp.length)) {   // (on a piano page one of its two staves is enough)
        const cnt = {}; withTs.forEach(s => { const k2 = s.ts.join('/'); cnt[k2] = (cnt[k2] || 0) + 1; });
        const best = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0].split('/').map(Number);
        const sym = withTs.filter(s => s.tsC).length * 2 > withTs.length ? withTs.find(s => s.tsC).tsC : null;   // C or cut C, if most staves show it
        grp.forEach(s => { s.ts = best; s.tsC = sym; });
      } else grp.forEach(s => { s.ts = null; s.tsC = null; });           // one staff alone with a time signature was a misreading
    }
  }
  // Keep the parts of a system together: a bar lasts as long in every staff. If one staff's bar came out short (a note
  // was missed) it is filled with a rest; if it came out long, its last note is cut short.
  for (const k in bySys) {
    const grp = bySys[k]; if (grp.length < 2) continue;
    for (const s of grp) {
      const p = s.p;
      for (let b = 1; b < s.barX.length; b++) {
        const own = s.totals[b]; if (own === null) continue;            // (null: a several-bar rest)
        const x0 = s.barX[b - 1], x1 = s.barX[b], others = [];
        for (const o of grp) { if (o === s) continue;
          for (let c = 1; c < o.barX.length; c++) if (Math.abs(o.barX[c - 1] - x0) < p && Math.abs(o.barX[c] - x1) < p) { if (o.totals[c] != null) others.push(o.totals[c]); break; } }
        if (!others.length) continue;
        if (own === undefined) {   // nothing was read in this bar (a whole-bar rest missed): it lasts as long as the others say
          if (others.some(v => v !== others[0])) continue;
          s.elems.push({ kind: 'rest', x: (x0 + x1) / 2, y: s.top + 1.5 * p, d: others[0], box: [(x0 + x1) / 2 - 0.5 * p, s.top + p, p, 0.5 * p], padded: true, bar: b });
          s.totals[b] = others[0]; continue;
        }
        const cnt = {}; [own, ...others].forEach(v => cnt[v] = (cnt[v] || 0) + 1);
        const agreed = +Object.keys(cnt).sort((a, c) => cnt[c] - cnt[a])[0];
        if (agreed === own || cnt[agreed] < 2 || cnt[own] >= cnt[agreed]) continue;
        const inBar = s.elems.filter(e => e.bar === b), last = inBar[inBar.length - 1];
        if (own < agreed) { if (last && last.tie) continue; s.elems.push({ kind: 'rest', x: x1 - 0.3 * p, y: s.top + 2 * p, d: agreed - own, box: [x1 - 0.7 * p, s.top + 1.4 * p, 0.4 * p, 1.2 * p], padded: true, bar: b }); }
        else if (last && last.d > own - agreed) last.d -= own - agreed; else continue;
        s.totals[b] = agreed;
      }
      s.elems.sort((a, c) => a.x - c.x);
    }
  }
  if (out.poly && !again) { const o2 = omrReadPage(imgData, true); if (o2.poly) return o2; }
  return out;
}

// Reads a printed number (such as the count over a several-bar rest) by comparing it with numbers drawn in a serif font.
let omrNumTemplates = null;
function omrReadNumber(bin, W, H, x0, x1, y0, y1, allowed) {
  x0 = Math.max(0, x0); x1 = Math.min(W - 1, x1); y0 = Math.max(0, y0); y1 = Math.min(H - 1, y1);
  let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (bin[y * W + x]) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  if (maxx < 0 || maxy - miny < 6) return null;
  const S = 32, w = maxx - minx + 1, h = maxy - miny + 1, a = new Uint8Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) a[j * S + i] = bin[(miny + Math.floor((j + 0.5) * h / S)) * W + minx + Math.floor((i + 0.5) * w / S)];
  if (!omrNumTemplates) {
    omrNumTemplates = [];
    const cv = document.createElement('canvas'); cv.width = 360; cv.height = 140; const g = cv.getContext('2d', { willReadFrequently: true });
    for (let n = 1; n <= 99; n++) {
      g.fillStyle = '#fff'; g.fillRect(0, 0, 360, 140); g.fillStyle = '#000'; g.font = 'bold 100px "Times New Roman", Times, serif'; g.fillText(String(n), 10, 110);
      const d = g.getImageData(0, 0, 360, 140).data; let mnx = 1e9, mxx = -1, mny = 1e9, mxy = -1;
      for (let y = 0; y < 140; y++) for (let x = 0; x < 360; x++) if (d[(y * 360 + x) * 4] < 128) { if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
      const tw = mxx - mnx + 1, th = mxy - mny + 1, t = new Uint8Array(S * S);
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) t[j * S + i] = d[((mny + Math.floor((j + 0.5) * th / S)) * 360 + mnx + Math.floor((i + 0.5) * tw / S)) * 4] < 128 ? 1 : 0;
      omrNumTemplates.push({ n, t, aspect: tw / th });
    }
    // the heavy numbers of a time signature, as music fonts draw them (from the notation library, when it is there)
    try {
      const VF = window.Vex && window.Vex.Flow;
      if (VF) {
        const dig = [];
        for (let dg = 0; dg <= 9; dg++) {
          const c2 = document.createElement('canvas'); c2.width = 160; c2.height = 160;
          const vctx = new VF.Renderer(c2, VF.Renderer.Backends.CANVAS).getContext(), g2 = c2.getContext('2d', { willReadFrequently: true });
          g2.fillStyle = '#fff'; g2.fillRect(0, 0, 160, 160); g2.fillStyle = '#000';
          VF.Glyph.renderGlyph(vctx, 40, 100, 90, 'timeSig' + dg);
          const d = g2.getImageData(0, 0, 160, 160).data; let a = 1e9, b = -1, e = 1e9, f = -1;
          for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) if (d[(y * 160 + x) * 4] < 128) { if (x < a) a = x; if (x > b) b = x; if (y < e) e = y; if (y > f) f = y; }
          dig.push({ d, a, b, e, f });
        }
        const e0 = Math.min(...dig.map(q => q.e)), f0 = Math.max(...dig.map(q => q.f)), th = f0 - e0 + 1;
        for (let n = 1; n <= 16; n++) {
          const ds = String(n).split('').map(Number), tw = ds.reduce((s, q) => s + dig[q].b - dig[q].a + 1, 0) + (ds.length - 1) * 3, big = new Uint8Array(tw * th); let ox = 0;
          for (const q of ds) { const D = dig[q]; for (let y = e0; y <= f0; y++) for (let x = D.a; x <= D.b; x++) if (D.d[(y * 160 + x) * 4] < 128) big[(y - e0) * tw + ox + x - D.a] = 1; ox += D.b - D.a + 1 + 3; }
          let my = 1e9, My = -1; for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) if (big[y * tw + x]) { if (y < my) my = y; if (y > My) My = y; }
          const hh = My - my + 1, t = new Uint8Array(S * S);
          for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) t[j * S + i] = big[(my + Math.floor((j + 0.5) * hh / S)) * tw + Math.floor((i + 0.5) * tw / S)];
          omrNumTemplates.push({ n, t, aspect: tw / hh });
        }
      }
    } catch (e) {}
  }
  let best = null, bestS = -1e9;
  for (const T of omrNumTemplates) {
    if (allowed && !allowed.includes(T.n)) continue;
    let inter = 0, uni = 0; for (let k = 0; k < S * S; k++) { if (T.t[k] && a[k]) inter++; if (T.t[k] || a[k]) uni++; }
    const s = inter / Math.max(1, uni) - 0.6 * Math.abs(Math.log(T.aspect / (w / h)));
    if (s > bestS) { bestS = s; best = T.n; }
  }
  return bestS > 0.35 ? best : null;
}

// The dynamics p, pp, mp, mf, f, ff ... drawn in the music font of the notation library, for comparing with what is on
// the page (null when the library is not there).
let omrDynT = null;
function omrDynTemplates() {
  if (omrDynT) return omrDynT.length ? omrDynT : null;
  omrDynT = [];
  try {
    const VF = window.Vex && window.Vex.Flow; if (!VF) return null;
    const GL = { p: 'dynamicPiano', m: 'dynamicMezzo', f: 'dynamicForte', s: 'dynamicSforzando', z: 'dynamicZ', r: 'dynamicRinforzando' }, S = 32;
    for (const text of ['pp', 'p', 'mp', 'mf', 'f', 'ff', 'fp', 'sf', 'sfz', 'fz', 'ppp', 'fff']) {
      const c = document.createElement('canvas'); c.width = 520; c.height = 200;
      const vctx = new VF.Renderer(c, VF.Renderer.Backends.CANVAS).getContext(), g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff'; g.fillRect(0, 0, 520, 200); g.fillStyle = '#000';
      omrDrawDyn(VF, vctx, g, text, 20, 120, 80);
      const d = g.getImageData(0, 0, 520, 200).data; let a = 1e9, b = -1, e = 1e9, f = -1;
      for (let y = 0; y < 200; y++) for (let x = 0; x < 520; x++) if (d[(y * 520 + x) * 4] < 128) { if (x < a) a = x; if (x > b) b = x; if (y < e) e = y; if (y > f) f = y; }
      if (b < 0) continue;
      const tw = b - a + 1, th = f - e + 1, t = new Uint8Array(S * S);
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) t[j * S + i] = d[((e + Math.floor((j + 0.5) * th / S)) * 520 + a + Math.floor((i + 0.5) * tw / S)) * 4] < 128 ? 1 : 0;
      omrDynT.push({ text, t, aspect: tw / th });
    }
  } catch (err) { omrDynT = []; }
  return omrDynT.length ? omrDynT : null;
}
// draws a dynamic letter by letter (each letter starts where the one before ends, a little tucked in)
function omrDrawDyn(VF, vctx, g, text, x, y, size) {
  const GL = { p: 'dynamicPiano', m: 'dynamicMezzo', f: 'dynamicForte', s: 'dynamicSforzando', z: 'dynamicZ', r: 'dynamicRinforzando' };
  for (const ch of text) {
    if (!GL[ch]) continue;
    let w = size * 0.5; try { const m = VF.Glyph.getWidth ? VF.Glyph.getWidth(GL[ch], size) : null; if (m) w = m; } catch (e) {}
    VF.Glyph.renderGlyph(vctx, x, y, size, GL[ch]); x += w * 0.92;
  }
  return x;
}
function omrMatchDyn(bin, W, x0, x1, y0, y1) {
  const T = omrDynTemplates(); if (!T) return null;
  const S = 32, w = x1 - x0 + 1, h = y1 - y0 + 1, a = new Uint8Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) a[j * S + i] = bin[(y0 + Math.floor((j + 0.5) * h / S)) * W + x0 + Math.floor((i + 0.5) * w / S)];
  let best = null, bestS = -1e9;
  for (const t of T) { let inter = 0, uni = 0; for (let k = 0; k < S * S; k++) { if (t.t[k] && a[k]) inter++; if (t.t[k] || a[k]) uni++; }
    const s = inter / Math.max(1, uni) - 0.6 * Math.abs(Math.log(t.aspect / (w / h))); if (s > bestS) { bestS = s; best = t.text; } }
  return bestS > 0.42 ? best : null;
}

const omrKeyOff = f => { const o = {}; OMR_LET.split('').forEach(l => o[l] = 0); if (f > 0) OMR_SHARPS.slice(0, f).split('').forEach(l => o[l] = 1); else if (f < 0) OMR_FLATS.slice(0, -f).split('').forEach(l => o[l] = -1); return o; };

// Works out the key signature of each piece from every staff read so far, in page order. A piece starts at a time
// signature or after a final double bar line. Every staff of a piece carries the same key signature, so a staff that
// disagrees with the staves around it was misread. Then the sharps, flats and naturals written in the music are checked:
// with the right key signature hardly any of them are pointless (a natural on a note the key leaves natural, a flat on a
// note the key already flattens). Sets keyFinal on every staff, and sec on the first staff of each piece.
function omrSettle(pages, clef) {
  const topDia = OMR_TOPDIA[clef] || 32, rows = [];
  pages.forEach(pg => { if (pg) pg.staves.forEach(s => { s._page = pg; rows.push(s); }); });
  // pieces from time signatures and final bar lines
  let pieces = [], cur = null, prevFinal = true;
  // (in a full score the pieces are decided for the whole system beforehand: forceSec)
  for (const s of rows) { const here = s.forceSec != null ? s.forceSec : !!s.ts || prevFinal; if (!cur || here) { cur = { staves: [], ts: s.ts || null, sym: s.tsC || null }; pieces.push(cur); } cur.staves.push(s); prevFinal = !!s.endsFinal; }
  // inside a piece: a lone staff that disagrees with its neighbours takes theirs; a lasting change starts a new piece
  const split = [];
  for (const pc of pieces) {
    const k = pc.staves.map(s => s.fifths);
    for (let i = 0; i < k.length; i++) {
      const a = i > 0 ? k[i - 1] : null, b = i + 1 < k.length ? k[i + 1] : null;
      if (k[i] !== a && k[i] !== b && (a === b ? a != null : (a == null ? b != null && k[i + 2] === b : b == null && k[i - 2] === a))) k[i] = a != null ? a : b;
    }
    if (pc.staves[0].forceSec != null) {   // a piece of a full score keeps one key: the one most of its staves show
      const cnt = {}; k.forEach(v => cnt[v] = (cnt[v] || 0) + 1);
      split.push({ staves: pc.staves, ts: pc.ts, sym: pc.sym, key: +Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] }); continue;
    }
    let part = null;
    pc.staves.forEach((s, i) => { if (!part || k[i] !== part.key) { part = { staves: [], ts: part ? null : pc.ts, sym: part ? null : pc.sym, key: k[i] }; split.push(part); } part.staves.push(s); });
  }
  // the music's own accidentals as a second opinion
  for (const pc of split) {
    const pointless = f => {
      const ko = omrKeyOff(f); let n = 0, all = 0;
      for (const s of pc.staves) { let bar = -1, carry = {}, before = {};
        for (const e of s.elems) {
          if (e.bar !== bar) { bar = e.bar; before = carry; carry = {}; }
          if (e.kind !== 'note' || e.accOff == null) continue;
          const dia = (OMR_TOPDIA[s.clefType] || topDia) - e.step, letter = OMR_LET[((dia % 7) + 7) % 7];
          const now = carry[dia] != null ? carry[dia] : ko[letter];
          all++; if (e.accOff === now && before[dia] == null) n++;       // (a reminder after last bar's change is fine)
          carry[dia] = e.accOff;
        } }
      return { n, all };
    };
    const here = pointless(pc.key);
    pc.check = here;
    if (here.n >= 3 && here.n >= 0.3 * here.all) {
      for (const f of [pc.key - 1, pc.key + 1]) { if (f < -7 || f > 7) continue; const t = pointless(f); if (t.n <= here.n / 3) { pc.key = f; pc.keyFromNotes = true; pc.check = t; break; } }
    }
  }
  let lastTs = null;
  const headOf = s => {   // the piece's title (the biggest words between this system and the one above it), and its composer
    // (only real words count: some PDFs print the music itself as characters of a music font)
    const pg = s._page, words = pg && pg.texts ? pg.texts.filter(t => /[A-Za-zÀ-ɏ]{2,}/.test(t.str)) : [];
    if (!words.length) return { title: null, by: null };
    const top = pg.staves.find(x => x.sys === s.sys) || s, i = pg.staves.indexOf(top), above = i > 0 ? pg.staves[i - 1].bot + 2 * s.p : 0;
    const sizes = words.map(t => t.size).sort((a, b) => a - b), med = sizes[sizes.length >> 1];
    const c = words.filter(t => t.y < top.top - 1.5 * s.p && t.y > above && t.size >= 1.25 * med).sort((a, b) => b.size - a.size)[0];
    if (!c) return { title: null, by: null };
    const title = words.filter(t => Math.abs(t.y - c.y) < 0.3 * c.size && Math.abs(t.size - c.size) < 0.1 * c.size).sort((a, b) => a.x - b.x).map(t => t.str).join(' ').trim();
    // the composer: smaller lines on the right half of the page, between the title and the music
    const mid = (top.left + top.right) / 2, lines = {};
    pg.texts.filter(t => t.y > c.y + 0.3 * c.size && t.y < top.top - 0.5 * s.p && t.x > mid && t.size < 0.9 * c.size && !/^[A-Za-z]$/.test(t.str))   // (a lone letter is a music-font sign)
      .forEach(t => { const k = Math.round(t.y / (0.6 * t.size)); (lines[k] = lines[k] || []).push(t); });
    const by = Object.keys(lines).sort((a, b) => a - b).map(k => lines[k].sort((a, b) => a.x - b.x).map(t => t.str).join(' ').replace(/\s+/g, ' ').trim())
      .filter(l => /[A-Za-zÀ-ɏ]{2,}/.test(l)).join('\n');
    return { title: title || null, by: by || null };
  };
  for (const pc of split) { if (pc.ts) lastTs = pc.ts; pc.staves.forEach((s, i) => { s.keyFinal = pc.key; s.secTs = pc.ts; s.pieceTs = lastTs; s.sec = i === 0 ? Object.assign({ k: pc.key, ts: pc.ts, sym: pc.ts ? pc.sym || null : null }, headOf(s)) : null; s.keyFromNotes = !!pc.keyFromNotes; }); }
  return split;
}

// Turns one page's elements into score items. clef: 'alto' etc. fifths: null to use the key signature worked out for each
// piece (omrSettle). barT: ticks in a bar, for rests that last several bars when no time signature was read.
// The first note of each piece carries sec: {k, ts} so that the score can show the new key and time signature.
function omrItems(page, clef, fifthsOverride, barT) {
  const items = [];
  let tied = null;                                   // the item a tie is still holding on to, even across lines
  for (const st of page.staves) {
    const topDia = OMR_TOPDIA[st.clefType] || OMR_TOPDIA[clef] || 32;   // every staff in its own clef
    const f = fifthsOverride != null ? fifthsOverride : st.keyFinal != null ? st.keyFinal : st.fifths;
    const keyOff = omrKeyOff(f), bt = st.pieceTs ? st.pieceTs[0] * 64 / st.pieceTs[1] : barT;
    const start = items.length;
    // repeat signs: a start sign on bar line k opens bar k+1, an end sign on bar line k closes bar k
    const startAt = new Set(), endAt = new Set();
    (st.barRep || []).forEach((r, k) => { if (r.start) startAt.add(k + 1); if (r.end) endAt.add(k); });
    let bar = -1, carry = {}, openRep = false, barMark = null;
    for (const e of st.elems) {
      if (e.bar !== bar) {
        if (endAt.has(bar) && items.length > start) items[items.length - 1].re = true;
        if (startAt.has(e.bar)) openRep = true;
        bar = e.bar; carry = {};
        // where this bar is in the score (page, system, and its bar line's place across the page), so that the parts
        // of a full score can be kept together bar by bar when they play
        barMark = { at: page.no + '.' + st.sys, x: e.bar > 0 && st.barX[e.bar - 1] != null ? st.barX[e.bar - 1] / st.p : 0 };
      }
      const vol = (st.voltas || []).find(v => e.x >= v.x0 && e.x <= v.x1);
      if (e.kind === 'rest') { const r = { m: null, d: e.multi ? e.multi * (bt || 64) : e.d }; if (openRep) { r.rs = true; openRep = false; } if (vol) r.v = vol.n; if (barMark) { r.bar = barMark.at; r.bx = +barMark.x.toFixed(2); barMark = null; } items.push(r); tied = null; continue; }
      const dia = topDia - e.step, letter = OMR_LET[((dia % 7) + 7) % 7], oct = Math.floor(dia / 7);
      if (tied && tied.dia === dia) { tied.item.d += Math.round(e.d); if (!e.tie) tied = null; continue; }   // a tied note just lengthens the first one
      let off = keyOff[letter];
      if (e.accOff != null) { off = e.accOff; carry[dia] = off; } else if (carry[dia] != null) off = carry[dia];
      const item = { m: 12 * (oct + 1) + OMR_BASE[letter] + off, d: Math.round(e.d) };
      if (openRep) { item.rs = true; openRep = false; }
      if (vol) item.v = vol.n;
      if (barMark) { item.bar = barMark.at; item.bx = +barMark.x.toFixed(2); barMark = null; }
      items.push(item);
      tied = e.tie ? { item, dia } : null;
    }
    if (endAt.has(bar) && items.length > start) items[items.length - 1].re = true;
    if (st.sec && items.length > start) items[start].sec = { k: fifthsOverride != null ? fifthsOverride : st.sec.k, ts: st.sec.ts, sym: st.sec.sym || null, title: st.sec.title || null, by: st.sec.by || null, clef: st.clefType || null };
  }
  return items;
}

// Most common bar length between two bar lines, in ticks (16 per crotchet). Null if there is no clear answer.
function omrGuessBar(pages) {
  const counts = new Map();
  for (const pg of pages) for (const st of pg.staves) for (let b = 1; b < st.barX.length; b++) { const t = st.totals[b]; if (t) counts.set(Math.round(t), (counts.get(Math.round(t)) || 0) + 1); }
  let best = null, n = 0, total = 0; for (const [t, c] of counts) { total += c; if (c > n) { n = c; best = t; } }
  return best && n >= 2 && n >= 0.4 * total ? best : null;
}

/* ================================================================
   Piano scores and other music in chords: every head, timed across the staves of a system
   ================================================================ */
// Which part each staff belongs to. The staves above the piano are parts from the top down, and the piano's two staves
// are the last two parts. A system that leaves a staff out (the voice while the piano plays alone) is matched by clef.
function omrPolyPlan(pages) {
  const systems = [];
  pages.forEach(pg => { if (!pg) return; const by = {}; pg.staves.forEach(s => (by[s.sys] = by[s.sys] || []).push(s)); Object.keys(by).sort((a, b) => a - b).forEach(k => systems.push(by[k])); });
  let ref = [], hasKb = false;
  systems.forEach(g => { if (g.some(s => s.kb)) hasKb = true; });
  // (the line-up of the staves above the piano comes from the systems that have the piano; a cut-off system does not count)
  systems.forEach(g => { if (hasKb && !g.some(s => s.kb)) return; const v = g.filter(s => !s.kb); if (v.length > ref.length) ref = v.map(s => s.clefType); });
  systems.forEach(g => {
    const v = g.filter(s => !s.kb); let last = -1;
    v.forEach((s, j) => {
      let k = j;
      if (v.length < ref.length) { k = -1; for (let q = last + 1; q < ref.length; q++) if (ref[q] === s.clefType) { k = q; break; } if (k < 0) k = Math.min(ref.length - 1, last + 1); }
      s.part = k; last = k;
    });
    g.forEach(s => { if (s.kb) s.part = ref.length + (s.kb === 'U' ? 0 : 1); });
    if (hasKb && !g.some(s => s.kb)) v.forEach(s => { if ((ref[s.part] !== s.clefType || s.part >= ref.length) && s.clefType === 'bass' && !ref.includes('bass')) s.part = ref.length + 1; else if (s.part >= ref.length) s.part = ref.length; });
  });
  const plan = ref.map(c => ({ kb: null, clef: c }));
  if (hasKb) plan.push({ kb: 'U', clef: 'treble' }, { kb: 'L', clef: 'bass' });
  plan.forEach((pl, k) => {   // the clef each part is mostly printed in
    const cnt = {}; systems.forEach(g => g.forEach(s => { if (s.part === k && s.clefType) cnt[s.clefType] = (cnt[s.clefType] || 0) + 1; }));
    const best = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0]; if (best) pl.clef = best;
  });
  return plan;
}

// Puts every note and rest of one bar, on all the staves of the system, at its time in the bar (e.t, in ticks from the
// bar line) and gives the length it sounds for (e.pd). Notes printed one above the other start together, on any staff.
// A staff with one line of music, or a voice whose notes fill the bar, gives sure times by adding its notes up; the
// other notes at those places take the same times. Between them, the next place comes when the shortest note that is
// still sounding ends.
function omrTimeBar(staffEvs, cap, p, short, sureCap) {
  const cols = [], live = []; let multi = 0;
  staffEvs.forEach(evs => evs.forEach(e => {
    if (e.d0 == null) e.d0 = e.d; e.d = e.d0; e.tu = 0;   // (timed again from what was read)
    e.t = null; e.ta = null; e.pd = 0;
    if (e.multi > multi) multi = e.multi;
    // a semibreve rest fills the bar whatever the time signature (in 4/2 it is only half the bar)
    e.whole = e.kind === 'rest' && (!!e.multi || (e.d === 64 && (!cap || cap <= 96 || evs.length === 1)));
    if (!e.whole) live.push(e);
  }));
  live.sort((a, b) => a.x - b.x);
  for (const e of live) { const c = cols[cols.length - 1]; if (c && e.x - c.x < 0.75 * p) c.es.push(e); else cols.push({ x: e.x, es: [e], t: 0 }); e.col = cols.length - 1; }
  // Triplets: a voice that is too long for the bar, with three equal notes in a row that start on a beat of twice their
  // length. Making such groups triplets (three in the time of two) until the voice fills the bar exactly.
  const triplets = S => {
    const sum = S.reduce((a, e) => a + e.d, 0); if (!sureCap || !(sum > cap + 0.01) || S.length > 40) return false;
    const ok3 = i => i + 2 < S.length && [0, 1, 2].every(k => S[i + k].kind === 'note' && !S[i + k].dotted && S[i + k].d === S[i].d) && S[i].d <= 16 && S[i].d >= 2;
    const pick = []; let found = null, steps = 0;
    const walk = (i, t) => {
      if (found || ++steps > 4000) return;
      if (i >= S.length) { if (Math.abs(t - cap) < 0.01) found = pick.slice(); return; }
      if (t > cap + 0.01) return;
      if (ok3(i) && Math.abs(t / (2 * S[i].d) - Math.round(t / (2 * S[i].d))) < 0.01) { pick.push(i); walk(i + 3, t + 2 * S[i].d); pick.pop(); }
      walk(i + 1, t + S[i].d);
    };
    walk(0, 0);
    if (!found) return false;
    for (const i of found) for (let k = 0; k < 3; k++) { S[i + k].d = S[i + k].d * 2 / 3; S[i + k].tu = 3; }
    return true;
  };
  if (cap) staffEvs.forEach(evs => {
    const E = evs.filter(e => !e.whole).sort((a, b) => a.x - b.x); if (!E.length) return;
    const fits = S => S.length > 0 && (Math.abs(S.reduce((a, e) => a + e.d, 0) - cap) < 0.01 || triplets(S));
    const set = S => { let t = 0; S.forEach(e => { e.ta = Math.round(t * 12) / 12; t += e.d; }); };
    if (!E.some((e, i) => i && e.col === E[i - 1].col)) { if (fits(E)) set(E); return; }
    // two voices: stems up and stems down, with the rests in one of them
    const byX = S => S.slice().sort((a, b) => a.x - b.x);
    const U = E.filter(e => e.kind === 'note' && e.up !== false), D = E.filter(e => e.kind === 'note' && e.up === false), R = E.filter(e => e.kind === 'rest');
    let best = null, score = 0;
    for (const o of [[byX(U.concat(R)), D], [U, byX(D.concat(R))]]) { const sc = (fits(o[0]) ? 1 : 0) + (fits(o[1]) ? 1 : 0); if (sc > score) { score = sc; best = o; } }
    if (best) best.forEach(S => { if (fits(S)) set(S); });
  });
  const mode = a => { const c = {}; let b = a[0]; a.forEach(v => { c[v] = (c[v] || 0) + 1; if (c[v] > c[b]) b = v; }); return b; };
  const sure = c => { const v = c.es.filter(e => e.ta != null).map(e => e.ta); return v.length ? mode(v) : null; };
  let bad = false;
  cols.forEach((c, j) => {
    const prev = j ? cols[j - 1].t : 0, known = sure(c); let t;
    if (known != null) t = known;
    else if (!j) t = 0;
    else {
      t = Infinity;
      for (let i = 0; i < j; i++) for (const e of cols[i].es) { const end = Math.round((cols[i].t + e.d) * 12) / 12; if (end > prev + 0.01 && end < t) t = end; }
      if (t === Infinity) t = prev;
      for (let i = j + 1; i < cols.length; i++) { const tn = sure(cols[i]); if (tn == null) continue; if (t >= tn) { bad = true; t = Math.max(prev, Math.floor((prev + tn) / 2)); } break; }   // not past the next sure place
    }
    if (j && t < prev) { bad = true; t = prev; }
    c.t = t;
  });
  let maxEnd = 0; live.forEach(e => { e.t = cols[e.col].t; if (e.t + e.d > maxEnd) maxEnd = e.t + e.d; });
  // a bar may be short at the start of a piece, at its end, and beside a repeat sign
  let L = multi ? multi * (cap || 64) : cap ? (short && maxEnd > 0 && maxEnd < cap ? maxEnd : cap) : (maxEnd || 64);
  live.forEach(e => { if (e.t >= L) { e.t = null; bad = true; } else e.pd = Math.min(e.d, L - e.t); });
  staffEvs.forEach(evs => evs.forEach(e => { if (e.whole) { e.t = 0; e.pd = L; } }));
  if (cap && live.length && Math.abs(maxEnd - L) > 0.01) bad = true;
  return { L, bad };
}

// The bars of each system of a page, every one timed (omrTimeBar). The bar lines are those most staves show.
function omrPolySystems(page, barT) {
  const by = {}, out = [];
  page.staves.forEach(s => (by[s.sys] = by[s.sys] || []).push(s));
  for (const k of Object.keys(by).sort((a, b) => a - b)) {
    const grp = by[k], p = grp[0].p, need = Math.ceil(grp.length / 2);
    const xs = []; grp.forEach(s => s.barX.forEach(x => xs.push(x))); xs.sort((a, b) => a - b);
    const cl = []; xs.forEach(x => { const c = cl[cl.length - 1]; if (c && x - c.x < p) { c.n++; c.x += (x - c.x) / c.n; } else cl.push({ x, n: 1 }); });
    const barX = cl.filter(c => c.n >= need).map(c => c.x);
    const rep = barX.map(x => { let s = 0, e = 0; grp.forEach(st => { const i = st.barX.findIndex(v => Math.abs(v - x) < p); if (i >= 0 && st.barRep[i]) { if (st.barRep[i].start) s++; if (st.barRep[i].end) e++; } }); return { start: s >= need, end: e >= need }; });
    const tsS = grp.map(s => s.pieceTs).find(Boolean), cap = tsS ? tsS[0] * 64 / tsS[1] : barT || null;
    const startsPiece = grp.some(s => s.sec), endsPiece = grp.filter(s => s.endsFinal).length * 2 > grp.length;
    const barOf = x => { let b = 0; while (b < barX.length && barX[b] < x) b++; return b; };
    const bars = [];
    for (let b = 0; b <= barX.length; b++) {
      const evs = grp.map(s => (s.pe || []).filter(e => barOf(e.x) === b));
      if (!evs.some(a => a.length)) continue;
      const x0 = b > 0 ? barX[b - 1] : Math.min(...grp.map(s => s.musicStart)), x1 = b < barX.length ? barX[b] : Math.max(...grp.map(s => s.right));
      const short = (!bars.length && startsPiece) || (b < barX.length && rep[b].end) || (b > 0 && rep[b - 1].start) || (endsPiece && b >= barX.length - 1);
      const r = omrTimeBar(evs, cap, p, short, !!tsS && !(tsS[1] === 8 && tsS[0] % 3 === 0));   // (no triplets guessed in 6/8, 9/8, 12/8)
      bars.push({ b, x0, x1, evs, L: r.L, bad: r.bad, rs: b > 0 && rep[b - 1].start, re: b < barX.length && rep[b].end });
    }
    out.push({ sys: +k, grp, p, barX, bars, cap });
  }
  return out;
}

// The score items of every part (plan: omrPolyPlan), from the timed bars. Each part has one or two voices on its staff:
// items (the upper voice, or the only one) and v2 (the lower voice, when a staff has two). An item is a note or chord
// (m: its top note, ch: the others) or a rest (m null; hid: a gap that is not printed). tn: the notes tied on into the
// next item, tu: 3 for a note of a triplet. A part with no staff in a system rests for its bars.
// The words under a staff (a PDF carries them as text): each syllable goes to the note it stands under.
function omrLyrics(page) {
  if (page._ly || !page.texts || !page.texts.length) return; page._ly = true;
  page.staves.forEach((st, si) => {
    if (!st.pe || !st.pe.length) return;
    const p = st.p, next = page.staves[si + 1], ya = st.bot + 0.8 * p, yb = next && next.top > st.bot ? Math.min(st.bot + 8 * p, next.top - 0.4 * p) : st.bot + 8 * p;
    const notes = st.pe.filter(e => e.kind === 'note'); if (!notes.length) return;
    const words = page.texts.filter(t => t.y > ya && t.y < yb && t.x > st.musicStart - 2 * p && t.size >= 1.1 * p && t.size <= 3.6 * p && /[A-Za-zÀ-ɏ&]/.test(t.str)).sort((a, b) => a.y - b.y || a.x - b.x);
    if (words.length < 2) return;
    const dashes = page.texts.filter(t => t.y > ya && t.y < yb && /^[-–]+$/.test(t.str));
    const lines = []; words.forEach(t => { const l = lines.find(q => Math.abs(q.y - t.y) < 0.6 * p); if (l) l.w.push(t); else lines.push({ y: t.y, w: [t] }); });
    lines.forEach((l, li) => l.w.forEach(t => {
      const cx = t.x + 0.22 * t.size * t.str.length; let best = null, bd = 2.8 * p;
      for (const e of notes) { const dd = Math.abs(e.x - cx); if (dd < bd) { bd = dd; best = e; } }
      if (!best) return;
      const dash = dashes.some(d => Math.abs(d.y - t.y) < 0.6 * p && d.x > t.x && d.x - t.x < 0.5 * t.size * t.str.length + 3 * p);
      best.ly = best.ly || []; best.ly[li] = (best.ly[li] ? best.ly[li] + ' ' : '') + t.str + (dash ? '-' : '');
    }));
  });
}

function omrPolyItems(pages, plan, clef, fifthsOverride, barT) {
  pages.forEach(omrLyrics);
  const parts = plan.map(() => ({ items: [], v2: [], two: false, tied: {} }));
  const R12 = x => Math.round(x * 12) / 12;
  let nBars = 0, nBad = 0;
  for (const page of pages) for (const sy of omrPolySystems(page, barT)) {
    const top = sy.grp[0], secSrc = sy.grp.find(s => s.sec);
    sy.bars.forEach((bar, bi) => {
      nBars++; if (bar.bad) nBad++;
      const mid = (bar.x0 + bar.x1) / 2, vol = (top.voltas || []).find(v => mid >= v.x0 && mid <= v.x1), L = bar.L;
      parts.forEach((P, pi) => {
        const gi = sy.grp.findIndex(s => s.part === pi), st = gi >= 0 ? sy.grp[gi] : null;
        const evs = st ? bar.evs[gi].filter(e => e.t != null && e.pd > 0).sort((a, b) => a.t - b.t || a.x - b.x) : [];
        if (st) {
          const topDia = OMR_TOPDIA[st.clefType] || OMR_TOPDIA[clef] || 32, carry = {}, tiedOut = {};
          const keyOff = omrKeyOff(fifthsOverride != null ? fifthsOverride : st.keyFinal != null ? st.keyFinal : st.fifths);
          for (const e of evs) {
            if (e.kind !== 'note') continue;
            e.ms = []; e.tnm = []; e.sp = {};
            for (const h of e.notes) {
              const dia = topDia - h.step, letter = OMR_LET[((dia % 7) + 7) % 7], oct = Math.floor(dia / 7);
              let off = keyOff[letter];
              if (h.accOff != null) { off = h.accOff; carry[dia] = off; } else if (carry[dia] != null) off = carry[dia];
              let m = 12 * (oct + 1) + OMR_BASE[letter] + off;
              if (e.t === 0 && h.accOff == null && P.tied[dia] != null) { m = P.tied[dia][0]; off = P.tied[dia][1]; }   // tied over the bar line: still the same note
              if (!e.ms.includes(m)) e.ms.push(m);
              if (off) e.sp[m] = off;   // how the note is spelt on the page (a flat stays a flat)
              if (h.tie) { e.tnm.push(m); if (R12(e.t + e.pd) >= L - 0.01) tiedOut[dia] = [m, off]; }
            }
          }
          P.tied = tiedOut;
        } else P.tied = {};
        // one voice, or two: where notes overlap in time the stems tell the voices apart (up: upper voice)
        const over = (a, b) => a.t < b.t + b.pd - 0.01 && b.t < a.t + a.pd - 0.01;
        const two = evs.some((a, i) => evs.some((b, j) => j > i && over(a, b))), V = [[], []];
        for (const e of evs) {
          if (!two) { V[0].push(e); continue; }
          let w = e.kind === 'rest' ? (e.whole ? 0 : e.y < st.top + 2 * st.p ? 0 : 1) : e.up === false ? 1 : 0;
          if (V[w].some(o => over(o, e))) w = 1 - w;
          if (V[w].some(o => over(o, e))) {
            if (e.kind !== 'note') continue;
            const same = V[0].concat(V[1]).find(o => o.kind === 'note' && Math.abs(o.t - e.t) < 0.01);   // no room in either voice: part of the chord that starts with it
            if (same) { e.ms.forEach(m => { if (!same.ms.includes(m)) same.ms.push(m); }); e.tnm.forEach(m => { if (!same.tnm.includes(m)) same.tnm.push(m); }); Object.assign(same.sp, e.sp); }
            continue;
          }
          V[w].push(e);
        }
        if (two) P.two = true;
        const first = [P.items.length, P.v2.length];
        V.forEach((list, vi) => {
          const out = vi ? P.v2 : P.items, hidGap = two || vi === 1; let c = 0;
          list.sort((a, b) => a.t - b.t);
          for (const e of list) {
            if (e.t > c + 0.01) out.push(Object.assign({ m: null, d: R12(e.t - c) }, hidGap ? { hid: true } : {}));
            const d = R12(Math.min(e.pd, L - e.t));
            if (e.kind === 'rest') out.push({ m: null, d });
            else {
              const ms = e.ms.slice().sort((a, b) => b - a), it = { m: ms[0], d };
              if (ms.length > 1) it.ch = ms.slice(1);
              if (e.tnm.length) it.tn = e.tnm.slice();
              if (e.tu) it.tu = e.tu;
              if (Object.keys(e.sp).length) it.sp = e.sp;
              if (e.up != null && two) it.up = e.up;
              if (e.art && e.art.length) it.art = e.art.slice();
              if (e.dyn) it.dyn = e.dyn;
              if (e.ly) it.ly = e.ly.filter(Boolean).join('\n');
              if (e.gr) it.gr = e.gr;
              if (e.ss) it.ss = e.ss;
              if (e.se) it.se = e.se;
              out.push(it);
            }
            c = R12(e.t + d);
          }
          if (c < L - 0.01) out.push(Object.assign({ m: null, d: R12(L - c) }, (hidGap && list.length) || vi === 1 ? { hid: true } : {}));
        });
        const f0 = P.items[first[0]], l0 = P.items[P.items.length - 1], g0 = P.v2[first[1]];
        f0.bar = g0.bar = page.no + '.' + sy.sys; f0.bx = g0.bx = bar.b > 0 ? +(bar.x0 / sy.p).toFixed(2) : 0;
        if (bar.rs) f0.rs = true;
        if (bar.re) l0.re = true;
        if (vol) for (let q = first[0]; q < P.items.length; q++) P.items[q].v = vol.n;
        const sec = bi === 0 ? (st && st.sec) || (secSrc && secSrc.sec) : null;
        if (sec) f0.sec = { k: fifthsOverride != null ? fifthsOverride : sec.k, ts: sec.ts, sym: sec.sym || null, title: sec.title || null, by: sec.by || null, clef: st ? st.clefType || null : null };
      });
    });
  }
  return { parts: parts.map(P => ({ items: P.items, v2: P.two ? P.v2 : null })), bars: nBars, bad: nBad };
}

// Draws what was read on top of the page picture: ctx is scaled so that page pixels are used.
function omrDrawOverlay(ctx, page, expectBar) {
  const polyBad = new Map();
  if (page.poly) for (const sy of omrPolySystems(page, expectBar)) for (const s of sy.grp) polyBad.set(s, sy.bars.filter(b => b.bad));
  const COL = { 128: '#00838f', 64: '#1565c0', 32: '#2e7d32', 16: '#e65100', 8: '#8e24aa', 4: '#c62828' };
  const NAME = { 128: 'B', 64: 'S', 32: 'M', 16: 'C', 8: 'Q', 4: 'q' };
  ctx.lineWidth = Math.max(2, page.U * 0.12); ctx.textAlign = 'center';
  for (const st of page.staves) {
    const p = st.p, exp = st.pieceTs ? st.pieceTs[0] * 64 / st.pieceTs[1] : expectBar;
    // the key signature worked out for this staff (and whether this staff starts a piece)
    const kf = st.keyFinal != null ? st.keyFinal : st.fifths, fixed = kf !== st.fifths;
    ctx.font = `bold ${Math.round(p * 0.8)}px sans-serif`; ctx.textAlign = 'left';
    ctx.fillStyle = fixed ? '#c62828' : '#6a1b9a';
    ctx.fillText((st.sec ? 'New piece · ' : '') + 'Key: ' + (kf === 0 ? 'none' : Math.abs(kf) + (kf > 0 ? ' sharp' : ' flat') + (Math.abs(kf) > 1 ? 's' : '')) + (fixed ? ' (corrected)' : '') + (st.sec && st.sec.ts ? ' · ' + st.sec.ts.join('/') : ''), st.left, st.top - 2.6 * p);
    ctx.textAlign = 'center';
    if (st.pos === 0) (st.voltas || []).forEach(v => { ctx.strokeStyle = '#00838f'; ctx.fillStyle = '#00838f'; ctx.beginPath(); ctx.moveTo(v.x0, v.y + 1.2 * p); ctx.lineTo(v.x0, v.y); ctx.lineTo(v.x1, v.y); ctx.stroke(); ctx.fillText('ending ' + v.n, v.x0 + 2.2 * p, v.y - 0.3 * p); });
    (st.barRep || []).forEach((r, i) => { if (!r.start && !r.end) return; const x = st.barX[i]; ctx.fillStyle = '#00838f'; ctx.fillText((r.end ? ':' : '') + '||' + (r.start ? ':' : ''), x, st.bot + 2.6 * p); });
    st.barX.forEach((x, i) => { const bad = !st.poly && exp && st.totals[i] != null && i >= 1 && Math.round(st.totals[i]) !== exp; ctx.strokeStyle = 'rgba(0,150,0,.55)'; ctx.beginPath(); ctx.moveTo(x, st.top - 0.4 * p); ctx.lineTo(x, st.bot + 0.4 * p); ctx.stroke();
      if (i >= 1 && bad) { ctx.fillStyle = 'rgba(220,0,0,.14)'; ctx.fillRect(st.barX[i - 1], st.top - 0.4 * p, x - st.barX[i - 1], st.bot - st.top + 0.8 * p); } });
    ctx.font = `bold ${Math.round(p * 0.9)}px sans-serif`;
    (polyBad.get(st) || []).forEach(b => { ctx.fillStyle = 'rgba(220,0,0,.14)'; ctx.fillRect(b.x0, st.top - 0.4 * p, b.x1 - b.x0, st.bot - st.top + 0.8 * p); });
    // chords and two voices: every head, with the length of each chord over it (stems up) or under it (stems down)
    if (st.poly) for (const e of st.pe) {
      const base = e.dotted ? e.d * 2 / 3 : e.d, col = e.multi ? '#00838f' : COL[base] || '#000', lab = e.multi ? ' ' + e.multi + ' bars' : (NAME[base] || '?') + (e.dotted ? '.' : '');
      ctx.strokeStyle = col; ctx.fillStyle = col;
      if (e.kind === 'note') {
        let lo = 1e9, hi = -1e9;
        for (const h of e.notes) { if (h.y < lo) lo = h.y; if (h.y > hi) hi = h.y;
          ctx.beginPath(); ctx.ellipse(h.x, h.y, h.half + 0.1 * p, 0.5 * p, 0, 0, 7); ctx.stroke();
          if (h.tie) { ctx.beginPath(); ctx.moveTo(h.x + h.half, h.y + 0.6 * p); ctx.quadraticCurveTo(h.x + h.half + 1.2 * p, h.y + 1.2 * p, h.x + h.half + 2.4 * p, h.y + 0.6 * p); ctx.stroke(); }
          if (h.accOff != null) ctx.fillText(h.accOff > 0 ? '#' : h.accOff < 0 ? 'b' : 'n', h.accBox ? h.accBox.minx - 0.5 * p : h.x - 1.6 * p, h.y + 0.3 * p); }
        ctx.fillText(lab, e.x, e.up === false ? Math.max(st.bot + 1.9 * p, hi + 1.7 * p) : Math.min(st.top - 1.0 * p, lo - 1.1 * p));
      } else { ctx.strokeRect(e.box[0] - 3, e.box[1] - 3, e.box[2] + 6, e.box[3] + 6); ctx.fillText('r' + lab, e.x, st.bot + 1.7 * p); }
    }
    for (const e of (st.poly ? [] : st.elems)) {
      const base = e.dotted ? e.d * 2 / 3 : e.d;
      const col = e.multi ? '#00838f' : COL[base] || '#000', lab = e.multi ? ' ' + e.multi + ' bars' : (NAME[base] || '?') + (e.dotted ? '.' : '');
      ctx.strokeStyle = col; ctx.fillStyle = col;
      if (e.kind === 'note') { ctx.beginPath(); ctx.ellipse(e.x, e.y, e.half + 0.15 * p, 0.55 * p, 0, 0, 7); ctx.stroke();
        if (e.tie) { ctx.beginPath(); ctx.moveTo(e.x + e.half, e.y + 0.9 * p); ctx.quadraticCurveTo(e.x + e.half + 1.2 * p, e.y + 1.6 * p, e.x + e.half + 2.4 * p, e.y + 0.9 * p); ctx.stroke(); } ctx.fillText(lab, e.x, st.top - 1.0 * p - (e.step < 0 ? -e.step * p / 2 : 0)); if (e.accOff != null) { ctx.fillText(e.accOff > 0 ? '#' : e.accOff < 0 ? 'b' : 'n', e.accBox ? (e.accBox.minx + e.accBox.maxx) / 2 : e.x - p, e.y - 1.6 * p); } }
      else { ctx.strokeRect(e.box[0] - 3, e.box[1] - 3, e.box[2] + 6, e.box[3] + 6); ctx.fillText('r' + lab, e.x, st.bot + 1.7 * p); }
    }
  }
}
