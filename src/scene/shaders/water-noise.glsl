#define RIM_JET_COUNT 7

// 贴壁水柱与进入水面的旋流共用宽度倍率，保持接合处的粗细一致。
const float STREAM_WIDTH_SCALE = 1.35;

float waterHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float waterNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), f.x),
    mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0)), f.x), f.y);
}

float rimJetAngle(float index) {
  return index * 6.283185 / float(RIM_JET_COUNT) + sin(index * 8.21) * 0.14;
}

float rimJetTurn(float drop) {
  return drop * 1.5 + drop * drop * 0.6;
}
