import { PROTOCOL_VERSION } from './constants.js';
export const MAX_WIRE_BYTES = 32 * 1024 * 1024;
const MAGIC = 0x33535452;
export enum WireKind {
  Control = 1,
  Snapshot = 2,
  Tick = 3,
  Commands = 4,
  TileDelta = 5,
}
const constructors = [
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int32Array,
  Float32Array,
  Float64Array,
] as const;
type NumericArray = InstanceType<(typeof constructors)[number]>;
/** Metadata is UTF-8; bulk arrays are little-endian binary sections, never JSON number arrays. */
export function encodeWire(kind: WireKind, value: unknown): ArrayBuffer {
  const blocks: Uint8Array[] = [];
  const text = JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Set) return { $set: [...item] };
    if (ArrayBuffer.isView(item)) {
      const type = constructors.findIndex((c) => item instanceof c);
      if (type < 0) throw new TypeError('Unsupported binary array');
      const array = item as NumericArray,
        bytes = new Uint8Array(array.byteLength),
        view = new DataView(bytes.buffer);
      for (let i = 0; i < array.length; i++) {
        const offset = i * array.BYTES_PER_ELEMENT,
          n = array[i]!;
        switch (type) {
          case 0:
            view.setUint8(offset, n);
            break;
          case 1:
            view.setUint16(offset, n, true);
            break;
          case 2:
            view.setUint32(offset, n, true);
            break;
          case 3:
            view.setInt32(offset, n, true);
            break;
          case 4:
            view.setFloat32(offset, n, true);
            break;
          case 5:
            view.setFloat64(offset, n, true);
        }
      }
      blocks.push(bytes);
      return { $buffer: blocks.length - 1, type, length: array.length };
    }
    return item;
  });
  const metadata = new TextEncoder().encode(text);
  const length = 16 + metadata.length + blocks.reduce((n, b) => n + 4 + b.length, 0);
  if (length > MAX_WIRE_BYTES || metadata.length > 4 * 1024 * 1024)
    throw new RangeError('Wire packet too large');
  const bytes = new Uint8Array(length),
    view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, PROTOCOL_VERSION, true);
  view.setUint16(6, kind, true);
  view.setUint32(8, metadata.length, true);
  view.setUint32(12, length, true);
  bytes.set(metadata, 16);
  let offset = 16 + metadata.length;
  for (const block of blocks) {
    view.setUint32(offset, block.length, true);
    bytes.set(block, offset + 4);
    offset += 4 + block.length;
  }
  return bytes.buffer;
}
export function decodeWire(input: ArrayBuffer | Uint8Array): { kind: WireKind; value: unknown } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 16 || bytes.length > MAX_WIRE_BYTES) throw new RangeError('Invalid wire size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    kind = view.getUint16(6, true),
    size = view.getUint32(8, true);
  if (
    view.getUint32(0, true) !== MAGIC ||
    view.getUint16(4, true) !== PROTOCOL_VERSION ||
    kind < 1 ||
    kind > 5 ||
    view.getUint32(12, true) !== bytes.length ||
    size > 4 * 1024 * 1024 ||
    size > bytes.length - 16
  )
    throw new Error('Invalid wire header/version');
  const metadata: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(16, 16 + size)),
  );
  const blocks: Uint8Array[] = [];
  let offset = 16 + size;
  while (offset < bytes.length) {
    if (blocks.length >= 65536) throw new Error('Too many binary blocks');
    if (offset + 4 > bytes.length) throw new Error('Truncated block');
    const n = view.getUint32(offset, true);
    offset += 4;
    if (n > bytes.length - offset) throw new Error('Truncated block');
    blocks.push(bytes.subarray(offset, offset + n));
    offset += n;
  }
  let nodes = 0,
    allocated = 0;
  const used = new Set<number>();
  function restore(value: unknown, depth: number): unknown {
    if (++nodes > 1000000 || depth > 64) throw new Error('Wire nesting limit');
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => restore(v, depth + 1));
    const record = value as Record<string, unknown>;
    if ('$buffer' in record) {
      const { type, length, $buffer: index } = record;
      if (
        !Number.isInteger(type) ||
        !Number.isInteger(length) ||
        !Number.isInteger(index) ||
        Number(type) < 0 ||
        Number(type) >= constructors.length ||
        Number(length) < 0 ||
        Number(index) < 0 ||
        Object.keys(record).length !== 3
      )
        throw new Error('Invalid array descriptor');
      const constructor = constructors[Number(type)]!,
        block = blocks[Number(index)];
      if (!block || block.length !== Number(length) * constructor.BYTES_PER_ELEMENT)
        throw new Error('Invalid array length');
      if (used.has(Number(index)) || (allocated += block.length) > MAX_WIRE_BYTES)
        throw new Error('Repeated or oversized binary block');
      used.add(Number(index));
      const array = new constructor(Number(length)),
        data = new DataView(block.buffer, block.byteOffset, block.byteLength);
      for (let i = 0; i < array.length; i++) {
        const o = i * array.BYTES_PER_ELEMENT;
        switch (type) {
          case 0:
            array[i] = data.getUint8(o);
            break;
          case 1:
            array[i] = data.getUint16(o, true);
            break;
          case 2:
            array[i] = data.getUint32(o, true);
            break;
          case 3:
            array[i] = data.getInt32(o, true);
            break;
          case 4:
            array[i] = data.getFloat32(o, true);
            break;
          case 5:
            array[i] = data.getFloat64(o, true);
            break;
        }
      }
      return array;
    }
    if ('$set' in record) {
      if (!Array.isArray(record.$set) || Object.keys(record).length !== 1)
        throw new Error('Invalid set');
      return new Set(record.$set.map((v) => restore(v, depth + 1)));
    }
    for (const key of Object.keys(record)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype')
        throw new Error('Forbidden metadata key');
      record[key] = restore(record[key], depth + 1);
    }
    return record;
  }
  const value = restore(metadata, 0);
  if (used.size !== blocks.length) throw new Error('Unused binary blocks');
  return { kind, value };
}
