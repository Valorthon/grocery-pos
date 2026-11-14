// Minimal ZIP reader for the bundle builder (#362): the pinned Windows
// archives are plain ZIP (stored or deflated, no ZIP64, no encryption).
// Node has no ZIP API and the build must not depend on `unzip` being
// installed, so this reads the central directory itself. Anything outside
// that subset is refused rather than guessed.
import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Entries of a ZIP buffer: `{ name, directory, data() }`. */
export function readZip(buffer) {
    const min = Math.max(0, buffer.length - 0xffff - 22);
    let eocd = -1;
    for (let i = buffer.length - 22; i >= min; i--) {
        if (buffer.readUInt32LE(i) === EOCD) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error('Not a ZIP archive.');
    const count = buffer.readUInt16LE(eocd + 10);
    let offset = buffer.readUInt32LE(eocd + 16);
    if (count === 0xffff || offset === 0xffffffff) {
        throw new Error('ZIP64 archives are not supported.');
    }
    const entries = [];
    for (let n = 0; n < count; n++) {
        if (buffer.readUInt32LE(offset) !== CENTRAL) {
            throw new Error('Corrupt ZIP central directory.');
        }
        const flags = buffer.readUInt16LE(offset + 8);
        const method = buffer.readUInt16LE(offset + 10);
        const compressed = buffer.readUInt32LE(offset + 20);
        const size = buffer.readUInt32LE(offset + 24);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const local = buffer.readUInt32LE(offset + 42);
        const name = buffer
            .subarray(offset + 46, offset + 46 + nameLength)
            .toString('utf8')
            .replaceAll('\\', '/');
        offset += 46 + nameLength + extraLength + commentLength;
        if (flags & 1) throw new Error(`Encrypted ZIP entry: ${name}`);
        if (
            name.startsWith('/') ||
            /^[A-Za-z]:/.test(name) ||
            name.split('/').includes('..')
        ) {
            throw new Error(`Unsafe ZIP entry path: ${name}`);
        }
        entries.push({
            name,
            directory: name.endsWith('/'),
            data() {
                if (buffer.readUInt32LE(local) !== LOCAL) {
                    throw new Error(`Corrupt ZIP entry: ${name}`);
                }
                const start =
                    local +
                    30 +
                    buffer.readUInt16LE(local + 26) +
                    buffer.readUInt16LE(local + 28);
                const raw = buffer.subarray(start, start + compressed);
                let out;
                if (method === 0) out = Buffer.from(raw);
                else if (method === 8) out = inflateRawSync(raw);
                else
                    throw new Error(
                        `Unsupported ZIP method ${method}: ${name}`,
                    );
                if (out.length !== size) {
                    throw new Error(`ZIP entry size mismatch: ${name}`);
                }
                return out;
            },
        });
    }
    return entries;
}

/** Writes a stored (uncompressed) ZIP. Test fixtures only. */
export function writeZip(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const data = Buffer.from(content);
        const nameBuf = Buffer.from(name, 'utf8');
        const local = Buffer.alloc(30);
        local.writeUInt32LE(LOCAL, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(CENTRAL, 0);
        central.writeUInt16LE(20, 6);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, nameBuf, data);
        centrals.push(central, nameBuf);
        offset += 30 + nameBuf.length + data.length;
    }
    const dir = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(EOCD, 0);
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(dir.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, dir, end]);
}
