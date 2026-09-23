uniform sampler2D uPrevious;
uniform float uStep;
uniform float uTexel;
uniform float uTime;
uniform float uInflow;
uniform float uSwirl;
uniform float uSuction;
uniform float uHeight;
uniform vec2 uDrain;
varying vec2 vUv;

float surfaceAt(vec2 uv, float center) {
  // 便池边缘采用反射边界；离开圆形水域的采样不能吸走波纹。
  return length(uv * 2.0 - 1.0) < 0.98 ? texture2D(uPrevious, uv).r : center;
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  if (length(p) > 0.99) { gl_FragColor = vec4(0.0); return; }
  vec2 relative = p - uDrain * min(uSuction * 0.5, 0.65);
  float radius = length(relative);
  vec2 velocity = vec2(relative.y, -relative.x) * uSwirl * 1.1 / (0.45 + radius * radius);
  velocity -= (p - uDrain) * (uSuction * 0.36 + uInflow * 0.18);
  vec2 backUv = clamp(vUv - velocity * uStep * 0.5, 0.005, 0.995);
  vec4 previous = texture2D(uPrevious, backUv);
  float texel = uTexel;
  float left = surfaceAt(backUv - vec2(texel, 0.0), previous.r);
  float right = surfaceAt(backUv + vec2(texel, 0.0), previous.r);
  float up = surfaceAt(backUv + vec2(0.0, texel), previous.r);
  float down = surfaceAt(backUv - vec2(0.0, texel), previous.r);
  float cellSize = texel * 2.0;
  float laplacian = (left + right + up + down - 4.0 * previous.r) / (cellSize * cellSize);

  float force = 0.0;
  float impact = 0.0;
  for (int index = 0; index < RIM_JET_COUNT; index++) {
    float i = float(index);
    float angle = rimJetAngle(i) + rimJetTurn(0.78 - uHeight);
    vec2 origin = vec2(sin(angle), cos(angle)) * 0.955;
    float jet = exp(-dot(p - origin, p - origin) * 480.0);
    float pulse = waterNoise(vec2(uTime * (7.0 + i * 0.7), i * 5.31)) * 2.0 - 1.0;
    force += jet * pulse * uInflow * 2.4;
    impact += jet * max(0.0, uInflow - 0.2) * (0.7 + pulse * 0.3);
  }
  float speed = (previous.g + (laplacian * 0.09 + force) * uStep) * exp(-uStep * 1.1);
  float height = (previous.r + speed * uStep) * exp(-uStep * 0.35);
  float drain = exp(-dot(p - uDrain, p - uDrain) * 35.0) * uSuction;
  float foam = previous.b * exp(-uStep * (0.5 + drain * 3.0)) + impact * uStep * 2.4;
  float settling = 1.0 - smoothstep(0.05, 0.3, uSwirl);
  float streak = previous.a * exp(-uStep * (0.24 + drain * 3.5 + settling));
  float bowlRadius = length(p);
  float angle = atan(p.x, p.y + 0.000001);
  vec2 inlet = sampleRimFlow(angle, surfaceFlowDrop(uHeight, bowlRadius), uTime, uInflow);
  // 入口约束沿用贴壁水的形状与相位，随后由速度场把它带入内部。
  streak = mix(streak, inlet.x * min(uInflow, 1.5), smoothstep(0.82, 0.985, bowlRadius));
  gl_FragColor = vec4(clamp(height, -0.035, 0.035), clamp(speed, -0.3, 0.3),
    min(foam, 1.0), min(streak, 1.0));
}
