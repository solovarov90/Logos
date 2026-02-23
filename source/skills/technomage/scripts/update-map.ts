
import fs from 'fs';
import path from 'path';

const VAULT_ROOT = process.env.OBSIDIAN_VAULT_ROOT || "c:/Users/Petr/Documents/Obsidian/Technomage";
const MAP_FILE = path.join(VAULT_ROOT, "00_Map.md");

function getFiles(dir: string): string[] {
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    list.forEach((file) => {
        if (file.startsWith('.')) return;
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getFiles(fullPath));
        } else {
            if (file.endsWith('.md')) {
                results.push(path.relative(VAULT_ROOT, fullPath));
            }
        }
    });
  } catch (err) {
      // ignore
  }
  return results;
}

const allFiles = getFiles(VAULT_ROOT);
const content = `# Vault Map
Generated: ${new Date().toISOString()}

## Files
${allFiles.map(f => `- [[${f}]]`).join('\n')}
`;

fs.writeFileSync(MAP_FILE, content);
console.log(`Map updated at ${MAP_FILE}`);
