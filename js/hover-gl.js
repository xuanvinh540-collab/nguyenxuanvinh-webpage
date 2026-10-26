// Ảnh bên dưới (Selected works, Exterior/Interior, Masterplans): rê chuột vào ảnh thì ảnh gợn sóng lan ra
// từ chỗ con trỏ, tách màu và xô lệch pixel trong khoảng 1 giây rồi lắng lại. Cuộn trang không gây hiệu ứng.
// Chỉ ảnh đang có hiệu ứng mới vẽ bằng WebGL; các ảnh khác (và lúc không rê chuột) là ảnh DOM bình thường.
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const SEL = ".work .ph img, .split .card img, .mp-card img";
const DURATION = 1000;    // thời gian hiệu ứng (ms)
const STRENGTH = 1;       // độ mạnh (0.5 = nhẹ, 1.5 = mạnh)
const MAX_TEX = 1600;     // thu nhỏ ảnh trước khi đưa lên GPU (px cạnh dài)
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const canHover = matchMedia("(hover: hover) and (pointer: fine)").matches;   // điện thoại không có rê chuột

async function start() {
  const imgs = [...document.querySelectorAll(SEL)];
  if (reduce || !canHover || !imgs.length) return;

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "high-performance" }); }
  catch { return; }
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  const cv = renderer.domElement;
  cv.className = "hover-gl";
  cv.setAttribute("aria-hidden", "true");
  document.getElementById("bgContour").after(cv);

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
  const geo = new THREE.PlaneGeometry(1, 1);
  const shared = { time: { value: 0 }, screen: { value: new THREE.Vector2(1, 1) }, dpr: { value: dpr } };

  const vertexShader = `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
  const fragmentShader = `
    precision mediump float;
    uniform sampler2D tex;
    uniform vec4 box;            // khung ảnh trên màn hình: x, y (từ trên xuống), rộng, cao (px)
    uniform vec2 mouse;
    uniform vec2 fpos;           // object-position của ảnh (0..1, từ trên xuống)          // điểm bắt đầu gợn (toạ độ trong khung ảnh, 0..1)
    uniform float aspect, bright, amp, prog, time, dpr;
    uniform vec2 screen;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    vec2 coverUv(vec2 uv){
      float ba = box.z / box.w;                     // object-fit: cover
      if (ba > aspect) { float k = aspect / ba; uv.y = uv.y * k + (1. - k) * fpos.y; } else { float k = ba / aspect; uv.x = uv.x * k + (1. - k) * fpos.x; }
      return vec2(uv.x, 1. - uv.y);
    }
    void main(){
      vec2 px = vec2(gl_FragCoord.x / dpr, screen.y - gl_FragCoord.y / dpr);
      vec2 uv = (px - box.xy) / box.zw;
      // sóng tròn lan ra từ con trỏ
      vec2 d = (uv - mouse) * vec2(box.z / box.w, 1.);
      float r = length(d);
      float front = prog * 1.6;                                   // mép sóng chạy ra ngoài theo thời gian
      float wave = sin((r - front) * 38.) * exp(-abs(r - front) * 7.);
      uv += normalize(d + 1e-4) * wave * .022 * amp;
      // gợn chất lỏng nhỏ + dải pixel xô lệch
      uv += (vec2(noise(uv * 5. + time), noise(uv * 5. + 7. - time)) - .5) * .02 * amp;
      float row = floor(uv.y * 40.);
      uv.x += step(.92, hash(vec2(row, floor(time * 14.)))) * (hash(vec2(row, 3.)) - .5) * .07 * amp;
      vec2 c = coverUv(uv), sh = vec2(.012 * amp, 0.);
      vec3 col = vec3(texture2D(tex, c + sh).r, texture2D(tex, c).g, texture2D(tex, c - sh).b);   // tách màu
      gl_FragColor = vec4(col * bright, 1.);
    }`;

  const shrink = img => {
    const k = Math.min(1, MAX_TEX / Math.max(img.width, img.height));
    if (k === 1) return img;
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  };

  const items = imgs.map(img => {
    const clipEl = img.closest(".ph, .card") || img.parentElement;
    const u = {
      ...shared,
      tex: { value: null }, aspect: { value: 1.5 }, bright: { value: 1 },
      box: { value: new THREE.Vector4() }, mouse: { value: new THREE.Vector2(.5, .5) }, fpos: { value: new THREE.Vector2(.5, .5) },
      amp: { value: 0 }, prog: { value: 0 },
    };
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: u, vertexShader, fragmentShader, depthTest: false }));
    mesh.visible = false;
    scene.add(mesh);
    const it = { img, clipEl, u, mesh, ready: false, loading: false, start: -1 };

    const load = () => {
      if (it.loading) return;
      it.loading = true;
      const src = new Image();
      src.decoding = "async";
      src.onload = () => {
        const t = new THREE.Texture(shrink(src));
        t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
        u.tex.value = t; u.aspect.value = src.width / src.height;
        renderer.initTexture(t);
        it.ready = true;
      };
      src.src = img.currentSrc || img.src;
    };
    // tải texture khi ảnh sắp vào màn hình, để rê chuột là chạy ngay
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { io.disconnect(); load(); } }, { rootMargin: "50% 0px" });
    io.observe(clipEl);

    clipEl.addEventListener("pointerenter", e => {
      if (e.pointerType !== "mouse" || document.body.classList.contains("admin")) return;
      load();
      const r = clipEl.getBoundingClientRect();
      u.mouse.value.set((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      it.start = performance.now();
      wake();
    });
    return it;
  });

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    cam.right = innerWidth; cam.bottom = -innerHeight; cam.updateProjectionMatrix();
    shared.screen.value.set(innerWidth, innerHeight);
  }
  addEventListener("resize", resize);
  resize();

  const insetOf = (el, r) => {
    const m = getComputedStyle(el).clipPath.match(/inset\(([^)]*)\)/);
    if (!m) return [0, 0, 0, 0];
    const v = m[1].trim().split(/\s+/).map((s, i) => s.endsWith("%") ? parseFloat(s) / 100 * (i % 2 ? r.width : r.height) : parseFloat(s) || 0);
    const [t, rr = t, b = t, l = rr] = v;
    return [t, rr, b, l];
  };
  const brightOf = img => { const m = getComputedStyle(img).filter.match(/brightness\(([\d.]+)\)/); return m ? parseFloat(m[1]) : 1; };

  // Vòng vẽ chỉ chạy khi có ảnh đang hiệu ứng; xong thì dừng hẳn
  let running = false;
  const t0 = performance.now();
  function wake() { if (!running) { running = true; requestAnimationFrame(frame); } }
  function frame(now) {
    shared.time.value = (now - t0) / 1000;
    let any = false;
    for (const it of items) {
      const k = it.start < 0 ? 1 : (now - it.start) / DURATION;
      const live = it.ready && k < 1 && !document.body.classList.contains("admin");
      it.img.classList.toggle("gl-live", live);
      if (!live) { it.mesh.visible = false; if (k >= 1) it.start = -1; continue; }
      const c = it.clipEl.getBoundingClientRect();
      const [t, r, b, l] = insetOf(it.clipEl, c);
      const x = c.left + l, y = c.top + t, w = c.width - l - r, h = c.height - t - b;
      const ir = it.img.getBoundingClientRect();
      it.u.box.value.set(ir.left, ir.top, ir.width, ir.height);
      it.u.bright.value = brightOf(it.img);
      const pp = getComputedStyle(it.img).objectPosition.split(" ").map(v => v.endsWith("%") ? parseFloat(v) / 100 : .5);
      it.u.fpos.value.set(pp[0], pp[1] ?? .5);
      it.u.prog.value = k;
      it.u.amp.value = Math.sin(Math.PI * Math.min(1, k * 1.15)) * STRENGTH;   // mạnh nhanh rồi lắng dần
      it.mesh.position.set(x + w / 2, -(y + h / 2), 0);
      it.mesh.scale.set(w, h, 1);
      it.mesh.visible = any = true;
    }
    renderer.render(scene, cam);
    if (any) requestAnimationFrame(frame); else running = false;
  }
}

start();
