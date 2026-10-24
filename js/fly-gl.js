// Chuyển cảnh WebGL cho phần cuộn Bai Om: ảnh gợn sóng, tan chảy, xô lệch pixel khi sang ảnh mới.
// Tiến độ cuộn lấy từ window.__flyP (đặt trong hàm update() của fly-through). Lỗi WebGL thì giữ ảnh DOM như cũ.
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const fly = document.getElementById("fly");
const stage = fly && fly.querySelector(".stage");
const scenes = fly ? [...fly.querySelectorAll(".scene")] : [];
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

async function start() {
  if (!stage || scenes.length < 2 || reduce) return;

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" }); }
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

  const uniforms = {
    t0: { value: items[0].tex }, t1: { value: items[1].tex },
    asp0: { value: items[0].aspect }, asp1: { value: items[1].aspect },
    o0: { value: origins[0] }, o1: { value: origins[1] },
    s0: { value: 1 }, s1: { value: 1 },
    m: { value: 0 }, time: { value: 0 },
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
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++){ v += a*noise(p); p *= 2.02; a *= .5; } return v; }
      vec2 cover(vec2 uv, float ia){ float sa = res.x/res.y;
        if (sa > ia) uv.y = (uv.y-.5)*(ia/sa)+.5; else uv.x = (uv.x-.5)*(sa/ia)+.5; return uv; }
      vec3 samp(sampler2D t, vec2 uv, float ia, vec2 o, float s, vec2 off, float split){
        vec2 c = cover(o + (uv - o)/s + off, ia);
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
        vec3 a = samp(t0, uv, asp0, o0, s0,  dv*w*.28*(edge + .2) + rip + glitch, .008*w);
        vec3 b = samp(t1, uv, asp1, o1, s1, -dv*w*.28*(1. - edge + .2) + rip + glitch, .008*w);
        gl_FragColor = vec4(mix(a, b, edge), 1.);
      }`,
    depthTest: false, depthWrite: false,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    uniforms.res.value.set(w, h);
  }
  addEventListener("resize", resize);
  resize();

  // Cùng nhịp với bản DOM: mỗi ảnh zoom dần về điểm lấy nét, chuyển cảnh trong 35% cuối đoạn
  const N = scenes.length, seg = 1 / N, fade = seg * 0.35;
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
    uniforms.t0.value = items[from].tex; uniforms.asp0.value = items[from].aspect; uniforms.o0.value = origins[from]; uniforms.s0.value = zoom(from, p);
    uniforms.t1.value = items[to].tex;   uniforms.asp1.value = items[to].aspect;   uniforms.o1.value = origins[to];   uniforms.s1.value = zoom(to, p);
    // ảnh đứng yên (không cuộn, không chuyển cảnh) thì không vẽ lại
    if (p === lastP && m === 0 && lastW === stage.clientWidth) return;
    lastP = p; lastW = stage.clientWidth;
    uniforms.m.value = m;
    uniforms.time.value = (now - t0) / 1000;
    renderer.render(scene, cam);
  })(t0);
}

start();
