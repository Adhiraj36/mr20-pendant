/**
 * Loading a textured .glb under React Native.
 *
 * three's GLTFLoader reads the images embedded in a .glb by wrapping each one
 * in a Blob and handing itself a blob: URL. React Native has no such Blob —
 * `new Blob([arrayBuffer])` throws "Creating blobs from 'ArrayBuffer' and
 * 'ArrayBufferView' are not supported" — and no DOM <img> behind the URL
 * either, so every texture in the file fails to load and the model renders
 * bare. Nothing about the file is wrong; the loader's only route to an image
 * is one this platform does not have.
 *
 * expo-gl does have a route: its texImage2D decodes an image natively, with
 * stb_image, from an object carrying a `localUri` that points at a real file.
 * So this module unpacks the images to disk once, rewrites the file's image
 * entries to point at them, and gives the loader a texture loader that
 * produces exactly that object. From GLTFLoader's side this is the ordinary
 * external-image path, which it handles perfectly well.
 *
 * The unpacked files are cached: the work happens on the first load after an
 * install, and subsequent loads only pay for reading them back.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

interface ImageFile {
  uri: string;
  width: number;
  height: number;
}

/** The pieces of a .glb: the scene description, and the geometry it points into. */
function splitGlb(buffer: ArrayBuffer): { json: any; bin: Uint8Array } {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a glb');

  let json: any = null;
  let bin: Uint8Array | null = null;
  let at = 12;
  while (at + 8 <= view.byteLength) {
    const length = view.getUint32(at, true);
    const kind = view.getUint32(at + 4, true);
    const body = new Uint8Array(buffer, at + 8, length);
    if (kind === CHUNK_JSON) json = JSON.parse(decodeUtf8(body));
    else if (kind === CHUNK_BIN) bin = body;
    at += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error('glb has no JSON chunk');
  return { json, bin: bin ?? new Uint8Array(0) };
}

/** Reassemble a .glb, chunk lengths and 4-byte padding included. */
function buildGlb(json: any, bin: Uint8Array): ArrayBuffer {
  const jsonBytes = encodeUtf8(JSON.stringify(json));
  // The spec pads the JSON chunk with spaces and the binary chunk with zeroes.
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + (bin.length ? 8 + bin.length + binPad : 0);

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);

  view.setUint32(12, jsonBytes.length + jsonPad, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad);

  if (bin.length) {
    const binAt = 20 + jsonBytes.length + jsonPad;
    view.setUint32(binAt, bin.length + binPad, true);
    view.setUint32(binAt + 4, CHUNK_BIN, true);
    out.set(bin, binAt + 8);
  }
  return out.buffer;
}

/**
 * A PNG's dimensions, straight out of its IHDR.
 *
 * three wants the size before the image is uploaded, and only the native
 * decoder knows it otherwise. Every other format returns zeroes, which is
 * harmless here: the size matters for the power-of-two handling that WebGL 2
 * does not need.
 */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const isPng = bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50;
  if (!isPng) return { width: 0, height: 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Unpack the file's images to disk and point its image entries at them.
 *
 * Files are named by index and byte length and the folder by the size of the
 * model, so replacing the .glb unpacks afresh rather than reusing whatever the
 * last one left behind.
 */
function externaliseImages(json: any, bin: Uint8Array, modelBytes: number): Map<string, ImageFile> {
  const files = new Map<string, ImageFile>();
  const images: any[] = json.images ?? [];
  if (images.length === 0) return files;

  const folder = new Directory(Paths.cache, `glb-${modelBytes}`);
  if (!folder.exists) folder.create({ intermediates: true });

  const views: any[] = json.bufferViews ?? [];
  images.forEach((image, index) => {
    if (image.bufferView === undefined) return;
    const view = views[image.bufferView];
    const start = bin.byteOffset + (view.byteOffset ?? 0);
    const bytes = new Uint8Array(bin.buffer, start, view.byteLength);

    const file = new File(folder, `${index}-${view.byteLength}.png`);
    // Cached from a previous run: the bytes cannot have changed, because the
    // length is in the name and the folder is keyed to this exact model.
    if (!file.exists) file.write(bytes);

    files.set(file.uri, { uri: file.uri, ...pngSize(bytes) });
    // The loader now sees an ordinary external image.
    images[index] = { uri: file.uri, name: image.name };
  });
  return files;
}

/** Hands three a texture expo-gl can decode: a path, not pixels. */
class NativeFileTextureLoader extends THREE.Loader {
  constructor(private readonly files: Map<string, ImageFile>) {
    super();
  }

  load(
    url: string,
    onLoad?: (texture: THREE.Texture) => void,
    _onProgress?: unknown,
    onError?: (event: unknown) => void,
  ): THREE.Texture {
    const texture = new THREE.Texture();
    const file = this.files.get(url);
    if (!file) {
      onError?.(new Error(`no unpacked image for ${url}`));
      return texture;
    }
    // Not pixel data: expo-gl's texImage2D looks for `localUri` and decodes
    // the file itself. Width and height are read from the PNG header so three
    // knows the size without having decoded anything.
    texture.image = { localUri: file.uri, width: file.width, height: file.height };
    texture.needsUpdate = true;
    onLoad?.(texture);
    return texture;
  }
}

/** The model's scene graph, textures and all. */
export async function loadGlbScene(assetModule: number): Promise<THREE.Group> {
  const asset = Asset.fromModule(assetModule);
  await asset.downloadAsync();
  const response = await fetch(asset.localUri ?? asset.uri);
  const source = await response.arrayBuffer();

  const { json, bin } = splitGlb(source);
  const files = externaliseImages(json, bin, source.byteLength);

  const loader = new GLTFLoader();
  // GLTFLoader consults the manager for a handler matching each image URI, so
  // this is the loader's own extension point rather than a patch over it.
  if (files.size > 0) loader.manager.addHandler(/^file:\/\//, new NativeFileTextureLoader(files) as any);

  const rebuilt = files.size > 0 ? buildGlb(json, bin) : source;
  return new Promise<THREE.Group>((resolve, reject) => {
    loader.parse(rebuilt, '', (gltf) => resolve(gltf.scene), reject);
  });
}

function decodeUtf8(bytes: Uint8Array): string {
  const Decoder = (globalThis as any).TextDecoder;
  if (Decoder) return new Decoder('utf-8').decode(bytes);
  // Hermes without the polyfill. glTF JSON is almost always ASCII; this keeps
  // multi-byte names intact rather than mangling them.
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte < 0x80) out += String.fromCharCode(byte);
    else if (byte < 0xe0) out += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[++i] & 0x3f));
    else out += String.fromCharCode(((byte & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f));
  }
  return out;
}

function encodeUtf8(text: string): Uint8Array {
  const Encoder = (globalThis as any).TextEncoder;
  if (Encoder) return new Encoder().encode(text);
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(out);
}
