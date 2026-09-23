vec3 waterAbsorption(vec3 dyeColor, float concentration) {
  // 用染色后的透光率推导吸收系数，水层仍透出陶瓷与池底的明暗。
  vec3 clearAbsorption = vec3(0.06, 0.025, 0.015);
  vec3 dyeAbsorption = -log(clamp(dyeColor, vec3(0.04), vec3(0.95))) * 0.85;
  return mix(clearAbsorption, dyeAbsorption, concentration);
}

vec3 transmittedWater(vec3 backgroundColor, vec3 absorption, float opticalPath) {
  return backgroundColor * exp(-absorption * max(opticalPath, 0.0));
}
