uniform float uTime;
uniform float uInflow;
uniform float uHeight;
uniform sampler2D uBackground;
uniform vec2 uResolution;
uniform vec3 uDyeColor;
uniform float uConcentration;
varying vec2 vUv;
varying vec3 vPosition;

void main() {
  if (uInflow < 0.001 || vPosition.y < uHeight - 0.04 || vPosition.y > 0.78) discard;
  float angle = vUv.x * 6.283185;
  float drop = 0.78 - vPosition.y;
  vec2 flow = sampleRimFlow(angle, drop, uTime, uInflow);
  // 贴壁水延伸至水线下方，由水面的深度遮挡结束，避免提前淡出留下白环。
  float heightFade = smoothstep(uHeight - 0.04, uHeight - 0.008, vPosition.y)
    * (1.0 - smoothstep(0.745, 0.785, vPosition.y));
  vec2 screenUv = gl_FragCoord.xy / uResolution;
  vec2 offset = rimFlowRefraction(angle, flow, uInflow);
  vec3 underFilm = texture2D(uBackground, clamp(screenUv + offset, 0.001, 0.999)).rgb;
  float opticalPath = rimFlowOpticalPath(flow, uInflow);
  vec3 color = transmittedWater(underFilm, waterAbsorption(uDyeColor, uConcentration), opticalPath);
  color += vec3(rimFlowGlint(flow, uInflow));
  gl_FragColor = vec4(color, heightFade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
