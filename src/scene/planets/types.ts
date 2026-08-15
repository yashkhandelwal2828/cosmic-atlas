import type * as THREE from 'three'

export interface PlanetVisuals {
  globe: THREE.Mesh
  atmosphere?: THREE.Mesh
  clouds?: THREE.Mesh
  rings?: THREE.Mesh
  materials: THREE.ShaderMaterial[]
}

export interface PlanetUpdateCtx {
  time: number
  sunPosition: THREE.Vector3
  /** World position of Earth — Moon earthshine. */
  earthPosition?: THREE.Vector3
}

export interface PlanetMaps {
  albedo?: THREE.Texture | null
  night?: THREE.Texture | null
  clouds?: THREE.Texture | null
  normal?: THREE.Texture | null
  specular?: THREE.Texture | null
  atmosphere?: THREE.Texture | null
  rings?: THREE.Texture | null
}
