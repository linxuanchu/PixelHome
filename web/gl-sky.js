// PixelHome WebGL Pixel Sky — drop-in background for .pixel-room
// Renders a pixel-art sky with animated clouds and a glowing sun.
// If WebGL is unavailable the original CSS background stays visible.
// To roll back: delete this file and revert the one-line additions in
// index.html + styles.css.

;(function () {
  'use strict'

  var canvas = document.getElementById('glSky')
  if (!canvas) return

  var gl =
    canvas.getContext('webgl', { antialias: false, alpha: false }) ||
    canvas.getContext('experimental-webgl', { antialias: false, alpha: false })
  if (!gl) return // silent fallback — CSS sky stays

  // ── Shaders ────────────────────────────────────────────────
  var vsSrc =
    'attribute vec2 a_pos;' +
    'varying vec2 v_uv;' +
    'void main(){' +
    '  v_uv=a_pos*0.5+0.5;' +
    '  gl_Position=vec4(a_pos,0.,1.);' +
    '}'

  var fsSrc =
    'precision mediump float;' +
    'varying vec2 v_uv;' +
    'uniform vec2 u_res;' +
    'uniform float u_time;' +
    'void main(){' +
    // pixelate UVs — this is the whole pixel-art trick
    '  vec2 uv=floor(v_uv*u_res)/u_res;' +
    // sky gradient
    '  vec3 top=vec3(.31,.65,.82);' +
    '  vec3 bot=vec3(.56,.83,.91);' +
    '  vec3 sky=mix(top,bot,uv.y);' +
    // sun
    '  vec2 sp=vec2(.78,.20);' +
    '  float d=length(uv-sp);' +
    '  float core=1.-smoothstep(0.,.07,d);' +
    '  float glow=exp(-d*6.)*.6;' +
    '  vec3 sun=vec3(1.,.88,.25);' +
    '  sky=mix(sky,sun*1.2,core);' +
    '  sky+=sun*glow*.25;' +
    // pixel clouds — two layers of quantised sine waves
    '  float t=u_time*.12;' +
    '  float n1=sin((uv.x+t*.6)*7.3)*sin(uv.y*4.1+1.3)*.5+.5;' +
    '  float n2=sin((uv.x-t*.9+.4)*9.5)*sin((uv.y-.08)*3.3+2.1)*.5+.5;' +
    '  n1=floor(n1*3.)/3.;' +
    '  n2=floor(n2*3.)/3.;' +
    '  float cld=min(1.,step(.65,n1)*.85+step(.65,n2)*.6);' +
    '  sky=mix(sky,vec3(.95,.95,.92),cld);' +
    '  gl_FragColor=vec4(sky,1.);' +
    '}'

  // ── Compile & link ─────────────────────────────────────────
  function mkShader(type, src) {
    var s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('GLSL:', gl.getShaderInfoLog(s))
      return null
    }
    return s
  }

  var vs = mkShader(gl.VERTEX_SHADER, vsSrc)
  var fs = mkShader(gl.FRAGMENT_SHADER, fsSrc)
  if (!vs || !fs) return

  var prog = gl.createProgram()
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return

  var aPos = gl.getAttribLocation(prog, 'a_pos')
  var uRes = gl.getUniformLocation(prog, 'u_res')
  var uTime = gl.getUniformLocation(prog, 'u_time')

  // ── Full-screen triangle pair ──────────────────────────────
  var buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  )

  // ── Pixel grid (higher = finer; 80×45 gives chunky NES-era blocks) ──
  var PX_W = 80
  var PX_H = 45

  function resize() {
    var r = canvas.parentElement.getBoundingClientRect()
    var w = Math.floor(r.width)
    var h = Math.floor(r.height)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      gl.viewport(0, 0, w, h)
    }
  }

  // ── Render loop ────────────────────────────────────────────
  function render(ms) {
    resize()
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.uniform2f(uRes, PX_W, PX_H)
    gl.uniform1f(uTime, ms * 0.001)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    requestAnimationFrame(render)
  }

  // ── Hide CSS cloud & sun (WebGL draws them now) ───────────
  ;['.sun', '.cloud-a', '.cloud-b'].forEach(function (sel) {
    var el = document.querySelector('.pixel-room ' + sel)
    if (el) el.style.display = 'none'
  })
  canvas.parentElement.classList.add('has-gl')

  resize()
  requestAnimationFrame(render)
})()
