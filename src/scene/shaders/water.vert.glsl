uniform sampler2D uWaterState;
uniform float uHeight;
uniform vec2 uRadii;
uniform float uCenterZ;
uniform float uSuction;
varying vec3 vWorld;
varying vec2 vDisk;

void main() {
  vDisk = position.xz;
  vec3 transformed = vec3(position.x * uRadii.x, uHeight, position.z * uRadii.y + uCenterZ);
  vec4 fluid = texture2D(uWaterState, vDisk * 0.5 + 0.5);
  float displacement = fluid.r + fluid.a * 0.004;
  float drainDistance = length(transformed.xz - vec2(0.0, -0.19));
  float rim = 1.0 - smoothstep(0.9, 1.0, length(vDisk));
  transformed.y += (displacement - exp(-drainDistance * drainDistance * 55.0) * uSuction * 0.048) * rim;
  vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
