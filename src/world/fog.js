import * as THREE from 'three';
import { SUN_DIR, SKY } from './sky.js';

// Atmosphere for every material in the game (patched into three's shared fog chunks):
//  - light distance haze that thins with altitude
//  - a mist wall past the valley rim: the far lands fade into low mist (the map's barrier); the
//    battle area itself stays clear
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
    // light aerial perspective only; inside the valley the air stays clear
    fogFactor *= mix( 1.0, mix( 0.5, 1.0, exp( - max( vFogWorld.y, 0.0 ) * 0.006 ) ), FOG_MIST );
    // the mist wall: the world fades into low mist past the valley rim (the map's barrier)
    float wr = length( vFogWorld.xz );
    float barrier = smoothstep( 235.0, 470.0, wr ) * exp( - max( vFogWorld.y - 45.0, 0.0 ) * 0.012 ) * smoothstep( 40.0, 160.0, fd );
    fogFactor = max( fogFactor, barrier * 0.75 * FOG_MIST );
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
