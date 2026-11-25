/* Nexus UI Venom Button — vanilla-JS port for this static site.
 *
 * Faithful port of the Nexus UI "venom-button" registry component
 * (React + WebGL + 2D canvas) into plain JS with no dependencies.
 * Original: a glossy black pill rendered by ONE WebGL fragment shader
 * as a signed-distance field (pill + mound + tapered-capsule strands +
 * spikes + droplets, smooth-minimum melted together, lit like black
 * lacquer), strands simulated as verlet ropes with heavy damping, a
 * cartoon glove cursor on a separate 2D canvas, fine hairs + web
 * threads on another 2D canvas. Modes: idle -> seek -> grow -> hold
 * -> snap. Ghost autoplay is OFF (the original default), so the goo
 * only reacts to the visitor's own pointer. With no WebGL, or under
 * prefers-reduced-motion, the module reports supported=false and the
 * site falls back to the plain CSS glossy pill.
 *
 * Architecture for many cards: ONE shared stage (WebGL canvas + 2D fx
 * canvas) plus ONE separate hand canvas. The stage is moved into
 * whichever card's .thumb is hovered; the shader's pill rect (uPill)
 * is the hovered card's .view-btn rect measured against the thumb
 * every frame. The label stays the existing HTML .view-btn text
 * (white, above the stage canvases, below the hand canvas). The rAF
 * loop runs only while a card is hovered (plus the snap-out after the
 * pointer leaves, max ~1.2s), then stops.
 *
 * Scale: the original stage is ~420px tall with a ~520px pill; our
 * thumbs are ~360x225px and the button ~150x40px. Distances scale by
 * clamp(pillWidth / 520, 0.25, 1): sense 290, reach 140, release 215
 * (release kept above reach). The glove is scaled a little less
 * aggressively (min 0.45) so it stays readable at card size.
 */
(function () {
  'use strict';

  /* ---------- constants copied from the Nexus registry source ---------- */
  /* A cartoon glove pointer, drawn in a 32 x 36 box. The fingertip
     (the hotspot) sits at (11.5, 1). */
  var GLOVE =
    'M9 14V3.6a2.5 2.5 0 0 1 5 0V12.2a2.2 2.2 0 0 1 4.4 0.4a2.2 2.2 0 0 1 4.4 0.8a2.2 2.2 0 0 1 4.2 1.6V22c0 4-2.6 7-6 7H14.6c-3 0-5.4-1.8-6.6-4.4L4.1 18.6a2.3 2.3 0 0 1 3.6-2.8L9 17.4Z';
  var GLOVE_LINES = 'M18.4 12.6V17.2M22.8 13.4V17.6M14 12.2V16.6';
  var CUFF =
    'M12.6 28.6h12.2a1.6 1.6 0 0 1 1.6 1.6v3.4a1.6 1.6 0 0 1-1.6 1.6H12.6a1.6 1.6 0 0 1-1.6-1.6v-3.4a1.6 1.6 0 0 1 1.6-1.6Z';
  var CUFF_LINES = 'M15.4 29.2v5.4M18.7 29.2v5.4M22 29.2v5.4';
  var HOT_X = 11.5, HOT_Y = 1;
  /* Where the goo grabs the glove, in the same 32 x 36 box: index tip,
     the three knuckles, the thumb, the index joint, the palm and the
     cuff. */
  var GRIPS = [[11.5, 3.6], [16.2, 13.2], [20.6, 14], [24.9, 15.8], [5.6, 18], [11.5, 10], [18.5, 22], [18.7, 31.6]];
  /* For each grip: the angle of the band of goo across it (radians)
     and its length in glove units. */
  var BANDS = [[0, 5.6], [0, 4.6], [0, 4.6], [0, 4.4], [Math.PI / 4, 4.8], [0, 5.6], [0.08, 11], [0, 15]];
  /* With the system pointer there is no hand, so the strands gather
     round the hotspot. (Unused in glove mode; kept for fidelity.) */
  var NATIVE_GRIPS = [[0, 0], [5, 7], [-4, 6], [8, 13], [-2, 12], [3, 3], [6, 18], [0, 16]];
  var NATIVE_BANDS = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];

  /* Limits baked into the shader. */
  var MS = 7; // thick strands rendered as goo
  var NP = 12; // points per strand
  var MSPK = 8;
  var MDROP = 6;

  var STRANDS = 7; // thick strands (2 to 7); about as many fine hairs are added between them
  var SENSE0 = 290; // px from the edge at which the goo notices the cursor
  var REACH0 = 140; // px at which the strands lunge and grab the fingers
  var RELEASE0 = 215; // px at which they snap (kept above reach)

  var VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';

  /*
   * The goo is one signed distance field: the pill, a mound pulled
   * toward the hand, the strands (tapered capsules), spikes and
   * droplets, all joined with a smooth minimum so every join melts
   * into the next. The field also carries a "thickness" so each part
   * is shaded with its own round profile: a pillow for the pill, a
   * tube for a strand. Normals come from that height, and the colour
   * is a near-black lacquer reflecting a simple studio: a softbox
   * above, a window on the left, the pale floor below, plus two sharp
   * glints.
   */
  var FRAG = `precision highp float;
uniform vec2 uRes; // canvas px
uniform float uDpr;
uniform vec4 uPill; // x, y, w, h in css px
uniform vec4 uPts[${MS * NP}]; // x, y, radius, unused
uniform float uCount; // strands in use
uniform vec4 uSpk[${MSPK}]; // base x, y, tip x, y
uniform vec4 uSpkR[${MSPK}]; // base radius, alive
uniform vec4 uDrop[${MDROP}]; // x, y, r, alive
uniform vec4 uMound; // from x, y to x, y
uniform vec2 uMoundR; // radius at base, radius at tip
uniform float uLean;

vec2 smin(vec2 a, vec2 b, float k){
 // smooth union of (distance, thickness) pairs
 float h = clamp(0.5 + 0.5 * (b.x - a.x) / k, 0.0, 1.0);
 return vec2(mix(b.x, a.x, h) - k * h * (1.0 - h), mix(b.y, a.y, h));
}
// exact distance to a tapered capsule (a circle of radius ra at a, rb at b, joined by tangents)
float cone(vec2 p, vec2 a, vec2 b, float ra, float rb, out float r){
 vec2 pb = b - a;
 p -= a;
 float h = dot(pb, pb);
 float t = clamp(dot(p, pb) / (h + 1e-4), 0.0, 1.0);
 r = mix(ra, rb, t);
 float bb = ra - rb;
 if (h <= bb * bb + 1e-3) {
 // too short to taper: the larger circle swallows the smaller one
 return ra > rb ? length(p) - ra : length(p - pb) - rb;
 }
 vec2 q = vec2(dot(p, vec2(pb.y, -pb.x)), dot(p, pb)) / h;
 q.x = abs(q.x);
 vec2 c = vec2(sqrt(h - bb * bb), bb);
 float k = c.x * q.y - c.y * q.x;
 float m = dot(c, q);
 float n = dot(q, q);
 if (k < 0.0) return sqrt(h * n) - ra;
 if (k > c.x) return sqrt(h * (n + 1.0 - 2.0 * q.y)) - rb;
 return m - ra;
}
vec2 field(vec2 p){
 // the pill itself (a stadium) with a soft bevel thickness
 float rr = uPill.w * 0.5;
 vec2 c = vec2(uPill.x + uPill.z * 0.5, uPill.y + rr);
 float a = max(0.0, uPill.z * 0.5 - rr);
 vec2 q = p - c;
 vec2 body = vec2(length(q - vec2(clamp(q.x, -a, a), 0.0)) - rr, rr);
 float r;
 if (uMoundR.x > 0.01) {
 float dm = cone(p, uMound.xy, uMound.zw, uMoundR.x, uMoundR.y, r);
 body = smin(body, vec2(dm, rr), 14.0);
 }
 // strands, melted into each other a little and into the body a lot
 vec2 st = vec2(1e5, 2.0);
 for (int s = 0; s < ${MS}; s++) {
 if (float(s) >= uCount) break;
 // one strand is a hard union of its pieces (no beads at the joints)...
 vec2 one = vec2(1e5, 2.0);
 for (int i = 0; i < ${NP - 1}; i++) {
 vec4 A = uPts[s * ${NP} + i];
 vec4 B = uPts[s * ${NP} + i + 1];
 float d = cone(p, A.xy, B.xy, A.z, B.z, r);
 if (d < one.x) one = vec2(d, r + 0.3);
 }
 // ...and neighbouring strands melt together where they touch
 st = smin(st, one, 3.5);
 }
 for (int k = 0; k < ${MSPK}; k++) {
 if (uSpkR[k].y < 0.5) continue;
 float d = cone(p, uSpk[k].xy, uSpk[k].zw, uSpkR[k].x, 0.35, r);
 st = smin(st, vec2(d, r + 1.0), 3.0);
 }
 for (int k = 0; k < ${MDROP}; k++) {
 if (uDrop[k].w < 0.5) continue;
 st = smin(st, vec2(length(p - uDrop[k].xy) - uDrop[k].z, uDrop[k].z), 5.0);
 }
 vec2 res = smin(body, st, 11.0);
 // deep inside the body, keep the body's round profile even where a strand root overlaps it
 res.y = max(res.y, body.y * clamp(-body.x / 6.0, 0.0, 1.0));
 return res;
}
float dist(vec2 p){ return field(p).x; }

float env(vec3 R){
 R.x += uLean * 0.18;
 float up = -R.y;
 float e = 0.015;
 e += smoothstep(0.3, 0.5, up) * smoothstep(0.75, 0.55, up) * smoothstep(0.8, 0.5, abs(R.x)) * 2.6; // softbox above
 e += smoothstep(0.8, 0.95, up) * 0.6; // ceiling
 e += smoothstep(-0.5, -0.7, R.x) * smoothstep(0.5, 0.25, abs(R.y)) * 1.1; // window, left
 e += smoothstep(0.6, 0.85, R.x) * smoothstep(0.6, 0.2, abs(R.y)) * 0.5; // fill, right
 e += smoothstep(0.25, 0.7, R.y) * 1.25; // pale floor
 return e;
}

void main(){
 vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
 vec2 f = field(p);
 float d = f.x;
 float aa = clamp(0.5 - d * uDpr, 0.0, 1.0);

 // soft contact shadow, cast down and a little right
 float sh = 0.0;
 if (aa < 1.0) {
 float ds = dist(p - vec2(2.0, 9.0));
 sh = (1.0 - smoothstep(-4.0, 16.0, ds)) * 0.2;
 }

 vec3 col = vec3(0.0);
 if (aa > 0.0) {
 // round profile: a circle of radius = local thickness. The slope comes from the profile
 // analytically, the direction from the distance field, so the surface stays smooth.
 float B = max(f.y, 0.8);
 float s = clamp(-d, 0.0, B);
 float z = sqrt(max(1e-3, s * (2.0 * B - s)));
 float slope = min((B - s) / z, 6.0);
 float e = 0.5;
 vec2 g = vec2(dist(p + vec2(e, 0.0)) - d, dist(p + vec2(0.0, e)) - d);
 g = length(g) > 1e-6 ? normalize(g) : vec2(0.0);
 vec3 n = normalize(vec3(g * slope, 1.0));
 vec3 R = reflect(vec3(0.0, 0.0, -1.0), n);
 float fres = 0.05 + 0.95 * pow(1.0 - max(n.z, 0.0), 3.0);
 col = vec3(0.008, 0.008, 0.01) + min(env(R) * fres, 1.0) * vec3(0.93, 0.94, 0.97);
 col += pow(max(dot(R, normalize(vec3(-0.35, -0.75, 0.56))), 0.0), 70.0) * 1.2;
 col += pow(max(dot(R, normalize(vec3(0.55, -0.35, 0.76))), 0.0), 140.0) * 0.55;
 }
 float alpha = aa + (1.0 - aa) * sh;
 gl_FragColor = vec4(col * aa, alpha);
}`;

  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- shared stage DOM (one WebGL context for all cards) ---------- */
  var stageEl = document.createElement('div');
  stageEl.className = 'venom-stage';
  stageEl.setAttribute('aria-hidden', 'true');
  var glc = document.createElement('canvas');
  var fxc = document.createElement('canvas');
  stageEl.appendChild(glc);
  stageEl.appendChild(fxc);
  var hc = document.createElement('canvas'); // separate hand canvas, drawn on top
  hc.className = 'venom-hand';
  hc.setAttribute('aria-hidden', 'true');

  /* ---------- engine state ---------- */
  var S = {
    thumb: null, btn: null, card: null,
    running: false, raf: 0, prev: 0, t0: 0,
    detaching: false, detachStarted: 0,
    sense: SENSE0, reach: REACH0, release: RELEASE0,
    ro: null
  };
  var supported = false;
  var gl = null, prog = null, quad = null, U = {};
  var quadData = new Float32Array(8);
  var pts = new Float32Array(MS * NP * 4);
  var spk = new Float32Array(MSPK * 4), spkR = new Float32Array(MSPK * 4), drp = new Float32Array(MDROP * 4);
  var fx = null, hx = null;
  var gloveP = null, gloveL = null, cuffP = null, cuffL = null, handClip = null;

  var w = 0, h = 0, dpr = 1;
  var sc = 1.55; // glove draw scale (recomputed from pill width in measure)
  var fingerLift = 52;

  /* the pill in stage coordinates, re-measured every frame */
  var pill = { x: 0, y: 0, w: 0, h: 0, r: 0, ls: 0, P: 1 };

  /* ---- WebGL setup (once; without it the module stays unsupported) ---- */
  function initGL() {
    if (reduced) return false;
    try {
      fx = fxc.getContext('2d');
      hx = hc.getContext('2d');
      gloveP = new Path2D(GLOVE);
      gloveL = new Path2D(GLOVE_LINES);
      cuffP = new Path2D(CUFF);
      cuffL = new Path2D(CUFF_LINES);
      handClip = new Path2D();
      handClip.addPath(gloveP);
      handClip.addPath(cuffP);
    } catch (err) {
      return false;
    }
    if (!fx || !hx) return false;
    var g = glc.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!g) return false;
    gl = g;
    var shaders = [];
    var sh = function (t, src) {
      var s = gl.createShader(t);
      if (!s) return null;
      shaders.push(s);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    var vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
    var p = gl.createProgram();
    if (p) {
      if (vs && fs) { gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); }
      if (vs && fs && gl.getProgramParameter(p, gl.LINK_STATUS)) prog = p;
      else gl.deleteProgram(p);
    }
    if (!prog) {
      for (var i = 0; i < shaders.length; i++) gl.deleteShader(shaders[i]);
      gl = null;
      return false;
    }
    gl.useProgram(prog);
    var names = ['uRes', 'uDpr', 'uPill', 'uPts', 'uCount', 'uSpk', 'uSpkR', 'uDrop', 'uMound', 'uMoundR', 'uLean'];
    for (var n = 0; n < names.length; n++) U[names[n]] = gl.getUniformLocation(prog, names[n]);
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    var aLoc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
    glc.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      supported = false;
      abort();
    });
    return true;
  }

  /* ---------- geometry: pill rect, perimeter walk, nearest point ---------- */
  function measure() {
    if (!S.thumb || !S.btn) return;
    var a = S.thumb.getBoundingClientRect(), b = S.btn.getBoundingClientRect();
    var k = S.thumb.offsetWidth ? a.width / S.thumb.offsetWidth : 1;
    pill.x = (b.left - a.left) / k; pill.y = (b.top - a.top) / k; pill.w = b.width / k; pill.h = b.height / k;
    pill.r = pill.h / 2;
    pill.ls = Math.max(0, pill.w - pill.h);
    pill.P = 2 * pill.ls + 2 * Math.PI * pill.r || 1;
    /* distances scale with the pill: the original stage has a ~520px pill */
    var scF = Math.max(0.25, Math.min(1, pill.w / 520));
    S.sense = SENSE0 * scF; S.reach = REACH0 * scF; S.release = RELEASE0 * scF;
    /* the glove is scaled a little less aggressively so it stays readable */
    sc = 1.55 * Math.max(0.45, Math.min(1, pill.w / 520));
    fingerLift = 36 * sc;
  }

  /* point + outward normal at arc-length s around the pill perimeter */
  function at(s) {
    var x = pill.x, y = pill.y, W = pill.w, H = pill.h, r = pill.r, ls = pill.ls, P = pill.P;
    s = ((s % P) + P) % P;
    if (s < ls) return { x: x + r + s, y: y, nx: 0, ny: -1 };
    s -= ls;
    if (s < Math.PI * r) {
      var a = -Math.PI / 2 + s / r;
      return { x: x + W - r + Math.cos(a) * r, y: y + r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
    }
    s -= Math.PI * r;
    if (s < ls) return { x: x + W - r - s, y: y + H, nx: 0, ny: 1 };
    s -= ls;
    var a2 = Math.PI / 2 + s / r;
    return { x: x + r + Math.cos(a2) * r, y: y + r + Math.sin(a2) * r, nx: Math.cos(a2), ny: Math.sin(a2) };
  }

  function nearest(qx, qy) {
    var x = pill.x, W = pill.w, r = pill.r, ls = pill.ls;
    var cy = pill.y + r;
    var cx = Math.max(x + r, Math.min(x + W - r, qx));
    var dist = Math.hypot(qx - cx, qy - cy) - r;
    var s;
    if (qx > x + W - r) s = ls + (Math.atan2(qy - cy, qx - cx) + Math.PI / 2) * r;
    else if (qx < x + r) {
      var a = Math.atan2(qy - cy, qx - cx);
      if (a < -Math.PI / 2) a += Math.PI * 2;
      s = 2 * ls + Math.PI * r + (a - Math.PI / 2) * r;
    } else s = qy < cy ? qx - (x + r) : ls + Math.PI * r + (x + W - r - qx);
    return { s: s, dist: dist };
  }

  function loopDiff(a, b) {
    var P = pill.P;
    var d = (b - a) % P;
    if (d > P / 2) d -= P;
    if (d < -P / 2) d += P;
    return d;
  }

  function fit() {
    if (!S.thumb) return;
    var r = S.thumb.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = S.thumb.offsetWidth || r.width; h = S.thumb.offsetHeight || r.height;
    var cs = [glc, fxc, hc];
    for (var i = 0; i < cs.length; i++) {
      cs[i].width = Math.round(w * dpr);
      cs[i].height = Math.round(h * dpr);
    }
    if (gl) gl.viewport(0, 0, glc.width, glc.height);
    measure();
  }

  /* ---------- pointer tracking (window-wide, like the original) ---------- */
  /* Touch has no hover, so the hand follows a finger only while it is
     down, lingers a moment after it lifts (a tap is a quick poke),
     and lets go at once if the browser takes the gesture to scroll. */
  var touchOnly = !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  var LINGER = 1700; // ms the goo keeps hold after a finger lifts
  var ptr = { x: -999, y: -999, inside: false, last: 0, touch: false, down: false, upAt: 0 };
  var touched = false;
  var lastClient = { x: -999, y: -999 };

  function place(e) {
    if (!S.thumb) return;
    var r = S.thumb.getBoundingClientRect();
    var k = S.thumb.offsetWidth ? r.width / S.thumb.offsetWidth : 1;
    ptr.x = (e.clientX - r.left) / k;
    ptr.y = (e.clientY - r.top) / k;
    ptr.inside = ptr.x >= 0 && ptr.y >= 0 && ptr.x <= w && ptr.y <= h;
    if (ptr.inside) { touched = true; ptr.last = performance.now(); }
  }
  function onMove(e) {
    lastClient.x = e.clientX; lastClient.y = e.clientY;
    if (e.pointerType === 'touch') {
      if (!ptr.down || !e.isPrimary) return;
      ptr.touch = true;
    } else ptr.touch = false;
    place(e);
  }
  function onDown(e) {
    if (e.pointerType !== 'touch' || !e.isPrimary) return;
    ptr.touch = true;
    ptr.down = true;
    place(e);
  }
  function onUp(e) {
    if (e.pointerType !== 'touch' || !e.isPrimary || !ptr.down) return;
    ptr.down = false;
    ptr.upAt = performance.now();
    /* the browser took the gesture to scroll the page: let go straight away */
    if (e.type === 'pointercancel') { ptr.inside = false; ptr.last = ptr.upAt; }
  }
  /* a mouse that leaves the window sends no more moves, so without
     this the goo would keep holding */
  function onLeaveWindow() { if (!ptr.touch) ptr.inside = false; }

  /* ---------- goo state ---------- */
  /* idle -> seek (pseudopods reach for the hand) -> grow (they lunge
     for the fingers) -> hold -> snap */
  var mode = 'idle';
  var violentSnap = false;
  var grow = 0;
  var seekF = 0;
  var list = [];
  var webs = [];
  var spikes = [];
  var drops = [];
  var near = { s: 0, dist: 999 };
  var hand = { x: -999, y: -999 };
  var anchor = { x: 0, y: 0 };
  var stretch = 0;
  /* the mound is a damped spring, so it wobbles when the strands let go */
  var mound = 0, moundV = 0, moundS = 0;
  var moundDir = { x: 0, y: 1 };
  var lean = 0;
  var grips = GRIPS;
  var bands = BANDS;
  /* how far the goo has crept over each part of the glove (0 to 1);
     it lives apart from the strands so it can keep receding after
     they are gone */
  var coat = new Float32Array(GRIPS.length);

  function gripAt(g) {
    return { x: hand.x + (g[0] - HOT_X) * sc, y: hand.y + (g[1] - HOT_Y) * sc };
  }

  function spawn() {
    list = [];
    var main = Math.max(2, Math.min(MS, Math.round(STRANDS)));
    var total = main * 2 - 1;
    var root = at(near.s);
    for (var k = 0; k < total; k++) {
      var hair = k % 2 === 1;
      var mi = Math.floor(k / 2);
      /* each thick strand claims a finger; each hair takes a spot
         between two of them */
      var g = hair
        ? [(grips[mi % grips.length][0] + grips[(mi + 1) % grips.length][0]) / 2,
           (grips[mi % grips.length][1] + grips[(mi + 1) % grips.length][1]) / 2]
        : grips[mi % grips.length];
      list.push({
        x: new Float32Array(NP).fill(root.x), y: new Float32Array(NP).fill(root.y),
        px: new Float32Array(NP).fill(root.x), py: new Float32Array(NP).fill(root.y),
        spread: (k / (total - 1)) * 2 - 1 + (Math.random() - 0.5) * 0.15,
        s: near.s,
        slack: 1.02 + Math.random() * (hair ? 0.2 : 0.12),
        width: hair ? 0.5 : 0.8 + Math.random() * 0.45,
        grip: g,
        band: hair ? [0, 0] : bands[mi % bands.length],
        gi: hair ? -1 : mi % grips.length,
        reachK: hair ? 0.35 : 0.55 + Math.random() * 0.4,
        ex: root.x, ey: root.y,
        follow: 9 + Math.random() * 8,
        seg: 0, phase: Math.random() * 10, hair: hair
      });
    }
    webs = [];
    for (var k2 = 0; k2 < list.length - 1; k2++) {
      var count = 1 + Math.floor(Math.random() * 2);
      for (var c = 0; c < count; c++) {
        var i = 3 + Math.floor(Math.random() * (NP - 5));
        var j = Math.max(2, Math.min(NP - 2, i + Math.round((Math.random() - 0.5) * 3)));
        webs.push([k2, k2 + 1, i, j, (Math.random() - 0.5) * 5]);
      }
    }
    grow = 0;
    mode = 'seek';
  }

  function snap(violent) {
    if (mode === 'idle' || mode === 'snap') return;
    mode = 'snap';
    violentSnap = violent;
    if (!violent) return;
    moundV -= 90; // the body recoils
    var seen = {};
    for (var si = 0; si < list.length; si++) {
      var st = list[si];
      if (st.hair) continue;
      var key = Math.round(st.s / 8);
      if (seen[key] || spikes.length >= MSPK) continue;
      seen[key] = true;
      spikes.push({ s: st.s, tilt: (Math.random() - 0.5) * 0.8, len: 10 + Math.random() * 16, age: 0, life: 1.1 + Math.random() * 0.6 });
      if (Math.random() < 0.6 && drops.length < MDROP) {
        var i = 4 + Math.floor(Math.random() * 4);
        var root = at(st.s);
        drops.push({ x: st.x[i], y: st.y[i], vx: (root.x - st.x[i]) * 2, vy: (root.y - st.y[i]) * 2 - 40, r: 2 + Math.random() * 2.2, age: 0 });
      }
    }
  }

  function resetState() {
    mode = 'idle'; violentSnap = false; grow = 0; seekF = 0;
    list = []; webs = []; spikes = []; drops = [];
    near = { s: 0, dist: 999 };
    hand = { x: -999, y: -999 };
    stretch = 0; mound = 0; moundV = 0; moundS = 0; moundDir = { x: 0, y: 1 }; lean = 0;
    coat = new Float32Array(GRIPS.length);
    ptr.inside = false;
  }

  /* ---------- per-frame draw ---------- */
  function draw(now) {
    if (!S.thumb || !S.thumb.isConnected || !gl || !prog) { abort(); return; }
    var dt = Math.max(1 / 240, Math.min(0.033, (now - S.prev) / 1000));
    S.prev = now;
    if (!w || !h) return;
    measure();
    var time = (now - S.t0) / 1000;

    /* a lifted finger keeps hold for a moment, then lets go */
    if (ptr.touch && !ptr.down && ptr.inside && now - ptr.upAt > LINGER) { ptr.inside = false; ptr.last = now; }
    var live = ptr.inside;
    hand = { x: ptr.x, y: ptr.touch ? ptr.y - fingerLift : ptr.y };
    S.thumb.style.cursor = live ? 'none' : '';

    /* distance is measured from the middle of the hand; over the
       button it counts as touching */
    anchor = { x: hand.x + (16 - HOT_X) * sc, y: hand.y + (18 - HOT_Y) * sc };
    near = nearest(anchor.x, anchor.y);
    var D = Math.max(0, near.dist);
    /* on a narrow touch stage the sensing distance shrinks with it,
       or the whole stage would be inside `sense` */
    var dk = ptr.touch ? Math.max(0.55, Math.min(1, w / 560)) : 1;
    /* a finger is a clumsy pointer: it keeps the full grab and let-go
       distances and only senses sooner */
    var sn = S.sense * dk, rc = S.reach, rl = S.release;
    var cx = pill.x + pill.w / 2;
    lean += ((live ? Math.max(-1, Math.min(1, (hand.x - cx) / (pill.w * 1.5))) : 0) - lean) * Math.min(1, dt * 4);

    if (mode === 'idle' && live && D < sn) spawn();
    else if (mode === 'snap' && !violentSnap && live && D < sn) mode = 'seek'; // changed its mind
    else if (mode === 'seek' && (!live || D > sn + 25)) snap(false);
    else if (mode === 'seek' && D < rc) { mode = 'grow'; grow = 0; }
    else if ((mode === 'grow' || mode === 'hold') && (!live || D > rl)) snap(true);

    var holding = mode === 'hold' || mode === 'grow';
    var seeking = mode === 'seek';
    /* how hard it is reaching: nothing at the edge of its senses,
       everything at grabbing range */
    var fT = seeking ? Math.max(0, Math.min(1, (sn - D) / Math.max(1, sn - rc))) : holding ? 1 : 0;
    seekF += (fT - seekF) * Math.min(1, dt * 5);
    stretch = holding ? Math.min(1, D / rl) : 0;
    if (mode === 'grow') {
      grow = Math.min(1, grow + dt / 0.3);
      if (grow >= 1) mode = 'hold';
    }

    /* ---- simulate ---- */
    var spreadPx = Math.max(14, Math.min(pill.w * 0.3, D * 0.4 + 14)) * (seeking ? 0.65 : 1);
    var alive = 0;
    for (var si = 0; si < list.length; si++) {
      var st = list[si];
      var target = near.s + st.spread * spreadPx;
      st.s += loopDiff(st.s, target) * Math.min(1, dt * (mode === 'snap' ? 1.5 : 6));
      var root = at(st.s);
      var rx = root.x - root.nx * 3, ry = root.y - root.ny * 3;
      var pinTip = false;
      var gp = gripAt(st.grip);
      if (seeking) {
        /* a pseudopod reaching for its finger: part of the way there,
           feeling about as it goes */
        var svx = gp.x - rx, svy = gp.y - ry;
        var svl = Math.hypot(svx, svy) || 1;
        var ease = seekF * seekF * (3 - 2 * seekF);
        /* it hesitates, then darts a little further, then draws back,
           like it is testing the air */
        var dart = Math.pow(Math.max(0, Math.sin(time * 1.9 + st.phase * 3.1)), 10) * 0.28;
        var slen = Math.max(3, svl * st.reachK * 0.85 * ease * (1 + dart));
        var sway = Math.sin(time * 2.7 + st.phase) * (3 + 9 * ease) + Math.sin(time * 5.3 + st.phase * 2) * 2 * ease;
        var ttx = rx + (svx / svl) * slen - (svy / svl) * sway;
        var tty = ry + (svy / svl) * slen + (svx / svl) * sway;
        var kk = 1 - Math.exp(-dt * 6);
        st.ex += (ttx - st.ex) * kk;
        st.ey += (tty - st.ey) * kk;
        pinTip = true;
        st.seg = (Math.hypot(st.ex - rx, st.ey - ry) * (st.slack + 0.06)) / (NP - 1);
      } else if (holding) {
        /* lunge for the finger and coil in around it, then hold on and
           trail it like syrup */
        var gx = gp.x, gy = gp.y;
        if (mode === 'grow') {
          var coil = Math.pow(1 - grow, 1.6) * (st.hair ? 7 : 13);
          var coilA = st.phase + grow * Math.PI * 2.6;
          gx += Math.cos(coilA) * coil;
          gy += Math.sin(coilA) * coil * 0.8;
        }
        var kk2 = 1 - Math.exp(-dt * (mode === 'grow' ? 20 + st.follow : st.follow * 1.4));
        st.ex += (gx - st.ex) * kk2;
        st.ey += (gy - st.ey) * kk2;
        pinTip = true;
        st.seg = (Math.hypot(st.ex - rx, st.ey - ry) * st.slack) / (NP - 1);
      } else {
        st.seg *= Math.exp(-dt * 5.5); // reel back in, slowly, like something heavy
        if (st.seg * (NP - 1) > 1.5) alive++;
      }
      var damp = mode === 'snap' ? 0.86 : 0.92;
      for (var i = 1; i < NP; i++) {
        var ivx = (st.x[i] - st.px[i]) * damp, ivy = (st.y[i] - st.py[i]) * damp;
        st.px[i] = st.x[i]; st.py[i] = st.y[i];
        var mid = Math.sin((i / (NP - 1)) * Math.PI);
        var wx = Math.sin(time * 1.6 + st.phase + i * 0.55) * 14 * mid;
        var wy = Math.cos(time * 1.3 + st.phase * 1.3 + i * 0.45) * 14 * mid;
        st.x[i] += ivx + wx * dt * dt;
        st.y[i] += ivy + (260 + wy) * dt * dt;
      }
      st.x[0] = st.px[0] = rx; st.y[0] = st.py[0] = ry;
      if (pinTip) { st.x[NP - 1] = st.ex; st.y[NP - 1] = st.ey; }
      var segLen = Math.max(0.01, st.seg);
      for (var it = 0; it < 14; it++) {
        for (var j = 0; j < NP - 1; j++) {
          var cdx = st.x[j + 1] - st.x[j], cdy = st.y[j + 1] - st.y[j];
          var cd = Math.hypot(cdx, cdy) || 0.0001;
          var cdiff = (cd - segLen) / cd;
          var ca = j === 0 ? 0 : 0.5, cb = pinTip && j + 1 === NP - 1 ? 0 : j === 0 ? 1 : 0.5;
          var cm = ca + cb || 1;
          st.x[j] += cdx * cdiff * (ca / cm); st.y[j] += cdy * cdiff * (ca / cm);
          st.x[j + 1] -= cdx * cdiff * (cb / cm); st.y[j + 1] -= cdy * cdiff * (cb / cm);
        }
      }
      /* a little bending stiffness, so a strand curves like goo instead
         of folding into kinks */
      for (var pass = 0; pass < 2; pass++) {
        for (var j2 = 1; j2 < NP - 1; j2++) {
          if (pinTip && j2 === NP - 1) continue;
          st.x[j2] += ((st.x[j2 - 1] + st.x[j2 + 1]) / 2 - st.x[j2]) * 0.22;
          st.y[j2] += ((st.y[j2 - 1] + st.y[j2 + 1]) / 2 - st.y[j2]) * 0.22;
        }
      }
      if (!Number.isFinite(st.x[NP - 1])) { st.x.fill(rx); st.y.fill(ry); st.px.fill(rx); st.py.fill(ry); }
    }
    if (mode === 'snap' && alive === 0) { mode = 'idle'; list = []; webs = []; }

    /* mound spring */
    var moundTarget = holding ? 5 + 16 * stretch : seeking ? 3 + 9 * seekF : 0;
    moundV += ((moundTarget - mound) * 150 - moundV * 9) * dt;
    mound += moundV * dt;
    if (holding || seeking) {
      moundS += loopDiff(moundS, near.s) * Math.min(1, dt * 6);
      var me0 = at(moundS);
      var mtx0 = anchor.x - me0.x, mty0 = anchor.y - me0.y, mtl = Math.hypot(mtx0, mty0) || 1;
      moundDir = { x: me0.nx * 0.55 + (mtx0 / mtl) * 0.45, y: me0.ny * 0.55 + (mty0 / mtl) * 0.45 };
    }

    for (var k = spikes.length - 1; k >= 0; k--) { spikes[k].age += dt; if (spikes[k].age > spikes[k].life) spikes.splice(k, 1); }
    for (var k3 = drops.length - 1; k3 >= 0; k3--) {
      var dd = drops[k3];
      dd.age += dt;
      dd.vy += 520 * dt;
      dd.vx *= Math.exp(-dt * 2); dd.vy *= Math.exp(-dt * 1);
      dd.x += dd.vx * dt; dd.y += dd.vy * dt;
      dd.r *= Math.exp(-dt * 1.5);
      if (dd.age > 0.9 || nearest(dd.x, dd.y).dist < -dd.r) drops.splice(k3, 1);
    }

    /* ---- upload to the shader ---- */
    var thin = 1 - 0.5 * stretch;
    var mains = list.filter(function (s) { return !s.hair; }).slice(0, MS);
    var minX = pill.x, minY = pill.y, maxX = pill.x + pill.w, maxY = pill.y + pill.h;
    var grow2 = seeking ? 0.55 + 0.45 * seekF : 1;
    mains.forEach(function (stm, si) {
      for (var i = 0; i < NP; i++) {
        var f = i / (NP - 1);
        /* thick where it leaves the body, a fine thread at the hand */
        var r = (stm.width * (3.0 - 1.9 * f)) * thin * grow2;
        /* a slow pulse travels from the body toward the hand, as if it is feeding */
        if (holding) r *= 1 + 0.24 * Math.sin(f * 9 - time * 6 + stm.phase) * Math.sin(f * Math.PI);
        if (mode === 'snap') r *= 1.15; // gathering up as it slumps back
        var o = (si * NP + i) * 4;
        pts[o] = stm.x[i];
        pts[o + 1] = stm.y[i];
        pts[o + 2] = Math.max(0.55, r);
        pts[o + 3] = 1;
        minX = Math.min(minX, stm.x[i]); maxX = Math.max(maxX, stm.x[i]);
        minY = Math.min(minY, stm.y[i]); maxY = Math.max(maxY, stm.y[i]);
      }
    });
    spk.fill(0); spkR.fill(0);
    spikes.forEach(function (sp, ki) {
      var p = sp.age / sp.life;
      var up = p < 0.15 ? 1 - Math.pow(1 - p / 0.15, 3) : p > 0.45 ? Math.max(0, 1 - (p - 0.45) / 0.55) : 1;
      var len = sp.len * (p > 0.45 ? up * up * (3 - 2 * up) : up);
      var b = at(sp.s);
      var sway = Math.sin(sp.age * 14) * Math.exp(-sp.age * 3) * 0.35;
      var ang = Math.atan2(b.ny, b.nx) + sp.tilt + sway;
      var tx = b.x + Math.cos(ang) * len, ty = b.y + Math.sin(ang) * len;
      spk[ki * 4] = b.x - b.nx * 2; spk[ki * 4 + 1] = b.y - b.ny * 2; spk[ki * 4 + 2] = tx; spk[ki * 4 + 3] = ty;
      spkR[ki * 4] = 2.6 * Math.min(1, up + 0.2); spkR[ki * 4 + 1] = len > 0.6 ? 1 : 0;
      minX = Math.min(minX, tx); maxX = Math.max(maxX, tx); minY = Math.min(minY, ty); maxY = Math.max(maxY, ty);
    });
    drp.fill(0);
    drops.forEach(function (d, ki) {
      drp[ki * 4] = d.x; drp[ki * 4 + 1] = d.y; drp[ki * 4 + 2] = d.r; drp[ki * 4 + 3] = 1;
      minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x); minY = Math.min(minY, d.y); maxY = Math.max(maxY, d.y);
    });
    var me = at(moundS);
    var mlen = Math.max(0, mound);
    var mr = Math.max(0, mound) > 0.3 ? (9 + spreadPx * 0.32) * Math.min(1, mound / 6) : 0;
    var mtx = me.x + moundDir.x * mlen, mty = me.y + moundDir.y * mlen;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uRes, glc.width, glc.height);
    gl.uniform1f(U.uDpr, dpr);
    gl.uniform4f(U.uPill, pill.x, pill.y, pill.w, pill.h);
    gl.uniform4fv(U.uPts, pts);
    gl.uniform1f(U.uCount, mains.length);
    gl.uniform4fv(U.uSpk, spk);
    gl.uniform4fv(U.uSpkR, spkR);
    gl.uniform4fv(U.uDrop, drp);
    gl.uniform4f(U.uMound, me.x - me.nx * 6, me.y - me.ny * 6, mtx, mty);
    gl.uniform2f(U.uMoundR, mr, mr * 0.45);
    gl.uniform1f(U.uLean, lean);
    /* only shade the box around the goo (plus room for its shadow) */
    var pad = 34;
    var x0 = Math.max(0, minX - pad), x1 = Math.min(w, maxX + pad), y0 = Math.max(0, minY - pad), y1 = Math.min(h, maxY + pad + 10);
    var X = function (v) { return (v / w) * 2 - 1; };
    var Y = function (v) { return 1 - (v / h) * 2; };
    quadData.set([X(x0), Y(y0), X(x1), Y(y0), X(x0), Y(y1), X(x1), Y(y1)]);
    gl.bufferData(gl.ARRAY_BUFFER, quadData, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    /* ---- fine hairs and web threads on top, in 2D ---- */
    fx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fx.clearRect(0, 0, w, h);
    fx.lineCap = 'round';
    fx.lineJoin = 'round';
    if (list.length && (holding || mode === 'snap')) {
      fx.strokeStyle = 'rgba(6,6,8,0.9)';
      for (var hi = 0; hi < list.length; hi++) {
        var sth = list[hi];
        if (!sth.hair) continue;
        fx.lineWidth = 0.7 * thin;
        fx.beginPath();
        fx.moveTo(sth.x[0], sth.y[0]);
        for (var ii = 1; ii < NP - 1; ii++) fx.quadraticCurveTo(sth.x[ii], sth.y[ii], (sth.x[ii] + sth.x[ii + 1]) / 2, (sth.y[ii] + sth.y[ii + 1]) / 2);
        fx.lineTo(sth.x[NP - 1], sth.y[NP - 1]);
        fx.stroke();
      }
      if (mode === 'hold') {
        fx.strokeStyle = 'rgba(10,10,12,0.6)';
        fx.lineWidth = 0.5;
        for (var wi = 0; wi < webs.length; wi++) {
          var wb = webs[wi];
          var A = list[wb[0]], Bs = list[wb[1]];
          if (!A || !Bs) continue;
          fx.beginPath();
          fx.moveTo(A.x[wb[2]], A.y[wb[2]]);
          fx.lineTo((A.x[wb[2]] + Bs.x[wb[3]]) / 2 + wb[4], (A.y[wb[2]] + Bs.y[wb[3]]) / 2 - Math.abs(wb[4]) * 0.4);
          fx.lineTo(Bs.x[wb[3]], Bs.y[wb[3]]);
          fx.stroke();
        }
      }
    }

    /* ---- the goo creeping over the glove ---- */
    for (var gi = 0; gi < coat.length; gi++) {
      var caught = holding && list.some(function (stc) {
        var gp2 = gripAt(stc.grip);
        return stc.gi === gi && Math.hypot(stc.ex - gp2.x, stc.ey - gp2.y) < 6;
      });
      /* it spreads slowly while it holds on, and slides off quickly
         when it lets go */
      coat[gi] = caught ? Math.min(1, coat[gi] + dt * 0.5) : Math.max(0, coat[gi] - dt * 1.4);
    }

    /* ---- the glove, always on top, then the goo wrapped round each
       finger it has caught ---- */
    hx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hx.clearRect(0, 0, w, h);
    if (live) {
      hx.save();
      hx.translate(hand.x - HOT_X * sc, hand.y - HOT_Y * sc);
      hx.scale(sc, sc);
      hx.save();
      hx.translate(2.5, 4.5);
      hx.fillStyle = 'rgba(0,0,0,0.15)';
      hx.fill(gloveP); hx.fill(cuffP);
      hx.restore();
      hx.fillStyle = '#ffffff';
      hx.fill(cuffP);
      hx.fill(gloveP);
      /* living black skin spreading out from each finger it holds,
         clipped to the glove */
      if (coat.some(function (c) { return c > 0.01; })) {
        hx.save();
        hx.clip(handClip);
        for (var g2 = 0; g2 < coat.length; g2++) {
          var c = coat[g2];
          if (c < 0.01) continue;
          var e2 = c * c * (3 - 2 * c);
          var gx0 = GRIPS[g2][0], gy0 = GRIPS[g2][1];
          /* it creeps from the finger toward the middle of the hand as
             it spreads */
          var cx0 = gx0 + (17 - gx0) * e2 * 0.35, cy0 = gy0 + (20 - gy0) * e2 * 0.35;
          var R = 2.4 + e2 * 7.5;
          hx.beginPath();
          for (var k2 = 0; k2 <= 28; k2++) {
            var a2 = (k2 / 28) * Math.PI * 2;
            var rr2 = R * (1 + 0.17 * Math.sin(4 * a2 + g2 * 1.7 + time * 2.2) + 0.08 * Math.sin(7 * a2 - time * 3.1 + g2));
            var xx = cx0 + Math.cos(a2) * rr2, yy = cy0 + Math.sin(a2) * rr2;
            if (k2 === 0) hx.moveTo(xx, yy); else hx.lineTo(xx, yy);
          }
          hx.closePath();
          var grad = hx.createRadialGradient(cx0 - R * 0.35, cy0 - R * 0.4, 0, cx0, cy0, R * 1.15);
          grad.addColorStop(0, '#56565b');
          grad.addColorStop(0.28, '#141416');
          grad.addColorStop(1, '#050506');
          hx.fillStyle = grad;
          hx.fill();
        }
        hx.restore();
      }
      hx.strokeStyle = '#0b0b0b';
      hx.lineWidth = 1.9; hx.stroke(cuffP);
      hx.lineWidth = 1.1; hx.stroke(cuffL);
      hx.lineWidth = 1.9; hx.stroke(gloveP);
      hx.lineWidth = 1.1; hx.stroke(gloveL);
      hx.restore();
    }
    if (holding && list.length) {
      hx.lineCap = 'round';
      hx.lineJoin = 'round';
      for (var oi = 0; oi < list.length; oi++) {
        var sto = list[oi];
        var gp3 = gripAt(sto.grip);
        var gap = Math.hypot(sto.ex - gp3.x, sto.ey - gp3.y);
        var on = Math.max(0, Math.min(1, 1 - gap / 14));
        if (on <= 0) continue;
        /* the last stretch of the strand runs over the glove, drawn as
           one smooth taper */
        var from = NP - 4;
        hx.globalAlpha = on;
        hx.strokeStyle = '#060607';
        for (var i3 = from; i3 < NP - 1; i3++) {
          var f3 = i3 / (NP - 1);
          hx.lineWidth = Math.max(0.6, sto.width * (3.0 - 1.9 * f3) * thin * 2) * (sto.hair ? 0.45 : 1);
          var x0b = i3 === from ? sto.x[i3] : (sto.x[i3 - 1] + sto.x[i3]) / 2;
          var y0b = i3 === from ? sto.y[i3] : (sto.y[i3 - 1] + sto.y[i3]) / 2;
          var last = i3 === NP - 2;
          hx.beginPath();
          hx.moveTo(x0b, y0b);
          hx.quadraticCurveTo(sto.x[i3], sto.y[i3], last ? sto.x[NP - 1] : (sto.x[i3] + sto.x[i3 + 1]) / 2, last ? sto.y[NP - 1] : (sto.y[i3] + sto.y[i3 + 1]) / 2);
          hx.stroke();
        }
        hx.globalAlpha = 1;
      }
    }
  }

  /* ---------- frame loop ---------- */
  function frame(now) {
    if (!S.running) return;
    S.raf = requestAnimationFrame(frame);
    draw(now);
    if (S.detaching) {
      var done = (mode === 'idle' && list.length === 0) || (now - S.detachStarted > 1200);
      if (done) finishDetach();
    }
  }

  function finishDetach() {
    var thumb = S.thumb, card = S.card;
    if (thumb) {
      if (stageEl.parentNode === thumb) thumb.removeChild(stageEl);
      if (hc.parentNode === thumb) thumb.removeChild(hc);
      thumb.style.cursor = '';
    }
    if (card) card.classList.remove('venom-live');
    if (S.ro) { S.ro.disconnect(); S.ro = null; }
    S.thumb = null; S.btn = null; S.card = null;
    S.detaching = false;
    S.running = false;
    if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
    resetState();
  }

  /* ---------- public API ---------- */
  function attach(thumb, btn) {
    if (!supported || !thumb || !btn) return false;
    if (S.thumb === thumb && S.btn === btn) {
      /* re-entering the same card while snapping out: cancel the snap-out */
      S.detaching = false;
      return true;
    }
    /* moving to another card: stop whatever was running, clean slate */
    abort();
    S.thumb = thumb; S.btn = btn;
    S.card = thumb.closest ? thumb.closest('.card') : null;
    thumb.appendChild(stageEl);
    thumb.appendChild(hc);
    if (S.card) S.card.classList.add('venom-live');
    if (lastClient.x !== -999) place({ clientX: lastClient.x, clientY: lastClient.y });
    fit();
    if (!S.btn.getBoundingClientRect().width) { abort(); return false; }
    if (S.ro) S.ro.disconnect();
    S.ro = new ResizeObserver(function () { fit(); });
    S.ro.observe(thumb);
    if (!S.running) {
      S.running = true;
      S.prev = performance.now();
      S.t0 = S.prev;
      S.raf = requestAnimationFrame(frame);
    }
    return true;
  }

  function detach() {
    if (!S.thumb || S.detaching) return;
    /* the mode machine snaps the strands from here; the loop keeps
       running until they are gone (or 1.2s max), then finishDetach
       removes the stage */
    ptr.inside = false;
    S.detaching = true;
    S.detachStarted = performance.now();
  }

  function abort() {
    var thumb = S.thumb, card = S.card;
    if (thumb) {
      if (stageEl.parentNode === thumb) thumb.removeChild(stageEl);
      if (hc.parentNode === thumb) thumb.removeChild(hc);
      thumb.style.cursor = '';
    }
    if (card) card.classList.remove('venom-live');
    if (S.ro) { S.ro.disconnect(); S.ro = null; }
    S.thumb = null; S.btn = null; S.card = null;
    S.detaching = false;
    S.running = false;
    if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
    resetState();
  }

  /* ---------- init ---------- */
  supported = initGL();
  if (supported) {
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeaveWindow);
  }

  window.VenomStage = {
    attach: attach,
    detach: detach,
    abort: abort,
    supported: supported
  };
})();
