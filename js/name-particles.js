// Chữ "NGUYEN / XUAN VINH" khi cuộn xuống:
//   1) giãn cao theo chiều dọc,
//   2) nổi thành khối 3D (nhiều lớp hạt theo chiều sâu) rồi nứt thành các mảnh Voronoi,
//      từng mảnh bay tách ra, xoay, sau đó vụn thành hạt bụi dày đặc,
//   3) cùng lúc nền xanh của phần đầu mờ đi để ảnh hero hiện ra ngay phía sau.
// Hạt lấy mẫu từ đúng vị trí chữ trên trang nên lúc đổi từ chữ sang hạt không bị giật.
(() => {
  const word = document.getElementById("orbitWord");
  const orbit = document.getElementById("orbit");
  if (!word || !orbit) return;

  const STRETCH_END = 0.12;     // giãn dọc trong 12% đầu đoạn cuộn
  const STRETCH = 0.8;          // cao thêm 80%
  const BREAK_END = 0.72;       // vỡ hết ở 72% đoạn cuộn
  const BG_FADE = [0.1, 0.42];  // nền xanh mờ dần trong khoảng này để lộ ảnh hero
  const CELLS = 70;             // số mảnh Voronoi
  const LAYERS = 4;             // số lớp hạt theo chiều sâu (khối 3D)
  const THICK = 0.22;           // độ dày khối = 22% cỡ chữ
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
    window.__nameFx = sp => { word.style.opacity = 1 - clamp(sp / 0.4); setBg(sp); };
    return;
  }

  const cv = document.createElement("canvas");
  cv.className = "name-fx";
  cv.setAttribute("aria-hidden", "true");
  orbit.appendChild(cv);
  const ctx = cv.getContext("2d");

  let W = 0, H = 0, groups = [], cells = [], ready = false, lastSp = 0, oy = 0;
  const rnd = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const shade = (rgb, f) => { let i = 0; return rgb.replace(/[\d.]+/g, v => i++ < 3 ? Math.round(+v * f) : v); };

  function build() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = orbit.clientWidth; H = orbit.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
      colors[li] = cs.color;
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
    oy = wr.bottom - base.top;      // giãn dọc tính từ chân chữ
    word.style.transform = prevT;
    const depth = fs * THICK;

    // Mảnh Voronoi: hạt giống rải trên khung chữ (đã giãn), mỗi mảnh có hướng bay và độ xoay riêng
    const bx = wr.left - base.left, bw = wr.width, by = wr.top - base.top, bh = wr.height;
    cells = Array.from({ length: CELLS }, (_, i) => {
      const x = bx + rnd(i, 11) * bw, y = by + rnd(i, 12) * bh;
      const a = rnd(i, 13) * Math.PI * 2, b = rnd(i, 14) * 2 - 1, sp = 0.5 + rnd(i, 15) * 0.9;
      return {
        x, y: oy + (y - oy) * (1 + STRETCH),
        vx: Math.cos(a) * Math.sqrt(1 - b * b) * sp, vy: (Math.sin(a) * Math.sqrt(1 - b * b) - 0.35) * sp, vz: b * sp,
        rot: (rnd(i, 16) - .5) * 2.4,
        d: clamp(((x - bx) / bw) * 0.32 + rnd(i, 17) * 0.12),   // nứt từ trái sang phải
      };
    });

    const step = 2;
    const layers = W < 760 ? 3 : LAYERS;
    const data = o.getImageData(0, 0, W, H).data;
    const pts = [];
    for (let li = 0; li < 2; li++) for (let L = 0; L < layers; L++) pts.push([]);
    let n = 0;
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const k = (y * W + x) * 4;
      if (data[k + 3] < 140) continue;
      const li = data[k] > 1 ? 1 : 0;
      const sy = oy + (y - oy) * (1 + STRETCH);
      // mảnh gần nhất
      let ci = 0, best = Infinity;
      for (let c = 0; c < cells.length; c++) {
        const dx = cells[c].x - x, dy = cells[c].y - sy, dd = dx * dx + dy * dy;
        if (dd < best) { best = dd; ci = c; }
      }
      for (let L = 0; L < layers; L++) {
        const a = rnd(n, 1) * Math.PI * 2, b = rnd(n, 2) * 2 - 1;
        pts[li * layers + L].push({
          x: x + (rnd(n, 5) - .5) * step, y: sy + (rnd(n, 6) - .5) * step,
          z0: -(L / Math.max(1, layers - 1)) * depth,
          dx: Math.cos(a) * Math.sqrt(1 - b * b), dy: Math.sin(a) * Math.sqrt(1 - b * b) - 0.2, dz: b,
          c: cells[ci], j: rnd(n, 7) * 0.25,     // j: hạt rời mảnh sớm/muộn khác nhau
        });
        n++;
      }
    }
    groups = pts.map((p, gi) => {
      const li = Math.floor(gi / layers), L = gi % layers;
      return { pts: p, color: shade(colors[li] || "rgb(255,255,255)", 1 - L / layers * 0.55), size: step * 1.05, L };
    }).reverse();   // vẽ lớp sau trước
    ready = true;
    draw(lastSp);
  }

  function draw(sp) {
    lastSp = sp;
    setBg(sp);
    const sy = 1 + STRETCH * ease(clamp(sp / STRETCH_END));
    const t = clamp((sp - STRETCH_END) / (BREAK_END - STRETCH_END));
    ctx.clearRect(0, 0, W, H);
    if (!ready || t <= 0) {
      word.style.opacity = "";
      word.style.transformOrigin = "50% 100%";
      word.style.transform = `scaleY(${sy})`;   // giai đoạn 1: chữ thật giãn cao
      return;
    }
    word.style.opacity = "0";
    const cx = W / 2, cy = oy * 0.75;
    const ext = ease(clamp(t / 0.15));             // khối nổi chiều sâu
    const ang = SPIN * ease(t), ca = Math.cos(ang), sa = Math.sin(ang);
    const rise = ease(clamp(t / 0.6)) * 0.22 * H;
    for (const grp of groups) {
      if (grp.L > 0 && ext <= 0) continue;
      ctx.fillStyle = grp.color;
      for (const p of grp.pts) {
        const c = p.c;
        const ct = clamp((t - c.d) / 0.62);         // tiến độ của mảnh
        if (ct >= 1) continue;
        const shard = ease(clamp(ct / 0.55));        // mảnh tách ra như khối cứng
        const dust = clamp((ct - 0.35 - p.j) / 0.5); // rồi vụn thành bụi
        if (dust >= 1) continue;
        // xoay mảnh quanh tâm của nó
        const r = c.rot * shard, cr = Math.cos(r), sr = Math.sin(r);
        const lx = p.x - c.x, ly = p.y - c.y;
        let x = c.x + lx * cr - ly * sr + c.vx * shard * 160;
        let y = c.y + lx * sr + ly * cr + c.vy * shard * 120 - rise;
        let z = p.z0 * ext + c.vz * shard * 260;
        // bụi bay tung
        const d2 = dust * dust;
        x += (p.dx * 380 + c.vx * 260) * d2; y += (p.dy * 300 + c.vy * 200) * d2; z += p.dz * 700 * d2;
        // cả khối xoay quanh trục dọc
        const rx = (x - cx) * ca - z * sa, rz = (x - cx) * sa + z * ca;
        const k = FOCAL / (FOCAL - rz);
        if (k <= 0) continue;
        const size = grp.size * k * (1 - dust * 0.4);
        ctx.globalAlpha = 1 - dust;
        ctx.fillRect(cx + rx * k, cy + (y - cy) * k, size, size);
      }
    }
    ctx.globalAlpha = 1;
  }

  window.__nameFx = draw;
  const rebuild = () => setTimeout(build, 120);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(rebuild);
  addEventListener("resize", rebuild);
})();
