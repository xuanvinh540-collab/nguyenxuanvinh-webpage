// Chuyển cảnh WebGL cho phần ảnh cuộn đầu trang. Hai kiểu (đổi ở MODE):
//   "particles": ảnh vỡ thành hạt, hạt bay lên theo chiều sâu rồi xếp lại thành ảnh kế tiếp (giống hiệu ứng chữ tên)
//   "liquid":    ảnh gợn sóng, tan chảy, xô lệch pixel (bản cũ)
// Tiến độ cuộn lấy từ window.__flyP (đặt trong hàm update() của fly-through). Lỗi WebGL thì giữ ảnh DOM như cũ.
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const fly = document.getElementById("fly");
const stage = fly && fly.querySelector(".stage");
const scenes = fly ? [...fly.querySelectorAll(".scene")] : [];
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MODE = "particles";
const WEAK = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
const STEP = matchMedia("(pointer: coarse)").matches ? 5.5 : WEAK ? 5.5 : 4.25;   // khoảng cách hạt (px): nhỏ = nhiều hạt hơn, nặng hơn
const SCATTER = 0.55;   // hạt bay ra xa bao nhiêu (theo bề ngang màn hình)
const DEPTH = 1.6;      // độ bay theo chiều sâu
const ROT = 0.85;       // ảnh mới hình thành trong không gian 3D xoay (radian), xoay về chính diện khi ghép xong
const RELIEF = 0.35;    // độ nổi khối giả theo độ sáng ảnh trong lúc xoay
const REVEAL = 0.82;    // từ mốc này ảnh thật hiện dần đè lên đám hạt

async function start() {
  if (!stage || scenes.length < 2 || reduce) return;

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: true }); }
  catch { return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.25));
  const cv = renderer.domElement;
  cv.className = "fly-gl";
  scenes[scenes.length - 1].after(cv);

  const loader = new THREE.TextureLoader();
  const load = img => new Promise(res => loader.load(img.currentSrc || img.src, t => {
    t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    res({ tex: t, aspect: t.image.width / t.image.height });
  }, undefined, () => res(null)));
  const items = await Promise.all(scenes.map(s => load(s.querySelector("img"))));
  if (items.some(x => !x)) { cv.remove(); return; }

  const origins = scenes.map(s => {
    const [x, y] = (s.dataset.origin || "50% 50%").split(" ").map(v => parseFloat(v) / 100);
    return new THREE.Vector2(x, 1 - y);
  });

  // khung ảnh chỉnh trong trang edit (object-position + scale trên thẻ img)
  const frames = scenes.map(s => {
    const im = s.querySelector("img");
    const pp = getComputedStyle(im).objectPosition.split(" ").map(v => v.endsWith("%") ? parseFloat(v) / 100 : .5);
    return new THREE.Vector3(pp[0], 1 - (pp[1] ?? .5), parseFloat(im.style.scale) || 1);
  });

  const uniforms = {
    f0: { value: frames[0] }, f1: { value: frames[1] },
    t0: { value: items[0].tex }, t1: { value: items[1].tex },
    asp0: { value: items[0].aspect }, asp1: { value: items[1].aspect },
    o0: { value: origins[0] }, o1: { value: origins[1] },
    s0: { value: 1 }, s1: { value: 1 },
    m: { value: 0 }, time: { value: 0 }, alpha: { value: 1 },
    res: { value: new THREE.Vector2(1, 1) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `
      precision highp float;
      uniform sampler2D t0, t1;
      uniform float asp0, asp1, s0, s1, m, time;
      uniform vec2 o0, o1, res;
      uniform vec3 f0, f1;
      uniform float alpha;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++){ v += a*noise(p); p *= 2.02; a *= .5; } return v; }
      vec2 cover(vec2 uv, float ia, vec3 f){ float sa = res.x/res.y;   // f = vị trí khung (object-position) + phóng to
        uv = (uv - .5) / f.z + .5;
        if (sa > ia) { float k = ia/sa; uv.y = uv.y*k + (1.-k)*f.y; } else { float k = sa/ia; uv.x = uv.x*k + (1.-k)*f.x; } return uv; }
      vec3 samp(sampler2D t, vec2 uv, float ia, vec2 o, float s, vec2 off, float split, vec3 f){
        vec2 c = cover(o + (uv - o)/s + off, ia, f);
        vec2 sh = vec2(split, 0.);
        return vec3(texture2D(t, c + sh).r, texture2D(t, c).g, texture2D(t, c - sh).b);
      }
      void main(){
        vec2 uv = vUv;
        float w = sin(m * 3.14159);                         // mạnh nhất ở giữa lúc chuyển
        float n  = fbm(uv*3.5 + vec2(time*.05, -time*.08));
        float n2 = fbm(uv*3.5 + 17.3 + time*.06);
        vec2 dv = vec2(n - .5, n2 - .5);
        // dải pixel xô lệch
        float row = floor(uv.y * 46.);
        float band = step(.9, hash(vec2(row, floor(time * 14.)))) * w;
        vec2 glitch = vec2(band * (hash(vec2(row, 3.)) - .5) * .09, 0.);
        // gợn sóng chất lỏng
        vec2 rip = vec2(sin(uv.y*24. + time*3.), cos(uv.x*19. + time*2.4)) * .007 * w;
        // mép tan chảy chạy từ dưới lên theo nhiễu
        float edge = smoothstep(.0, 1., clamp(m*1.6 - .3 + (n - .5)*1.1 + (.5 - uv.y)*.25, 0., 1.));
        vec3 a = samp(t0, uv, asp0, o0, s0,  dv*w*.28*(edge + .2) + rip + glitch, .008*w, f0);
        vec3 b = samp(t1, uv, asp1, o1, s1, -dv*w*.28*(1. - edge + .2) + rip + glitch, .008*w, f1);
        gl_FragColor = vec4(mix(a, b, edge), alpha);
      }`,
    depthTest: false, depthWrite: false, transparent: true,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---- Chuyển cảnh bằng hạt: mỗi ô lưới trên màn hình là 1 hạt ----
  // Hạt bắt đầu ở ô của nó trên ảnh cũ (màu ảnh cũ), bay tung theo chiều sâu, rồi về một ô ngẫu nhiên trên ảnh mới (màu ảnh mới).
  const pScene = new THREE.Scene();
  const pUniforms = { ...uniforms, size: { value: STEP }, dpr: { value: renderer.getPixelRatio() } };
  const pMaterial = new THREE.ShaderMaterial({
    uniforms: pUniforms,
    vertexShader: `
      precision highp float;
      attribute vec2 aFrom, aTo;
      attribute vec3 aRnd;
      uniform sampler2D t0, t1;
      uniform float asp0, asp1, s0, s1, m, time, size, dpr;
      uniform vec2 o0, o1, res;
      uniform vec3 f0, f1;
      varying vec3 vCol;
      vec2 cover(vec2 uv, float ia, vec3 f){ float sa = res.x/res.y;   // f = vị trí khung (object-position) + phóng to
        uv = (uv - .5) / f.z + .5;
        if (sa > ia) { float k = ia/sa; uv.y = uv.y*k + (1.-k)*f.y; } else { float k = sa/ia; uv.x = uv.x*k + (1.-k)*f.x; } return uv; }
      void main(){
        // mỗi hạt chạy lệch nhịp một chút để ảnh vỡ và ghép lại dần dần
        float e = clamp((m - aRnd.x * .35) / .65, 0., 1.);
        e = e * e * (3. - 2. * e);
        float burst = sin(e * 3.14159);
        vec3 cb = texture2D(t1, cover(o1 + (aTo - o1) / s1, asp1, f1)).rgb;
        // ảnh mới hình thành trên một mặt phẳng 3D đang xoay (nổi khối theo độ sáng), xoay dần về chính diện
        float ar = res.x / res.y;
        float rp = clamp((m - .3) / .6, 0., 1.); rp = rp * rp * (3. - 2. * rp);
        float ang = ${ROT.toFixed(3)} * (1. - rp);
        float lum = dot(cb, vec3(.299, .587, .114));
        vec3 T = vec3((aTo.x - .5) * ar, aTo.y - .5, (lum - .5) * ${RELIEF.toFixed(3)} * (1. - rp));
        float cy = cos(ang), sy = sin(ang), cx = cos(ang * .35), sx = sin(ang * .35);
        T = vec3(T.x * cy + T.z * sy, T.y, -T.x * sy + T.z * cy);           // xoay quanh trục dọc
        T = vec3(T.x, T.y * cx - T.z * sx, T.y * sx + T.z * cx);            // nghiêng nhẹ
        float kt = 1. / (1. - T.z * .9);
        vec2 target = vec2(T.x * kt / ar, T.y * kt) + .5;
        vec2 pos = mix(aFrom, target, e);
        // bay tung: lệch ngang dọc + xoáy nhẹ + chiều sâu
        vec2 dir = aRnd.yz * 2. - 1.;
        pos += dir * ${SCATTER.toFixed(3)} * burst * vec2(1., res.x / res.y) * .5;
        pos += vec2(sin(pos.y * 9. + time * 1.3), cos(pos.x * 7. - time)) * .02 * burst;
        float z = (aRnd.x - .5) * ${DEPTH.toFixed(3)} * burst;
        vec3 ca = texture2D(t0, cover(o0 + (aFrom - o0) / s0, asp0, f0)).rgb;
        vCol = mix(ca, cb, e);
        vec2 clip = pos * 2. - 1.;
        float k = 1. / (1. - z * .35);                 // phối cảnh: hạt gần to và văng xa hơn
        gl_Position = vec4(clip * k, 0., 1.);
        gl_PointSize = size * dpr * (1. + burst * .8) * k + .5;
      }`,
    fragmentShader: `
      precision highp float;
      varying vec3 vCol;
      void main(){ gl_FragColor = vec4(vCol, 1.); }`,
    depthTest: false, depthWrite: false,
  });
  let points = null;
  function buildPoints(w, h) {
    if (points) { pScene.remove(points); points.geometry.dispose(); }
    const cols = Math.ceil(w / STEP), rows = Math.ceil(h / STEP), n = cols * rows;
    const from = new Float32Array(n * 2), to = new Float32Array(n * 2), rnd = new Float32Array(n * 3);
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = n - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
    for (let i = 0; i < n; i++) {
      from[i * 2] = ((i % cols) + .5) / cols; from[i * 2 + 1] = (Math.floor(i / cols) + .5) / rows;
      const k = order[i];
      to[i * 2] = ((k % cols) + .5) / cols; to[i * 2 + 1] = (Math.floor(k / cols) + .5) / rows;
      rnd[i * 3] = Math.random(); rnd[i * 3 + 1] = Math.random(); rnd[i * 3 + 2] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aFrom", new THREE.BufferAttribute(from, 2));
    g.setAttribute("aTo", new THREE.BufferAttribute(to, 2));
    g.setAttribute("aRnd", new THREE.BufferAttribute(rnd, 3));
    points = new THREE.Points(g, pMaterial);
    points.frustumCulled = false;
    pScene.add(points);
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    uniforms.res.value.set(w, h);
    if (MODE === "particles") buildPoints(w, h);
  }
  addEventListener("resize", resize);
  resize();

  // Cùng nhịp với bản DOM: mỗi ảnh zoom dần về điểm lấy nét, chuyển cảnh trong 35% cuối đoạn
  const N = scenes.length, seg = 1 / N, fade = seg * (MODE === "particles" ? 0.55 : 0.35);   // hạt cần đoạn chuyển dài hơn
  const clamp = v => Math.min(1, Math.max(0, v));
  const zoom = (i, p) => { const t = clamp((p - (i * seg - fade)) / (seg + fade)); return 1 + (i === N - 1 ? 0.12 : 0.65) * t * t; };

  fly.classList.add("gl-on");
  const t0 = performance.now();
  let lastP = -1, lastW = 0;
  (function frame(now) {
    requestAnimationFrame(frame);
    const r = stage.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= innerHeight) return;   // không thấy thì không vẽ
    const p = window.__flyP || 0;
    let idx = 0;
    for (let i = 1; i < N; i++) if (p >= i * seg - fade) idx = i;
    let from = idx, to = idx, m = 0;
    if (idx >= 1 && p < idx * seg) { from = idx - 1; m = clamp((p - (idx * seg - fade)) / fade); }
    uniforms.t0.value = items[from].tex; uniforms.asp0.value = items[from].aspect; uniforms.o0.value = origins[from]; uniforms.s0.value = zoom(from, p); uniforms.f0.value = frames[from]; uniforms.f1.value = frames[to];
    uniforms.t1.value = items[to].tex;   uniforms.asp1.value = items[to].aspect;   uniforms.o1.value = origins[to];   uniforms.s1.value = zoom(to, p);
    // ảnh đứng yên (không cuộn, không chuyển cảnh) thì không vẽ lại
    if (p === lastP && m === 0 && lastW === stage.clientWidth) return;
    lastP = p; lastW = stage.clientWidth;
    uniforms.m.value = m;
    uniforms.time.value = (now - t0) / 1000;
    if (MODE === "particles" && m > 0 && m < 1) {
      // vẽ đám hạt, rồi ảnh thật hiện dần đè lên ở cuối quá trình
      renderer.render(pScene, cam);
      const reveal = clamp((m - REVEAL) / (1 - REVEAL));
      if (reveal > 0) {
        renderer.autoClear = false;
        uniforms.m.value = 1; uniforms.alpha.value = reveal * reveal * (3 - 2 * reveal);
        renderer.render(scene, cam);
        uniforms.m.value = m; uniforms.alpha.value = 1;
        renderer.autoClear = true;
      }
    } else {
      renderer.render(scene, cam);
    }
  })(t0);
}

start();
