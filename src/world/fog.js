import * as THREE from 'three';
import { SUN_DIR, SKY } from './sky.js';

// Atmosphere for every material in the game (patched into three's shared fog chunks):
//  - distance haze that pools low in the valley and thins with altitude, so the peaks and spires
//    rise clear out of it (height fog)
//  - a faint ground mist that hugs the meadow even up close
//  - in-scattering: looking toward the sun the haze glows gold, away from it it stays lavender
// World position is rebuilt from the view-space position (cameraPosition + R^T · mv), so custom
// shader materials that already include the fog chunks get it for free.

const v3 = (v) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = cameraPosition + transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  {
    vec3 fwd = vFogWorld - cameraPosition;
    float fd = length(fwd);
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fd * fd );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, fd );
    #endif
    float hgt = exp( - max( vFogWorld.y, 0.0 ) * 0.011 );
    fogFactor *= mix( 0.42, 1.0, hgt );
    fogFactor = max( fogFactor, ( 1.0 - exp( - fd * 0.007 ) ) * exp( - max( vFogWorld.y - 0.5, 0.0 ) * 0.3 ) * 0.42 * FOG_MIST );
    float sunAmt = pow( max( dot( fwd / max( fd, 1e-3 ), ${v3(SUN_DIR)} ), 0.0 ), 5.0 );
    vec3 fc = mix( fogColor, ${v3(new THREE.Vector3(1.25, 0.78, 0.48))}, sunAmt * 0.7 * FOG_MIST );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fc, clamp( fogFactor, 0.0, 1.0 ) );
  }
#endif`;
// the Unlimited Void / Checkmate worlds set their own fog: they switch the mist + sun tint off
export const FOG = { mist: 1 };
// (scaled by the fog colour's brightness: the near-black Unlimited Void gets none of it)
THREE.ShaderChunk.fog_pars_fragment = THREE.ShaderChunk.fog_pars_fragment.replace('#ifdef USE_FOG', '#define FOG_MIST min( 1.0, dot( fogColor, vec3( 0.5 ) ) )\n#ifdef USE_FOG');
void SKY;
