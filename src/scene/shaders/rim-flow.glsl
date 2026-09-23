// 贴壁水、入水过渡和高度场入口共用同一流束，避免在水线换一套纹理。
float surfaceFlowDrop(float height, float radius) {
  return 0.78 - height + max(0.0, 1.0 - radius) * 0.6;
}

vec2 sampleRimFlow(float angle, float drop, float time, float inflow) {
  if (inflow < 0.001) return vec2(0.0, 0.5);
  vec2 direction = vec2(sin(angle), cos(angle));
  float angularPixelWidth = max(length(dFdx(direction)), length(dFdy(direction)));
  // 使用周期坐标，圆周首尾的细节和导数也连续。
  vec2 detailPoint = direction * 6.0 + vec2(drop * 14.0 - time * 2.8, -drop * 8.0);
  float detailVisibility = 1.0 - smoothstep(0.6, 1.5, length(fwidth(detailPoint)));
  float variation = mix(0.5, waterNoise(detailPoint), detailVisibility);
  float jets = 0.0;
  for (int index = 0; index < RIM_JET_COUNT; index++) {
    float i = float(index);
    float target = rimJetAngle(i) + rimJetTurn(drop);
    float distance = atan(sin(angle - target), cos(angle - target));
    float pulse = waterNoise(vec2(time * 1.2 - drop * 4.0, i * 5.31));
    float width = (0.032 + drop * 0.1 + min(inflow, 1.5) * 0.025)
      * (0.7 + pulse * 0.6) * STREAM_WIDTH_SCALE;
    distance += (variation - 0.5) * 0.09 * drop;
    width = max(width, angularPixelWidth + fwidth(variation) * 0.09 * drop);
    jets += exp(-distance * distance / (width * width)) * (0.65 + pulse * 0.35);
  }
  return vec2(min(1.0, jets) * (0.55 + variation * 0.45), variation);
}

float rimFlowOpticalPath(vec2 flow, float inflow) {
  return (0.006 + flow.x * 0.3) * min(inflow, 1.5) * smoothstep(0.0, 0.12, inflow);
}

vec2 rimFlowRefraction(float angle, vec2 flow, float inflow) {
  return vec2(sin(angle), -cos(angle)) * (flow.y - 0.5) * flow.x * 0.0015
    * smoothstep(0.0, 0.12, inflow);
}

float rimFlowGlint(vec2 flow, float inflow) {
  return 0.012 * smoothstep(0.65, 0.86, flow.y) * flow.x * min(inflow, 1.0);
}
