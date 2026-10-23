// Chữ "NGUYEN / XUAN VINH": khi cuộn xuống thì giãn rộng, trượt lên, mờ dần và tan thành hạt 3D.
// Hạt được lấy mẫu từ đúng vị trí chữ trên trang nên lúc đổi từ chữ sang hạt không bị giật.
(() => {
  const word = document.getElementById("orbitWord");
  const orbit = document.getElementById("orbit");
  if (!word || !orbit) return;

  const START = 0.03;     // bắt đầu tan khi cuộn được 3% đoạn hero
  const SPAN = 0.62;      // tan hết sau 62% đoạn hero
  const WIDEN = 0.5;      // giãn ngang thêm 50%
  const RISE = 0.32;      // trượt lên 32% chiều cao màn hình
  const DEPTH = 700;      // độ bay sâu theo trục z (px)
  const FOCAL = 900;      // tiêu cự phối cảnh

  const clamp = v => Math.min(1, Math.max(0, v));
  const ease = v => v * v * (3 - 2 * v);

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.__nameFx = sp => { word.style.opacity = 1 - clamp(sp / 0.4); };
    return;
  }

  const cv = document.createElement("canvas");
  cv.className = "name-fx";
  cv.setAttribute("aria-hidden", "true");
  orbit.appendChild(cv);
  const ctx = cv.getContext("2d");

  let W = 0, H = 0, groups = [], ready = false, lastSp = 0;
  const rnd = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };

  function build() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = orbit.clientWidth; H = orbit.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Vẽ lại chữ lên canvas ẩn, đúng từng ký tự theo vị trí trên trang
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const o = off.getContext("2d", { willReadFrequently: true });
    const base = orbit.getBoundingClientRect();
    const colors = [];
    word.querySelectorAll(".w1, .w2").forEach((line, li) => {
      const cs = getComputedStyle(line);
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

    // Lấy mẫu điểm ảnh thành hạt
    const step = Math.max(2, Math.round(W / 640));
    const data = o.getImageData(0, 0, W, H).data;
    const pts = [[], []];
    let n = 0;
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const k = (y * W + x) * 4;
      if (data[k + 3] < 140) continue;
      const li = data[k] > 1 ? 1 : 0;
      const a = rnd(n, 1) * Math.PI * 2, b = rnd(n, 2) * 2 - 1;
      pts[li].push({
        x, y,
        dx: Math.cos(a) * Math.sqrt(1 - b * b), dy: Math.sin(a) * Math.sqrt(1 - b * b) - 0.35, dz: b,
        d: clamp((x / W) * 0.25 + rnd(n, 3) * 0.2),   // trễ theo vị trí: tan từ trái sang phải
      });
      n++;
    }
    groups = pts.map((p, li) => ({ pts: p, color: colors[li] || "#fff", size: step * 1.1 }));
    ready = true;
    draw(lastSp);
  }

  function draw(sp) {
    lastSp = sp;
    const t = clamp((sp - START) / SPAN);
    if (!ready || t <= 0) {
      word.style.opacity = "";
      word.style.transform = "";
      ctx.clearRect(0, 0, W, H);
      return;
    }
    word.style.opacity = "0";
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.72;
    const g = ease(clamp(t / 0.45));                // giai đoạn giãn rộng + trượt lên
    const rise = g * RISE * H;
    for (const grp of groups) {
      ctx.fillStyle = grp.color;
      for (const p of grp.pts) {
        const lt = clamp((t - p.d) / 0.55);
        if (lt >= 1) continue;
        const s = lt * lt;
        const x0 = cx + (p.x - cx) * (1 + WIDEN * g);
        const y0 = p.y - rise;
        const X = x0 + p.dx * s * 420, Y = y0 + p.dy * s * 320, Z = p.dz * s * DEPTH;
        const k = FOCAL / (FOCAL - Z);
        const size = grp.size * k * (1 - lt * 0.4);
        ctx.globalAlpha = (1 - lt) * (1 - g * 0.25);
        ctx.fillRect(cx + (X - cx) * k, cy + (Y - cy) * k, size, size);
      }
    }
    ctx.globalAlpha = 1;
  }

  window.__nameFx = draw;
  // dựng hạt sau khi font đã tải và dòng "XUAN VINH" đã được canh bề ngang
  const rebuild = () => setTimeout(build, 120);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(rebuild);
  addEventListener("resize", rebuild);
})();
