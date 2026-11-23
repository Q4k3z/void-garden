// Final composite: screen-space light shafts from the moon (depth-occlusion march),
// underwater absorption, ACES filmic tone mapping, colour grading (teal shadows,
// warm highlights), sRGB encode, vignette, subtle chromatic fringe and film grain.
export const FINAL_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Depth-only screen-space ambient occlusion at half resolution. View-space positions are
// reconstructed from depth, normals from neighbouring depths (edge-aware), and samples are
// spread on a golden-angle spiral with per-pixel rotation.
export const SSAO_FRAG = /* glsl */`
uniform sampler2D tDepth;
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform vec2 uRes;
uniform float uRadius;
uniform float uIntensity;
varying vec2 vUv;
vec3 viewPos(vec2 uv){
  float d = textureLod(tDepth, uv, 0.0).r;
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  float d = texture2D(tDepth, vUv).r;
  if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  vec2 px = 1.0 / uRes;
  vec3 pr = viewPos(vUv + vec2(px.x, 0.0)), pl = viewPos(vUv - vec2(px.x, 0.0));
  vec3 pu = viewPos(vUv + vec2(0.0, px.y)), pd = viewPos(vUv - vec2(0.0, px.y));
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 Nc = cross(dx, dy);
  float nlen = length(Nc);
  if (nlen < 1e-10) { gl_FragColor = vec4(1.0); return; }
  vec3 N = Nc / nlen;
  float ruv = clamp(uRadius * uProj[1][1] / max(-P.z, 0.1) * 0.5, 3.0 * px.y, 0.08);
  // interleaved gradient noise: well distributed, removed cleanly by the 3x3 upsample blur
  vec2 pix = floor(vUv * uRes);
  float rnd = fract(52.9829189 * fract(dot(pix, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  float ao = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float t = (float(i) + 0.5) / float(SAMPLES);
    float a = rnd + float(i) * 2.3999632;
    vec2 off = vec2(cos(a) * uRes.y / uRes.x, sin(a)) * ruv * sqrt(t);
    vec3 S = viewPos(vUv + off);
    vec3 v = S - P;
    float dist = length(v);
    float occ = max(0.0, dot(N, v / max(dist, 1e-4)) - 0.1);
    occ *= 1.0 - smoothstep(uRadius * 0.6, uRadius * 2.0, dist);
    ao += occ;
  }
  ao = clamp(1.0 - ao / float(SAMPLES) * uIntensity, 0.0, 1.0);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

export const FINAL_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform sampler2D tAO;
uniform float uAOStrength;
uniform vec2 uSunUV;
uniform float uSunVis;
uniform float uRayAmount;
uniform float uExposure;
uniform float uTime;
uniform float uUnder;
uniform float uNear;
uniform float uFar;
uniform vec2 uRes;
uniform vec3 uRayColor;
varying vec2 vUv;

float linDepth(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 color){
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= 1.0 / 0.6;
  color = IN * color; color = RRTAndODTFit(color); color = OUT * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
#ifdef USE_AO
// depth-aware 3x3 upsample/blur of the half-resolution AO
float aoAt(vec2 uv){
  float d0 = linDepth(texture2D(tDepth, uv).r);
  float sum = 0.0, wsum = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)) * 2.0 / uRes;
    float a = textureLod(tAO, uv + o, 0.0).r;
    float d = linDepth(textureLod(tDepth, uv + o, 0.0).r);
    float w = exp(-abs(d - d0) / (0.04 * d0 + 0.05));
    sum += a * w; wsum += w;
  }
  return sum / max(wsum, 1e-4);
}
#endif

void main(){
  vec2 uv = vUv;
  vec2 fromC = uv - 0.5;
  // chromatic fringe toward the edges
  float ca = dot(fromC, fromC) * 0.0045;
  vec3 col;
  col.r = texture2D(tDiffuse, uv + fromC * ca).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - fromC * ca).b;

  #ifdef USE_AO
  {
    float ao = aoAt(uv);
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col *= mix(1.0, ao, uAOStrength * (1.0 - smoothstep(0.4, 2.5, lum))); // glowing surfaces are not occluded
  }
  #endif

  #if RAY_SAMPLES > 0
  if (uSunVis > 0.001) {
    vec2 delta = (uv - uSunUV) / float(RAY_SAMPLES) * 0.9;
    vec2 p = uv;
    float illum = 0.0, decay = 1.0;
    float jitter = hash(uv * uRes + uTime) ;
    p -= delta * jitter;
    vec2 asp = vec2(uRes.x / uRes.y, 1.0);
    float wsum = 0.0;
    for (int i = 0; i < RAY_SAMPLES; i++) {
      p -= delta;
      float d = textureLod(tDepth, clamp(p, 0.0, 1.0), 0.0).r;
      float sky = step(0.99999, d);
      // only sky close to the moon emits: shafts appear where silhouettes cut that glow
      float near = exp(-dot((p - uSunUV) * asp, (p - uSunUV) * asp) * 9.0);
      illum += sky * near * decay;
      wsum += near * decay;
      decay *= 0.97;
    }
    illum /= max(wsum, 1e-3);
    float falloff = 1.0 - smoothstep(0.0, 0.85, length((uv - uSunUV) * asp));
    col += uRayColor * illum * falloff * falloff * uSunVis * uRayAmount;
  }
  #endif

  // underwater absorption and haze
  if (uUnder > 0.001) {
    float ld = linDepth(texture2D(tDepth, uv).r);
    float ab = 1.0 - exp(-ld * 0.11);
    vec3 waterCol = vec3(0.004, 0.05, 0.055);
    col = mix(col * vec3(0.45, 0.85, 0.8), waterCol, ab * uUnder);
    col += vec3(0.0, 0.03, 0.03) * (0.5 + 0.5 * sin(uv.x * 40.0 + uTime * 2.0 + sin(uv.y * 25.0 + uTime))) * uUnder * (1.0 - ab);
  }

  col *= uExposure;
  col = aces(col);
  // grading in display-referred space
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 shadowTint = vec3(0.86, 1.03, 1.06), highTint = vec3(1.05, 1.0, 0.94);
  col *= mix(shadowTint, highTint, smoothstep(0.15, 0.75, l));
  col = mix(vec3(l), col, 1.06);
  col = clamp(col, 0.0, 1.0);
  col = toSRGB(col);
  // vignette + grain
  float vig = smoothstep(1.05, 0.35, length(fromC * vec2(1.0, 0.85)) * 1.25);
  col *= mix(0.78, 1.0, vig);
  col += (hash(uv * uRes + fract(uTime * 13.7)) - 0.5) * 0.022;
  gl_FragColor = vec4(col, 1.0);
}
`;
