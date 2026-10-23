// Ảnh bên dưới (Selected works, Exterior/Interior, Masterplans) được vẽ lại bằng WebGL.
// Khi trang đang trôi, ảnh gợn sóng, cong theo hướng cuộn, tách màu và xô lệch pixel; dừng cuộn thì ảnh trở lại sắc nét.
// Vị trí, parallax, clip-path và độ sáng vẫn lấy từ ảnh DOM nên bố cục không đổi. Lỗi WebGL thì giữ ảnh DOM.
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const SEL = ".work .ph img, .split .card img, .mp-card img";
const STRENGTH = 1;       // độ mạnh hiệu ứng (0.5 = nhẹ, 1.5 = mạnh)
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

async function start() {
  const imgs = [...document.querySelectorAll(SEL)];
  if (reduce || !imgs.length) return;

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" }); }
  catch { return; }
  const dpr = Math.min(devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(dpr);
  const cv = renderer.domElement;
  cv.className = "scroll-gl";
  cv.setAttribute("aria-hidden", "true");
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
    precision highp float;
    uniform sampler2D tex;
    uniform vec4 box;            // khung ảnh trên màn hình: x, y (từ trên xuống), rộng, cao (px)
    uniform float aspect, bright, vel, time, dpr;
    uniform vec2 screen;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    vec3 pick(vec2 uv){
      float ba = box.z / box.w;                     // object-fit: cover
      vec2 c = uv;
      if (ba > aspect) c.y = (c.y - .5) * (aspect / ba) + .5; else c.x = (c.x - .5) * (ba / aspect) + .5;
      return texture2D(tex, vec2(c.x, 1. - c.y)).rgb;
    }
    void main(){
      vec2 px = vec2(gl_FragCoord.x / dpr, screen.y - gl_FragCoord.y / dpr);
      vec2 uv = (px - box.xy) / box.zw;
      float v = vel, a = abs(v);
      // cong theo hướng cuộn (giữa ảnh trễ lại như vải)
      uv.y -= sin(uv.x * 3.14159) * v * .06;
      // gợn sóng chất lỏng
      float n = noise(uv * 4. + time * .4);
      uv.x += sin(uv.y * 14. + time * 2.) * .012 * a + (n - .5) * .03 * a;
      uv.y += (noise(uv * 3. + 9. + time * .3) - .5) * .05 * a;
      // dải pixel xô lệch
      float row = floor(uv.y * 38.);
      uv.x += step(.93, hash(vec2(row, floor(time * 12.)))) * (hash(vec2(row, 7.)) - .5) * .08 * a;
      // tách màu theo hướng cuộn
      vec2 sh = vec2(0., .018 * v);
      vec3 col = vec3(pick(uv + sh).r, pick(uv).g, pick(uv - sh).b);
      gl_FragColor = vec4(col * bright, 1.);
    }`;

  const loader = new THREE.TextureLoader();
  const items = [];
  imgs.forEach(img => {
    const clipEl = img.closest(".ph, .card") || img.parentElement;
    const u = {
      ...shared,
      tex: { value: null }, aspect: { value: 1.5 }, bright: { value: 1 },
      box: { value: new THREE.Vector4() },
    };
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: u, vertexShader, fragmentShader, transparent: true, depthTest: false }));
    mesh.visible = false;
    scene.add(mesh);
    const it = { img, clipEl, u, mesh, ready: false };
    items.push(it);
    loader.load(img.currentSrc || img.src, t => {
      t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
      u.tex.value = t; u.aspect.value = t.image.width / t.image.height;
      it.ready = true; img.classList.add("gl-hide");
    });
  });

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    cam.right = innerWidth; cam.bottom = -innerHeight; cam.updateProjectionMatrix();
    shared.screen.value.set(innerWidth, innerHeight);
  }
  addEventListener("resize", resize);
  resize();

  // clip-path: inset(a b c d) của khung chứa (hiệu ứng mở ảnh khi vào màn hình)
  const insetOf = (el, r) => {
    const m = getComputedStyle(el).clipPath.match(/inset\(([^)]*)\)/);
    if (!m) return [0, 0, 0, 0];
    const v = m[1].trim().split(/\s+/).map((s, i) => s.endsWith("%") ? parseFloat(s) / 100 * (i % 2 ? r.width : r.height) : parseFloat(s) || 0);
    const [t, rr = t, b = t, l = rr] = v;
    return [t, rr, b, l];
  };
  const brightOf = img => { const m = getComputedStyle(img).filter.match(/brightness\(([\d.]+)\)/); return m ? parseFloat(m[1]) : 1; };

  document.documentElement.classList.add("scroll-gl-on");
  let lastY = scrollY, vel = 0;
  const t0 = performance.now();
  (function frame(now) {
    requestAnimationFrame(frame);
    const off = document.body.classList.contains("admin") || document.querySelector(".gallery.open");
    cv.style.visibility = off ? "hidden" : "";
    document.documentElement.classList.toggle("scroll-gl-on", !off);
    if (off) return;

    const dy = scrollY - lastY; lastY = scrollY;
    vel += (dy - vel) * 0.12;
    shared.vel.value = Math.max(-1, Math.min(1, vel / 45)) * STRENGTH;
    shared.time.value = (now - t0) / 1000;

    let any = false;
    for (const it of items) {
      const c = it.clipEl.getBoundingClientRect();
      if (!it.ready || c.bottom < 0 || c.top > innerHeight || c.width === 0) { it.mesh.visible = false; continue; }
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
    if (any) renderer.render(scene, cam); else renderer.clear();
  })(t0);
}

start();
