import {
  CompressedCubeTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  RGBA_BPTC_Format,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT3_Format,
  RGBA_S3TC_DXT5_Format,
  UnsignedByteType,
} from 'three'
import type { SkyData } from '../assets/sky.ts'

const FORMAT = { bc1: RGBA_S3TC_DXT1_Format, bc2: RGBA_S3TC_DXT3_Format, bc3: RGBA_S3TC_DXT5_Format, bc7: RGBA_BPTC_Format, rgba: RGBAFormat } as const

export function makeSkyTexture(d: SkyData): CompressedCubeTexture {
  const images = d.faces.map((levels) => ({
    width: d.size,
    height: d.size,
    mipmaps: levels.map((data, i) => ({ data, width: Math.max(1, d.size >> i), height: Math.max(1, d.size >> i) })),
  }))
  const tex = new CompressedCubeTexture(images as never, FORMAT[d.fmt] as never, UnsignedByteType)
  tex.colorSpace = NoColorSpace
  tex.magFilter = LinearFilter
  tex.minFilter = LinearMipmapLinearFilter
  tex.generateMipmaps = false
  tex.flipY = false
  tex.needsUpdate = true
  return tex
}
