// Executed from a fixed string, with all file names and contents passed as data.
// No source code or filesystem path from a PR is interpolated into the program.
export function sandboxFileProgram(checkout: string) {
  return `
const fs = require('node:fs');
const path = require('node:path');
const [operation, relative] = process.argv.slice(1);
const root = ${JSON.stringify(checkout)};
try {
  if (!relative || relative.includes('\\\\') || relative.includes('\\0') || path.isAbsolute(relative) || relative.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Invalid sandbox file path.');
  let current = root;
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw Error('Invalid checkout directory.');
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    try { if (operation !== 'read' && fs.lstatSync(current).isSymbolicLink()) throw Error('Symlink paths are not allowed.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (operation === 'read') {
    current = fs.realpathSync(current);
    if (!current.startsWith(fs.realpathSync(root) + path.sep)) throw Error('File escapes sandbox.');
    const handle = fs.openSync(current, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(handle);
    if (!stat.isFile()) throw Error('Sandbox file must be a regular file.');
    const buffer = Buffer.alloc(Math.min(stat.size, 256000));
    const length = fs.readSync(handle, buffer, 0, buffer.length, 0);
    process.stdout.write(buffer.subarray(0, length));
    fs.closeSync(handle);
  } else if (operation === 'write') {
    if (!/^\\.change-verifier\\/[a-zA-Z0-9_-]+\\.(test\\.ts|config\\.mjs)$/.test(relative)) throw Error('Invalid generated artifact path.');
    const directory = path.dirname(current);
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, {mode: 0o700});
    if (fs.lstatSync(directory).isSymbolicLink()) throw Error('Symlink paths are not allowed.');
    const contents = fs.readFileSync(0);
    if (contents.length > 32000) throw Error('Generated file exceeds the size limit.');
    const handle = fs.openSync(current, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(handle, contents);
    fs.closeSync(handle);
  } else if (operation === 'replace') {
    if (!/^[a-zA-Z0-9_/-]+\\.(ts|tsx|js|jsx)$/.test(relative) || relative.split('/').some(p => /^(node_modules|tests?|__tests__|fixtures?|__fixtures__|scripts|dist|build|coverage)$/i.test(p)) || /(^|[/.\\-])(test|spec|config|setup|lock)([/.\\-]|$)/i.test(relative) || /\\.d\\.ts$/.test(relative)) throw Error('Repair path is not application source.');
    const input = fs.readFileSync(0);
    if (input.length > 32000) throw Error('Repair exceeds size limit.');
    const change = JSON.parse(input);
    if (typeof change.content !== 'string' || !change.content.trim() || Buffer.byteLength(change.content) > 24000 || !/^[a-f0-9]{64}$/.test(change.expectedSha256)) throw Error('Invalid source replacement.');
    const handle = fs.openSync(current, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(handle);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 24000) throw Error('Repair requires a bounded regular file without hard links.');
      const before = fs.readFileSync(handle);
      if (require('node:crypto').createHash('sha256').update(before).digest('hex') !== change.expectedSha256) throw Error('Source hash changed; repair refused.');
      fs.ftruncateSync(handle, 0);
      fs.writeSync(handle, change.content, 0, 'utf8');
    } finally { fs.closeSync(handle); }
  } else throw Error('Unsupported file operation.');
} catch (error) { process.stderr.write(error.message); process.exitCode = error.code === 'ENOENT' ? 44 : 1; }
`;
}
