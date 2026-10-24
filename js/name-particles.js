// Chữ "NGUYEN / XUAN VINH" khi cuộn xuống:
//   1) giãn cao theo chiều dọc,
//   2) nổi thành khối 3D đặc (nhiều lớp hạt theo chiều sâu), nứt nhanh thành mảnh Voronoi rồi vỡ thành bụi,
//   3) bụi bay về đúng vị trí và đổi sang đúng màu của ảnh hero, ghép thành bức ảnh,
//   4) ảnh thật hiện lên thay cho đám hạt.
// Vẽ bằng bộ đệm điểm ảnh (ImageData) nên chạy được vài trăm nghìn hạt.
(() => {
  const word = document.getElementById("orbitWord");
  const orbit = document.getElementById("orbit");
  if (!word || !orbit) return;

  const STRETCH_END = 0.12;     // giãn dọc trong 12% đầu đoạn cuộn
  const STRETCH = 0.8;          // cao thêm 80%
  const BREAK_END = 0.78;       // hết hiệu ứng hạt ở 78% đoạn cuộn
  const BG_FADE = [0.62, 0.76]; // nền xanh mờ đi khi hạt đã ghép xong ảnh
  const CELLS = 70;             // số mảnh Voronoi
  const LAYERS = 10;            // số lớp hạt theo chiều sâu: nhiều lớp = khối đặc hơn, nhiều hạt hơn
  const THICK = 0.34;           // độ dày khối = 34% cỡ chữ
  const SPIN = 0.7;             // cả khối xoay quanh trục dọc khi vỡ (radian)
  const FOCAL = 900;

  const clamp = v => Math.min(1, Math.max(0, v));
  const ease = v => v * v * (3 - 2 * v);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setBg(sp) {
    const a = 1 - ease(clamp((sp - BG_FADE[0]) / (BG_FADE[1] - BG_FADE[0])));
    orbit.style.setProperty("--orbit-bg", a);
    [orbit.querySelector("canvas.contour"), ...orbit.querySelectorAll(".meta")].forEach(el => el && (el.style.opacity = a));
  }

  if (reduce) {
    window.__nameFx = sp => { word.style.opacity = 1 - clamp(sp / 0.4); setBg(sp * 1.6); };
    return;
  }

  const cv = document.createElement("canvas");
  cv.className = "name-fx";
  cv.setAttribute("aria-hidden", "true");
  orbit.appendChild(cv);
  const ctx = cv.getContext("2d");

  let gridCell = 2;
  let W = 0, H = 0, N = 0, ready = false, lastSp = 0, oy = 0, img32 = null, imgData = null;
  // dữ liệu hạt (mảng số cho nhanh)
  let PX, PY, PZ, DX, DY, DZ, J, CI, TX, TY, CA, CB;   // CA: màu chữ, CB: màu ảnh (ABGR)
  let cells = [];
  const rnd = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const rgbOf = s => (s.match(/[\d.]+/g) || [255, 255, 255]).slice(0, 3).map(Number);
  const pack = (r, g, b) => (255 << 24 | b << 16 | g << 8 | r) >>> 0;

  // ảnh hero (ảnh đầu tiên của phần cuộn), vẽ kiểu cover vào khung màn hình
  async function heroPixels(w, h) {
    const img = document.querySelector("#fly .scene img");
    if (!img) return null;
    try { if (!img.complete) await img.decode(); } catch { return null; }
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
    g.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
    try { return g.getImageData(0, 0, w, h).data; } catch { return null; }
  }

  async function build() {
    W = orbit.clientWidth; H = orbit.clientHeight;
    cv.width = W; cv.height = H;   // 1 điểm ảnh canvas = 1px CSS, hạt vẽ thành ô 2–3px
    imgData = ctx.createImageData(W, H);
    img32 = new Uint32Array(imgData.data.buffer);

    const prevT = word.style.transform; word.style.transform = "none";
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const o = off.getContext("2d", { willReadFrequently: true });
    const base = orbit.getBoundingClientRect();
    const colors = [];
    let fs = 100;
    word.querySelectorAll(".w1, .w2").forEach((line, li) => {
      const cs = getComputedStyle(line);
      if (li === 0) fs = parseFloat(cs.fontSize);
      o.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      o.fillStyle = `rgb(${li + 1}, 0, 0)`;   // đánh dấu dòng bằng kênh đỏ
      colors[li] = rgbOf(cs.color);
      const tn = line.firstChild, range = document.createRange();
      for (let i = 0; i < tn.length; i++) {
        const ch = tn.data[i].toUpperCase();
        if (ch === " ") continue;
        range.setStart(tn, i); range.setEnd(tn, i + 1);
        const r = range.getBoundingClientRect();
        const m = o.measureText(ch);
        const asc = m.fontBoundingBoxAscent || m.actualBoundingBoxAscent, desc = m.fontBoundingBoxDescent || m.actualBoundingBoxDescent;
        o.fillText(ch, r.left - base.left, r.top - base.top + (r.height - asc - desc) / 2 + asc);
      }
    });
    const wr = word.getBoundingClientRect();
    oy = wr.bottom - base.top;
    word.style.transform = prevT;
    const depth = fs * THICK;

    const bx = wr.left - base.left, bw = wr.width, by = wr.top - base.top, bh = wr.height;
    cells = Array.from({ length: CELLS }, (_, i) => {
      const x = bx + rnd(i, 11) * bw, y = by + rnd(i, 12) * bh;
      const a = rnd(i, 13) * Math.PI * 2, b = rnd(i, 14) * 2 - 1, sp = 0.5 + rnd(i, 15) * 0.9;
      return {
        x, y: oy + (y - oy) * (1 + STRETCH),
        vx: Math.cos(a) * Math.sqrt(1 - b * b) * sp, vy: (Math.sin(a) * Math.sqrt(1 - b * b) - 0.35) * sp, vz: b * sp,
        rot: (rnd(i, 16) - .5) * 2.4,
        d: clamp(((x - bx) / bw) * 0.08 + rnd(i, 17) * 0.05),
      };
    });

    const layers = W < 760 ? 5 : LAYERS;
    const step = 2;
    const data = o.getImageData(0, 0, W, H).data;
    const samples = [];
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const k = (y * W + x) * 4;
      if (data[k + 3] >= 140) samples.push(x, y, data[k] > 1 ? 1 : 0);
    }
    N = (samples.length / 3) * layers;
    PX = new Float32Array(N); PY = new Float32Array(N); PZ = new Float32Array(N);
    DX = new Float32Array(N); DY = new Float32Array(N); DZ = new Float32Array(N);
    J = new Float32Array(N); CI = new Uint16Array(N); TX = new Float32Array(N); TY = new Float32Array(N);
    CA = new Uint32Array(N); CB = new Uint32Array(N);

    const hero = await heroPixels(W, H);
    // điểm đến chia đều theo lưới để ảnh ghép lại kín, không lỗ chỗ
    const g = Math.max(2, Math.sqrt((W * H) / N));
    const cols = Math.ceil(W / g), slots = cols * Math.ceil(H / g);
    gridCell = g;
    let n = 0;
    for (let s = 0; s < samples.length; s += 3) {
      const x = samples[s], y = samples[s + 1], li = samples[s + 2];
      const sy = oy + (y - oy) * (1 + STRETCH);
      let ci = 0, best = Infinity;
      for (let c = 0; c < cells.length; c++) {
        const dx = cells[c].x - x, dy = cells[c].y - sy, dd = dx * dx + dy * dy;
        if (dd < best) { best = dd; ci = c; }
      }
      for (let L = 0; L < layers; L++, n++) {
        const a = rnd(n, 1) * Math.PI * 2, b = rnd(n, 2) * 2 - 1;
        PX[n] = x + (rnd(n, 5) - .5) * step; PY[n] = sy + (rnd(n, 6) - .5) * step;
        PZ[n] = -(L / Math.max(1, layers - 1)) * depth;
        DX[n] = Math.cos(a) * Math.sqrt(1 - b * b); DY[n] = Math.sin(a) * Math.sqrt(1 - b * b) - 0.2; DZ[n] = b;
        J[n] = rnd(n, 7); CI[n] = ci;
        const f = 1 - (L / layers) * 0.6;   // lớp sau tối hơn: thấy rõ bề dày khối
        const col = colors[li] || [255, 255, 255];
        CA[n] = pack(col[0] * f | 0, col[1] * f | 0, col[2] * f | 0);
        // điểm đến trên ảnh hero và màu tại đó
        const slot = Math.floor(rnd(n, 8) * slots);
        const tx = Math.min(W - 1, (slot % cols) * g + rnd(n, 9) * g), ty = Math.min(H - 1, Math.floor(slot / cols) * g + rnd(n, 10) * g);
        TX[n] = tx; TY[n] = ty;
        if (hero) { const q = ((ty | 0) * W + (tx | 0)) * 4; CB[n] = pack(hero[q], hero[q + 1], hero[q + 2]); }
        else CB[n] = CA[n];
      }
    }
    ready = true;
    draw(lastSp);
  }

  function draw(sp) {
    lastSp = sp;
    setBg(sp);
    const sy = 1 + STRETCH * ease(clamp(sp / STRETCH_END));
    const t = clamp((sp - STRETCH_END) / (BREAK_END - STRETCH_END));
    if (!ready || t <= 0 || t >= 1) {
      ctx.clearRect(0, 0, W, H);
      word.style.opacity = t >= 1 ? "0" : "";
      word.style.transformOrigin = "50% 100%";
      word.style.transform = `scaleY(${sy})`;   // giai đoạn 1: chữ thật giãn cao
      return;
    }
    word.style.opacity = "0";
    img32.fill(0);
    const cx = W / 2, cy = oy * 0.75;
    const ext = ease(clamp(t / 0.12));                  // khối nổi chiều sâu
    const rise = ease(clamp(t / 0.4)) * 0.2 * H;
    const fadeOut = clamp((sp - BG_FADE[0]) / (BG_FADE[1] - BG_FADE[0]));   // hạt thưa dần khi ảnh thật hiện
    for (let i = 0; i < N; i++) {
      if (J[i] < fadeOut) continue;
      const c = cells[CI[i]];
      const shard = ease(clamp((t - c.d) / 0.12));                        // mảnh tách ra (nhanh)
      const dust = ease(clamp((t - 0.05 - c.d - J[i] * 0.08) / 0.32));    // vỡ thành bụi
      const conv = ease(clamp((t - 0.42 - J[i] * 0.14) / 0.36));          // bay về ghép thành ảnh
      // mảnh xoay quanh tâm của nó
      const r = c.rot * shard * (1 - dust * 0.5), cr = Math.cos(r), sr = Math.sin(r);
      const lx = PX[i] - c.x, ly = PY[i] - c.y;
      let x = c.x + lx * cr - ly * sr + c.vx * shard * 70;
      let y = c.y + lx * sr + ly * cr + c.vy * shard * 50 - rise;
      let z = PZ[i] * ext + c.vz * shard * 120;
      const d2 = dust * dust;
      x += (DX[i] * 300 + c.vx * 200) * d2; y += (DY[i] * 230 + c.vy * 150) * d2; z += DZ[i] * 620 * d2;
      // cả khối xoay quanh trục dọc (giảm dần khi ghép ảnh)
      const ang = SPIN * ease(t) * (1 - conv), ca = Math.cos(ang), sa = Math.sin(ang);
      const rx = (x - cx) * ca - z * sa, rz = ((x - cx) * sa + z * ca) * (1 - conv);
      const k = FOCAL / (FOCAL - rz);
      if (k <= 0) continue;
      let sx = cx + rx * k, sy2 = cy + (y - cy) * k;
      sx += (TX[i] - sx) * conv; sy2 += (TY[i] - sy2) * conv;
      const ix = sx | 0, iy = sy2 | 0;
      if (ix < 0 || iy < 0 || ix >= W - 6 || iy >= H - 6) continue;
      // màu: từ màu chữ chuyển dần sang màu ảnh
      let col = CA[i];
      if (conv > 0) {
        const a = CA[i], b = CB[i];
        const R = (a & 255) + (((b & 255) - (a & 255)) * conv) | 0;
        const G = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * conv) | 0;
        const B = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * conv) | 0;
        col = pack(R, G, B);
      }
      // khi ghép ảnh, mỗi hạt phình ra lấp ô lưới của nó -> ảnh kín như mosaic
      const size = Math.min(6, Math.round((k > 1.3 ? 3 : 2) + (gridCell * 1.15 - 2) * conv * conv));
      let o = iy * W + ix;
      for (let yy = 0; yy < size; yy++, o += W) for (let xx = 0; xx < size; xx++) img32[o + xx] = col;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  window.__nameFx = draw;
  const rebuild = () => setTimeout(build, 120);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(rebuild);
  addEventListener("resize", rebuild);
})();
