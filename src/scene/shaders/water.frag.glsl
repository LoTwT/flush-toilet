uniform sampler2D uBackground;
uniform sampler2D uBackgroundDepth;
uniform sampler2D uWaterState;
uniform vec2 uResolution;
uniform vec2 uRadii;
uniform vec2 uClip;
uniform float uTime;
uniform float uFlowTime;
uniform float uInflow;
uniform float uHeight;
uniform float uWaterTexel;
uniform float uTurbulence;
uniform float uSuction;
uniform vec3 uDyeColor;
uniform float uConcentration;
varying vec3 vWorld;
varying vec2 vDisk;

float surfaceHeight(vec2 disk) {
  vec2 world = vec2(disk.x * uRadii.x, disk.y * uRadii.y + vWorld.z - vDisk.y * uRadii.y);
  float drainDistance = length(world - vec2(0.0, -0.19));
  float rim = 1.0 - smoothstep(0.9, 1.0, length(disk));
  vec4 fluid = texture2D(uWaterState, disk * 0.5 + 0.5);
  return (fluid.r + fluid.a * 0.004
    - exp(-drainDistance * drainDistance * 55.0) * uSuction * 0.048) * rim;
}

void main() {
  vec4 fluid = texture2D(uWaterState, vDisk * 0.5 + 0.5);
  float streak = smoothstep(0.02, 0.38, fluid.a);
  vec2 texel = vec2(uWaterTexel * 2.0, 0.0);
  float dx = surfaceHeight(vDisk + texel.xy) - surfaceHeight(vDisk - texel.xy);
  float dz = surfaceHeight(vDisk + texel.yx) - surfaceHeight(vDisk - texel.yx);
  vec3 normal = normalize(vec3(-dx / (texel.x * 2.0 * uRadii.x), 1.0,
    -dz / (texel.x * 2.0 * uRadii.y)));
  vec2 detailPoint = vWorld.xz * 48.0 + vec2(uTime * 0.4, -uTime * 0.7);
  float detailVisibility = 1.0 - smoothstep(0.5, 1.2, length(fwidth(detailPoint)));
  float detail = waterNoise(detailPoint);
  vec2 smallNormal = vec2(waterNoise(detailPoint + vec2(0.15, 0.0)) - detail,
    waterNoise(detailPoint + vec2(0.0, 0.15)) - detail);
  normal = normalize(normal + vec3(smallNormal.x, 0.0, smallNormal.y)
    * (0.012 + uTurbulence * 4.0) * detailVisibility);

  vec2 screenUv = gl_FragCoord.xy / uResolution;
  float floorDepth = texture2D(uBackgroundDepth, screenUv).r;
  float floorHeight = cameraPosition.y - mix(uClip.x, uClip.y, floorDepth);
  float depth = clamp(vWorld.y - floorHeight, 0.0, 0.7);
  float radius = length(vDisk);
  float angle = atan(vDisk.x, vDisk.y + 0.000001);
  vec2 inlet = sampleRimFlow(angle, surfaceFlowDrop(uHeight, radius), uFlowTime, uInflow);
  float entryBlend = smoothstep(0.65, 1.0, radius);
  vec2 offset = vec2(normal.x, -normal.z) * depth * 0.025
    + rimFlowRefraction(angle, inlet, uInflow) * entryBlend;
  vec3 underWater = texture2D(uBackground, clamp(screenUv + offset, 0.001, 0.999)).rgb;
  vec3 absorption = waterAbsorption(uDyeColor, uConcentration);
  // 旋流只改变光程和表面法线，不再把纯色覆盖在水面上。
  // 水深在水线归零，但流入的薄膜仍有厚度；它必须连续跨过材质边界。
  float poolPath = depth * 2.0 * (1.0 + streak * 0.32);
  float inletPath = rimFlowOpticalPath(inlet, uInflow) * entryBlend;
  float opticalPath = max(poolPath, inletPath);
  vec3 color = transmittedWater(underWater, absorption, opticalPath);
  color += vec3(rimFlowGlint(inlet, uInflow)) * entryBlend;
  float surfaceCoverage = smoothstep(0.0, 0.025, depth);

  vec3 eye = normalize(cameraPosition - vWorld);
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(eye, normal), 0.0), 5.0);
  vec3 light = normalize(vec3(-1.4, 12.0, 1.3));
  // 以像素内法线变化展宽高光，避免微波纹在运动时闪成锯齿亮点。
  float normalVariance = dot(dFdx(normal), dFdx(normal)) + dot(dFdy(normal), dFdy(normal));
  float specularPower = 1.0 / (1.0 / 90.0 + normalVariance * 3.0);
  float highlight = pow(max(dot(normal, normalize(light + eye)), 0.0), specularPower);
  color = mix(color, vec3(0.83, 0.87, 0.84), fresnel * surfaceCoverage);
  color += vec3(1.0, 0.98, 0.9) * highlight * 0.055 * (specularPower / 90.0) * surfaceCoverage;

  vec2 foamPoint = vDisk * 46.0 + vec2(uTime * 0.15, 0.0);
  float grainVisibility = 1.0 - smoothstep(0.5, 1.2, length(fwidth(foamPoint)));
  float grain = waterNoise(foamPoint);
  // 白色仅用于稀疏气泡；像素不足时按覆盖率平均，避免闪点与大片白色泡沫。
  float bubbles = mix(0.08, smoothstep(0.65, 0.84, grain), grainVisibility);
  float foam = smoothstep(0.04, 0.2, fluid.b) * bubbles * 0.22 * surfaceCoverage;
  color = mix(color, vec3(0.91, 0.95, 0.91), foam);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
