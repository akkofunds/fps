import * as THREE from 'three';

// Stylized "anime open-world" lighting for Lambert world materials, patched in via onBeforeCompile:
//  - wrap (half-Lambert) diffuse so forms read soft and round instead of harsh
//  - a warm, slightly saturated band at the light terminator (painted look)
//  - optional back-light translucency for leaves / grass
//  - drifting cloud shadows that sweep across the whole valley (one shared time uniform)
// Composes with any onBeforeCompile already on the material (wind, sway, ...).

export const STYLE = {
  uTime: { value: 0 },
  uCloud: { value: 0.42 }, // how dark a cloud shadow gets (0 = off)
};

const LAMBERT = THREE.ShaderChunk.lights_lambert_pars_fragment;

export function stylize(mat, { wrap = 0.45, translucency = 0, band = 0.12, clouds = true } = {}) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    sh.uniforms.uStyTime = STYLE.uTime;
    sh.uniforms.uStyCloud = STYLE.uCloud;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStyWP;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        {
          vec4 sWP = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            sWP = instanceMatrix * sWP;
          #endif
          vStyWP = (modelMatrix * sWP).xyz;
        }`);
    const direct = /* glsl */`
      float styCloud = 1.0;
      void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
        float nl = dot( geometryNormal, directLight.direction );
        float w = saturate( ( nl + ${wrap.toFixed(3)} ) / ${(1 + wrap).toFixed(3)} );
        w = w * w * ( 3.0 - 2.0 * w ) * 0.35 + w * 0.65;
        // warm, saturated band where light turns to shadow
        float bandK = ${band.toFixed(3)} * ( 1.0 - abs( w - 0.42 ) * 2.4 );
        vec3 irradiance = directLight.color * ( w + max( bandK, 0.0 ) * vec3( 0.55, 0.12, -0.25 ) );
        ${translucency > 0 ? `irradiance += directLight.color * pow( saturate( dot( geometryViewDir, -directLight.direction ) ), 3.0 ) * ${translucency.toFixed(3)} * vec3( 0.75, 1.0, 0.4 );` : ''}
        reflectedLight.directDiffuse += irradiance * styCloud * BRDF_Lambert( material.diffuseColor );
      }`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vStyWP;
        uniform float uStyTime, uStyCloud;
        float styHash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float styNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(styHash(i), styHash(i + vec2(1, 0)), u.x), mix(styHash(i + vec2(0, 1)), styHash(i + vec2(1, 1)), u.x), u.y); }`)
      .replace('#include <lights_lambert_pars_fragment>', LAMBERT.replace(/void RE_Direct_Lambert[\s\S]*?\n}\n/, direct + '\n'))
      .replace('#include <lights_fragment_begin>', `
        ${clouds ? `{
          vec2 cp = vStyWP.xz * 0.011 + vec2(uStyTime * 0.018, uStyTime * 0.007);
          float c = styNoise(cp) * 0.65 + styNoise(cp * 2.3 + 4.1) * 0.35;
          styCloud = 1.0 - uStyCloud * smoothstep(0.5, 0.72, c);
        }` : ''}
        #include <lights_fragment_begin>`);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|sty${wrap}${translucency}${band}${clouds}`;
  return mat;
}
