// Ảnh bên dưới (Selected works, Exterior/Interior, Masterplans) méo theo tốc độ cuộn bằng WebGL.
// Chỉ bật khi trang đang trôi: lúc đứng yên canvas tắt hẳn, trang hiện ảnh DOM bình thường nên không tốn gì.
// Vị trí, parallax, clip-path và độ sáng lấy từ ảnh DOM nên bố cục không đổi. Lỗi WebGL thì giữ ảnh DOM.
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const SEL = ".work .ph img, .split .card img, .mp-card img";
const STRENGTH = 1;       // độ mạnh hiệu ứng (0.5 = nhẹ, 1.5 = mạnh)
const MAX_TEX = 1600;     // thu nhỏ ảnh trước khi đưa lên GPU (px cạnh dài)
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const touch = matchMedia("(pointer: coarse)").matches;   // điện thoại: bỏ hiệu ứng này cho nhẹ

async function start() {
  const imgs = [...document.querySelectorAll(SEL)];
  if (reduce || touch || !imgs.length) return;

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "high-performance" }); }
  catch { return; }
  const dpr = 1;   // ảnh đang chuyển động nên độ phân giải 1x là đủ
  renderer.setPixelRatio(dpr);
  const cv = renderer.domElement;
  cv.className = "scroll-gl";
  cv.setAttribute("aria-hidden", "true");
  cv.style.visibility = "hidden";
  document.getElementById("bgContour").after(cv);

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
  const geo = new THREE.PlaneGeometry(1, 1);
  const shared = {
    vel: { value: 0 }, time: { value: 0 },
    screen: { value: new THREE.Vector2(1, 1) }, dpr: { value: dpr },
  };

  const vertexShader = `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
  const fragmentShader = `
    precision mediump float;
    uniform sampler2D tex;
    uniform vec4 box;            // khung ảnh trên màn hình: x, y (từ trên xuống), rộng, cao (px)
    uniform float aspect, bright, vel, time, dpr;
    uniform vec2 screen;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    vec2 coverUv(vec2 uv){
      float ba = box.z / box.w;                     // object-fit: cover
      if (ba > aspect) uv.y = (uv.y - .5) * (aspect / ba) + .5; else uv.x = (uv.x - .5) * (ba / aspect) + .5;
      return vec2(uv.x, 1. - uv.y);
    }
    void main(){
      vec2 px = vec2(gl_FragCoord.x / dpr, screen.y - gl_FragCoord.y / dpr);
      vec2 uv = (px - box.xy) / box.zw;
      float v = vel, a = abs(v);
      uv.y -= sin(uv.x * 3.14159) * v * .06;                                   // cong theo hướng cuộn
      float n = noise(uv * 4. + time * .4);
      uv.x += sin(uv.y * 14. + time * 2.) * .012 * a + (n - .5) * .03 * a;    // gợn sóng
      uv.y += (n - .5) * .04 * a;
      float row = floor(uv.y * 38.);
      uv.x += step(.93, hash(vec2(row, floor(time * 12.)))) * (hash(vec2(row, 7.)) - .5) * .08 * a;   // dải pixel xô lệch
      vec2 c = coverUv(uv), sh = vec2(0., .018 * v);
      vec3 col = vec3(texture2D(tex, c + sh).r, texture2D(tex, c).g, texture2D(tex, c - sh).b);   // tách màu
      gl_FragColor = vec4(col * bright, 1.);
    }`;

  // Thu nhỏ ảnh trước khi đưa lên GPU: đỡ bộ nhớ và đỡ giật lúc tải
  const shrink = img => {
    const k = Math.min(1, MAX_TEX / Math.max(img.width, img.height));
    if (k === 1) return img;
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  };

  const items = [];
  imgs.forEach(img => {
    const clipEl = img.closest(".ph, .card") || img.parentElement;
    const u = {
      ...shared,
      tex: { value: null }, aspect: { value: 1.5 }, bright: { value: 1 },
      box: { value: new THREE.Vector4() },
    };
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: u, vertexShader, fragmentShader, depthTest: false }));
    mesh.visible = false;
    scene.add(mesh);
    const it = { img, clipEl, u, mesh, ready: false };
    items.push(it);
    // chỉ tải texture khi ảnh sắp vào màn hình
    const io = new IntersectionObserver(es => {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      const src = new Image();
      src.decoding = "async";
      src.onload = () => {
        const t = new THREE.Texture(shrink(src));
        t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
        u.tex.value = t; u.aspect.value = src.width / src.height;
        renderer.initTexture(t);
        it.ready = true; img.classList.add("gl-hide");
      };
      src.src = img.currentSrc || img.src;
    }, { rootMargin: "100% 0px" });
    io.observe(clipEl);
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

  const root = document.documentElement;
  let lastY = scrollY, vel = 0, active = false;
  const t0 = performance.now();
  function setActive(on) {
    if (on === active) return;
    active = on;
    root.classList.toggle("scroll-gl-on", on);
    cv.style.visibility = on ? "" : "hidden";
  }
  (function frame(now) {
    requestAnimationFrame(frame);
    const dy = scrollY - lastY; lastY = scrollY;
    vel += (dy - vel) * 0.12;
    const v = Math.max(-1, Math.min(1, vel / 45)) * STRENGTH;
    const off = document.body.classList.contains("admin") || document.querySelector(".gallery.open");
    // đứng yên hoặc gần như yên: tắt WebGL, trả lại ảnh DOM
    if (off || Math.abs(v) < 0.04) { setActive(false); return; }

    shared.vel.value = v;
    shared.time.value = (now - t0) / 1000;
    let any = false;
    for (const it of items) {
      if (!it.ready) { it.mesh.visible = false; continue; }
      const c = it.clipEl.getBoundingClientRect();
      if (c.bottom < 0 || c.top > innerHeight || c.width === 0) { it.mesh.visible = false; continue; }
      const [t, r, b, l] = insetOf(it.clipEl, c);
      const x = c.left + l, y = c.top + t, w = c.width - l - r, h = c.height - t - b;
      if (w <= 1 || h <= 1) { it.mesh.visible = false; continue; }
      const ir = it.img.getBoundingClientRect();
      it.u.box.value.set(ir.left, ir.top, ir.width, ir.height);
      it.u.bright.value = brightOf(it.img);
      it.mesh.position.set(x + w / 2, -(y + h / 2), 0);
      it.mesh.scale.set(w, h, 1);
      it.mesh.visible = any = true;
    }
    if (!any) { setActive(false); return; }
    renderer.render(scene, cam);
    setActive(true);
  })(t0);
}

start();
